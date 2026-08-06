import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, inr, METHODS, today } from '../api.js';
import { Layout, Modal, Empty, useToast, RadialGauge, Icons } from '../components/ui.jsx';

export default function Funds() {
  const { buildingId } = useParams();
  const [funds, setFunds] = useState(null);
  const [open, setOpen] = useState(null);   // fund with tx list expanded
  const [txs, setTxs] = useState([]);
  const [createForm, setCreateForm] = useState(null);
  const [txForm, setTxForm] = useState(null);
  const toast = useToast();

  const load = () => api.get(`/buildings/${buildingId}/funds`).then(setFunds).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [buildingId]);

  const openFund = async (f) => {
    setOpen(f);
    setTxs(await api.get(`/funds/${f.id}/transactions`));
  };

  const createFund = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/buildings/${buildingId}/funds`, createForm);
      toast('Emergency fund created'); setCreateForm(null); load();
    } catch (err) { toast(err.message); }
  };

  const saveTx = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/funds/${txForm.fund_id}/transactions`, txForm);
      toast(txForm.type === 'contribution' ? 'Contribution recorded' : 'Emergency expense recorded');
      setTxForm(null); load();
      if (open) openFund(open);
    } catch (err) { toast(err.message); }
  };

  return (
    <Layout title="Emergency funds" sub="Reserved money for urgent building needs" backTo={`/b/${buildingId}`}
      actions={<button className="btn primary" onClick={() => setCreateForm({ name: '', reason: '', target_amount: '', notes: '' })}>+ Create fund</button>}>

      {funds && funds.length === 0 && (
        <Empty title="No emergency funds" hint="Create a fund for lift breakdowns, electrical failures or urgent repairs." />
      )}

      <div className="grid cards">
        {(funds || []).map((f) => {
          const pct = f.target_amount > 0 ? Math.min((f.collected / f.target_amount) * 100, 100) : 0;
          return (
            <div key={f.id} className="glass card-hover" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                {f.target_amount > 0 && <RadialGauge percent={pct} size={64} stroke={7} color="var(--ok)" />}
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{f.name}</h3>
                  <div className="mut">{f.reason || 'Emergency reserve'}</div>
                </div>
              </div>
              {f.target_amount > 0 && (
                <div className="mut num">{inr(f.collected)} of {inr(f.target_amount)} target</div>
              )}
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 13 }}>
                <div><div className="mut">Collected</div><b className="num" style={{ color: 'var(--ok)' }}>{inr(f.collected)}</b></div>
                <div><div className="mut">Spent</div><b className="num" style={{ color: 'var(--bad)' }}>{inr(f.spent)}</b></div>
                <div><div className="mut">Balance</div><b className="num" style={{ color: 'var(--adv)' }}>{inr(f.balance)}</b></div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm primary" style={{ flex: 1 }} onClick={() => setTxForm({ fund_id: f.id, type: 'contribution', amount: '', method: 'cash', date: today(), notes: '' })}>+ Contribution</button>
                <button className="btn sm" onClick={() => setTxForm({ fund_id: f.id, type: 'expense', amount: '', method: 'cash', date: today(), notes: '' })}>+ Expense</button>
                <button className="btn sm icon-only" onClick={() => openFund(f)} data-label="History" aria-label="History">{Icons.history}</button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={!!createForm} onClose={() => setCreateForm(null)} title="Create emergency fund">
        {createForm && (
          <form onSubmit={createFund}>
            <div className="field"><label>Fund name *</label>
              <input required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} /></div>
            <div className="field"><label>Emergency reason</label>
              <input value={createForm.reason} onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })} placeholder="e.g. Lift motor replacement" /></div>
            <div className="field"><label>Target amount (₹)</label>
              <input type="number" min="0" step="0.01" value={createForm.target_amount} onChange={(e) => setCreateForm({ ...createForm, target_amount: e.target.value })} /></div>
            <div className="field"><label>Notes</label>
              <textarea rows="2" value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setCreateForm(null)}>Cancel</button>
              <button className="btn primary">Create fund</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!txForm} onClose={() => setTxForm(null)}
        title={txForm?.type === 'contribution' ? 'Record contribution' : 'Record emergency expense'}>
        {txForm && (
          <form onSubmit={saveTx}>
            <div className="form-row">
              <div className="field"><label>Amount (₹) *</label>
                <input required type="number" min="0.01" step="0.01" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} /></div>
              <div className="field"><label>Date *</label>
                <input required type="date" value={txForm.date} onChange={(e) => setTxForm({ ...txForm, date: e.target.value })} /></div>
            </div>
            <div className="field"><label>Payment method *</label>
              <select value={txForm.method} onChange={(e) => setTxForm({ ...txForm, method: e.target.value })}>
                {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select></div>
            <div className="field"><label>Notes</label>
              <input value={txForm.notes} onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })} placeholder={txForm.type === 'expense' ? 'What was repaired?' : 'Who contributed?'} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setTxForm(null)}>Cancel</button>
              <button className="btn primary">Save</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.name} · history` : ''}>
        {txs.length === 0 && <div className="mut">No transactions yet.</div>}
        {txs.map((t) => (
          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 13.5 }}>
            <span>{t.date} · {t.type === 'contribution' ? 'Contribution' : 'Expense'} <span className="mut">({t.method})</span><div className="mut">{t.notes}</div></span>
            <strong className="num" style={{ color: t.type === 'contribution' ? 'var(--ok)' : 'var(--bad)' }}>
              {t.type === 'contribution' ? '+' : '−'}{inr(t.amount)}
            </strong>
          </div>
        ))}
      </Modal>
    </Layout>
  );
}
