import { Errors } from '../utils/apiError.js';

/**
 * Minimal in-memory fixed-window rate limiter.
 * Good enough for a single-instance deployment; swap for a Redis-backed
 * limiter if LinkVault is ever scaled horizontally.
 */
function createLimiter({ windowMs, max, keyFn }) {
  const hits = new Map(); // key -> { count, resetAt }

  // Periodically sweep expired entries so the map doesn't grow forever.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, Math.max(windowMs, 30_000)).unref?.();

  return function limiter(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return next(Errors.rateLimited(`Too many requests. Try again in ${retryAfterSec}s.`));
    }

    next();
  };
}

function clientKey(req) {
  return req.ip || req.headers['x-forwarded-for'] || 'unknown';
}

// General protection for auth endpoints (register/login).
export const authRateLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyFn: clientKey,
});

// General protection for public share access endpoints.
export const publicShareRateLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyFn: clientKey,
});

/**
 * Dedicated limiter for share password attempts: locks out an IP+share
 * combination after too many wrong guesses, independent of the general
 * request-rate limiter above.
 */
const passwordAttempts = new Map(); // key -> { failures, lockedUntil, windowStart }
const PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_MAX_FAILURES = 5;
const PASSWORD_LOCKOUT_MS = 15 * 60 * 1000;

function passwordKey(req) {
  return `${clientKey(req)}:${req.params.id}`;
}

export function checkPasswordLockout(req) {
  const key = passwordKey(req);
  const entry = passwordAttempts.get(key);
  if (!entry) return;
  const now = Date.now();
  if (entry.lockedUntil && entry.lockedUntil > now) {
    const retryAfterSec = Math.ceil((entry.lockedUntil - now) / 1000);
    throw Errors.rateLimited(`Too many incorrect password attempts. Try again in ${retryAfterSec}s.`);
  }
}

export function recordPasswordFailure(req) {
  const key = passwordKey(req);
  const now = Date.now();
  let entry = passwordAttempts.get(key);
  if (!entry || entry.windowStart + PASSWORD_WINDOW_MS <= now) {
    entry = { failures: 0, windowStart: now, lockedUntil: 0 };
  }
  entry.failures += 1;
  if (entry.failures >= PASSWORD_MAX_FAILURES) {
    entry.lockedUntil = now + PASSWORD_LOCKOUT_MS;
  }
  passwordAttempts.set(key, entry);
}

export function resetPasswordFailures(req) {
  passwordAttempts.delete(passwordKey(req));
}
