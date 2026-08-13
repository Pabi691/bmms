import { Router } from 'express';
import db, { toPaise, toRupees, audit } from '../db.js';
import { approvePaymentSubmission, ADJUSTMENT_CATEGORIES } from '../services/finance.js';
import { autoSync } from '../services/sheets.js';
import { requireAuth, requireRole, assertBuildingAccess, loadScoped } from '../middleware/auth.js';
import { need, isOneOf, asyncHandler } from '../middleware/validate.js';
import { uploadPaymentScreenshot, sniffAndValidate, putUpload, streamBlob } from '../middleware/upload.js';

const r = Router();
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

r.use(requireAuth);

const serialize = (s) => ({
  id: s.id, buildingId: s.building_id, flatId: s.flat_id, month: s.month, year: s.year,
  amount: toRupees(s.amount), bankAmount: toRupees(s.bank_amount || 0),
  adjustmentCategory: s.adjustment_category, adjustmentCustomTitle: s.adjustment_custom_title,
  adjustmentAmount: s.adjustment_amount ? toRupees(s.adjustment_amount) : 0,
  method: s.method, transactionRef: s.transaction_ref, paidOn: s.paid_on,
  notes: s.notes, status: s.status, rejectionReason: s.rejection_reason,
  reviewedAt: s.reviewed_at, paymentId: s.payment_id, residentCreditId: s.resident_credit_id,
  createdAt: s.created_at,
});

// ---------------- resident: submit + view own ----------------
r.post('/me/payment-submissions', requireRole('resident'), (req, res, next) => {
  uploadPaymentScreenshot(req, res, async (uploadErr) => {
    try {
      if (uploadErr) throw Object.assign(new Error(uploadErr.message || 'Upload failed'), { status: 400 });
      if (!req.file) throw err('Payment screenshot is required');
      sniffAndValidate(req.file.buffer, req.file.mimetype);

      need(req.body, ['month', 'year', 'method', 'paid_on']);
      isOneOf(req.body.method, ['upi', 'bank', 'other'], 'method');

      const bankAmount = req.body.bank_amount !== undefined && req.body.bank_amount !== '' ? toPaise(req.body.bank_amount) : 0;
      if (bankAmount < 0) throw err('Amount paid to society cannot be negative');

      const hasAdjustment = req.body.adjustment_category && req.body.adjustment_category !== 'none';
      let adjustmentCategory = null, adjustmentAmount = 0, adjustmentCustomTitle = null;
      if (hasAdjustment) {
        if (!ADJUSTMENT_CATEGORIES.includes(req.body.adjustment_category)) throw err('Invalid adjustment category');
        adjustmentAmount = req.body.adjustment_amount !== undefined && req.body.adjustment_amount !== '' ? toPaise(req.body.adjustment_amount) : 0;
        if (adjustmentAmount <= 0) throw err('Adjustment amount must be greater than zero');
        if (req.body.adjustment_category === 'custom' && !req.body.adjustment_custom_title) throw err('Custom Expense Name is required');
        adjustmentCategory = req.body.adjustment_category;
        adjustmentCustomTitle = req.body.adjustment_category === 'custom' ? req.body.adjustment_custom_title : null;
      }
      if (!(bankAmount > 0) && !(adjustmentAmount > 0)) throw err('Enter an amount paid to the society or an adjustment amount');

      const screenshotUrl = await putUpload(req.file, 'payment-screenshots');
      const total = bankAmount + adjustmentAmount;
      const info = await db.prepare(
        `INSERT INTO payment_submissions
           (building_id, flat_id, submitted_by, month, year, amount, bank_amount, adjustment_category,
            adjustment_amount, adjustment_custom_title, method, transaction_ref, paid_on, screenshot_path, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        req.user.buildingId, req.user.flatId, req.user.id,
        Number(req.body.month), Number(req.body.year), total, bankAmount, adjustmentCategory,
        adjustmentAmount || null, adjustmentCustomTitle, req.body.method,
        req.body.transaction_ref || null, req.body.paid_on,
        screenshotUrl, req.body.notes || null
      );
      await audit(req.user.buildingId, 'submit', 'payment_submission', info.lastInsertRowid,
        `Payment claim ₹${toRupees(total)} for ${req.body.month}/${req.body.year}`, req.user.id);

      const row = await db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(info.lastInsertRowid);
      res.status(201).json(serialize(row));
    } catch (e) { next(e); }
  });
});

r.get('/me/payment-submissions', requireRole('resident'), asyncHandler(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM payment_submissions WHERE flat_id=? ORDER BY created_at DESC').all(req.user.flatId);
  res.json(rows.map(serialize));
}));

// ---------------- admin: review queue ----------------
r.get('/buildings/:id/payment-submissions', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const status = req.query.status;
  const rows = status
    ? await db.prepare(
        `SELECT ps.*, f.number flat_number FROM payment_submissions ps JOIN flats f ON f.id=ps.flat_id
         WHERE ps.building_id=? AND ps.status=? ORDER BY ps.created_at DESC`
      ).all(req.params.id, status)
    : await db.prepare(
        `SELECT ps.*, f.number flat_number FROM payment_submissions ps JOIN flats f ON f.id=ps.flat_id
         WHERE ps.building_id=? ORDER BY ps.created_at DESC LIMIT 300`
      ).all(req.params.id);
  res.json(rows.map((s) => ({ ...serialize(s), flatNumber: s.flat_number })));
}));

r.post('/payment-submissions/:id/approve', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const sub = await loadScoped(req, (id) => db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(id), req.params.id);
  if (sub.status !== 'pending') throw err('This submission has already been reviewed');

  const tx = await db.transaction();
  let result;
  try {
    result = await approvePaymentSubmission(tx, sub, req.user.id);
    await tx.prepare(
      "UPDATE payment_submissions SET status='approved', reviewed_by=?, reviewed_at=datetime('now'), payment_id=?, resident_credit_id=? WHERE id=?"
    ).run(req.user.id, result.payment?.id || null, result.credit?.id || null, sub.id);
    await audit(sub.building_id, 'approve', 'payment_submission', sub.id, `Approved ₹${toRupees(sub.amount)} claim`, req.user.id, tx);
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }

  autoSync(sub.building_id);
  res.json({ ok: true, payment: result.payment, credit: result.credit });
}));

r.post('/payment-submissions/:id/reject', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const sub = await loadScoped(req, (id) => db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(id), req.params.id);
  if (sub.status !== 'pending') throw err('This submission has already been reviewed');
  need(req.body, ['reason']);
  await db.prepare(
    "UPDATE payment_submissions SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), rejection_reason=? WHERE id=?"
  ).run(req.user.id, req.body.reason, sub.id);
  await audit(sub.building_id, 'reject', 'payment_submission', sub.id, `Rejected: ${req.body.reason}`, req.user.id);
  res.json({ ok: true });
}));

// ---------------- screenshot retrieval — never via express.static ----------------
r.get('/payment-submissions/:id/screenshot', asyncHandler(async (req, res) => {
  const sub = await db.prepare('SELECT * FROM payment_submissions WHERE id=?').get(req.params.id);
  if (!sub) throw err('Not found', 404);
  const isOwner = req.user.role === 'resident' && sub.submitted_by === req.user.id;
  if (!isOwner) assertBuildingAccess(req, sub.building_id);
  if (req.user.role === 'resident' && !isOwner) throw err('Not authorized', 403);

  await streamBlob(sub.screenshot_path, res);
}));

export default r;
