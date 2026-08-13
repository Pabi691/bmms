import { Router } from 'express';
import db, { audit } from '../db.js';
import { requireAuth, requireRole, assertBuildingAccess, loadScoped } from '../middleware/auth.js';
import { need, asyncHandler } from '../middleware/validate.js';

const r = Router();

// requireAuth only as the blanket guard — see residents.js for why requireRole
// must stay per-route on a router sharing the `/api` mount point.
r.use(requireAuth);
const adminOnly = requireRole('building_admin', 'master_admin');

const serialize = (n) => ({
  id: n.id, buildingId: n.building_id, title: n.title, body: n.body,
  pinned: !!n.pinned, createdAt: n.created_at,
});

r.get('/buildings/:id/notices', adminOnly, asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const rows = await db.prepare(
    'SELECT * FROM notices WHERE building_id=? AND archived=0 ORDER BY pinned DESC, created_at DESC'
  ).all(req.params.id);
  res.json(rows.map(serialize));
}));

r.post('/buildings/:id/notices', adminOnly, asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  need(req.body, ['title', 'body']);
  const info = await db.prepare(
    'INSERT INTO notices (building_id, title, body, created_by, pinned) VALUES (?,?,?,?,?)'
  ).run(req.params.id, req.body.title, req.body.body, req.user.id, req.body.pinned ? 1 : 0);
  await audit(Number(req.params.id), 'create', 'notice', info.lastInsertRowid, req.body.title, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid });
}));

r.put('/notices/:id', adminOnly, asyncHandler(async (req, res) => {
  const n = await loadScoped(req, (id) => db.prepare('SELECT * FROM notices WHERE id=?').get(id), req.params.id);
  const title = req.body.title ?? n.title;
  const body = req.body.body ?? n.body;
  const pinned = req.body.pinned !== undefined ? (req.body.pinned ? 1 : 0) : n.pinned;
  await db.prepare('UPDATE notices SET title=?, body=?, pinned=? WHERE id=?').run(title, body, pinned, n.id);
  await audit(n.building_id, 'update', 'notice', n.id, title, req.user.id);
  res.json({ ok: true });
}));

r.delete('/notices/:id', adminOnly, asyncHandler(async (req, res) => {
  const n = await loadScoped(req, (id) => db.prepare('SELECT * FROM notices WHERE id=?').get(id), req.params.id);
  await db.prepare('UPDATE notices SET archived=1 WHERE id=?').run(n.id);
  await audit(n.building_id, 'delete', 'notice', n.id, n.title, req.user.id);
  res.json({ ok: true });
}));

export default r;
