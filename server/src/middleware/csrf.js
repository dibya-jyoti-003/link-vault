import { Errors } from '../utils/apiError.js';
import { getAllowedOrigins } from '../utils/origins.js';
import { getAuthCookieName } from '../utils/cookies.js';

function refererOrigin(referer) {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Cookie-based sessions are ambient - a browser attaches them automatically
 * to any request, including ones triggered by a malicious third-party page
 * (classic CSRF). Bearer-token requests (non-browser API clients) and
 * manage-token requests aren't vulnerable the same way, since the caller
 * has to deliberately attach the credential - so this only enforces an
 * origin check when a session cookie is actually present on the request.
 *
 * This is intentionally simple: no CSRF-token framework, just verifying
 * the request actually originated from our own frontend. That's enough
 * for this app's architecture (see CHANGES.md).
 */
export function requireTrustedOriginIfCookie(req, res, next) {
  const hasCookie = !!req.cookies?.[getAuthCookieName()];
  if (!hasCookie) return next();

  const allowed = getAllowedOrigins();
  const origin = req.header('origin') || refererOrigin(req.header('referer'));

  if (!origin) {
    return next(Errors.forbidden('Missing Origin header on a cookie-authenticated request'));
  }
  if (!allowed.includes(origin)) {
    return next(Errors.forbidden('Request blocked: untrusted origin'));
  }
  next();
}
