import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { Errors } from '../utils/apiError.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { setAuthCookie, clearAuthCookie } from '../utils/cookies.js';

const router = express.Router();

function issueToken(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw Errors.internal('JWT_SECRET not configured');
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({}, secret, { subject: userId, expiresIn });
}

router.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string') {
      throw Errors.invalidRequest('Email is required');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw Errors.invalidRequest('Password must be at least 8 characters');
    }

    const normalized = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalized });
    if (existing) {
      throw Errors.conflict('Email already in use');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: normalized, passwordHash });
    const token = issueToken(user._id.toString());

    setAuthCookie(res, token);
    return res.status(201).json({ user: { id: user._id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) throw Errors.invalidRequest('Email and password are required');

    const normalized = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalized });
    if (!user) throw Errors.unauthorized('Invalid credentials');

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) throw Errors.unauthorized('Invalid credentials');

    const token = issueToken(user._id.toString());
    setAuthCookie(res, token);
    return res.json({ user: { id: user._id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

export default router;
