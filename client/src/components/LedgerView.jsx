import React, { useMemo, useState } from 'react';
import { inr, MONTHS } from '../api.js';

const CATEGORY_LABELS = { electricity: 'Electricity', internet: 'Internet', water: 'Water', sweeper: 'Sweeper', security: 'Security', cleaning: 'Cleaning', generator: 'Generator', custom: 'Custom' };
const STATUS_CHIP = { paid: 'paid', partial: 'partial', due: 'due' };

const fmtDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y.slice(2)}`;
};

// Presentational core of the flat ledger — shared by the building admin's
// Ledger.jsx (fetches /flats/:id/ledger) and the resident's MyLedger.jsx
// (fetches /me/ledger). Takes the already-fetched ledger payload as `data`.
export default function LedgerView({ data }) {
  const [fYear, setFYear] = useState('all');

  // Running credit-pool (resident adjustments) and bank-advance-pool
  // balances, walked chronologically through advance_tx history. Each
  // month's row shows the pool balance carried INTO it ("before") and
  // what's left AFTER that month's due is drawn from it ("after") — a
  // running ledger of the pool itself, not just how much of it happened to
  // get used that specific month (e.g. a ₹1200 adjustment against a ₹500
  // due shows 1200 on its own row, 700 carried into the next).
  const poolByMonth = useMemo(() => {
    if (!data) return new Map();
    let creditPool = 0, bankPool = 0;
    const map = new Map();
    const get = (key) => {
      if (!map.has(key)) map.set(key, { genesis: [] });
      return map.get(key);
    };
    for (const a of data.advanceHistory) {
      const key = `${a.year}-${a.month}`;
      const g = get(key);
      if (a.type === 'credit') {
        // A fresh deposit always updates "before" AND "after" immediately —
        // even if this exact month's due gets covered some other way (e.g.
        // a direct payment in the same event) and none of it is drawn down
        // this month, the row still needs to show the credit came in and is
        // fully available, not blank.
        if (a.source === 'credit') {
          creditPool += a.amount;
          g.adjustmentBefore = creditPool;
          g.adjustmentAfter = creditPool;
        } else {
          bankPool += a.amount;
          g.advanceBefore = bankPool;
          g.advanceAfter = bankPool;
        }
        g.genesis.push({ amount: a.amount, source: a.source, category: a.category, customTitle: a.customTitle });
      } else if (a.source === 'credit') {
        if (g.adjustmentBefore === undefined) g.adjustmentBefore = creditPool;
        creditPool -= a.amount;
        g.adjustmentAfter = creditPool;
      } else {
        if (g.advanceBefore === undefined) g.advanceBefore = bankPool;
        bankPool -= a.amount;
        g.advanceAfter = bankPool;
      }
    }
    return map;
  }, [data]);

  // One row per calendar month, merging that month's charge, direct bank
  // payment(s) and pool activity into a single summary line.
  const monthlyRows = useMemo(() => {
    if (!data) return [];
    const groups = new Map();
    const order = [];
    for (const r of data.ledger) {
      const key = `${r.year}-${r.month}`;
      if (!groups.has(key)) {
        groups.set(key, { month: r.month, year: r.year, required: 0, creditAmt: 0, appliedAdjustment: 0, appliedAdvance: 0, date: null });
        order.push(key);
      }
      const g = groups.get(key);
      if (r.type === 'charge') {
        g.required += r.charge;
      } else if (r.type === 'payment') {
        g.creditAmt += r.credit;
        if (!g.date || r.date > g.date) g.date = r.date;
      } else if (r.type === 'advance_used') {
        if (r.source === 'credit') g.appliedAdjustment += r.credit; else g.appliedAdvance += r.credit;
        if (!g.date || r.date > g.date) g.date = r.date;
      }
    }

    const emptyPool = { adjustmentBefore: 0, adjustmentAfter: 0, advanceBefore: 0, advanceAfter: 0, genesis: [] };
    return order
      .map((key) => ({ key, ...groups.get(key), pool: poolByMonth.get(key) || emptyPool }))
      .filter((g) => g.required > 0 || g.creditAmt > 0 || g.appliedAdjustment > 0 || g.appliedAdvance > 0)
      .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))
      .map((g) => {
        // Charge rows only exist for months up to "now" — a month a credit
        // cascade already reached but that hasn't been officially charged
        // yet would otherwise show ₹0 here. Fall back to the flat's own
        // monthly rate so every visible row shows a real amount.
        const required = g.required || data.flat.monthly_amount;
        const settled = g.creditAmt + g.appliedAdjustment + g.appliedAdvance;
        const due = Math.max(required - settled, 0);
        const status = required === 0 || settled >= required ? 'paid' : settled > 0 ? 'partial' : 'due';

        const adjustmentGenesis = g.pool.genesis.filter((x) => x.source === 'credit');
        const advanceGenesis = g.pool.genesis.filter((x) => x.source === 'bank');
        const adjustmentShown = g.pool.adjustmentBefore || 0;
        const advanceShown = (g.pool.adjustmentAfter || 0) + (g.pool.advanceAfter || 0);

        const typeParts = [];
        if (g.creditAmt > 0) typeParts.push('Payment received');
        if (adjustmentGenesis.length || g.appliedAdjustment > 0) typeParts.push('Adjustment');
        if (g.appliedAdvance > 0 && !g.creditAmt) typeParts.push('Advance applied');

        const descParts = [];
        if (g.creditAmt > 0) descParts.push(`${inr(g.creditAmt)} paid`);
        if (adjustmentGenesis.length) {
          descParts.push(adjustmentGenesis.map((x) =>
            `${inr(x.amount)} paid for ${x.category === 'custom' ? (x.customTitle || 'Custom') : (CATEGORY_LABELS[x.category] || x.category)}`
          ).join(', '));
        } else if (g.appliedAdjustment > 0) {
          descParts.push('adjustment');
        }
        if (advanceGenesis.length && !g.creditAmt) {
          descParts.push(`${inr(advanceGenesis.reduce((s, x) => s + x.amount, 0))} added to advance`);
        } else if (g.appliedAdvance > 0) {
          descParts.push('advance applied');
        }

        return {
          key: g.key, date: g.date || `${g.year}-${String(g.month).padStart(2, '0')}-01`,
          month: g.month, year: g.year, required, status,
          type: typeParts.join(' & ') || 'No activity',
          description: descParts.join(' and ') || '—',
          credit: g.creditAmt, adjustment: adjustmentShown, advance: advanceShown, due,
        };
      });
  }, [data, poolByMonth]);

  const rows = useMemo(() => monthlyRows.filter((r) => fYear === 'all' || r.year === Number(fYear)), [monthlyRows, fYear]);

  if (!data) return null;
  const years = [...new Set(monthlyRows.map((r) => r.year))];
  const s = data.summary;
  const hasCredit = s.currentCreditAvailable > 0 || data.ledger.some((r) => r.source === 'credit');

  return (
    <>
      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className={'glass stat ' + (s.currentDue > 0 ? 'accent-bad' : '')}><div className="label">Current due</div><div className="value num">{inr(s.currentDue)}</div></div>
        {hasCredit ? (
          <>
            <div className="glass stat accent-adv"><div className="label">Bank advance</div><div className="value num">{inr(s.currentBankAdvance)}</div></div>
            <div className="glass stat accent-adv"><div className="label">Available credit</div><div className="value num">{inr(s.currentCreditAvailable)}</div></div>
          </>
        ) : (
          <div className="glass stat accent-adv"><div className="label">Current advance</div><div className="value num">{inr(s.currentAdvance)}</div></div>
        )}
        <div className="glass stat accent-ok"><div className="label">Total paid</div><div className="value num">{inr(s.totalPaid)}</div></div>
      </div>

      <div className="searchbar">
        <select value={fYear} onChange={(e) => setFYear(e.target.value)}>
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="glass tablewrap" style={{ padding: 0 }}>
        <table className="data responsive">
          <thead><tr>
            <th>Date</th><th>Type</th><th>Maintenance paid for</th><th className="t-right">Maintenance</th>
            <th>Status</th><th>Description</th><th className="t-right">Credit</th>
            <th className="t-right">Adjustment</th><th className="t-right">Advance</th><th className="t-right">Due</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{fmtDate(r.date)}</td>
                <td>{r.type}</td>
                <td>{MONTHS[r.month - 1]} {String(r.year).slice(2)}</td>
                <td className="t-right num">{inr(r.required)}</td>
                <td><span className={'chip ' + STATUS_CHIP[r.status]}>{r.status}</span></td>
                <td className="mut">{r.description}</td>
                <td className="t-right num" style={{ color: r.credit > 0 ? 'var(--ok)' : 'var(--muted)' }}>{r.credit > 0 ? inr(r.credit) : '—'}</td>
                <td className="t-right num" style={{ color: r.adjustment > 0 ? 'var(--adv)' : 'var(--muted)' }}>{r.adjustment > 0 ? inr(r.adjustment) : '—'}</td>
                <td className="t-right num" style={{ color: r.advance > 0 ? 'var(--adv)' : 'var(--muted)' }}>{r.advance > 0 ? inr(r.advance) : '—'}</td>
                <td className="t-right num" style={{ fontWeight: 600, color: r.due > 0 ? 'var(--bad)' : 'var(--ok)' }}>{inr(r.due)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="list" style={{ marginTop: 12 }}>
        {rows.map((r) => (
          <div key={r.key} className="glass rowcard">
            <div className="rc-top">
              <span className="rc-title">{MONTHS[r.month - 1]} {String(r.year).slice(2)} · {r.type}</span>
              <span className={'chip ' + STATUS_CHIP[r.status]}>{r.status}</span>
            </div>
            <div className="rc-meta num">
              <span>{fmtDate(r.date)}</span>
              <span>Maintenance {inr(r.required)}</span>
            </div>
            <div className="mut" style={{ fontSize: 13, margin: '4px 0' }}>{r.description}</div>
            <div className="rc-meta num">
              {r.credit > 0 && <span style={{ color: 'var(--ok)' }}>Credit {inr(r.credit)}</span>}
              {r.adjustment > 0 && <span style={{ color: 'var(--adv)' }}>Adjustment {inr(r.adjustment)}</span>}
              {r.advance > 0 && <span style={{ color: 'var(--adv)' }}>Advance {inr(r.advance)}</span>}
              <span style={{ color: r.due > 0 ? 'var(--bad)' : 'var(--ok)' }}>Due {inr(r.due)}</span>
            </div>
          </div>
        ))}
      </div>

      {data.advanceHistory.length > 0 && (
        <>
          <h3 className="section-title">Advance history</h3>
          <div className="glass" style={{ padding: '6px 18px' }}>
            {data.advanceHistory.map((a) => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 13.5 }}>
                <span>
                  {a.created_at.slice(0, 10)} · {a.type === 'credit' ? (a.source === 'credit' ? 'Resident credit added' : 'Advance added') : `Applied to ${a.month}/${a.year}`}
                  <div className="mut">{a.notes}</div>
                </span>
                <strong className="num" style={{ color: a.type === 'credit' ? 'var(--adv)' : 'var(--warn)' }}>
                  {a.type === 'credit' ? '+' : '−'}{inr(a.amount)}
                </strong>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
