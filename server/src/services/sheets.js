// Google Sheets sync — service-account auth via signed JWT, no SDK dependency.
// Credentials come ONLY from environment variables (.env). Never exposed to the frontend.
import crypto from 'crypto';
import db, { toRupees } from '../db.js';
import { buildingSummary, flatLedger, monthState } from './finance.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error('Google credentials missing. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in server/.env');
  }
  key = key.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google auth failed: ${data.error_description || data.error}`);
  return data.access_token;
}

const statusLabel = { paid: 'Paid', partial: 'Partially Paid', due: 'Due' };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthlyKeys(buildingId) {
  return db.prepare(
    `SELECT DISTINCT year, month FROM payments WHERE building_id=? AND deleted=0 ORDER BY year, month`
  ).all(buildingId);
}

const DASHBOARD_TAB = 'Flat Dashboard';
const EXPENSES_TAB = 'Expenses';
const FUNDS_TAB = 'Emergency Funds';

function buildSummaryRows(buildingId, s) {
  const rows = [];
  const push = (...r) => rows.push(r.map((c) => (c === undefined || c === null ? '' : c)));

  push('BUILDING MAINTENANCE — SYNCED RECORD');
  push('Last synced', new Date().toLocaleString('en-IN'));
  push();
  push('BUILDING INFORMATION');
  push('Name', s.building.name); push('Address', s.building.address);
  push('Manager', s.building.manager_name); push('Contact', s.building.contact);
  push();
  push('FINANCIAL SUMMARY', `${s.month}/${s.year}`);
  push('Total flats', s.totals.flats);
  push('Expected monthly maintenance', s.totals.expected);
  push('Collected (this month)', s.totals.collectedMonth);
  push('Pending (this month)', s.totals.pendingMonth);
  push('Available building balance', s.totals.availableBalance);
  push('Cash balance', s.totals.cash); push('Bank balance (UPI + online + bank transfer)', s.totals.bank);
  push('Advance balance', s.totals.advance);
  push('Emergency fund balance', s.totals.emergencyFund);
  push('Total income', s.totals.totalIncome); push('Total expenses', s.totals.totalExpenses);
  push();
  push('MAINTENANCE PAYMENTS');
  const pays = db.prepare(
    `SELECT p.*, f.number FROM payments p JOIN flats f ON f.id=p.flat_id
     WHERE p.building_id=? AND p.deleted=0 ORDER BY p.year, p.month, p.paid_on`).all(buildingId);
  const byMonth = new Map();
  for (const p of pays) {
    const key = `${p.year}-${p.month}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(p);
  }
  for (const [key, group] of byMonth) {
    const [year, month] = key.split('-').map(Number);
    push(`${MONTH_NAMES[month - 1]} ${year}`);
    push('Date', 'Flat', 'Amount', 'Applied', 'To advance', 'Method', 'Notes');
    let totalAmount = 0, totalApplied = 0, totalAdvance = 0;
    for (const p of group) {
      push(p.paid_on, p.number, toRupees(p.amount), toRupees(p.applied_amount), toRupees(p.advance_amount), p.method, p.notes);
      totalAmount += p.amount; totalApplied += p.applied_amount; totalAdvance += p.advance_amount;
    }
    push('Total', '', toRupees(totalAmount), toRupees(totalApplied), toRupees(totalAdvance), '', '');
    push();
  }
  return rows;
}

function buildExpenseRows(buildingId) {
  const rows = [];
  const push = (...r) => rows.push(r.map((c) => (c === undefined || c === null ? '' : c)));

  push('EXPENSES');
  push('Last synced', new Date().toLocaleString('en-IN'));
  push();
  push('Date', 'Category', 'Name', 'Amount', 'Method', 'Paid to', 'Description');
  const exps = db.prepare('SELECT * FROM expenses WHERE building_id=? AND deleted=0 ORDER BY date').all(buildingId);
  for (const e of exps) push(e.date, e.category, e.custom_name, toRupees(e.amount), e.method, e.paid_to, e.description);
  return rows;
}

