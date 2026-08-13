import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import api from './routes/api.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import residentsRoutes from './routes/residents.js';
import paymentSubmissionsRoutes from './routes/payment-submissions.js';
import noticesRoutes from './routes/notices.js';
import meRoutes from './routes/me.js';
import { verifyOrigin } from './middleware/csrf.js';
import { ensureMasterAdmin } from './seedMasterAdmin.js';

// Defense in depth: every async route handler is wrapped with asyncHandler()
// so its rejections reach the Express error middleware, but if one is ever
// missed, this keeps a single bad request from taking the whole API down.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

const app = express();
// Comma-separated list so a phone/LAN address can be allowed alongside
// localhost during dev, without dropping either.
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());

app.use(helmet());
app.use(cors({
  origin: (origin, cb) => (!origin || CLIENT_ORIGINS.includes(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS'))),
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use('/api', verifyOrigin);

// public, must be registered before any router with a blanket requireAuth
// mounted at the shared /api prefix — otherwise that router's auth check
// runs for this path too, before Express ever gets to try this route.
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', residentsRoutes);
app.use('/api', paymentSubmissionsRoutes);
app.use('/api', noticesRoutes);
app.use('/api/me', meRoutes);
app.use('/api', api);

// Central error handler — clean messages, no stack leaks.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// On Vercel, this module is imported by api/index.js as a serverless
// handler — the platform invokes the exported `app` per-request, so it
// must never call listen() itself. Locally (and on any other host), it
// runs as a normal long-lived Express server.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`BMMS API running on http://localhost:${PORT}`);
    ensureMasterAdmin().catch((e) => console.error('[auth] ensureMasterAdmin failed:', e));
  });
} else {
  ensureMasterAdmin().catch((e) => console.error('[auth] ensureMasterAdmin failed:', e));
}

export default app;
