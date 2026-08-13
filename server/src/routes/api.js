import { Router } from 'express';
import db, { toPaise, toRupees, audit } from '../db.js';
import {
  buildingSummary, flatLedger, recordPayment, recordPaymentWithAdjustment, editPayment, deletePayment,
  applyAdvance, monthState, advanceBalance, residentCreditSummary, revokeResidentCredit, ADJUSTMENT_CATEGORIES,
} from '../services/finance.js';
import { syncBuilding, autoSync } from '../services/sheets.js';
import { need, asyncHandler } from '../middleware/validate.js';
import { requireAuth, requireRole, assertBuildingAccess, loadScoped } from '../middleware/auth.js';
import { uploadBuildingQr, sniffAndValidate, putUpload, streamBlob } from '../middleware/upload.js';

const r = Router();
const METHODS = ['cash', 'upi', 'bank', 'online', 'other'];
const checkMethod = (m) => {
  if (!METHODS.includes(m)) throw Object.assign(new Error('Invalid payment method'), { status: 400 });
};

export const EXPENSE_CATEGORIES = [
  'Sweeper / Cleaning', 'Electricity Bill', 'Water Bill', 'Security', 'Internet',
  'Sweeper', 'Cleaning', 'Generator',
  'CCTV Maintenance', 'Lift Maintenance', 'Building Repair', 'Electrical Repair',
  'Plumbing', 'Painting', 'Cleaning Supplies', 'General Maintenance', 'Other',
];

// every route below requires a signed-in user; specific routes further
// restrict to particular roles and/or building-scope the resource
r.use(requireAuth);

// ---------------- buildings (master admin only — building_admin acts on
// their own building via req.user.buildingId, they never need this list) ----------------
r.get('/buildings', requireRole('master_admin'), asyncHandler(async (req, res) => {
  const now = new Date();
  const buildings = await db.prepare('SELECT * FROM buildings WHERE archived=0 ORDER BY created_at DESC').all();
  const list = await Promise.all(buildings.map(async (b) => {
    const s = await buildingSummary(b.id, now.getMonth() + 1, now.getFullYear());
    return { ...b, stats: s.totals };
  }));
  res.json(list);
}));

r.post('/buildings', requireRole('master_admin'), asyncHandler(async (req, res) => {
  need(req.body, ['name']);
  const { name, address, description, floors, total_flats, manager_name, contact, notes } = req.body;
  const info = await db.prepare(
    `INSERT INTO buildings (name, address, description, floors, total_flats, manager_name, contact, notes)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(name, address || null, description || null, floors || null, total_flats || null,
        manager_name || null, contact || null, notes || null);
  await audit(info.lastInsertRowid, 'create', 'building', info.lastInsertRowid, name, req.user.id);
  res.status(201).json(await db.prepare('SELECT * FROM buildings WHERE id=?').get(info.lastInsertRowid));
}));

r.put('/buildings/:id', requireRole('master_admin'), asyncHandler(async (req, res) => {
  const b = await db.prepare('SELECT * FROM buildings WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Building not found' });
  const f = { ...b, ...req.body };
  await db.prepare(
    `UPDATE buildings SET name=?, address=?, description=?, floors=?, total_flats=?, manager_name=?, contact=?, notes=?, archived=? WHERE id=?`
  ).run(f.name, f.address, f.description, f.floors, f.total_flats, f.manager_name, f.contact, f.notes, f.archived ? 1 : 0, b.id);
  await audit(b.id, 'update', 'building', b.id, f.name, req.user.id);
  res.json(await db.prepare('SELECT * FROM buildings WHERE id=?').get(b.id));
}));

r.delete('/buildings/:id', requireRole('master_admin'), asyncHandler(async (req, res) => {
  await db.prepare('UPDATE buildings SET archived=1 WHERE id=?').run(req.params.id);
  await audit(req.params.id, 'archive', 'building', req.params.id, '', req.user.id);
  res.json({ ok: true });
}));

r.delete('/buildings/:id/permanent', requireRole('master_admin'), asyncHandler(async (req, res) => {
  const b = await db.prepare('SELECT * FROM buildings WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Building not found' });
  await audit(b.id, 'delete', 'building', b.id, b.name, req.user.id);
  // cascades to flats/payments/advance_tx/expenses/emergency_funds/fund_tx/
  // sheet_connections/sync_logs/users/payment_submissions/notices via FK ON DELETE CASCADE
  await db.prepare('DELETE FROM buildings WHERE id=?').run(b.id);
  res.json({ ok: true });
}));

r.get('/buildings/:id/summary', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const now = new Date();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const year = Number(req.query.year) || now.getFullYear();
  res.json(await buildingSummary(Number(req.params.id), month, year));
}));

// ---------------- flats ----------------
r.get('/buildings/:id/flats', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const now = new Date();
  const rows = await db.prepare('SELECT * FROM flats WHERE building_id=? AND archived=0 ORDER BY number').all(req.params.id);
  const flats = await Promise.all(rows.map(async (f) => {
    const st = await monthState(f.id, now.getMonth() + 1, now.getFullYear());
    return {
      ...f, monthly_amount: toRupees(f.monthly_amount),
      status: st.status, due: toRupees(st.due), advance: toRupees(st.advBalance),
    };
  }));
  res.json(flats);
}));

r.post('/buildings/:id/flats', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  need(req.body, ['number', 'monthly_amount']);
  const { number, monthly_amount, owner_name, resident_name, mobile, floor, size_sqft, notes } = req.body;
  const info = await db.prepare(
    `INSERT INTO flats (building_id, number, monthly_amount, owner_name, resident_name, mobile, floor, size_sqft, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(req.params.id, number, toPaise(monthly_amount), owner_name || null, resident_name || null,
        mobile || null, floor || null, size_sqft || null, notes || null);
  await audit(Number(req.params.id), 'create', 'flat', info.lastInsertRowid, number, req.user.id);
  autoSync(Number(req.params.id));
  res.status(201).json({ id: info.lastInsertRowid });
}));

r.put('/flats/:id', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const f = await loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  const n = { ...f, ...req.body };
  const monthly = req.body.monthly_amount !== undefined ? toPaise(req.body.monthly_amount) : f.monthly_amount;
  await db.prepare(
    `UPDATE flats SET number=?, monthly_amount=?, owner_name=?, resident_name=?, mobile=?, floor=?, size_sqft=?, notes=?, archived=? WHERE id=?`
  ).run(n.number, monthly, n.owner_name, n.resident_name, n.mobile, n.floor, n.size_sqft, n.notes, n.archived ? 1 : 0, f.id);
  await audit(f.building_id, 'update', 'flat', f.id, n.number, req.user.id);
  autoSync(f.building_id);
  res.json({ ok: true });
}));

