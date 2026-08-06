import { Router } from 'express';
import db, { audit } from '../db.js';
import { requireAuth, requireRole, assertBuildingAccess, loadScoped } from '../middleware/auth.js';
import { need, isOneOf, isNonEmptyString, asyncHandler } from '../middleware/validate.js';
import { hashPassword, generatePassword, revokeUserSessions } from '../services/auth.js';

const r = Router();
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// requireAuth is safe as a blanket guard (every route here needs a login
// regardless), but requireRole must NOT be blanket: this router shares the
// `/api` mount point with other routers, and Express runs router-level
// .use() middleware for every request that enters the router — even ones
// that don't match any route inside it — so a blanket role-reject here
// would intercept and 403 requests actually meant for a sibling router
// before they ever got a chance to match. Apply requireRole per-route instead.
r.use(requireAuth);
const adminOnly = requireRole('building_admin', 'master_admin');

const serializeUser = (u) => ({
  id: u.id, role: u.role, username: u.username, fullName: u.full_name,
  flatId: u.flat_id, status: u.status, mustChangePassword: !!u.must_change_password,
  createdAt: u.created_at,
});

r.get('/buildings/:id/residents', adminOnly, (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const rows = db.prepare(
    `SELECT u.*, f.number flat_number FROM users u JOIN flats f ON f.id=u.flat_id
     WHERE u.role='resident' AND u.building_id=? ORDER BY f.number`
  ).all(req.params.id);
  res.json(rows.map((u) => ({ ...serializeUser(u), flatNumber: u.flat_number })));
});

r.post('/flats/:id/resident-account', adminOnly, asyncHandler(async (req, res) => {
  const flat = loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  const existing = db.prepare("SELECT id FROM users WHERE flat_id=? AND role='resident'").get(flat.id);
  if (existing) throw err('This flat already has a resident login — edit or reset that account instead', 409);

  need(req.body, ['username']);
  isNonEmptyString(req.body.username, 'Username', 40);
  const username = String(req.body.username).trim().toLowerCase();
  const dupe = db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username);
  if (dupe) throw err('That username is already taken', 409);

  const password = req.body.password || generatePassword();
  const hash = await hashPassword(password);
  const info = db.prepare(
    `INSERT INTO users (role, username, password_hash, full_name, building_id, flat_id, created_by)
     VALUES ('resident', ?, ?, ?, ?, ?, ?)`
  ).run(username, hash, req.body.full_name || flat.owner_name || flat.resident_name || null, flat.building_id, flat.id, req.user.id);

  audit(flat.building_id, 'create', 'user', info.lastInsertRowid, `Resident login "${username}" created for flat ${flat.number}`, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ user: serializeUser(user), password });
}));

r.put('/flats/:id/resident-account', adminOnly, (req, res) => {
  const flat = loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE flat_id=? AND role='resident'").get(flat.id);
  if (!u) throw err('No resident login exists for this flat', 404);
  const status = req.body.status !== undefined ? req.body.status : u.status;
  isOneOf(status, ['active', 'suspended'], 'status');
  db.prepare("UPDATE users SET status=?, updated_at=datetime('now') WHERE id=?").run(status, u.id);
  if (status === 'suspended') revokeUserSessions(u.id, 'suspended');
  audit(flat.building_id, 'update', 'user', u.id, `Resident login "${u.username}" set to ${status}`, req.user.id);
  res.json({ ok: true });
});

r.post('/flats/:id/resident-account/reset-password', adminOnly, asyncHandler(async (req, res) => {
  const flat = loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE flat_id=? AND role='resident'").get(flat.id);
  if (!u) throw err('No resident login exists for this flat', 404);
  const password = generatePassword();
  const hash = await hashPassword(password);
  db.prepare("UPDATE users SET password_hash=?, must_change_password=1, failed_login_count=0, locked_until=NULL, updated_at=datetime('now') WHERE id=?")
    .run(hash, u.id);
  revokeUserSessions(u.id, 'password_reset');
  audit(flat.building_id, 'reset_password', 'user', u.id, `Password reset for resident "${u.username}"`, req.user.id);
  res.json({ password });
}));

r.delete('/flats/:id/resident-account', adminOnly, (req, res) => {
  const flat = loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE flat_id=? AND role='resident'").get(flat.id);
  if (!u) throw err('No resident login exists for this flat', 404);
  db.prepare("UPDATE users SET status='suspended', updated_at=datetime('now') WHERE id=?").run(u.id);
  revokeUserSessions(u.id, 'deactivated');
  audit(flat.building_id, 'deactivate', 'user', u.id, `Resident login "${u.username}" deactivated`, req.user.id);
  res.json({ ok: true });
});

export default r;
