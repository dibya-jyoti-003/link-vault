const COOKIE_NAME = 'lv_session';

function cookieOptions() {
  // Defaults are safe for local, same-site dev (client + server both on
  // "localhost", different ports). For a real deployment where the
  // frontend and backend live on different domains (e.g. Vercel +
  // Render), cross-site cookies require SameSite=None + Secure, which in
  // turn requires HTTPS - set COOKIE_SAMESITE=none and COOKIE_SECURE=true
  // in that environment's env vars.
  const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : sameSite === 'none' || process.env.NODE_ENV === 'production';

  const options = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
  };
  if (process.env.COOKIE_DOMAIN) options.domain = process.env.COOKIE_DOMAIN;
  return options;
}

function maxAgeMsFromJwtExpiresIn(expiresIn) {
  // Supports simple "7d" / "12h" / "30m" / "3600" style values, matching
  // what jsonwebtoken's `expiresIn` accepts for the common cases we use.
  const match = /^(\d+)\s*(d|h|m|s)?$/i.exec(String(expiresIn).trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000; // fall back to 7 days
  const value = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  const unitMs = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 }[unit];
  return value * unitMs;
}

export function setAuthCookie(res, token) {
  const maxAge = maxAgeMsFromJwtExpiresIn(process.env.JWT_EXPIRES_IN || '7d');
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

export function getAuthCookieName() {
  return COOKIE_NAME;
}