r.delete('/flats/:id', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const f = await loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  await db.prepare('UPDATE flats SET archived=1 WHERE id=?').run(f.id);
  await audit(f.building_id, 'archive', 'flat', f.id, f.number, req.user.id);
  res.json({ ok: true });
}));

r.delete('/flats/:id/permanent', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const f = await loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  await audit(f.building_id, 'delete', 'flat', f.id, f.number, req.user.id);
  // expenses has no flat_id (only building_id), so the FK cascade from
  // flats->resident_credits doesn't reach adjustment-expenses linked via
  // source_credit_id — clean those up first or they'd orphan permanently.
  // resident_credits itself cascades via its own flat_id FK.
  const tx = await db.transaction();
  try {
    await tx.prepare('DELETE FROM expenses WHERE source_credit_id IN (SELECT id FROM resident_credits WHERE flat_id=?)').run(f.id);
    await tx.prepare('DELETE FROM flats WHERE id=?').run(f.id);
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  autoSync(f.building_id);
  res.json({ ok: true });
}));

// residents use /me/ledger and /me/month-state instead, so they can never
// pass an arbitrary flat id — these two stay admin-only.
r.get('/flats/:id/ledger', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const f = await loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  res.json(await flatLedger(f.id));
}));

r.get('/flats/:id/month-state', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const f = await loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  const now = new Date();
  const st = await monthState(f.id, Number(req.query.month) || now.getMonth() + 1, Number(req.query.year) || now.getFullYear());
  res.json({
    required: toRupees(st.required), paid: toRupees(st.paid + st.advUsed),
    due: toRupees(st.due), advance: toRupees(st.advBalance), status: st.status,
  });
}));

// ---------------- resident credit ledger (direct-vendor-payment adjustments) ----------------
r.get('/flats/:id/credits', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const f = await loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), req.params.id);
  res.json(await residentCreditSummary(f.id));
}));

r.get('/buildings/:id/resident-credits', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const rows = (await db.prepare(
    `SELECT rc.*, f.number flat_number FROM resident_credits rc JOIN flats f ON f.id=rc.flat_id
     WHERE rc.building_id=? AND rc.deleted=0 ORDER BY rc.created_at DESC LIMIT 300`
  ).all(req.params.id)).map((c) => ({ ...c, amount: toRupees(c.amount) }));
  res.json(rows);
}));

