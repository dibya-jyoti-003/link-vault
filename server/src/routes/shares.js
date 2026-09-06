import '../config/env.js';
import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import Share from '../models/Share.js';
import { purgeShare } from '../jobs/cleanup.js';
import { requireAuth, extractToken } from '../middleware/auth.js';
import { requireTrustedOriginIfCookie } from '../middleware/csrf.js';
import { uploadFile, deleteFile, getObjectStream } from '../services/storage.js';
import { Errors } from '../utils/apiError.js';
import {
  sanitizeFilename,
  getExtension,
  getBlockedExtensions,
  contentDispositionFilename,
} from '../utils/sanitize.js';
import {
  publicShareRateLimiter,
  checkPasswordLockout,
  recordPasswordFailure,
  resetPasswordFailures,
} from '../middleware/rateLimit.js';

const router = express.Router();

const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB || '20', 10)) * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = (process.env.ALLOWED_MIME_PREFIXES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Never trust the client-declared MIME type alone - it's easy to spoof.
    // We still honor an allowlist when configured...
    if (allowed.length > 0 && !allowed.some((p) => file.mimetype.startsWith(p))) {
      return cb(Errors.unsupportedFileType('This file type is not allowed'));
    }
    // ...and additionally block known-dangerous extensions regardless of MIME.
    const ext = getExtension(file.originalname);
    if (ext && getBlockedExtensions().has(ext)) {
      return cb(Errors.unsupportedFileType(`Files with a .${ext} extension are not allowed`));
    }
    cb(null, true);
  },
});

function toBool(v) {
  return v === true || v === 'true' || v === '1' || v === 'on';
}

function minutesFromNow(mins) {
  const ms = Math.max(1, mins) * 60 * 1000;
  return new Date(Date.now() + ms);
}

function fullShareUrl(id) {
  const client = (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';
  const base = (client || process.env.BASE_URL || '').replace(/\/$/, '');
  if (!base) return `/share/${id}`;
  return `${base}/share/${id}`;
}

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const shares = await Share.find({ owner: req.user._id })
      .sort({ createdAt: -1 })
      .select('shortId type expiresAt views downloadCount maxViews oneTime consumed createdAt file.originalName');
    res.json({ shares });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireTrustedOriginIfCookie, requireAuth, upload.single('file'), async (req, res, next) => {
  // Track what we've uploaded to R2/local storage so we can roll it back
  // if creating the database record fails - otherwise a Mongo hiccup
  // would leave an orphaned object with nothing referencing it.
  let uploadedObjectKey;

  try {
    const { text, expiresInMinutes, expiresAt, password, oneTime, maxViews } = req.body;

    const hasText = typeof text === 'string' && text.trim().length > 0;
    const hasFile = !!req.file;

    if (!hasText && !hasFile) {
      throw Errors.invalidRequest('Provide either text or a file');
    }
    if (hasText && hasFile) {
      throw Errors.invalidRequest('Provide only one: text or file');
    }

    if (hasText && text.length > 100_000) {
      throw Errors.textTooLarge('Text exceeds 100k characters limit');
    }

    let expiry;
    if (expiresAt) {
      // The frontend is expected to send a full ISO-8601 UTC timestamp
      // (`new Date(localValue).toISOString()`), never a bare
      // timezone-less "datetime-local" string - `new Date()` would
      // otherwise interpret that in the *server's* local timezone,
      // silently corrupting the expiry for anyone not in that timezone.
      const dt = new Date(expiresAt);
      if (Number.isNaN(dt.getTime())) {
        throw Errors.invalidRequest('Invalid expiresAt');
      }
      expiry = dt;
    } else if (expiresInMinutes) {
      const mins = parseInt(String(expiresInMinutes), 10);
      if (!Number.isFinite(mins) || mins <= 0 || mins > 60 * 24 * 30) {
        throw Errors.invalidRequest('Invalid expiresInMinutes');
      }
      expiry = minutesFromNow(mins);
    } else {
      const def = parseInt(process.env.DEFAULT_EXPIRY_MINUTES || '10', 10);
      expiry = minutesFromNow(def);
    }

    const shortId = nanoid(10);
    const manageToken = nanoid(24);
    const oneTimeFlag = toBool(oneTime);
    const mv = maxViews != null && String(maxViews).trim() !== '' ? parseInt(String(maxViews), 10) : undefined;
    if (mv != null && (!Number.isFinite(mv) || mv <= 0 || mv > 1000)) {
      throw Errors.invalidRequest('Invalid maxViews');
    }

    let passwordHash;
    if (password && String(password).length > 0) {
      passwordHash = await bcrypt.hash(String(password), 10);
    }

    let fileMeta;
    if (hasFile) {
      // The original filename is metadata only - never used to build a
      // server-side path. Storage always uses a randomly generated key.
      const safeName = sanitizeFilename(req.file.originalname);
      const { objectKey } = await uploadFile({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: safeName,
      });
      uploadedObjectKey = objectKey;
      fileMeta = {
        originalName: safeName,
        mimeType: req.file.mimetype,
        size: req.file.size,
        objectKey,
      };
    }

    const doc = {
      shortId,
      owner: req.user._id,
      type: hasFile ? 'file' : 'text',
      text: hasText ? text : undefined,
      file: hasFile ? fileMeta : undefined,
      passwordHash,
      oneTime: oneTimeFlag,
      maxViews: mv,
      expiresAt: expiry,
      manageToken,
    };

    let share;
    try {
      share = await Share.create(doc);
    } catch (dbErr) {
      // Roll back the just-uploaded object - otherwise it's orphaned in
      // storage forever with no Share document ever pointing at it.
      if (uploadedObjectKey) {
        try {
          await deleteFile({ objectKey: uploadedObjectKey });
        } catch (rollbackErr) {
          console.error(
            `Rollback failed: could not delete orphaned storage object ${uploadedObjectKey} after a database error`,
            rollbackErr
          );
        }
      }
      throw dbErr;
    }

    return res.status(201).json({
      id: share.shortId,
      url: fullShareUrl(share.shortId),
      type: share.type,
      expiresAt: share.expiresAt,
      requiresPassword: !!passwordHash,
      manageToken,
    });
  } catch (err) {
    next(err);
  }
});