function buildFundRows(buildingId) {
  const rows = [];
  const push = (...r) => rows.push(r.map((c) => (c === undefined || c === null ? '' : c)));

  push('EMERGENCY FUNDS');
  push('Last synced', new Date().toLocaleString('en-IN'));
  push();
  push('Fund', 'Reason', 'Target', 'Collected', 'Spent', 'Balance');
  const funds = db.prepare('SELECT * FROM emergency_funds WHERE building_id=? AND archived=0').all(buildingId);
  for (const f of funds) {
    const inS = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM fund_tx WHERE fund_id=? AND type='contribution' AND deleted=0").get(f.id).s;
    const outS = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM fund_tx WHERE fund_id=? AND type='expense' AND deleted=0").get(f.id).s;
    push(f.name, f.reason, toRupees(f.target_amount), toRupees(inS), toRupees(outS), toRupees(inS - outS));
  }
  return rows;
}

function buildDashboardRows(buildingId, keys) {
  const rows = [];
  const push = (...r) => rows.push(r.map((c) => (c === undefined || c === null ? '' : c)));

  push('FLAT DASHBOARD');
  push('Last synced', new Date().toLocaleString('en-IN'));
  push();
  for (const { year, month } of keys) {
    const ms = buildingSummary(buildingId, month, year);
    push(`${MONTH_NAMES[month - 1]} ${year}`);
    push('Flat', 'Owner/Resident', 'Monthly', 'Paid', 'Due', 'Advance', 'Status');
    let totalMonthly = 0, totalPaid = 0, totalDue = 0;
    for (const f of ms.flatStates) {
      push(f.number, f.owner_name || f.resident_name || '', f.monthly_amount, f.paid, f.due, f.advance, statusLabel[f.status] || f.status);
      totalMonthly += f.monthly_amount; totalPaid += f.paid; totalDue += f.due;
    }
    push('Total', '', totalMonthly, totalPaid, totalDue, '', '');
    push();
  }
  return rows;
}

// Google Sheets tab titles: max 100 chars, no []*/\?: — flat numbers are short and plain so a straight prefix is safe.
function flatTabName(number) {
  return `Flat ${number}`;
}

function buildFlatLedgerTabs(buildingId) {
  const flats = db.prepare('SELECT * FROM flats WHERE building_id=? AND archived=0 ORDER BY number').all(buildingId);
  return flats.map((f) => {
    const led = flatLedger(f.id);
    const rows = [];
    const push = (...r) => rows.push(r.map((c) => (c === undefined || c === null ? '' : c)));
    push(`FLAT ${f.number} — LEDGER`);
    push('Last synced', new Date().toLocaleString('en-IN'));
    push();
    push('Date', 'Type', 'Description', 'Month', 'Paid', 'Status');
    for (const r of led.ledger) {
      const st = monthState(f.id, r.month, r.year);
      push(r.date, r.type, r.description, `${MONTH_NAMES[r.month - 1]} ${r.year}`, r.credit, statusLabel[st.status] || st.status);
    }
    return { name: flatTabName(f.number), rows };
  });
}

async function getSheetList(base, headers) {
  const res = await fetch(`${base}?fields=sheets.properties`, { headers });
  if (!res.ok) throw new Error(`Read spreadsheet failed: ${(await res.json()).error?.message}`);
  const data = await res.json();
  return (data.sheets || []).map((sh) => sh.properties);
}

