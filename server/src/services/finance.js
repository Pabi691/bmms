import db, { toRupees, audit } from '../db.js';

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Maps payment methods onto the displayed balance buckets. UPI, online payment and
// bank transfer all settle into the same real bank account, so they share one bucket.
export const methodBucket = (m) =>
  m === 'cash' ? 'cash' : (m === 'bank' || m === 'upi' || m === 'online') ? 'bank' : 'other';

// Expense-classification labels for a "resident already paid this vendor
// directly" adjustment claim. These are NOT independently-tracked recurring
// dues — the credit they generate always reduces Maintenance specifically.
export const ADJUSTMENT_CATEGORIES = ['electricity', 'internet', 'water', 'sweeper', 'security', 'cleaning', 'generator', 'custom'];
export const ADJUSTMENT_EXPENSE_MAP = {
  electricity: 'Electricity Bill', internet: 'Internet', water: 'Water Bill', sweeper: 'Sweeper',
  security: 'Security', cleaning: 'Cleaning', generator: 'Generator', custom: 'Other',
};
const prevMonth = (m, y) => (m === 1 ? { m: 12, y: y - 1 } : { m: m - 1, y });

// ---------- month-level maintenance status for a flat ----------
// `x` is the executor: the shared `db` singleton for standalone reads
// (routes), or an open `tx` when called mid-transaction from below.
export async function monthState(flatId, month, year, x = db) {
  const flat = await x.prepare('SELECT * FROM flats WHERE id=?').get(flatId);
  if (!flat) throw err('Flat not found', 404);
  const paid = (await x
    .prepare(
      'SELECT COALESCE(SUM(applied_amount),0) s FROM payments WHERE flat_id=? AND month=? AND year=? AND deleted=0'
    )
    .get(flatId, month, year)).s;
  const advUsed = (await x
    .prepare(
      "SELECT COALESCE(SUM(amount),0) s FROM advance_tx WHERE flat_id=? AND type='debit' AND month=? AND year=? AND deleted=0"
    )
    .get(flatId, month, year)).s;
  const required = flat.monthly_amount;
  const settled = paid + advUsed;
  const due = Math.max(required - settled, 0);
  const advBalance = await advanceBalance(flatId, 'bank', x);
  let status = 'due';
  if (required === 0 || settled >= required) status = 'paid';
  else if (settled > 0) status = 'partial';
  return { flat, required, paid, advUsed, settled, due, advBalance, status };
}

// `source` distinguishes what funded a credit in the advance_tx pool: 'bank'
// (an overpayment against the society's own bank account, the original/only
// source before the Resident Credit Ledger existed) vs 'credit' (an approved
// direct-vendor-payment adjustment). Both cascade against the same
// Maintenance due via the exact same mechanism below — only WHAT feeds the
// pool differs. Default 'bank' reproduces every pre-existing call site's
// behavior unchanged.
export async function advanceBalance(flatId, source = 'bank', x = db) {
  const r = await x
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) b
       FROM advance_tx WHERE flat_id=? AND source=? AND deleted=0`
    )
    .get(flatId, source);
  return r.b;
}

// Roll a flat's current advance/credit balance forward into the due of each
// following month, in order, until the balance runs out (a partial amount
// just lands on whichever month it stops at). maxMonthsAhead is a safety
// cap, not a real limit.
//
// For a bank overpayment, `fromMonth` is the payment's own month — the loop
// increments *before* processing, so it only touches months *after* the
// anchor, which is correct because the payment's own applied_amount already
// settled the anchor month directly. A resident credit has no such direct
// settlement of its own anchor month, so recordAdjustment below passes
// "the month before the anchor" as fromMonth, exploiting this same
// pre-increment behavior so the cascade's first iteration lands ON the
// anchor month instead of skipping it.
//
// Always runs inside the caller's transaction — `tx` is required, not optional.
async function cascadeAdvance(tx, buildingId, flatId, fromMonth, fromYear, refId, source = 'bank', maxMonthsAhead = 36) {
  let m = fromMonth, y = fromYear, iterations = 0;
  let remaining = await advanceBalance(flatId, source, tx);
  const applied = [];
  while (remaining > 0 && iterations < maxMonthsAhead) {
    m++; if (m === 13) { m = 1; y++; }
    iterations++;
    const st = await monthState(flatId, m, y, tx);
    if (st.due <= 0) continue;
    const use = Math.min(remaining, st.due);
    await tx.prepare(
      `INSERT INTO advance_tx (building_id, flat_id, type, amount, month, year, payment_id, resident_credit_id, source, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(buildingId, flatId, 'debit', use, m, y,
          source === 'bank' ? refId : null, source === 'credit' ? refId : null, source,
          `Auto-applied ${source === 'credit' ? 'resident credit' : 'advance'} to ${m}/${y}`);
    remaining -= use;
    applied.push({ month: m, year: y, amount: toRupees(use), remainingDue: toRupees(st.due - use) });
  }
  return applied;
}

