import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, inr, METHODS, today } from '../api.js';
import { Layout, Modal, Empty, useToast, Icons } from '../components/ui.jsx';

const blank = { date: today(), amount: '', category: '', custom_name: '', description: '', method: 'cash', paid_to: '' };

export default function Expenses() {
  const { buildingId } = useParams();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [cats, setCats] = useState([]);
  const [q, setQ] = useState('');
  const [fCat, setFCat] = useState('all');
  const [form, setForm] = useState(params.get('add') ? { ...blank } : null);
  const toast = useToast();

  const load = () => api.get(`/buildings/${buildingId}/expenses`).then(setRows).catch((e) => toast(e.message));
  useEffect(() => { load(); api.get('/expense-categories').then(setCats); }, [buildingId]);

  const close = () => { setForm(null); params.delete('add'); setParams(params); };
  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) { await api.put(`/expenses/${form.id}`, form); toast('Expense updated'); }
      else { await api.post(`/buildings/${buildingId}/expenses`, form); toast('Expense added — building balance updated'); }
      close(); load();
    } catch (err) { toast(err.message); }
  };
  const remove = async (x) => {
    if (!confirm(`Delete this ${inr(x.amount)} expense (${x.custom_name || x.category})? It is kept in the audit log.`)) return;
    await api.del(`/expenses/${x.id}`); toast('Expense removed'); load();
  };

  const list = useMemo(() => (rows || []).filter((x) =>
    (fCat === 'all' || x.category === fCat) &&
    [x.category, x.custom_name, x.paid_to, x.description].join(' ').toLowerCase().includes(q.toLowerCase())
  ), [rows, q, fCat]);
  const total = list.reduce((s, x) => s + x.amount, 0);

  return (
    <Layout title="Expenses" sub={`${list.length} records · total ${inr(total)}`} backTo={`/b/${buildingId}`}
      actions={<button className="btn primary" onClick={() => setForm({ ...blank })}>{Icons.expense} + Expense</button>}
      headerIcon={Icons.expense}
      mobileExtra={<button className="btn primary sm" onClick={() => setForm({ ...blank })}>{Icons.expense} + Expense</button>}>

      <div className="searchbar">
        <input placeholder="Search expenses…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="all">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {rows && list.length === 0 && <Empty title="No expenses found" hint="Add building expenses to track outgoing money." />}

      <div className="glass tablewrap" style={{ padding: 0 }}>
        <table className="data responsive">
          <thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th className="t-right">Amount</th><th>Method</th><th></th></tr></thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id}>
                <td>{x.date}</td>
                <td>
                  <strong>{x.custom_name || x.category}</strong>
                  {!!x.is_adjustment && <span className="chip partial" style={{ marginLeft: 6 }}>Auto (adjustment)</span>}
                  <div className="mut">{x.description}</div>
                </td>
                <td>{x.paid_to || '—'}</td>
                <td className="t-right num" style={{ color: 'var(--bad)' }}>−{inr(x.amount)}</td>
                <td className="mut">{x.method}</td>
                <td className="t-right" style={{ whiteSpace: 'nowrap' }}>
                  {x.is_adjustment ? (
                    <span className="mut" style={{ fontSize: 12 }} data-label="Edit the source payment instead">—</span>
                  ) : (
                    <>
                      <button className="btn sm icon-only" onClick={() => setForm({ ...x })} data-label="Edit" aria-label="Edit">{Icons.edit}</button>{' '}
                      <button className="btn sm icon-only danger" onClick={() => remove(x)} data-label="Delete" aria-label="Delete">{Icons.trash}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="list" style={{ marginTop: 12 }}>
        {list.map((x) => (
          <div key={x.id} className="glass rowcard">
            <div className="rc-top">
              <span className="rc-title-block">
                <span className="icon-badge sm b-warn">{Icons.expense}</span>
                <span className="rc-title">{x.custom_name || x.category}</span>
              </span>
              <strong className="num" style={{ color: 'var(--bad)' }}>−{inr(x.amount)}</strong>
            </div>
            <div className="rc-meta">
              <span>{x.date}</span><span>{x.method}</span>{x.paid_to && <span>to {x.paid_to}</span>}
              {!!x.is_adjustment && <span className="chip partial">Auto (adjustment)</span>}
            </div>
            {!x.is_adjustment && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm icon-only" onClick={() => setForm({ ...x })} data-label="Edit" aria-label="Edit">{Icons.edit}</button>
                <button className="btn sm icon-only danger" onClick={() => remove(x)} data-label="Delete" aria-label="Delete">{Icons.trash}</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Modal open={!!form} onClose={close} title={form?.id ? 'Edit expense' : 'Add expense'}>
        {form && (
          <form onSubmit={save}>
            <div className="form-row">
              <div className="field"><label>Date *</label>
                <input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div className="field"><label>Amount (₹) *</label>
                <input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div className="field"><label>Category *</label>
              <select required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Select category…</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            {form.category === 'Other' && (
              <div className="field"><label>Custom expense name</label>
                <input value={form.custom_name || ''} onChange={(e) => setForm({ ...form, custom_name: e.target.value })} /></div>
            )}
            <div className="form-row">
              <div className="field"><label>Payment method *</label>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                </select></div>
              <div className="field"><label>Paid to</label>
                <input value={form.paid_to || ''} onChange={(e) => setForm({ ...form, paid_to: e.target.value })} /></div>
            </div>
            <div className="field"><label>Description</label>
              <textarea rows="2" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button className="btn primary">{form.id ? 'Save changes' : 'Add expense'}</button>
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
