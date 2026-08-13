import { Router } from 'express';
import db, { toRupees } from '../db.js';
import { flatLedger, monthState, residentCreditSummary } from '../services/finance.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isNonEmptyString, asyncHandler } from '../middleware/validate.js';

const r = Router();

// Every route here is resident-only and resolves its scope exclusively from
// req.user.flatId/buildingId — never from a client-supplied id — so a
// resident can never view another flat's data by changing a URL parameter.
r.use(requireAuth, requireRole('resident'));

r.get('/flat', asyncHandler(async (req, res) => {
  const flat = await db.prepare('SELECT * FROM flats WHERE id=?').get(req.user.flatId);
  res.json({ ...flat, monthly_amount: toRupees(flat.monthly_amount) });
}));

r.get('/ledger', asyncHandler(async (req, res) => {
  res.json(await flatLedger(req.user.flatId));
}));

r.get('/month-state', asyncHandler(async (req, res) => {
  const now = new Date();
  const st = await monthState(req.user.flatId, Number(req.query.month) || now.getMonth() + 1, Number(req.query.year) || now.getFullYear());
  res.json({
    required: toRupees(st.required), paid: toRupees(st.paid + st.advUsed),
    due: toRupees(st.due), advance: toRupees(st.advBalance), status: st.status,
  });
}));

// Merges approved credits (residentCreditSummary) with this flat's own
// pending/rejected adjustment claims (which never get a resident_credits
// row — see finance.js) into one chronological Credit History list.
r.get('/credits', asyncHandler(async (req, res) => {
  const summary = await residentCreditSummary(req.user.flatId);
  const pendingRejected = (await db.prepare(
    `SELECT id, adjustment_category AS category, adjustment_custom_title AS customTitle,
            adjustment_amount AS amount, status, paid_on AS paidOn, screenshot_path AS receiptPath,
            created_at AS createdAt, rejection_reason AS rejectionReason
     FROM payment_submissions WHERE flat_id=? AND adjustment_amount > 0 AND status != 'approved'
     ORDER BY created_at DESC`
  ).all(req.user.flatId)).map((row) => ({ ...row, amount: toRupees(row.amount) }));

  const history = [...summary.rows, ...pendingRejected]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  res.json({
    totals: {
      ...summary.totals,
      pending: pendingRejected.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0),
      rejected: pendingRejected.filter((p) => p.status === 'rejected').reduce((s, p) => s + p.amount, 0),
    },
    history,
  });
}));

r.get('/payments', asyncHandler(async (req, res) => {
  const rows = (await db.prepare(
    "SELECT * FROM payments WHERE flat_id=? AND deleted=0 ORDER BY paid_on DESC, id DESC"
  ).all(req.user.flatId)).map((p) => ({
    ...p, amount: toRupees(p.amount), applied_amount: toRupees(p.applied_amount), advance_amount: toRupees(p.advance_amount),
  }));
  res.json(rows);
}));

r.get('/notices', asyncHandler(async (req, res) => {
  const rows = await db.prepare(
    'SELECT * FROM notices WHERE building_id=? AND archived=0 ORDER BY pinned DESC, created_at DESC'
  ).all(req.user.buildingId);
  res.json(rows.map((n) => ({ id: n.id, title: n.title, body: n.body, pinned: !!n.pinned, createdAt: n.created_at })));
}));

r.get('/building-payment-info', asyncHandler(async (req, res) => {
  const b = await db.prepare(
    'SELECT id, name, bank_account_name, bank_account_number, bank_ifsc, bank_upi_id, bank_qr_path FROM buildings WHERE id=?'
  ).get(req.user.buildingId);
  const { bank_qr_path, ...rest } = b;
  res.json({ ...rest, hasQr: !!bank_qr_path, qrUrl: bank_qr_path ? `/api/buildings/${b.id}/payment-info/qr` : null });
}));

r.get('/profile', asyncHandler(async (req, res) => {
  const u = await db.prepare('SELECT id, username, full_name, email, mobile FROM users WHERE id=?').get(req.user.id);
  res.json(u);
}));

r.put('/profile', asyncHandler(async (req, res) => {
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const email = req.body.email !== undefined ? req.body.email : u.email;
  const mobile = req.body.mobile !== undefined ? req.body.mobile : u.mobile;
  if (mobile) isNonEmptyString(mobile, 'Mobile number', 20);
  // deliberately only email/mobile — owner_name and monthly_amount stay admin-managed
  await db.prepare("UPDATE users SET email=?, mobile=?, updated_at=datetime('now') WHERE id=?").run(email || null, mobile || null, u.id);
  res.json({ ok: true });
}));

export default r;