async function loadShareById(shortId) {
  return Share.findOne({ shortId });
}

function isExpired(share) {
  return !share || new Date(share.expiresAt).getTime() <= Date.now();
}

async function verifyPasswordIfNeeded(req, share) {
  if (!share.passwordHash) return;

  checkPasswordLockout(req);

  const provided = req.header('x-share-password');
  if (!provided) {
    throw Errors.passwordRequired();
  }

  const ok = await bcrypt.compare(String(provided), share.passwordHash);
  if (!ok) {
    recordPasswordFailure(req);
    throw Errors.invalidPassword();
  }
  resetPasswordFailures(req);
}

/**
 * Atomically record a view/download against a share, honoring the
 * expiry, max-views and one-time constraints in a single database
 * operation so concurrent requests can never both "win" past a limit.
 *
 * Returns the updated document, or null if the access should be denied
 * (limit reached, one-time link already consumed, or expired mid-flight).
 */
async function atomicRecordAccess(share, counterField) {
  const filter = { _id: share._id, expiresAt: { $gt: new Date() } };
  if (share.oneTime) filter.consumed = false;
  if (share.maxViews != null) filter[counterField] = { $lt: share.maxViews };

  const update = { $inc: { [counterField]: 1 } };
  if (share.oneTime) update.$set = { consumed: true };

  return Share.findOneAndUpdate(filter, update, { new: true });
}

router.get('/:id', publicShareRateLimiter, async (req, res, next) => {
  try {
    const { id } = req.params;
    const share = await loadShareById(id);
    if (!share) throw Errors.shareNotFound();
    if (isExpired(share)) throw Errors.shareExpired();
    if (share.oneTime && share.consumed) {
      throw Errors.accessLimitReached('This one-time link has already been used.');
    }

    await verifyPasswordIfNeeded(req, share);

    if (share.type === 'text') {
      if (share.maxViews != null && share.views >= share.maxViews) {
        throw Errors.accessLimitReached('View limit reached');
      }

      const updated = await atomicRecordAccess(share, 'views');
      if (!updated) {
        throw Errors.accessLimitReached('View limit reached');
      }

      res.json({
        id: updated.shortId,
        type: 'text',
        text: updated.text,
        expiresAt: updated.expiresAt,
        remainingViews: updated.maxViews != null ? Math.max(0, updated.maxViews - updated.views) : null,
      });

      // Shares that merely hit maxViews stay visible in the owner's
      // dashboard; only true one-time links are purged after use.
      if (updated.oneTime) {
        res.on('finish', async () => {
          try { await purgeShare(updated); } catch { /* logged in purgeShare */ }
        });
      }
    } else {
      // File metadata only - the download itself (and its counters) is
      // handled by the /download endpoint below.
      res.json({
        id: share.shortId,
        type: 'file',
        fileName: share.file?.originalName,
        size: share.file?.size,
        mimeType: share.file?.mimeType,
        downloadUrl: `/api/v1/shares/${share.shortId}/download`,
        expiresAt: share.expiresAt,
        requiresPassword: !!share.passwordHash,
        remainingDownloads:
          share.maxViews != null ? Math.max(0, share.maxViews - share.downloadCount) : null,
      });
    }
  } catch (err) {
    next(err);
  }
});