// ---------- record a payment (full / partial / extra) ----------
// `tx` is a transaction opened by the caller (see routes) — required, not
// optional, since libSQL has no implicit-nested-transaction equivalent of
// better-sqlite3's db.transaction(); every write path threads the same tx.
export async function recordPayment(tx, p) {
  const { flat_id, month, year, amount, method, paid_on, notes, actor_user_id = null } = p;
  const st = await monthState(flat_id, month, year, tx);
  const applied = Math.min(amount, st.due);
  const advance = amount - applied;
  const info = await tx
    .prepare(
      `INSERT INTO payments (building_id, flat_id, month, year, amount, applied_amount, advance_amount, method, paid_on, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(st.flat.building_id, flat_id, month, year, amount, applied, advance, method, paid_on, notes || null);
  let cascade = [];
  if (advance > 0) {
    await tx.prepare(
      `INSERT INTO advance_tx (building_id, flat_id, type, amount, month, year, payment_id, notes)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(st.flat.building_id, flat_id, 'credit', advance, month, year, info.lastInsertRowid,
      'Extra payment stored as advance');
    cascade = await cascadeAdvance(tx, st.flat.building_id, flat_id, month, year, info.lastInsertRowid);
  }
  await audit(st.flat.building_id, 'create', 'payment', info.lastInsertRowid,
    `Flat ${st.flat.number} ${month}/${year}: ₹${toRupees(amount)} (applied ₹${toRupees(applied)}, advance ₹${toRupees(advance)})`,
    actor_user_id, tx);
  return { id: info.lastInsertRowid, cascade };
}

// ---------- soft-delete a payment (removes its advance credit too) ----------
export async function deletePayment(tx, id, actorUserId = null) {
  const pay = await tx.prepare('SELECT * FROM payments WHERE id=? AND deleted=0').get(id);
  if (!pay) throw err('Payment not found', 404);
  await tx.prepare('UPDATE payments SET deleted=1 WHERE id=?').run(id);
  await tx.prepare('UPDATE advance_tx SET deleted=1 WHERE payment_id=?').run(id);
  await audit(pay.building_id, 'delete', 'payment', id, `Soft-deleted payment of ₹${toRupees(pay.amount)}`, actorUserId, tx);
}

// ---------- edit a payment: soft-delete + re-record keeps history traceable ----------
export async function editPayment(tx, id, next, actorUserId = null) {
  const pay = await tx.prepare('SELECT * FROM payments WHERE id=? AND deleted=0').get(id);
  if (!pay) throw err('Payment not found', 404);
  await deletePayment(tx, id, actorUserId);
  return recordPayment(tx, {
    flat_id: pay.flat_id,
    month: next.month ?? pay.month,
    year: next.year ?? pay.year,
    amount: next.amount ?? pay.amount,
    method: next.method ?? pay.method,
    paid_on: next.paid_on ?? pay.paid_on,
    notes: next.notes ?? pay.notes,
    actor_user_id: actorUserId,
  });
}

