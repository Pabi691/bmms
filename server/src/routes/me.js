import { Router } from 'express';
import db, { toRupees } from '../db.js';
import { flatLedger, monthState } from '../services/finance.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isNonEmptyString } from '../middleware/validate.js';

const r = Router();

// Every route here is resident-only and resolves its scope exclusively from
// req.user.flatId/buildingId — never from a client-supplied id — so a
// resident can never view another flat's data by changing a URL parameter.
r.use(requireAuth, requireRole('resident'));

r.get('/flat', (req, res) => {
  const flat = db.prepare('SELECT * FROM flats WHERE id=?').get(req.user.flatId);
  res.json({ ...flat, monthly_amount: toRupees(flat.monthly_amount) });
});

r.get('/ledger', (req, res) => {
  res.json(flatLedger(req.user.flatId));
});

r.get('/month-state', (req, res) => {
  const now = new Date();
  const st = monthState(req.user.flatId, Number(req.query.month) || now.getMonth() + 1, Number(req.query.year) || now.getFullYear());
  res.json({
    required: toRupees(st.required), paid: toRupees(st.paid + st.advUsed),
    due: toRupees(st.due), advance: toRupees(st.advBalance), status: st.status,
  });
});

r.get('/payments', (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM payments WHERE flat_id=? AND deleted=0 ORDER BY paid_on DESC, id DESC"
  ).all(req.user.flatId).map((p) => ({
    ...p, amount: toRupees(p.amount), applied_amount: toRupees(p.applied_amount), advance_amount: toRupees(p.advance_amount),
  }));
  res.json(rows);
});

r.get('/notices', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM notices WHERE building_id=? AND archived=0 ORDER BY pinned DESC, created_at DESC'
  ).all(req.user.buildingId);
  res.json(rows.map((n) => ({ id: n.id, title: n.title, body: n.body, pinned: !!n.pinned, createdAt: n.created_at })));
});

r.get('/building-payment-info', (req, res) => {
  const b = db.prepare(
    'SELECT id, name, bank_account_name, bank_account_number, bank_ifsc, bank_upi_id, bank_qr_path FROM buildings WHERE id=?'
  ).get(req.user.buildingId);
  const { bank_qr_path, ...rest } = b;
  res.json({ ...rest, hasQr: !!bank_qr_path, qrUrl: bank_qr_path ? `/api/buildings/${b.id}/payment-info/qr` : null });
});

r.get('/profile', (req, res) => {
  const u = db.prepare('SELECT id, username, full_name, email, mobile FROM users WHERE id=?').get(req.user.id);
  res.json(u);
});

r.put('/profile', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const email = req.body.email !== undefined ? req.body.email : u.email;
  const mobile = req.body.mobile !== undefined ? req.body.mobile : u.mobile;
  if (mobile) isNonEmptyString(mobile, 'Mobile number', 20);
  // deliberately only email/mobile — owner_name and monthly_amount stay admin-managed
  db.prepare("UPDATE users SET email=?, mobile=?, updated_at=datetime('now') WHERE id=?").run(email || null, mobile || null, u.id);
  res.json({ ok: true });
});

export default r;