// The sole, authoritative access point for file bytes. Every check
// (expiry, password, limits, one-time consumption) happens here, and the
// object is streamed straight from storage into the response - the
// client never gets a signed URL to a bucket it could otherwise poke at
// directly.
router.get('/:id/download', publicShareRateLimiter, async (req, res, next) => {
  try {
    const { id } = req.params;
    const share = await loadShareById(id);
    if (!share) throw Errors.shareNotFound();
    if (isExpired(share)) throw Errors.shareExpired();
    if (share.type !== 'file') throw Errors.invalidRequest('Not a file share');
    if (share.oneTime && share.consumed) {
      throw Errors.accessLimitReached('This one-time link has already been used.');
    }

    await verifyPasswordIfNeeded(req, share);

    if (share.maxViews != null && share.downloadCount >= share.maxViews) {
      throw Errors.accessLimitReached('Download limit reached');
    }

    // Atomically consume the access *before* touching storage, so a lost
    // race (or a retried request) can never result in more than the
    // allowed number of authorized attempts - regardless of what happens
    // to the storage fetch afterward.
    const updated = await atomicRecordAccess(share, 'downloadCount');
    if (!updated) {
      throw Errors.accessLimitReached('Download limit reached');
    }

    const objectKey = updated.file?.objectKey;
    if (!objectKey) throw Errors.internal('Missing file');

    let stream;
    try {
      const obj = await getObjectStream(objectKey);
      stream = obj.stream;
    } catch (storageErr) {
      // The counter/one-time flag is already committed at this point.
      // For a project this size we deliberately don't try to build
      // exactly-once semantics (e.g. rolling back the counter here would
      // just reopen the original race). The policy is simpler and more
      // honest: this was one successful *authorized* download attempt;
      // whether the bytes actually reached the client is a delivery
      // concern, not an authorization one. We log loudly so it's
      // noticeable operationally.
      console.error(`Storage fetch failed for share ${updated.shortId} after access was granted`, storageErr);
      throw Errors.internal('Could not retrieve the file from storage');
    }

    res.setHeader('Content-Type', updated.file?.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDispositionFilename(updated.file?.originalName));

    stream.on('error', (streamErr) => {
      console.error(`Error while streaming share ${updated.shortId}`, streamErr);
      if (!res.headersSent) next(streamErr);
      else res.destroy(streamErr);
    });
    stream.pipe(res);

    if (updated.oneTime) {
      // Bytes are being streamed directly through this response, so it's
      // safe to purge as soon as the response actually finishes sending -
      // no separate signed-URL TTL window to wait out.
      res.on('finish', () => {
        purgeShare(updated).catch(() => { /* logged in purgeShare */ });
      });
    }
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireTrustedOriginIfCookie, async (req, res, next) => {
  try {
    const { id } = req.params;
    const manageToken = req.header('x-manage-token') || '';

    const share = await Share.findOne({ shortId: id }).select('+manageToken owner');
    if (!share) throw Errors.shareNotFound();

    let ownerOk = false;
    const token = extractToken(req);
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        ownerOk = !!share.owner && String(share.owner) === String(payload.sub);
      } catch {
        // invalid/expired token - fall through to manage-token check
      }
    }

    const tokenOk = !!manageToken && !!share.manageToken && manageToken === share.manageToken;
    if (!ownerOk && !tokenOk) throw Errors.forbidden();

    await purgeShare(share);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
