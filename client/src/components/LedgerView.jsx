import React, { useMemo, useState } from 'react';
import { inr, MONTHS } from '../api.js';

const typeLabel = { charge: 'Maintenance charge', payment: 'Payment received', advance_used: 'Advance applied' };

// Presentational core of the flat ledger — shared by the building admin's
// Ledger.jsx (fetches /flats/:id/ledger) and the resident's MyLedger.jsx
// (fetches /me/ledger). Takes the already-fetched ledger payload as `data`.
export default function LedgerView({ data }) {
  const [fYear, setFYear] = useState('all');
  const [fType, setFType] = useState('all');

  const rows = useMemo(() => {
    if (!data) return [];
    return data.ledger.filter((r) =>
      r.type !== 'charge' && (fYear === 'all' || r.year === Number(fYear)) && (fType === 'all' || r.type === fType));
  }, [data, fYear, fType]);

  if (!data) return null;
  const years = [...new Set(data.ledger.map((r) => r.year))];
  const s = data.summary;
  const charges = data.ledger.filter((r) => r.type === 'charge').slice().reverse();

  return (
    <>
      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className={'glass stat ' + (s.currentDue > 0 ? 'accent-bad' : '')}><div className="label">Current due</div><div className="value num">{inr(s.currentDue)}</div></div>
        <div className="glass stat accent-adv"><div className="label">Current advance</div><div className="value num">{inr(s.currentAdvance)}</div></div>
        <div className="glass stat accent-ok"><div className="label">Total paid</div><div className="value num">{inr(s.totalPaid)}</div></div>
      </div>

      <div className="glass" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <strong>Monthly maintenance charges</strong>
          <span className="mut num">{charges.length} months · total {inr(charges.reduce((sum, r) => sum + r.charge, 0))}</span>
        </div>
        <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {charges.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13.5 }}>
              <span>{MONTHS[r.month - 1]} {r.year}</span>
              <strong className="num" style={{ color: 'var(--warn)' }}>{inr(r.charge)}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="searchbar">
        <select value={fYear} onChange={(e) => setFYear(e.target.value)}>
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="all">All transaction types</option>
          <option value="payment">Payments</option>
          <option value="advance_used">Advance applied</option>
        </select>
      </div>

      <div className="glass tablewrap" style={{ padding: 0 }}>
        <table className="data responsive">
          <thead><tr><th>Date</th><th>Month</th><th>Type</th><th>Description</th><th className="t-right">Credit</th><th>Method</th><th className="t-right">Advance / Due</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.date}</td>
                <td>{MONTHS[r.month - 1]?.slice(0, 3)} {r.year}</td>
                <td>{typeLabel[r.type]}</td>
                <td className="mut">{r.description}</td>
                <td className="t-right num" style={{ color: r.credit > 0 ? 'var(--ok)' : 'var(--muted)' }}>{r.credit > 0 ? inr(r.credit) : '—'}</td>
                <td className="mut">{r.method || '—'}</td>
                <td className="t-right num" style={{ fontWeight: 600, color: r.dueForMonth > 0 ? 'var(--bad)' : r.advanceRemaining > 0 ? 'var(--adv)' : 'var(--muted)' }}>
                  {r.dueForMonth > 0 ? inr(r.dueForMonth) + ' due' : r.advanceRemaining > 0 ? inr(r.advanceRemaining) + ' advance' : inr(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="list" style={{ marginTop: 12 }}>
        {rows.map((r, i) => (
          <div key={i} className="glass rowcard">
            <div className="rc-top">
              <span className="rc-title">{typeLabel[r.type]}</span>
              <strong className="num" style={{ color: r.credit > 0 ? 'var(--ok)' : 'var(--warn)' }}>
                {r.credit > 0 ? '+' + inr(r.credit) : '−' + inr(r.charge)}
              </strong>
            </div>
            <div className="rc-meta num">
              <span>{r.date}</span><span>{MONTHS[r.month - 1]?.slice(0, 3)} {r.year}</span>
              <span>{r.dueForMonth > 0 ? inr(r.dueForMonth) + ' due' : inr(r.advanceRemaining) + ' advance'}</span>
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
                <span>{a.created_at.slice(0, 10)} · {a.type === 'credit' ? 'Advance added' : `Applied to ${a.month}/${a.year}`}<div className="mut">{a.notes}</div></span>
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
