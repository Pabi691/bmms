import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, inr, MONTHS, METHODS, today } from '../api.js';
import { Layout, Modal, Empty, useToast, Icons } from '../components/ui.jsx';

const now = new Date();
const ADJUSTMENT_LABELS = { none: 'None', electricity: 'Electricity', internet: 'Internet', water: 'Water', sweeper: 'Sweeper', security: 'Security', cleaning: 'Cleaning', generator: 'Generator', custom: 'Custom' };
const blankPay = {
  flat_id: '', month: now.getMonth() + 1, year: now.getFullYear(), amount: '', method: 'cash', paid_on: today(), notes: '',
  adjustment_category: 'none', adjustment_amount: '', adjustment_custom_title: '',
};

export default function Payments() {
  const { buildingId } = useParams();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [credits, setCredits] = useState(null);
  const [flats, setFlats] = useState([]);
  const [form, setForm] = useState(params.get('add') ? { ...blankPay } : null);
  const [adv, setAdv] = useState(null); // advance apply form
  const [state, setState] = useState(null); // live month state preview
  const [filter, setFilter] = useState({ month: '', year: '', from: '', to: '' });
  const toast = useToast();

  const filteredRows = (rows || []).filter((p) => {
    if (filter.month && p.month !== Number(filter.month)) return false;
    if (filter.year && p.year !== Number(filter.year)) return false;
    if (filter.from && p.paid_on < filter.from) return false;
    if (filter.to && p.paid_on > filter.to) return false;
    return true;
  });
  const filtersActive = filter.month || filter.year || filter.from || filter.to;
  const clearFilters = () => setFilter({ month: '', year: '', from: '', to: '' });

  const load = () => {
    api.get(`/buildings/${buildingId}/payments`).then(setRows).catch((e) => toast(e.message));
    api.get(`/buildings/${buildingId}/flats`).then(setFlats).catch(() => {});
    api.get(`/buildings/${buildingId}/resident-credits`).then(setCredits).catch(() => {});
  };
  useEffect(() => { load(); }, [buildingId]);

  // live preview of due/advance for the selected flat+month
  useEffect(() => {
    const f = form || adv;
    if (!f?.flat_id) { setState(null); return; }
    api.get(`/flats/${f.flat_id}/month-state?month=${f.month}&year=${f.year}`).then(setState).catch(() => setState(null));
  }, [form?.flat_id, form?.month, form?.year, adv?.flat_id, adv?.month, adv?.year]);

  const close = () => { setForm(null); setAdv(null); params.delete('add'); setParams(params); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.adjustment_category !== 'none') {
        if (!(Number(form.adjustment_amount) > 0)) throw new Error('Enter an adjustment amount');
        if (form.adjustment_category === 'custom' && !form.adjustment_custom_title.trim()) throw new Error('Custom Expense Name is required');
      }
      if (!(Number(form.amount) > 0) && !(form.adjustment_category !== 'none' && Number(form.adjustment_amount) > 0)) {
        throw new Error('Enter an amount paid to the society or an adjustment amount');
      }
      const body = {
        flat_id: form.flat_id, month: form.month, year: form.year, method: form.method, paid_on: form.paid_on, notes: form.notes,
        amount: form.amount || 0,
        adjustment_category: form.adjustment_category !== 'none' ? form.adjustment_category : undefined,
        adjustment_amount: form.adjustment_category !== 'none' ? form.adjustment_amount : undefined,
        adjustment_custom_title: form.adjustment_category === 'custom' ? form.adjustment_custom_title : undefined,
      };
      const r = form.id ? await api.put(`/payments/${form.id}`, body) : await api.post('/payments', body);
      if (form.id) {
        if (r.cascade?.length) {
          const parts = r.cascade.map((c) =>
            `${MONTHS[c.month - 1].slice(0, 3)} ${c.year}: ${inr(c.amount)}${c.remainingDue > 0 ? ` (due ${inr(c.remainingDue)} left)` : ' (full)'}`);
          toast(`Payment saved — extra amount auto-applied to ${parts.join(' · ')}`);
        } else toast('Payment saved');
      } else {
        const parts = [];
        if (r.payment?.cascade?.length) parts.push(`bank overpayment auto-applied to ${r.payment.cascade.map((c) => `${MONTHS[c.month - 1].slice(0, 3)} ${c.year}`).join(', ')}`);
        if (r.credit?.cascade?.length) parts.push(`credit auto-applied to ${r.credit.cascade.map((c) => `${MONTHS[c.month - 1].slice(0, 3)} ${c.year}`).join(', ')}`);
        toast(parts.length ? `Payment saved — ${parts.join('; ')}` : 'Payment saved');
      }
      close(); load();
    } catch (err) { toast(err.message); }
  };

  const applyAdvance = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/advance/apply', adv);
      toast(`Advance applied: ${inr(r.used)} · remaining ${inr(r.remaining)}`);
      close(); load();
    } catch (err) { toast(err.message); }
  };

  const remove = async (p) => {
    if (!confirm(`Delete this ${inr(p.amount)} payment for flat ${p.flat_number}? It will be soft-deleted and kept in the audit log.`)) return;
    await api.del(`/payments/${p.id}`); toast('Payment removed'); load();
  };

  const revokeCredit = async (c) => {
    if (!confirm(`Revoke this ${inr(c.amount)} ${ADJUSTMENT_LABELS[c.category]} credit for flat ${c.flat_number}? Any maintenance months it settled will reopen.`)) return;
    await api.post(`/resident-credits/${c.id}/revoke`); toast('Credit revoked'); load();
  };

  const selFlat = flats.find((f) => f.id === Number((form || adv)?.flat_id));

  return (
    <Layout title="Payments" sub="Maintenance received — bank payments and resident credit adjustments" backTo={`/b/${buildingId}`}
      actions={
        <>
          <button className="btn" onClick={() => setAdv({ flat_id: '', month: now.getMonth() + 1, year: now.getFullYear(), amount: '' })}>{Icons.wallet} Apply advance</button>
          <button className="btn primary" onClick={() => setForm({ ...blankPay })}>{Icons.rupee} + Payment</button>
        </>
      }
      headerIcon={Icons.rupee}
      mobileExtra={
        <>
          <button className="btn sm" onClick={() => setAdv({ flat_id: '', month: now.getMonth() + 1, year: now.getFullYear(), amount: '' })}>{Icons.wallet} Advance</button>
          <button className="btn primary sm" onClick={() => setForm({ ...blankPay })}>{Icons.rupee} + Payment</button>
        </>
      }>

      {rows && rows.length === 0 && <Empty title="No payments yet" hint="Record the first maintenance payment." />}

      {rows && rows.length > 0 && (
        <div className="glass" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}><label>Month</label>
            <select value={filter.month} onChange={(e) => setFilter({ ...filter, month: e.target.value })}>
              <option value="">All months</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select></div>
          <div className="field" style={{ margin: 0 }}><label>Year</label>
            <input type="number" placeholder="All years" value={filter.year} onChange={(e) => setFilter({ ...filter, year: e.target.value })} style={{ width: 100 }} /></div>
          <div className="field" style={{ margin: 0 }}><label>From date</label>
            <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} /></div>
          <div className="field" style={{ margin: 0 }}><label>To date</label>
            <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} /></div>
          {filtersActive && <button type="button" className="btn sm" onClick={clearFilters}>Clear filters</button>}
          <span className="mut" style={{ marginLeft: 'auto', alignSelf: 'center' }}>{filteredRows.length} of {rows.length} payments</span>
        </div>
      )}

      {rows && rows.length > 0 && filteredRows.length === 0 && <Empty title="No payments match this filter" hint="Try a different month, year, or date range." />}

      <div className="glass tablewrap" style={{ padding: 0 }}>
        <table className="data responsive">
          <thead><tr><th>Date</th><th>Flat</th><th>For month</th><th className="t-right">Amount</th><th className="t-right">Applied</th><th className="t-right">To advance</th><th>Method</th><th></th></tr></thead>
          <tbody>
            {filteredRows.map((p) => (
              <tr key={p.id}>
                <td>{p.paid_on}</td>
                <td><strong>{p.flat_number}</strong></td>
                <td>{MONTHS[p.month - 1].slice(0, 3)} {p.year}</td>
                <td className="t-right num">{inr(p.amount)}</td>
                <td className="t-right num" style={{ color: 'var(--ok)' }}>{inr(p.applied_amount)}</td>
                <td className="t-right num" style={{ color: p.advance_amount > 0 ? 'var(--adv)' : 'var(--muted)' }}>{inr(p.advance_amount)}</td>
                <td className="mut">{p.method}</td>
                <td className="t-right" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm icon-only" onClick={() => setForm({ ...blankPay, ...p, adjustment_category: 'none', adjustment_amount: '', adjustment_custom_title: '' })} data-label="Edit" aria-label="Edit">{Icons.edit}</button>{' '}
                  <button className="btn sm icon-only danger" onClick={() => remove(p)} data-label="Delete" aria-label="Delete">{Icons.trash}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="list" style={{ marginTop: 12 }}>
        {filteredRows.map((p) => (
          <div key={p.id} className="glass rowcard">
            <div className="rc-top">
              <span className="rc-title-block">
                <span className="icon-badge sm b-ok">{Icons.rupee}</span>
                <span className="rc-title">{p.flat_number} · {MONTHS[p.month - 1].slice(0, 3)} {p.year}</span>
              </span>
              <strong className="num" style={{ color: 'var(--ok)' }}>{inr(p.amount)}</strong>
            </div>
            <div className="rc-meta num">
              <span>{p.paid_on}</span><span>{p.method}</span>
              {p.advance_amount > 0 && <span style={{ color: 'var(--adv)' }}>{inr(p.advance_amount)} to advance</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm icon-only" onClick={() => setForm({ ...blankPay, ...p, adjustment_category: 'none', adjustment_amount: '', adjustment_custom_title: '' })} data-label="Edit" aria-label="Edit">{Icons.edit}</button>
              <button className="btn sm icon-only danger" onClick={() => remove(p)} data-label="Delete" aria-label="Delete">{Icons.trash}</button>
            </div>
          </div>
        ))}
      </div>

      <h3 className="section-title">Resident credit adjustments</h3>
      {credits && credits.length === 0 && <div className="glass mut" style={{ padding: 18 }}>No direct-vendor-payment credits recorded yet.</div>}
      {credits && credits.length > 0 && (
        <div className="glass tablewrap" style={{ padding: 0 }}>
          <table className="data responsive">
            <thead><tr><th>Date</th><th>Flat</th><th>Category</th><th className="t-right">Amount</th><th></th></tr></thead>
            <tbody>
              {credits.map((c) => (
                <tr key={c.id}>
                  <td>{c.paid_on}</td>
                  <td><strong>{c.flat_number}</strong></td>
                  <td>{ADJUSTMENT_LABELS[c.category] || c.category}{c.custom_title ? ` — ${c.custom_title}` : ''}</td>
                  <td className="t-right num" style={{ color: 'var(--adv)' }}>{inr(c.amount)}</td>
                  <td className="t-right">
                    <button className="btn sm icon-only danger" onClick={() => revokeCredit(c)} data-label="Revoke" aria-label="Revoke">{Icons.trash}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* add / edit payment */}
      <Modal open={!!form} onClose={close} title={form?.id ? 'Edit payment' : 'Record payment'}>
        {form && (
          <form onSubmit={save}>
            <div className="field"><label>Flat *</label>
              <select required value={form.flat_id} onChange={(e) => setForm({ ...form, flat_id: e.target.value })} disabled={!!form.id}>
                <option value="">Select flat…</option>
                {flats.map((f) => <option key={f.id} value={f.id}>{f.number} — {f.owner_name || f.resident_name || 'unnamed'}</option>)}
              </select></div>
            <div className="form-row">
              <div className="field"><label>Month *</label>
                <select value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select></div>
              <div className="field"><label>Year *</label>
                <input type="number" min="2000" max="2100" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} /></div>
            </div>
            {state && (
              <div className="glass" style={{ padding: 12, marginBottom: 12, fontSize: 13 }}>
                <span className="mut">This month:</span>{' '}
                required <b className="num">{inr(state.required)}</b> · paid <b className="num" style={{ color: 'var(--ok)' }}>{inr(state.paid)}</b> · due <b className="num" style={{ color: state.due > 0 ? 'var(--bad)' : 'var(--ok)' }}>{inr(state.due)}</b>
                {state.advance > 0 && <> · advance <b className="num" style={{ color: 'var(--adv)' }}>{inr(state.advance)}</b></>}
                <div className="mut" style={{ marginTop: 4 }}>Anything above the due is automatically applied to the following months, in order, until it runs out.</div>
              </div>
            )}
            <div className="field"><label>Amount paid to society (₹)</label>
              <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>

            {!form.id && (
              <>
                <div className="form-row">
                  <div className="field"><label>Adjust maintenance with</label>
                    <select value={form.adjustment_category} onChange={(e) => setForm({ ...form, adjustment_category: e.target.value })}>
                      {Object.entries(ADJUSTMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select></div>
                  {form.adjustment_category !== 'none' && (
                    <div className="field"><label>Adjustment amount (₹) *</label>
                      <input required type="number" min="0.01" step="0.01" value={form.adjustment_amount} onChange={(e) => setForm({ ...form, adjustment_amount: e.target.value })} /></div>
                  )}
                </div>
                {form.adjustment_category === 'custom' && (
                  <div className="field"><label>Custom expense name *</label>
                    <input required value={form.adjustment_custom_title} onChange={(e) => setForm({ ...form, adjustment_custom_title: e.target.value })} /></div>
                )}
                {form.adjustment_category !== 'none' && (
                  <div className="mut" style={{ fontSize: 12.5, marginBottom: 10 }}>
                    The resident already paid this amount directly to the provider — it's recorded as an expense and credited toward their maintenance, never added to the society's bank balance.
                  </div>
                )}
              </>
            )}

            <div className="form-row">
              <div className="field"><label>Payment method *</label>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select></div>
              <div className="field"><label>Payment date *</label>
                <input required type="date" value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} /></div>
            </div>
            <div className="field"><label>Notes</label>
              <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button className="btn primary">{form.id ? 'Save changes' : 'Record payment'}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* apply advance */}
      <Modal open={!!adv} onClose={close} title="Apply advance to a month">
        {adv && (
          <form onSubmit={applyAdvance}>
            <div className="field"><label>Flat *</label>
              <select required value={adv.flat_id} onChange={(e) => setAdv({ ...adv, flat_id: Number(e.target.value) })}>
                <option value="">Select flat…</option>
                {flats.filter((f) => f.advance > 0).map((f) => (
                  <option key={f.id} value={f.id}>{f.number} — advance {inr(f.advance)}</option>
                ))}
              </select>
              {flats.every((f) => !(f.advance > 0)) && <span className="mut">No flat currently holds an advance balance.</span>}
            </div>
            <div className="form-row">
              <div className="field"><label>Apply to month *</label>
                <select value={adv.month} onChange={(e) => setAdv({ ...adv, month: Number(e.target.value) })}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select></div>
              <div className="field"><label>Year *</label>
                <input type="number" min="2000" max="2100" value={adv.year} onChange={(e) => setAdv({ ...adv, year: Number(e.target.value) })} /></div>
            </div>
            {state && selFlat && (
              <div className="glass" style={{ padding: 12, marginBottom: 12, fontSize: 13 }}>
                Due for that month: <b className="num" style={{ color: state.due > 0 ? 'var(--bad)' : 'var(--ok)' }}>{inr(state.due)}</b> ·
                available advance: <b className="num" style={{ color: 'var(--adv)' }}> {inr(state.advance)}</b>
              </div>
            )}
            <div className="field"><label>Amount to apply (₹) — leave blank to apply the maximum</label>
              <input type="number" min="0.01" step="0.01" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button className="btn primary">Apply advance</button>
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
