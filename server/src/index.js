import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, './.env'),
];

for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import connectDB from './config/db.js';
import authRouter from './routes/auth.js';
import sharesRouter from './routes/shares.js';
import startCleanupJob from './jobs/cleanup.js';
import { ApiError } from './utils/apiError.js';
import { getAllowedOrigins } from './utils/origins.js';

const app = express();

app.set('etag', false);

const allowedOrigins = getAllowedOrigins();
if (allowedOrigins.length === 0) {
  console.warn(
    'CLIENT_ORIGIN is not set. Cookie-based auth requires an explicit origin ' +
    '(credentialed CORS requests cannot use a wildcard) - all cross-origin ' +
    'requests will currently be rejected. Set CLIENT_ORIGIN in .env.'
  );
}
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / non-browser clients (curl, server-to-server)
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/shares', sharesRouter);

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Map well-known non-ApiError failures (Multer, CORS) to our error shape.
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the maximum allowed size' },
      });
    }
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: err.message } });
  }

  if (err instanceof ApiError) {
    if (err.status >= 500) console.error(err);
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  console.error(err);
  const status = err.status || 500;
  const code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR');
  res.status(status).json({ error: { code, message: err.message || 'Internal Server Error' } });
});

const port = parseInt(process.env.PORT || '4000', 10);

connectDB().then(() => {
  app.listen(port, () => {
    console.log(`LinkVault server running on port ${port}`);
    startCleanupJob();
  });
});
