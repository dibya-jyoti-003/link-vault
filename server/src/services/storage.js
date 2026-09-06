import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();
const STORAGE_DIR = process.env.STORAGE_DIR || 'uploads';
const storageRoot = path.resolve(__dirname, '../../', STORAGE_DIR);

if (STORAGE_PROVIDER === 'local' && !fs.existsSync(storageRoot)) {
  fs.mkdirSync(storageRoot, { recursive: true });
}

export function getStorageProvider() {
  return STORAGE_PROVIDER;
}

// ---------------------------------------------------------------------------
// R2 (S3-compatible) client - lazily constructed so a local-only dev setup
// never needs R2_* env vars configured at all.
// ---------------------------------------------------------------------------
let _s3Client = null;
function s3Client() {
  if (_s3Client) return _s3Client;

  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `STORAGE_PROVIDER=r2 but missing required env var(s): ${missing.join(', ')}. See .env.example.`
    );
  }

  const endpoint = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  _s3Client = new S3Client({
    region: 'auto',
    endpoint,
    // R2's documented/most compatible addressing scheme is path-style
    // (https://<account>.r2.cloudflarestorage.com/<bucket>/<key>) rather
    // than virtual-hosted-style subdomains, which aren't guaranteed to
    // resolve for every account/bucket-naming combination.
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _s3Client;
}

function r2Bucket() {
  return process.env.R2_BUCKET_NAME;
}

/**
 * Upload a file buffer to the configured storage provider.
 * Returns { objectKey } - an opaque identifier. The database must never
 * store a public URL, only this key.
 */
export async function uploadFile({ buffer, mimeType, originalName }) {
  const ext = path.extname(originalName || '');

  if (STORAGE_PROVIDER === 'r2') {
    const objectKey = `shares/${nanoid(10)}/${nanoid(16)}${ext}`;
    await s3Client().send(new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType,
    }));
    return { objectKey };
  }

  if (STORAGE_PROVIDER === 'local') {
    const objectKey = `${nanoid(16)}${ext}`;
    const filePath = path.join(storageRoot, objectKey);
    await fs.promises.writeFile(filePath, buffer);
    return { objectKey };
  }

  throw new Error(`Unsupported storage provider: ${STORAGE_PROVIDER}`);
}

/** Permanently delete a stored object. Throws if the deletion itself fails
 *  (callers - notably the cleanup job - rely on this to decide whether it's
 *  safe to also remove the corresponding database record). Safe/no-op if
 *  the object is already gone. */
export async function deleteFile({ objectKey } = {}) {
  if (!objectKey) return;

  if (STORAGE_PROVIDER === 'r2') {
    await s3Client().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: objectKey }));
    return;
  }

  if (STORAGE_PROVIDER === 'local') {
    const filePath = path.join(storageRoot, objectKey);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
    return;
  }

  throw new Error(`Unsupported storage provider: ${STORAGE_PROVIDER}`);
}

/**
 * Open a readable stream for a stored object, along with whatever metadata
 * the provider can report. `/shares/:id/download` is the sole, authoritative
 * access point for file bytes: it fetches the object here and pipes it
 * straight into the HTTP response, rather than handing back a signed URL
 * for the browser to follow on its own. This keeps every access decision
 * (expiry, password, limits, one-time consumption) enforced in one place,
 * at the moment the bytes are actually served.
 */
export async function getObjectStream(objectKey) {
  if (STORAGE_PROVIDER === 'r2') {
    const response = await s3Client().send(new GetObjectCommand({
      Bucket: r2Bucket(),
      Key: objectKey,
    }));
    // In the Node runtime, @aws-sdk/client-s3 resolves `Body` to a Node
    // Readable stream - safe to pipe directly into the HTTP response.
    return { stream: response.Body, contentLength: response.ContentLength };
  }

  if (STORAGE_PROVIDER === 'local') {
    const filePath = path.join(storageRoot, objectKey);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${objectKey}`);
    }
    const stat = await fs.promises.stat(filePath);
    return { stream: fs.createReadStream(filePath), contentLength: stat.size };
  }

  throw new Error(`Unsupported storage provider: ${STORAGE_PROVIDER}`);
}
