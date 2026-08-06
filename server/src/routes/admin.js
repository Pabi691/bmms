import { Router } from 'express';
import db, { audit } from '../db.js';
import { buildingSummary } from '../services/finance.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { need, isOneOf, isNonEmptyString, asyncHandler } from '../middleware/validate.js';
import { hashPassword, generatePassword, assertStrongPassword, revokeUserSessions } from '../services/auth.js';

const r = Router();
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

r.use(requireAuth, requireRole('master_admin'));

const serializeUser = (u) => ({
  id: u.id, role: u.role, username: u.username, fullName: u.full_name,
  buildingId: u.building_id, status: u.status, mustChangePassword: !!u.must_change_password,
  createdAt: u.created_at,
});

// ---------------- buildings: status (suspend/activate) ----------------
r.get('/buildings', (req, res) => {
  const now = new Date();
  const rows = db.prepare('SELECT * FROM buildings WHERE archived=0 ORDER BY created_at DESC').all().map((b) => {
    const admin = db.prepare("SELECT * FROM users WHERE building_id=? AND role='building_admin'").get(b.id);
    const s = buildingSummary(b.id, now.getMonth() + 1, now.getFullYear());
    return { ...b, admin: admin ? serializeUser(admin) : null, stats: s.totals };
  });
  res.json(rows);
});

r.post('/buildings/:id/status', (req, res) => {
  need(req.body, ['status']);
  isOneOf(req.body.status, ['active', 'suspended'], 'status');
  const b = db.prepare('SELECT * FROM buildings WHERE id=?').get(req.params.id);
  if (!b) throw err('Building not found', 404);
  db.prepare('UPDATE buildings SET status=? WHERE id=?').run(req.body.status, b.id);
  if (req.body.status === 'suspended') {
    for (const u of db.prepare('SELECT id FROM users WHERE building_id=?').all(b.id)) {
      revokeUserSessions(u.id, 'building_suspended');
    }
  }
  audit(b.id, 'status_change', 'building', b.id, `Building "${b.name}" set to ${req.body.status}`, req.user.id);
  res.json({ ok: true });
});

// ---------------- building admin accounts ----------------
r.post('/buildings/:id/admins', asyncHandler(async (req, res) => {
  const b = db.prepare('SELECT * FROM buildings WHERE id=?').get(req.params.id);
  if (!b) throw err('Building not found', 404);
  const existing = db.prepare("SELECT id FROM users WHERE building_id=? AND role='building_admin'").get(b.id);
  if (existing) throw err('This building already has a Building Admin — edit or reset that account instead', 409);

  need(req.body, ['username']);
  isNonEmptyString(req.body.username, 'Username', 40);
  const username = String(req.body.username).trim().toLowerCase();
  const dupe = db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username);
  if (dupe) throw err('That username is already taken', 409);

  const password = req.body.password || generatePassword();
  if (req.body.password) assertStrongPassword(password);
  const hash = await hashPassword(password);

  const info = db.prepare(
    `INSERT INTO users (role, username, password_hash, full_name, building_id, created_by)
     VALUES ('building_admin', ?, ?, ?, ?, ?)`
  ).run(username, hash, req.body.full_name || null, b.id, req.user.id);

  audit(b.id, 'create', 'user', info.lastInsertRowid, `Building Admin "${username}" created for "${b.name}"`, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ user: serializeUser(user), password }); // password shown once, never stored/logged in plaintext
}));

r.put('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u || u.role !== 'building_admin') throw err('Building Admin account not found', 404);
  const fullName = req.body.full_name !== undefined ? req.body.full_name : u.full_name;
  const status = req.body.status !== undefined ? req.body.status : u.status;
  isOneOf(status, ['active', 'suspended'], 'status');
  db.prepare("UPDATE users SET full_name=?, status=?, updated_at=datetime('now') WHERE id=?").run(fullName, status, u.id);
  if (status === 'suspended') revokeUserSessions(u.id, 'suspended');
  audit(u.building_id, 'update', 'user', u.id, `Building Admin "${u.username}" updated`, req.user.id);
  res.json({ ok: true });
});

r.post('/users/:id/reset-password', asyncHandler(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u || u.role !== 'building_admin') throw err('Building Admin account not found', 404);
  const password = generatePassword();
  const hash = await hashPassword(password);
  db.prepare("UPDATE users SET password_hash=?, must_change_password=1, failed_login_count=0, locked_until=NULL, updated_at=datetime('now') WHERE id=?")
    .run(hash, u.id);
  revokeUserSessions(u.id, 'password_reset');
  audit(u.building_id, 'reset_password', 'user', u.id, `Password reset for "${u.username}"`, req.user.id);
  res.json({ password });
}));

// only Building Admin accounts may be deleted this way — resident accounts
// are managed by the building admin via routes/residents.js
r.delete('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u || u.role !== 'building_admin') throw err('Building Admin account not found', 404);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  audit(u.building_id, 'delete', 'user', u.id, `Building Admin "${u.username}" deleted`, req.user.id);
  res.json({ ok: true });
});

r.get('/users/:id/sessions', (req, res) => {
  const rows = db.prepare(
    'SELECT id, ip, user_agent, created_at, last_active_at, revoked, revoked_reason FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 20'
  ).all(req.params.id);
  res.json(rows);
});

export default r;