async function ensureTabs(base, headers, wantedTabs) {
  const existing = await getSheetList(base, headers);
  const existingNames = new Set(existing.map((p) => p.title));
  const missing = wantedTabs.filter((t) => !existingNames.has(t));
  if (missing.length) {
    const res2 = await fetch(`${base}:batchUpdate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
    });
    if (!res2.ok) throw new Error(`Create tab failed: ${(await res2.json()).error?.message}`);
  }
  return existing;
}

// Remove tabs this sync used to auto-create but no longer does (e.g. a legacy combined tab replaced by per-flat tabs).
// Only touches tabs from `staleNames` that aren't in the current wanted set — never touches sheets the sync doesn't own.
async function pruneStaleTabs(base, headers, existingBefore, wantedTabs, staleNames) {
  const toDelete = existingBefore.filter((p) => staleNames.includes(p.title) && !wantedTabs.includes(p.title));
  if (!toDelete.length) return;
  const res = await fetch(`${base}:batchUpdate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requests: toDelete.map((p) => ({ deleteSheet: { sheetId: p.sheetId } })) }),
  });
  if (!res.ok) throw new Error(`Delete stale tab failed: ${(await res.json()).error?.message}`);
}

async function writeTab(base, headers, tab, rows) {
  let res = await fetch(`${base}/values/${encodeURIComponent(tab)}:clear`, { method: 'POST', headers });
  if (!res.ok) throw new Error(`Clear failed (${tab}): ${(await res.json()).error?.message}`);
  res = await fetch(
    `${base}/values/${encodeURIComponent(tab + '!A1')}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', headers, body: JSON.stringify({ values: rows }) }
  );
  if (!res.ok) throw new Error(`Write failed (${tab}): ${(await res.json()).error?.message}`);
}

export async function syncBuilding(buildingId) {
  const conn = db.prepare('SELECT * FROM sheet_connections WHERE building_id=?').get(buildingId);
  if (!conn) throw Object.assign(new Error('No Google Sheet connected for this building'), { status: 400 });
  try {
    const now = new Date();
    const s = buildingSummary(buildingId, now.getMonth() + 1, now.getFullYear());
    const token = await getAccessToken();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${conn.sheet_id}`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const keys = monthlyKeys(buildingId);
    const tabs = [
      { name: conn.sheet_tab, rows: buildSummaryRows(buildingId, s) },
      { name: DASHBOARD_TAB, rows: buildDashboardRows(buildingId, keys) },
      { name: EXPENSES_TAB, rows: buildExpenseRows(buildingId) },
      { name: FUNDS_TAB, rows: buildFundRows(buildingId) },
      ...buildFlatLedgerTabs(buildingId),
    ];

    const wantedNames = tabs.map((t) => t.name);
    const existingBefore = await ensureTabs(base, headers, wantedNames);
    await pruneStaleTabs(base, headers, existingBefore, wantedNames, ['Flat Ledgers']);
    let totalRows = 0;
    for (const t of tabs) {
      await writeTab(base, headers, t.name, t.rows);
      totalRows += t.rows.length;
    }

    const ts = new Date().toISOString();
    db.prepare("UPDATE sheet_connections SET status='connected', last_sync=? WHERE building_id=?").run(ts, buildingId);
    db.prepare("INSERT INTO sync_logs (building_id, status, message) VALUES (?, 'success', ?)")
      .run(buildingId, `Synced ${totalRows} rows across ${tabs.length} tabs`);
    return { ok: true, rows: totalRows, tabs: tabs.map((t) => t.name), last_sync: ts };
  } catch (e) {
    db.prepare("UPDATE sheet_connections SET status='error' WHERE building_id=?").run(buildingId);
    db.prepare("INSERT INTO sync_logs (building_id, status, message) VALUES (?, 'error', ?)")
      .run(buildingId, e.message);
    throw Object.assign(e, { status: e.status || 502 });
  }
}

// Fire-and-forget auto sync after data changes (never blocks the API response).
export function autoSync(buildingId) {
  if (process.env.SHEETS_AUTOSYNC !== 'true') return;
  const conn = db.prepare('SELECT id FROM sheet_connections WHERE building_id=?').get(buildingId);
  if (!conn) return;
  syncBuilding(buildingId).catch(() => {});
}