// ---------- apply advance balance to a month (manual, month-wise) ----------
export async function applyAdvance(tx, { flat_id, month, year, amount, actor_user_id = null }) {
  const st = await monthState(flat_id, month, year, tx);
  const available = await advanceBalance(flat_id, 'bank', tx);
  if (available <= 0) throw err('No advance balance available');
  if (st.due <= 0) throw err('Selected month has no due to adjust');
  const use = Math.min(amount || available, available, st.due);
  await tx.prepare(
    `INSERT INTO advance_tx (building_id, flat_id, type, amount, month, year, notes)
     VALUES (?,?,?,?,?,?,?)`
  ).run(st.flat.building_id, flat_id, 'debit', use, month, year, `Advance applied to ${month}/${year}`);
  await audit(st.flat.building_id, 'adjust', 'advance', flat_id,
    `Applied ₹${toRupees(use)} advance to ${month}/${year} for flat ${st.flat.number}`, actor_user_id, tx);
  return use;
}

// ---------- Resident Credit Ledger: direct-vendor-payment adjustments ----------

// Money-movement core shared by admin-direct-entry and submission-approval:
// creates the linked Expense Ledger entry, deposits the credit into the
// flat's 'credit'-source advance_tx pool, and immediately cascades it
// against current+future Maintenance due.
async function activateResidentCredit(tx, credit, actorUserId) {
  const flat = await tx.prepare('SELECT * FROM flats WHERE id=?').get(credit.flat_id);
  const expCategory = ADJUSTMENT_EXPENSE_MAP[credit.category];
  const expInfo = await tx.prepare(
    `INSERT INTO expenses (building_id, date, amount, category, custom_name, description, method, is_adjustment, source_credit_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(credit.building_id, credit.paid_on, credit.amount, expCategory,
        credit.category === 'custom' ? credit.custom_title : null,
        `Auto-recorded adjustment — Flat ${flat.number} (credit #${credit.id})`, 'other', 1, credit.id);
  await audit(credit.building_id, 'create', 'expense', expInfo.lastInsertRowid,
    `Auto-adjustment expense ₹${toRupees(credit.amount)} (${expCategory}) linked to credit #${credit.id}`, actorUserId, tx);

  await tx.prepare(
    `INSERT INTO advance_tx (building_id, flat_id, type, amount, month, year, resident_credit_id, source, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(credit.building_id, credit.flat_id, 'credit', credit.amount, credit.month, credit.year, credit.id, 'credit',
        'Resident direct-payment credit');

  const { m, y } = prevMonth(credit.month, credit.year);
  const cascade = await cascadeAdvance(tx, credit.building_id, credit.flat_id, m, y, credit.id, 'credit');

  await tx.prepare('UPDATE resident_credits SET expense_id=? WHERE id=?').run(expInfo.lastInsertRowid, credit.id);
  return { expenseId: expInfo.lastInsertRowid, cascade };
}

// Creates and immediately activates one Resident Credit. Always "approved"
// the moment this runs — pending/rejected states live on payment_submissions
// for resident-submitted claims (see approvePaymentSubmission); this
// function itself is the single moment of approval, called either directly
// (admin entry) or from the submission-approval route.
export async function recordAdjustment(tx, p) {
  const {
    flat_id, category, custom_title = null, amount, month, year, paid_on,
    receipt_path = null, notes = null, submission_id = null, actor_user_id = null,
  } = p;

  if (!ADJUSTMENT_CATEGORIES.includes(category)) throw err('Invalid adjustment category');
  if (category === 'custom' && !custom_title) throw err('Custom Expense Name is required');
  if (!(amount > 0)) throw err('Adjustment amount must be greater than zero');

  const flat = await tx.prepare('SELECT * FROM flats WHERE id=?').get(flat_id);
  if (!flat) throw err('Flat not found', 404);

  const info = await tx.prepare(
    `INSERT INTO resident_credits (building_id, flat_id, submission_id, category, custom_title, amount, month, year, paid_on, receipt_path, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(flat.building_id, flat_id, submission_id, category, category === 'custom' ? custom_title : null,
        amount, month, year, paid_on, receipt_path, notes, actor_user_id);

  const credit = await tx.prepare('SELECT * FROM resident_credits WHERE id=?').get(info.lastInsertRowid);
  const { expenseId, cascade } = await activateResidentCredit(tx, credit, actor_user_id);
  await audit(flat.building_id, 'create', 'resident_credit', credit.id,
    `Flat ${flat.number} ${category} adjustment ₹${toRupees(amount)}`, actor_user_id, tx);
  return { id: credit.id, expenseId, cascade };
}

// Orchestrates the combined "Amount Paid to Society" + "Adjust Maintenance
// With" payment screen. Bank portion (a real payments row) is recorded
// first, then the adjustment (a resident_credits row) — either or both may
// be present, at least one must be > 0.
export async function recordPaymentWithAdjustment(tx, p) {
  const {
    flat_id, month, year, paid_on, notes, method,
    bank_amount = 0, adjustment = null, submission_id = null, actor_user_id = null,
  } = p;
  if (bank_amount < 0) throw err('Amount paid to society cannot be negative');
  if (adjustment && adjustment.amount < 0) throw err('Adjustment amount cannot be negative');
  if (!(bank_amount > 0) && !(adjustment?.amount > 0)) throw err('Enter an amount paid to the society or an adjustment amount');

  const result = { payment: null, credit: null };
  if (bank_amount > 0) {
    result.payment = await recordPayment(tx, { flat_id, month, year, amount: bank_amount, method, paid_on, notes, actor_user_id });
  }
  if (adjustment?.amount > 0) {
    result.credit = await recordAdjustment(tx, {
      flat_id, month, year, paid_on, actor_user_id, submission_id,
      category: adjustment.category, custom_title: adjustment.custom_title,
      amount: adjustment.amount, receipt_path: adjustment.receipt_path, notes: adjustment.notes,
    });
  }
  return result;
}

// Approving a resident's submission is the same combined operation, just
// sourced from the stored row instead of a fresh request body.
export async function approvePaymentSubmission(tx, sub, actorUserId) {
  return recordPaymentWithAdjustment(tx, {
    flat_id: sub.flat_id, month: sub.month, year: sub.year, paid_on: sub.paid_on, method: sub.method,
    notes: `Approved from resident submission #${sub.id}${sub.transaction_ref ? ` (ref ${sub.transaction_ref})` : ''}`,
    bank_amount: sub.bank_amount || 0,
    adjustment: sub.adjustment_amount > 0
      ? { category: sub.adjustment_category, custom_title: sub.adjustment_custom_title, amount: sub.adjustment_amount, receipt_path: sub.screenshot_path }
      : null,
    submission_id: sub.id,
    actor_user_id: actorUserId,
  });
}

// Reverses a credit entirely: soft-deletes the resident_credits row, every
// advance_tx row it produced (the deposit itself AND every cascade debit it
// fed — reopening whatever Maintenance months it had settled), and its
// linked expense. Mirrors deletePayment's reversal pattern exactly.
export async function revokeResidentCredit(tx, id, actorUserId = null) {
  const credit = await tx.prepare('SELECT * FROM resident_credits WHERE id=? AND deleted=0').get(id);
  if (!credit) throw err('Resident credit not found', 404);
  await tx.prepare('UPDATE resident_credits SET deleted=1 WHERE id=?').run(id);
  await tx.prepare('UPDATE advance_tx SET deleted=1 WHERE resident_credit_id=?').run(id);
  if (credit.expense_id) await tx.prepare('UPDATE expenses SET deleted=1 WHERE id=? AND deleted=0').run(credit.expense_id);
  await audit(credit.building_id, 'revoke', 'resident_credit', id, `Revoked ₹${toRupees(credit.amount)} credit`, actorUserId, tx);
}

// FIFO oldest-credit-first allocation of the flat's single pooled
// credit-debit history onto each individual approved resident_credits row —
// this is how one fungible pool balance gets attributed back to
// Available/Used/Partially-Used per entry (mirrors how flatLedger already
// derives dueForMonth/advanceRemaining by walking history chronologically).
export async function residentCreditSummary(flatId, x = db) {
  const credits = await x.prepare('SELECT * FROM resident_credits WHERE flat_id=? AND deleted=0 ORDER BY created_at, id').all(flatId);
  let debitPool = (await x.prepare(
    "SELECT COALESCE(SUM(amount),0) s FROM advance_tx WHERE flat_id=? AND source='credit' AND type='debit' AND deleted=0"
  ).get(flatId)).s;
  const rows = credits.map((c) => {
    const used = Math.min(c.amount, debitPool);
    debitPool -= used;
    return {
      id: c.id, category: c.category, customTitle: c.custom_title, amount: toRupees(c.amount),
      month: c.month, year: c.year, paidOn: c.paid_on, receiptPath: c.receipt_path, createdAt: c.created_at,
      usedAmount: toRupees(used), availableAmount: toRupees(c.amount - used),
      status: used === 0 ? 'available' : used === c.amount ? 'used' : 'partially_used',
    };
  });
  const available = toRupees(await advanceBalance(flatId, 'credit', x));
  return {
    rows,
    totals: {
      approved: toRupees(credits.reduce((s, c) => s + c.amount, 0)),
      available,
      used: rows.reduce((s, r) => s + r.usedAmount, 0),
    },
  };
}

// ---------- building financial summary ----------
export async function buildingSummary(buildingId, month, year, x = db) {
  const b = await x.prepare('SELECT * FROM buildings WHERE id=?').get(buildingId);
  if (!b) throw err('Building not found', 404);

  const flats = await x.prepare('SELECT * FROM flats WHERE building_id=? AND archived=0').all(buildingId);

  const expected = flats.reduce((s, f) => s + f.monthly_amount, 0);

  const q = (sql, ...a) => x.prepare(sql).get(...a);
  const mm = String(month).padStart(2, '0');
  const monthsWindow = [];
  { let cm = month, cy = year; for (let i = 0; i < 6; i++) { monthsWindow.unshift({ cm, cy }); cm--; if (cm === 0) { cm = 12; cy--; } } }

  // Every query below reads the same building's data but none of them
  // depend on each other's result, so they're all fired together instead
  // of one round trip at a time — against a remote database (Turso) each
  // round trip carries real network latency, and this function used to
  // rack up ~40 of them sequentially on every Buildings-list/Dashboard
  // load, which is why those pages felt slow.
  const [
    flatStates,
    totalPaymentsR, totalExpensesR, realExpensesR, fundInR, fundOutR, advTotalR,
    cashMethodRows, fundInMethodRows, expenseMethodRows, fundOutMethodRows,
    monthIncomeR, monthExpenseR, settledViaBankMonthR, settledViaCreditMonthR,
    categoryTotals, societyPaidExpensesR,
    creditPendingR, creditRejectedR, creditApprovedR, creditAvailableR,
    series,
    recentPaymentsRaw, recentExpensesRaw,
  ] = await Promise.all([
    Promise.all(flats.map(async (f) => {
      const st = await monthState(f.id, month, year, x);
      const lastPaidOn = await x.prepare(
        "SELECT MAX(paid_on) d FROM payments WHERE flat_id=? AND month=? AND year=? AND deleted=0"
      ).get(f.id, month, year);
      return {
        id: f.id, number: f.number, owner_name: f.owner_name, resident_name: f.resident_name,
        monthly_amount: toRupees(f.monthly_amount), paid: toRupees(st.paid + st.advUsed),
        due: toRupees(st.due), advance: toRupees(st.advBalance), status: st.status,
        paidOn: lastPaidOn.d || null,
      };
    })),
    q('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE building_id=? AND deleted=0', buildingId),
    q('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE building_id=? AND deleted=0', buildingId),
    // Real cash only — an adjustment expense is direct-vendor money that never
    // touched the society's bank account, so it must not reduce the real cash
    // position, even though it does count toward totalExpenses below (the
    // spec's own formula: Total Expenses = Direct Vendor Payments + Society-Paid).
    q('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE building_id=? AND deleted=0 AND is_adjustment=0', buildingId),
    q("SELECT COALESCE(SUM(amount),0) s FROM fund_tx WHERE building_id=? AND type='contribution' AND deleted=0", buildingId),
    q("SELECT COALESCE(SUM(amount),0) s FROM fund_tx WHERE building_id=? AND type='expense' AND deleted=0", buildingId),
    q("SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) s FROM advance_tx WHERE building_id=? AND source='bank' AND deleted=0", buildingId),
    x.prepare('SELECT method, SUM(amount) s FROM payments WHERE building_id=? AND deleted=0 GROUP BY method').all(buildingId),
    x.prepare("SELECT method, SUM(amount) s FROM fund_tx WHERE building_id=? AND type='contribution' AND deleted=0 GROUP BY method").all(buildingId),
    x.prepare('SELECT method, SUM(amount) s FROM expenses WHERE building_id=? AND deleted=0 AND is_adjustment=0 GROUP BY method').all(buildingId),
    x.prepare("SELECT method, SUM(amount) s FROM fund_tx WHERE building_id=? AND type='expense' AND deleted=0 GROUP BY method").all(buildingId),
    q('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE building_id=? AND month=? AND year=? AND deleted=0', buildingId, month, year),
    q("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE building_id=? AND deleted=0 AND strftime('%m', date)=? AND strftime('%Y', date)=?", buildingId, mm, String(year)),
    // this month's Maintenance settled via bank payment vs. via resident credit
    q('SELECT COALESCE(SUM(applied_amount),0) s FROM payments WHERE building_id=? AND month=? AND year=? AND deleted=0', buildingId, month, year),
    q("SELECT COALESCE(SUM(amount),0) s FROM advance_tx WHERE building_id=? AND type='debit' AND source='credit' AND month=? AND year=? AND deleted=0", buildingId, month, year),
    // lifetime expenses by category — the 8 adjustment categories + society-paid
    Promise.all(Object.entries(ADJUSTMENT_EXPENSE_MAP).map(([cat, expCat]) =>
      q('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE building_id=? AND deleted=0 AND is_adjustment=1 AND category=?', buildingId, expCat)
        .then((r) => [cat, toRupees(r.s)]))),
    q('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE building_id=? AND deleted=0 AND is_adjustment=0', buildingId),
    // resident credit rollup across the whole building
    q("SELECT COALESCE(SUM(adjustment_amount),0) s FROM payment_submissions WHERE building_id=? AND status='pending' AND adjustment_amount > 0", buildingId),
    q("SELECT COALESCE(SUM(adjustment_amount),0) s FROM payment_submissions WHERE building_id=? AND status='rejected' AND adjustment_amount > 0", buildingId),
    q('SELECT COALESCE(SUM(amount),0) s FROM resident_credits WHERE building_id=? AND deleted=0', buildingId),
    q("SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) s FROM advance_tx WHERE building_id=? AND source='credit' AND deleted=0", buildingId),
    // last 6 months income vs expense for the chart
    Promise.all(monthsWindow.map(({ cm, cy }) =>
      Promise.all([
        q('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE building_id=? AND month=? AND year=? AND deleted=0', buildingId, cm, cy),
        q("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE building_id=? AND deleted=0 AND strftime('%m', date)=? AND strftime('%Y', date)=?", buildingId, String(cm).padStart(2, '0'), String(cy)),
      ]).then(([inc, exp]) => ({ label: `${String(cm).padStart(2, '0')}/${String(cy).slice(2)}`, income: toRupees(inc.s), expense: toRupees(exp.s) })))),
    x.prepare(
      `SELECT p.*, f.number flat_number FROM payments p JOIN flats f ON f.id=p.flat_id
       WHERE p.building_id=? AND p.deleted=0 ORDER BY p.created_at DESC LIMIT 6`).all(buildingId),
    x.prepare('SELECT * FROM expenses WHERE building_id=? AND deleted=0 ORDER BY date DESC, id DESC LIMIT 6').all(buildingId),
  ]);

  const collectedMonth = flatStates.reduce((s, f) => s + f.paid, 0);
  const pendingMonth = flatStates.reduce((s, f) => s + f.due, 0);

  const totalPayments = totalPaymentsR.s, totalExpenses = totalExpensesR.s, realExpenses = realExpensesR.s;
  const fundIn = fundInR.s, fundOut = fundOutR.s, advTotal = advTotalR.s;

  const buckets = { cash: 0, bank: 0, other: 0 };
  for (const r of cashMethodRows) buckets[methodBucket(r.method)] += r.s;
  for (const r of fundInMethodRows) buckets[methodBucket(r.method)] += r.s;
  for (const r of expenseMethodRows) buckets[methodBucket(r.method)] -= r.s;
  for (const r of fundOutMethodRows) buckets[methodBucket(r.method)] -= r.s;

  const monthIncome = monthIncomeR.s, monthExpense = monthExpenseR.s;
  const settledViaBankMonth = settledViaBankMonthR.s, settledViaCreditMonth = settledViaCreditMonthR.s;

  const expensesByCategory = Object.fromEntries(categoryTotals);
  const societyPaidExpenses = societyPaidExpensesR.s;

  const creditPending = creditPendingR.s, creditRejected = creditRejectedR.s;
  const creditApproved = creditApprovedR.s, creditAvailable = creditAvailableR.s;

  const recentPayments = recentPaymentsRaw.map((r) => ({ ...r, amount: toRupees(r.amount) }));
  const recentExpenses = recentExpensesRaw.map((r) => ({ ...r, amount: toRupees(r.amount) }));

  return {
    building: b,
    month, year,
    totals: {
      flats: flats.length,
      expected: toRupees(expected),
      collectedMonth, pendingMonth,
      availableBalance: toRupees(totalPayments + fundIn - realExpenses - fundOut),
      cash: toRupees(buckets.cash),
      bank: toRupees(buckets.bank), otherBalance: toRupees(buckets.other),
      advance: toRupees(advTotal),
      emergencyFund: toRupees(fundIn - fundOut),
      totalIncome: toRupees(totalPayments + fundIn),
      totalExpenses: toRupees(totalExpenses + fundOut),
      monthIncome: toRupees(monthIncome), monthExpense: toRupees(monthExpense),
      monthlyProfitLoss: toRupees(monthIncome) - toRupees(monthExpense),
      settledViaBank: toRupees(settledViaBankMonth),
      settledViaCredit: toRupees(settledViaCreditMonth),
      expensesByCategory: { ...expensesByCategory, societyPaid: toRupees(societyPaidExpenses) },
      residentCredit: {
        pending: toRupees(creditPending), rejected: toRupees(creditRejected),
        approved: toRupees(creditApproved), available: toRupees(creditAvailable),
        used: toRupees(creditApproved - creditAvailable),
      },
      outstandingDues: pendingMonth,
    },
    flatStates, series, recentPayments, recentExpenses,
  };
}

// ---------- flat-wise chronological ledger ----------
export async function flatLedger(flatId, x = db) {
  const flat = await x.prepare('SELECT * FROM flats WHERE id=?').get(flatId);
  if (!flat) throw err('Flat not found', 404);
  const rows = [];

  // monthly charges from flat creation month to current month
  const start = new Date(flat.created_at);
  const now = new Date();
  let m = start.getMonth() + 1, y = start.getFullYear();
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    rows.push({
      date: `${y}-${String(m).padStart(2, '0')}-01`, month: m, year: y, type: 'charge',
      description: `Monthly maintenance ${m}/${y}`, charge: flat.monthly_amount, credit: 0, method: null,
    });
    m++; if (m === 13) { m = 1; y++; }
  }

  for (const p of await x.prepare('SELECT * FROM payments WHERE flat_id=? AND deleted=0').all(flatId)) {
    rows.push({
      date: p.paid_on, month: p.month, year: p.year, type: 'payment',
      description: p.advance_amount > 0
        ? `Received ₹${toRupees(p.amount)} — ₹${toRupees(p.applied_amount)} for ${p.month}/${p.year}, ₹${toRupees(p.advance_amount)} to advance`
        : `Received ₹${toRupees(p.amount)} for ${p.month}/${p.year}`,
      charge: 0, credit: p.applied_amount, advance_added: p.advance_amount, method: p.method,
    });
  }
  for (const a of await x.prepare(
    `SELECT at.*, rc.category rc_category, rc.custom_title rc_custom_title
     FROM advance_tx at LEFT JOIN resident_credits rc ON rc.id = at.resident_credit_id
     WHERE at.flat_id=? AND at.type='debit' AND at.deleted=0`
  ).all(flatId)) {
    rows.push({
      date: a.created_at.slice(0, 10), month: a.month, year: a.year, type: 'advance_used', source: a.source,
      category: a.rc_category, customTitle: a.rc_custom_title,
      description: a.source === 'credit'
        ? `Resident credit (${a.rc_category === 'custom' ? a.rc_custom_title : a.rc_category}) applied to ${a.month}/${a.year}`
        : `Advance applied to ${a.month}/${a.year}`,
      charge: 0, credit: a.amount, method: a.source === 'credit' ? 'credit' : 'advance',
    });
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let running = 0; // positive = due owed by flat, cumulative across full history (feeds summary.currentDue only)
  let advancePool = 0; // the actual advance balance as it's built up and spent, in chronological order
  const ledger = await Promise.all(rows.map(async (r) => {
    running += (r.charge || 0) - (r.credit || 0);
    if (r.type === 'payment') advancePool += (r.advance_added || 0);
    else if (r.type === 'advance_used') advancePool -= (r.credit || 0);
    // once the advance pool is used up, show what's actually due for that row's month instead
    const dueIfAny = advancePool <= 0 && r.type !== 'charge' ? (await monthState(flatId, r.month, r.year, x)).due : 0;
    return {
      ...r, charge: toRupees(r.charge || 0), credit: toRupees(r.credit || 0),
      advance_added: toRupees(r.advance_added || 0),
      advanceRemaining: toRupees(Math.max(advancePool, 0)),
      dueForMonth: toRupees(Math.max(dueIfAny, 0)),
    };
  }));

  const totalCharged = rows.reduce((s, r) => s + (r.charge || 0), 0);
  const totalPaid = (await x.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE flat_id=? AND deleted=0').get(flatId)).s;
  return {
    flat: { ...flat, monthly_amount: toRupees(flat.monthly_amount) },
    ledger,
    summary: {
      currentDue: toRupees(Math.max(running, 0)),
      currentAdvance: toRupees(await advanceBalance(flatId, 'bank', x)),
      currentBankAdvance: toRupees(await advanceBalance(flatId, 'bank', x)),
      currentCreditAvailable: toRupees(await advanceBalance(flatId, 'credit', x)),
      totalPaid: toRupees(totalPaid),
      totalCharged: toRupees(totalCharged),
    },
    advanceHistory: (await x.prepare(
      `SELECT at.*, rc.category rc_category, rc.custom_title rc_custom_title
       FROM advance_tx at LEFT JOIN resident_credits rc ON rc.id = at.resident_credit_id
       WHERE at.flat_id=? AND at.deleted=0 ORDER BY at.created_at`
    ).all(flatId)).map((a) => ({
      ...a, amount: toRupees(a.amount), category: a.rc_category, customTitle: a.rc_custom_title,
    })),
  };
}
