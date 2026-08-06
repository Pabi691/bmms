import db, { toRupees, audit } from '../db.js';

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Maps payment methods onto the displayed balance buckets. UPI, online payment and
// bank transfer all settle into the same real bank account, so they share one bucket.
export const methodBucket = (m) =>
  m === 'cash' ? 'cash' : (m === 'bank' || m === 'upi' || m === 'online') ? 'bank' : 'other';

// ---------- month-level maintenance status for a flat ----------
export function monthState(flatId, month, year) {
  const flat = db.prepare('SELECT * FROM flats WHERE id=?').get(flatId);
  if (!flat) throw err('Flat not found', 404);
  const paid = db
    .prepare(
      'SELECT COALESCE(SUM(applied_amount),0) s FROM payments WHERE flat_id=? AND month=? AND year=? AND deleted=0'
    )
    .get(flatId, month, year).s;
  const advUsed = db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) s FROM advance_tx WHERE flat_id=? AND type='debit' AND month=? AND year=? AND deleted=0"
    )
    .get(flatId, month, year).s;
  const required = flat.monthly_amount;
  const settled = paid + advUsed;
  const due = Math.max(required - settled, 0);
  const advBalance = advanceBalance(flatId);
  let status = 'due';
  if (required === 0 || settled >= required) status = 'paid';
  else if (settled > 0) status = 'partial';
  if (status !== 'paid' && advBalance > 0) status = status === 'due' && settled === 0 ? 'due' : status;
  return { flat, required, paid, advUsed, settled, due, advBalance, status };
}

export function advanceBalance(flatId) {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) b
       FROM advance_tx WHERE flat_id=? AND deleted=0`
    )
    .get(flatId);
  return r.b;
}

// Roll a flat's current advance balance forward into the due of each following month,
// in order, until the balance runs out (a partial amount just lands on whichever month it stops at).
// maxMonthsAhead is a safety cap, not a real limit — a single payment rarely covers more than a few months.
function cascadeAdvance(buildingId, flatId, fromMonth, fromYear, paymentId, maxMonthsAhead = 36) {
  let m = fromMonth, y = fromYear, iterations = 0;
  let remaining = advanceBalance(flatId);
  const applied = [];
  while (remaining > 0 && iterations < maxMonthsAhead) {
    m++; if (m === 13) { m = 1; y++; }
    iterations++;
    const st = monthState(flatId, m, y);
    if (st.due <= 0) continue;
    const use = Math.min(remaining, st.due);
    db.prepare(
      `INSERT INTO advance_tx (building_id, flat_id, type, amount, month, year, payment_id, notes)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(buildingId, flatId, 'debit', use, m, y, paymentId, `Auto-applied advance to ${m}/${y}`);
    remaining -= use;
    applied.push({ month: m, year: y, amount: toRupees(use), remainingDue: toRupees(st.due - use) });
  }
  return applied;
}

// ---------- record a payment (full / partial / extra) ----------
export const recordPayment = db.transaction((p) => {
  const { flat_id, month, year, amount, method, paid_on, notes, actor_user_id = null } = p;
  const st = monthState(flat_id, month, year);
  const applied = Math.min(amount, st.due);
  const advance = amount - applied;
  const info = db
    .prepare(
      `INSERT INTO payments (building_id, flat_id, month, year, amount, applied_amount, advance_amount, method, paid_on, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(st.flat.building_id, flat_id, month, year, amount, applied, advance, method, paid_on, notes || null);
  let cascade = [];
  if (advance > 0) {
    db.prepare(
      `INSERT INTO advance_tx (building_id, flat_id, type, amount, month, year, payment_id, notes)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(st.flat.building_id, flat_id, 'credit', advance, month, year, info.lastInsertRowid,
      'Extra payment stored as advance');
    cascade = cascadeAdvance(st.flat.building_id, flat_id, month, year, info.lastInsertRowid);
  }
  audit(st.flat.building_id, 'create', 'payment', info.lastInsertRowid,
    `Flat ${st.flat.number} ${month}/${year}: ₹${toRupees(amount)} (applied ₹${toRupees(applied)}, advance ₹${toRupees(advance)})`,
    actor_user_id);
  return { id: info.lastInsertRowid, cascade };
});

// ---------- soft-delete a payment (removes its advance credit too) ----------
export const deletePayment = db.transaction((id, actorUserId = null) => {
  const pay = db.prepare('SELECT * FROM payments WHERE id=? AND deleted=0').get(id);
  if (!pay) throw err('Payment not found', 404);
  db.prepare('UPDATE payments SET deleted=1 WHERE id=?').run(id);
  db.prepare('UPDATE advance_tx SET deleted=1 WHERE payment_id=?').run(id);
  audit(pay.building_id, 'delete', 'payment', id, `Soft-deleted payment of ₹${toRupees(pay.amount)}`, actorUserId);
});

