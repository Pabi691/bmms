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
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(helmet());
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`BMMS API running on http://localhost:${PORT}`);
  ensureMasterAdmin().catch((e) => console.error('[auth] ensureMasterAdmin failed:', e));
});
