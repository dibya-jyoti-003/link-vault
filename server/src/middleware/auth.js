import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { Errors } from '../utils/apiError.js';
import { getAuthCookieName } from '../utils/cookies.js';

/**
 * The browser client authenticates via an httpOnly cookie. We also accept
 * a Bearer token for non-browser API clients (scripts, curl, Postman) that
 * can't rely on cookie jars.
 */
export function extractToken(req) {
  const cookieToken = req.cookies?.[getAuthCookieName()];
  if (cookieToken) return cookieToken;

  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) return token;

  return null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      throw Errors.unauthorized();
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw Errors.internal('JWT_SECRET not configured');
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (e) {
      // Covers both expired and malformed/invalid tokens.
      throw Errors.unauthorized('Session expired or invalid. Please log in again.');
    }

    const user = await User.findById(payload.sub);
    if (!user) throw Errors.unauthorized();

    req.user = { _id: user._id, id: user._id.toString(), email: user.email };
    next();
  } catch (err) {
    next(err);
  }
}