// ---------- edit a payment: soft-delete + re-record keeps history traceable ----------
export const editPayment = db.transaction((id, next, actorUserId = null) => {
  const pay = db.prepare('SELECT * FROM payments WHERE id=? AND deleted=0').get(id);
  if (!pay) throw err('Payment not found', 404);
  deletePayment(id, actorUserId);
  return recordPayment({
    flat_id: pay.flat_id,
    month: next.month ?? pay.month,
    year: next.year ?? pay.year,
    amount: next.amount ?? pay.amount,
    method: next.method ?? pay.method,
    paid_on: next.paid_on ?? pay.paid_on,
    notes: next.notes ?? pay.notes,
    actor_user_id: actorUserId,
  });
});

// ---------- apply advance balance to a month (manual, month-wise) ----------
export const applyAdvance = db.transaction(({ flat_id, month, year, amount, actor_user_id = null }) => {
  const st = monthState(flat_id, month, year);
  const available = advanceBalance(flat_id);
  if (available <= 0) throw err('No advance balance available');
  if (st.due <= 0) throw err('Selected month has no due to adjust');
  const use = Math.min(amount || available, available, st.due);
  db.prepare(
    `INSERT INTO advance_tx (building_id, flat_id, type, amount, month, year, notes)
     VALUES (?,?,?,?,?,?,?)`
  ).run(st.flat.building_id, flat_id, 'debit', use, month, year, `Advance applied to ${month}/${year}`);
  audit(st.flat.building_id, 'adjust', 'advance', flat_id,
    `Applied ₹${toRupees(use)} advance to ${month}/${year} for flat ${st.flat.number}`, actor_user_id);
  return use;
});

// ---------- building financial summary ----------
export function buildingSummary(buildingId, month, year) {
  const b = db.prepare('SELECT * FROM buildings WHERE id=?').get(buildingId);
  if (!b) throw err('Building not found', 404);

  const flats = db.prepare('SELECT * FROM flats WHERE building_id=? AND archived=0').get
    ? db.prepare('SELECT * FROM flats WHERE building_id=? AND archived=0').all(buildingId)
    : [];

  const expected = flats.reduce((s, f) => s + f.monthly_amount, 0);

  const flatStates = flats.map((f) => {
    const st = monthState(f.id, month, year);
    return {
      id: f.id, number: f.number, owner_name: f.owner_name, resident_name: f.resident_name,
      monthly_amount: toRupees(f.monthly_amount), paid: toRupees(st.paid + st.advUsed),
      due: toRupees(st.due), advance: toRupees(st.advBalance), status: st.status,
    };
  });

  const collectedMonth = flatStates.reduce((s, f) => s + f.paid, 0);
  const pendingMonth = flatStates.reduce((s, f) => s + f.due, 0);

  const q = (sql, ...a) => db.prepare(sql).get(...a);

  const totalPayments = q('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE building_id=? AND deleted=0', buildingId).s;
  const totalExpenses = q('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE building_id=? AND deleted=0', buildingId).s;
  const fundIn  = q("SELECT COALESCE(SUM(amount),0) s FROM fund_tx WHERE building_id=? AND type='contribution' AND deleted=0", buildingId).s;
  const fundOut = q("SELECT COALESCE(SUM(amount),0) s FROM fund_tx WHERE building_id=? AND type='expense' AND deleted=0", buildingId).s;
  const advTotal = q(
    "SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) s FROM advance_tx WHERE building_id=? AND deleted=0",
    buildingId).s;

  // balances by method bucket (income = maintenance payments + fund contributions; out = expenses + fund expenses)
  const buckets = { cash: 0, bank: 0, other: 0 };
  for (const r of db.prepare('SELECT method, SUM(amount) s FROM payments WHERE building_id=? AND deleted=0 GROUP BY method').all(buildingId))
    buckets[methodBucket(r.method)] += r.s;
  for (const r of db.prepare("SELECT method, SUM(amount) s FROM fund_tx WHERE building_id=? AND type='contribution' AND deleted=0 GROUP BY method").all(buildingId))
    buckets[methodBucket(r.method)] += r.s;
  for (const r of db.prepare('SELECT method, SUM(amount) s FROM expenses WHERE building_id=? AND deleted=0 GROUP BY method').all(buildingId))
    buckets[methodBucket(r.method)] -= r.s;
  for (const r of db.prepare("SELECT method, SUM(amount) s FROM fund_tx WHERE building_id=? AND type='expense' AND deleted=0 GROUP BY method").all(buildingId))
    buckets[methodBucket(r.method)] -= r.s;

  const mm = String(month).padStart(2, '0');
  const monthIncome = q(
    'SELECT COALESCE(SUM(amount),0) s FROM payments WHERE building_id=? AND month=? AND year=? AND deleted=0',
    buildingId, month, year).s;
  const monthExpense = q(
    "SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE building_id=? AND deleted=0 AND strftime('%m', date)=? AND strftime('%Y', date)=?",
    buildingId, mm, String(year)).s;

  // last 6 months income vs expense for the chart
  const series = [];
  let cm = month, cy = year;
  for (let i = 0; i < 6; i++) {
    const inc = q('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE building_id=? AND month=? AND year=? AND deleted=0', buildingId, cm, cy).s;
    const exp = q("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE building_id=? AND deleted=0 AND strftime('%m', date)=? AND strftime('%Y', date)=?",
      buildingId, String(cm).padStart(2, '0'), String(cy)).s;
    series.unshift({ label: `${String(cm).padStart(2, '0')}/${String(cy).slice(2)}`, income: toRupees(inc), expense: toRupees(exp) });
    cm--; if (cm === 0) { cm = 12; cy--; }
  }

  const recentPayments = db.prepare(
    `SELECT p.*, f.number flat_number FROM payments p JOIN flats f ON f.id=p.flat_id
     WHERE p.building_id=? AND p.deleted=0 ORDER BY p.created_at DESC LIMIT 6`).all(buildingId)
    .map((r) => ({ ...r, amount: toRupees(r.amount) }));
  const recentExpenses = db.prepare(
    'SELECT * FROM expenses WHERE building_id=? AND deleted=0 ORDER BY date DESC, id DESC LIMIT 6').all(buildingId)
    .map((r) => ({ ...r, amount: toRupees(r.amount) }));

  return {
    building: b,
    month, year,
    totals: {
      flats: flats.length,
      expected: toRupees(expected),
      collectedMonth, pendingMonth,
      availableBalance: toRupees(totalPayments + fundIn - totalExpenses - fundOut),
      cash: toRupees(buckets.cash),
      bank: toRupees(buckets.bank), otherBalance: toRupees(buckets.other),
      advance: toRupees(advTotal),
      emergencyFund: toRupees(fundIn - fundOut),
      totalIncome: toRupees(totalPayments + fundIn),
      totalExpenses: toRupees(totalExpenses + fundOut),
      monthIncome: toRupees(monthIncome), monthExpense: toRupees(monthExpense),
    },
    flatStates, series, recentPayments, recentExpenses,
  };
}

