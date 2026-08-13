import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import db, { audit } from '../db.js';
import {
  verifyPassword, assertStrongPassword, hashPassword,
  issueSession, signAccessToken, revokeSession, revokeUserSessions,
  isLocked, registerFailedLogin, clearFailedLogins,
} from '../services/auth.js';
import { requireAuth, setAuthCookie, clearAuthCookie, COOKIE_NAME } from '../middleware/auth.js';
import { need, asyncHandler } from '../middleware/validate.js';

const r = Router();
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts — try again later' },
});

const serializeUser = (u) => ({
  id: u.id, role: u.role, username: u.username, fullName: u.full_name,
  buildingId: u.building_id, flatId: u.flat_id, mustChangePassword: !!u.must_change_password,
});

r.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  need(req.body, ['username', 'password']);
  const { username, password } = req.body;

  const user = await db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
  // Constant-shape response either way — don't reveal whether the username exists.
  if (!user) throw err('Invalid username or password', 401);
  if (user.status === 'suspended') throw err('Account suspended', 403);
  if (isLocked(user)) throw err('Account temporarily locked due to repeated failed logins — try again later', 423);
  if (user.building_id) {
    const building = await db.prepare('SELECT status FROM buildings WHERE id=?').get(user.building_id);
    if (building?.status === 'suspended') throw err('This building has been suspended — contact your Master Admin', 403);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await registerFailedLogin(user.id);
    await audit(user.building_id, 'login_failed', 'user', user.id, `Failed login for "${username}"`, user.id);
    throw err('Invalid username or password', 401);
  }
  await clearFailedLogins(user.id);

  const session = await issueSession({ userId: user.id, ip: req.ip, userAgent: req.headers['user-agent'] });
  const token = signAccessToken({ userId: user.id, sessionId: session.id, role: user.role });
  setAuthCookie(res, token, session.expiresAt);

  await audit(user.building_id, 'login', 'user', user.id, `Login: ${username} (${user.role})`, user.id);
  res.json({ user: serializeUser(user) });
}));

r.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await revokeSession(req.sessionId, 'logout');
  clearAuthCookie(res);
  await audit(req.user.buildingId, 'logout', 'user', req.user.id, `Logout: ${req.user.username}`, req.user.id);
  res.json({ ok: true });
}));

r.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: serializeUser(user) });
}));

r.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  need(req.body, ['currentPassword', 'newPassword']);
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const ok = await verifyPassword(req.body.currentPassword, user.password_hash);
  if (!ok) throw err('Current password is incorrect', 401);
  assertStrongPassword(req.body.newPassword);

  const hash = await hashPassword(req.body.newPassword);
  await db.prepare(
    "UPDATE users SET password_hash=?, must_change_password=0, updated_at=datetime('now') WHERE id=?"
  ).run(hash, user.id);
  await revokeUserSessions(user.id, 'password_change', req.sessionId);
  await audit(user.building_id, 'change_password', 'user', user.id, `Password changed: ${user.username}`, user.id);
  res.json({ ok: true });
}));

r.get('/me/sessions', requireAuth, asyncHandler(async (req, res) => {
  const rows = await db.prepare(
    'SELECT id, ip, user_agent, created_at, last_active_at, revoked, revoked_reason FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 20'
  ).all(req.user.id);
  res.json(rows);
}));

export default r;