r.post('/resident-credits/:id/revoke', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const c = await loadScoped(req, (id) => db.prepare('SELECT * FROM resident_credits WHERE id=? AND deleted=0').get(id), req.params.id);
  const tx = await db.transaction();
  try {
    await revokeResidentCredit(tx, c.id, req.user.id);
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  autoSync(c.building_id);
  res.json({ ok: true });
}));

// ---------------- payments & advance ----------------
r.get('/buildings/:id/payments', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const rows = (await db.prepare(
    `SELECT p.*, f.number flat_number FROM payments p JOIN flats f ON f.id=p.flat_id
     WHERE p.building_id=? AND p.deleted=0 ORDER BY p.paid_on DESC, p.id DESC LIMIT 300`
  ).all(req.params.id)).map((p) => ({
    ...p, amount: toRupees(p.amount), applied_amount: toRupees(p.applied_amount), advance_amount: toRupees(p.advance_amount),
  }));
  res.json(rows);
}));

r.post('/payments', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  need(req.body, ['flat_id', 'month', 'year', 'method', 'paid_on']);
  checkMethod(req.body.method);
  const flat = await loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), Number(req.body.flat_id));

  const bankAmount = req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== '' ? toPaise(req.body.amount) : 0;
  let adjustment = null;
  if (req.body.adjustment_category && req.body.adjustment_category !== 'none') {
    if (!ADJUSTMENT_CATEGORIES.includes(req.body.adjustment_category)) throw Object.assign(new Error('Invalid adjustment category'), { status: 400 });
    if (!(Number(req.body.adjustment_amount) > 0)) throw Object.assign(new Error('Adjustment amount must be greater than zero'), { status: 400 });
    if (req.body.adjustment_category === 'custom' && !req.body.adjustment_custom_title) {
      throw Object.assign(new Error('Custom Expense Name is required'), { status: 400 });
    }
    adjustment = {
      category: req.body.adjustment_category, custom_title: req.body.adjustment_custom_title || null,
      amount: toPaise(req.body.adjustment_amount),
    };
  }

  const tx = await db.transaction();
  let result;
  try {
    result = await recordPaymentWithAdjustment(tx, {
      flat_id: flat.id, month: Number(req.body.month), year: Number(req.body.year),
      paid_on: req.body.paid_on, method: req.body.method, notes: req.body.notes,
      bank_amount: bankAmount, adjustment, actor_user_id: req.user.id,
    });
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  autoSync(flat.building_id);
  res.status(201).json({
    payment: result.payment && { ...result.payment, advanceBalance: toRupees(await advanceBalance(flat.id)) },
    credit: result.credit && { ...result.credit, creditAvailable: toRupees(await advanceBalance(flat.id, 'credit')) },
  });
}));

r.put('/payments/:id', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  await loadScoped(req, (id) => db.prepare('SELECT * FROM payments WHERE id=?').get(id), req.params.id);
  const patch = { ...req.body };
  if (patch.amount !== undefined) patch.amount = toPaise(patch.amount);
  if (patch.method) checkMethod(patch.method);
  const tx = await db.transaction();
  let result;
  try {
    result = await editPayment(tx, Number(req.params.id), patch, req.user.id);
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  res.json(result);
}));

r.delete('/payments/:id', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  await loadScoped(req, (id) => db.prepare('SELECT * FROM payments WHERE id=?').get(id), req.params.id);
  const tx = await db.transaction();
  try {
    await deletePayment(tx, Number(req.params.id), req.user.id);
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  res.json({ ok: true });
}));

r.post('/advance/apply', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  need(req.body, ['flat_id', 'month', 'year']);
  const flat = await loadScoped(req, (id) => db.prepare('SELECT * FROM flats WHERE id=?').get(id), Number(req.body.flat_id));
  const tx = await db.transaction();
  let used;
  try {
    used = await applyAdvance(tx, {
      flat_id: flat.id, month: Number(req.body.month), year: Number(req.body.year),
      amount: req.body.amount ? toPaise(req.body.amount) : undefined,
      actor_user_id: req.user.id,
    });
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  autoSync(flat.building_id);
  res.json({ used: toRupees(used), remaining: toRupees(await advanceBalance(flat.id)) });
}));

// ---------------- expenses ----------------
r.get('/expense-categories', (req, res) => res.json(EXPENSE_CATEGORIES));

r.get('/buildings/:id/expenses', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const rows = (await db.prepare(
    'SELECT * FROM expenses WHERE building_id=? AND deleted=0 ORDER BY date DESC, id DESC LIMIT 300'
  ).all(req.params.id)).map((e) => ({ ...e, amount: toRupees(e.amount) }));
  res.json(rows);
}));