// ---------- flat-wise chronological ledger ----------
export function flatLedger(flatId) {
  const flat = db.prepare('SELECT * FROM flats WHERE id=?').get(flatId);
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

  for (const p of db.prepare('SELECT * FROM payments WHERE flat_id=? AND deleted=0').all(flatId)) {
    rows.push({
      date: p.paid_on, month: p.month, year: p.year, type: 'payment',
      description: p.advance_amount > 0
        ? `Received ₹${toRupees(p.amount)} — ₹${toRupees(p.applied_amount)} for ${p.month}/${p.year}, ₹${toRupees(p.advance_amount)} to advance`
        : `Received ₹${toRupees(p.amount)} for ${p.month}/${p.year}`,
      charge: 0, credit: p.applied_amount, advance_added: p.advance_amount, method: p.method,
    });
  }
  for (const a of db.prepare("SELECT * FROM advance_tx WHERE flat_id=? AND type='debit' AND deleted=0").all(flatId)) {
    rows.push({
      date: a.created_at.slice(0, 10), month: a.month, year: a.year, type: 'advance_used',
      description: `Advance applied to ${a.month}/${a.year}`, charge: 0, credit: a.amount, method: 'advance',
    });
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let running = 0; // positive = due owed by flat, cumulative across full history (feeds summary.currentDue only)
  let advancePool = 0; // the actual advance balance as it's built up and spent, in chronological order
  const ledger = rows.map((r) => {
    running += (r.charge || 0) - (r.credit || 0);
    if (r.type === 'payment') advancePool += (r.advance_added || 0);
    else if (r.type === 'advance_used') advancePool -= (r.credit || 0);
    // once the advance pool is used up, show what's actually due for that row's month instead
    const dueIfAny = advancePool <= 0 && r.type !== 'charge' ? monthState(flatId, r.month, r.year).due : 0;
    return {
      ...r, charge: toRupees(r.charge || 0), credit: toRupees(r.credit || 0),
      advance_added: toRupees(r.advance_added || 0),
      advanceRemaining: toRupees(Math.max(advancePool, 0)),
      dueForMonth: toRupees(Math.max(dueIfAny, 0)),
    };
  });

  const totalCharged = rows.reduce((s, r) => s + (r.charge || 0), 0);
  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE flat_id=? AND deleted=0').get(flatId).s;
  return {
    flat: { ...flat, monthly_amount: toRupees(flat.monthly_amount) },
    ledger,
    summary: {
      currentDue: toRupees(Math.max(running, 0)),
      currentAdvance: toRupees(advanceBalance(flatId)),
      totalPaid: toRupees(totalPaid),
      totalCharged: toRupees(totalCharged),
    },
    advanceHistory: db.prepare('SELECT * FROM advance_tx WHERE flat_id=? AND deleted=0 ORDER BY created_at').all(flatId)
      .map((a) => ({ ...a, amount: toRupees(a.amount) })),
  };
}
