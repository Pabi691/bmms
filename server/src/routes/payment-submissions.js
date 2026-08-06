import { Router } from 'express';
import path from 'path';
import db, { toPaise, toRupees, audit } from '../db.js';
import { recordPayment } from '../services/finance.js';
import { autoSync } from '../services/sheets.js';
import { requireAuth, requireRole, assertBuildingAccess, loadScoped } from '../middleware/auth.js';
import { need, isOneOf } from '../middleware/validate.js';
import { uploadPaymentScreenshot, sniffAndValidate, SCREENSHOT_DIR_ABS } from '../middleware/upload.js';

const r = Router();
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

r.use(requireAuth);

const serialize = (s) => ({
  id: s.id, buildingId: s.building_id, flatId: s.flat_id, month: s.month, year: s.year,
  amount: toRupees(s.amount), method: s.method, transactionRef: s.transaction_ref, paidOn: s.paid_on,
  notes: s.notes, status: s.status, rejectionReason: s.rejection_reason,
  reviewedAt: s.reviewed_at, paymentId: s.payment_id, createdAt: s.created_at,
});

// ---------------- resident: submit + view own ----------------
r.post('/me/payment-submissions', requireRole('resident'), (req, res, next) => {
  uploadPaymentScreenshot(req, res, (uploadErr) => {
    if (uploadErr) return next(Object.assign(new Error(uploadErr.message || 'Upload failed'), { status: 400 }));
    try {
      if (!req.file) throw err('Payment screenshot is required');
      sniffAndValidate(req.file.path, req.file.mimetype);

      need(req.body, ['month', 'year', 'amount', 'method', 'paid_on']);
      isOneOf(req.body.method, ['upi', 'bank', 'other'], 'method');

      const info = db.prepare(
        `INSERT INTO payment_submissions
           (building_id, flat_id, submitted_by, month, year, amount, method, transaction_ref, paid_on, screenshot_path, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        req.user.buildingId, req.user.flatId, req.user.id,
        Number(req.body.month), Number(req.body.year), toPaise(req.body.amount), req.body.method,
        req.body.transaction_ref || null, req.body.paid_on,
        path.basename(req.file.path), req.body.notes || null
      );
      audit(req.user.buildingId, 'submit', 'payment_submission', info.lastInsertRowid,
        `Payment claim ₹${req.body.amount} for ${req.body.month}/${req.body.year}`, req.user.id);

      const row = db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(info.lastInsertRowid);
      res.status(201).json(serialize(row));
    } catch (e) { next(e); }
  });
});

r.get('/me/payment-submissions', requireRole('resident'), (req, res) => {
  const rows = db.prepare('SELECT * FROM payment_submissions WHERE flat_id=? ORDER BY created_at DESC').all(req.user.flatId);
  res.json(rows.map(serialize));
});

// ---------------- admin: review queue ----------------
r.get('/buildings/:id/payment-submissions', requireRole('building_admin', 'master_admin'), (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const status = req.query.status;
  const rows = status
    ? db.prepare(
        `SELECT ps.*, f.number flat_number FROM payment_submissions ps JOIN flats f ON f.id=ps.flat_id
         WHERE ps.building_id=? AND ps.status=? ORDER BY ps.created_at DESC`
      ).all(req.params.id, status)
    : db.prepare(
        `SELECT ps.*, f.number flat_number FROM payment_submissions ps JOIN flats f ON f.id=ps.flat_id
         WHERE ps.building_id=? ORDER BY ps.created_at DESC LIMIT 300`
      ).all(req.params.id);
  res.json(rows.map((s) => ({ ...serialize(s), flatNumber: s.flat_number })));
});

r.post('/payment-submissions/:id/approve', requireRole('building_admin', 'master_admin'), (req, res) => {
  const sub = loadScoped(req, (id) => db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(id), req.params.id);
  if (sub.status !== 'pending') throw err('This submission has already been reviewed');

  const { id: paymentId, cascade } = recordPayment({
    flat_id: sub.flat_id, month: sub.month, year: sub.year, amount: sub.amount,
    method: sub.method, paid_on: sub.paid_on,
    notes: `Approved from resident submission #${sub.id}${sub.transaction_ref ? ` (ref ${sub.transaction_ref})` : ''}`,
    actor_user_id: req.user.id,
  });
  db.prepare(
    "UPDATE payment_submissions SET status='approved', reviewed_by=?, reviewed_at=datetime('now'), payment_id=? WHERE id=?"
  ).run(req.user.id, paymentId, sub.id);
  audit(sub.building_id, 'approve', 'payment_submission', sub.id, `Approved ₹${toRupees(sub.amount)} claim`, req.user.id);
  autoSync(sub.building_id);
  res.json({ ok: true, paymentId, cascade });
});

r.post('/payment-submissions/:id/reject', requireRole('building_admin', 'master_admin'), (req, res) => {
  const sub = loadScoped(req, (id) => db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(id), req.params.id);
  if (sub.status !== 'pending') throw err('This submission has already been reviewed');
  need(req.body, ['reason']);
  db.prepare(
    "UPDATE payment_submissions SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), rejection_reason=? WHERE id=?"
  ).run(req.user.id, req.body.reason, sub.id);
  audit(sub.building_id, 'reject', 'payment_submission', sub.id, `Rejected: ${req.body.reason}`, req.user.id);
  res.json({ ok: true });
});

// ---------------- screenshot retrieval — never via express.static ----------------
r.get('/payment-submissions/:id/screenshot', (req, res) => {
  const sub = db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(req.params.id);
  if (!sub) throw err('Not found', 404);
  const isOwner = req.user.role === 'resident' && sub.submitted_by === req.user.id;
  if (!isOwner) assertBuildingAccess(req, sub.building_id);
  if (req.user.role === 'resident' && !isOwner) throw err('Not authorized', 403);

  const filePath = path.join(SCREENSHOT_DIR_ABS, sub.screenshot_path);
  res.sendFile(filePath, (e) => { if (e && !res.headersSent) res.status(404).json({ error: 'File not found' }); });
});

export default r;