r.post('/buildings/:id/expenses', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  need(req.body, ['date', 'amount', 'category', 'method']);
  checkMethod(req.body.method);
  const { date, amount, category, custom_name, description, method, paid_to } = req.body;
  const info = await db.prepare(
    `INSERT INTO expenses (building_id, date, amount, category, custom_name, description, method, paid_to)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(req.params.id, date, toPaise(amount), category, custom_name || null, description || null, method, paid_to || null);
  await audit(Number(req.params.id), 'create', 'expense', info.lastInsertRowid, `${category} ₹${amount}`, req.user.id);
  autoSync(Number(req.params.id));
  res.status(201).json({ id: info.lastInsertRowid });
}));

r.put('/expenses/:id', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const e = await loadScoped(req, (id) => db.prepare('SELECT * FROM expenses WHERE id=? AND deleted=0').get(id), req.params.id);
  if (e.is_adjustment) throw Object.assign(new Error('This expense was auto-generated from a resident credit adjustment — revoke the credit instead'), { status: 400 });
  const n = { ...e, ...req.body };
  if (req.body.method) checkMethod(req.body.method);
  const amount = req.body.amount !== undefined ? toPaise(req.body.amount) : e.amount;
  await db.prepare(
    'UPDATE expenses SET date=?, amount=?, category=?, custom_name=?, description=?, method=?, paid_to=? WHERE id=?'
  ).run(n.date, amount, n.category, n.custom_name, n.description, n.method, n.paid_to, e.id);
  await audit(e.building_id, 'update', 'expense', e.id, '', req.user.id);
  autoSync(e.building_id);
  res.json({ ok: true });
}));

r.delete('/expenses/:id', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  const e = await loadScoped(req, (id) => db.prepare('SELECT * FROM expenses WHERE id=?').get(id), req.params.id);
  if (e.is_adjustment) throw Object.assign(new Error('This expense was auto-generated from a resident credit adjustment — revoke the credit instead'), { status: 400 });
  await db.prepare('UPDATE expenses SET deleted=1 WHERE id=?').run(e.id);
  await audit(e.building_id, 'delete', 'expense', e.id, '', req.user.id);
  autoSync(e.building_id);
  res.json({ ok: true });
}));

// ---------------- emergency funds ----------------
r.get('/buildings/:id/funds', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const rows = await db.prepare('SELECT * FROM emergency_funds WHERE building_id=? AND archived=0 ORDER BY created_at DESC').all(req.params.id);
  const funds = await Promise.all(rows.map(async (f) => {
    const inS = (await db.prepare("SELECT COALESCE(SUM(amount),0) s FROM fund_tx WHERE fund_id=? AND type='contribution' AND deleted=0").get(f.id)).s;
    const outS = (await db.prepare("SELECT COALESCE(SUM(amount),0) s FROM fund_tx WHERE fund_id=? AND type='expense' AND deleted=0").get(f.id)).s;
    return {
      ...f, target_amount: toRupees(f.target_amount),
      collected: toRupees(inS), spent: toRupees(outS), balance: toRupees(inS - outS),
    };
  }));
  res.json(funds);
}));

r.post('/buildings/:id/funds', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  need(req.body, ['name']);
  const { name, reason, target_amount, notes } = req.body;
  const info = await db.prepare(
    'INSERT INTO emergency_funds (building_id, name, reason, target_amount, notes) VALUES (?,?,?,?,?)'
  ).run(req.params.id, name, reason || null, target_amount ? toPaise(target_amount) : 0, notes || null);
  await audit(Number(req.params.id), 'create', 'fund', info.lastInsertRowid, name, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid });
}));

r.get('/funds/:id/transactions', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  await loadScoped(req, (id) => db.prepare('SELECT * FROM emergency_funds WHERE id=?').get(id), req.params.id);
  const rows = (await db.prepare('SELECT * FROM fund_tx WHERE fund_id=? AND deleted=0 ORDER BY date DESC, id DESC')
    .all(req.params.id)).map((t) => ({ ...t, amount: toRupees(t.amount) }));
  res.json(rows);
}));

r.post('/funds/:id/transactions', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  need(req.body, ['type', 'amount', 'method', 'date']);
  checkMethod(req.body.method);
  if (!['contribution', 'expense'].includes(req.body.type))
    return res.status(400).json({ error: 'Invalid transaction type' });
  const fund = await loadScoped(req, (id) => db.prepare('SELECT * FROM emergency_funds WHERE id=?').get(id), req.params.id);
  const info = await db.prepare(
    'INSERT INTO fund_tx (fund_id, building_id, flat_id, type, amount, method, date, notes) VALUES (?,?,?,?,?,?,?,?)'
  ).run(fund.id, fund.building_id, req.body.flat_id || null, req.body.type,
        toPaise(req.body.amount), req.body.method, req.body.date, req.body.notes || null);
  await audit(fund.building_id, 'create', 'fund_tx', info.lastInsertRowid, `${req.body.type} ₹${req.body.amount} — ${fund.name}`, req.user.id);
  autoSync(fund.building_id);
  res.status(201).json({ id: info.lastInsertRowid });
}));

// ---------------- payment info (bank/UPI/QR shown to residents when paying) ----------------
r.get('/buildings/:id/payment-info', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const b = await db.prepare(
    'SELECT bank_account_name, bank_account_number, bank_ifsc, bank_upi_id, bank_qr_path FROM buildings WHERE id=?'
  ).get(req.params.id);
  if (!b) throw Object.assign(new Error('Building not found'), { status: 404 });
  res.json({ ...b, hasQr: !!b.bank_qr_path });
}));

r.put('/buildings/:id/payment-info', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const { bank_account_name, bank_account_number, bank_ifsc, bank_upi_id } = req.body;
  await db.prepare(
    'UPDATE buildings SET bank_account_name=?, bank_account_number=?, bank_ifsc=?, bank_upi_id=? WHERE id=?'
  ).run(bank_account_name || null, bank_account_number || null, bank_ifsc || null, bank_upi_id || null, req.params.id);
  await audit(Number(req.params.id), 'update', 'building_payment_info', Number(req.params.id), '', req.user.id);
  res.json({ ok: true });
}));

r.post('/buildings/:id/payment-info/qr', requireRole('building_admin', 'master_admin'), (req, res, next) => {
  assertBuildingAccess(req, req.params.id);
  uploadBuildingQr(req, res, async (uploadErr) => {
    try {
      if (uploadErr) throw Object.assign(new Error(uploadErr.message || 'Upload failed'), { status: 400 });
      if (!req.file) throw Object.assign(new Error('QR image is required'), { status: 400 });
      sniffAndValidate(req.file.buffer, req.file.mimetype);
      const url = await putUpload(req.file, 'building-qr');
      await db.prepare('UPDATE buildings SET bank_qr_path=? WHERE id=?').run(url, req.params.id);
      await audit(Number(req.params.id), 'update', 'building_qr', Number(req.params.id), '', req.user.id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
});

// building_admin/master_admin manage this; residents of the same building
// also need to view it when paying, so any authenticated same-building role works.
r.get('/buildings/:id/payment-info/qr', asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const b = await db.prepare('SELECT bank_qr_path FROM buildings WHERE id=?').get(req.params.id);
  if (!b?.bank_qr_path) throw Object.assign(new Error('No QR code uploaded yet'), { status: 404 });
  await streamBlob(b.bank_qr_path, res);
}));

// ---------------- google sheets ----------------
r.get('/buildings/:id/sheet', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  const conn = await db.prepare('SELECT * FROM sheet_connections WHERE building_id=?').get(req.params.id);
  const logs = await db.prepare('SELECT * FROM sync_logs WHERE building_id=? ORDER BY id DESC LIMIT 10').all(req.params.id);
  res.json({ connection: conn || null, logs });
}));

r.post('/buildings/:id/sheet', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  need(req.body, ['sheet_id']);
  // accept a full URL or bare sheet ID
  const m = String(req.body.sheet_id).match(/\/d\/([a-zA-Z0-9-_]+)/);
  const sheetId = m ? m[1] : req.body.sheet_id.trim();
  await db.prepare(
    `INSERT INTO sheet_connections (building_id, sheet_id, sheet_tab, sheet_name)
     VALUES (?,?,?,?)
     ON CONFLICT(building_id) DO UPDATE SET sheet_id=excluded.sheet_id, sheet_tab=excluded.sheet_tab, sheet_name=excluded.sheet_name, status='connected'`
  ).run(req.params.id, sheetId, req.body.sheet_tab || 'Sheet1', req.body.sheet_name || null);
  await audit(Number(req.params.id), 'connect', 'sheet', null, sheetId, req.user.id);
  res.json({ ok: true });
}));

r.post('/buildings/:id/sheet/sync', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  res.json(await syncBuilding(Number(req.params.id)));
}));

// ---------------- audit ----------------
r.get('/buildings/:id/audit', requireRole('building_admin', 'master_admin'), asyncHandler(async (req, res) => {
  assertBuildingAccess(req, req.params.id);
  res.json(await db.prepare('SELECT * FROM audit_logs WHERE building_id=? ORDER BY id DESC LIMIT 50').all(req.params.id));
}));

export default r;
