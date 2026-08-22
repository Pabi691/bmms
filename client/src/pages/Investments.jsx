import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, inr, today } from '../api.js';
import { Layout, Modal, Empty, useToast, Icons } from '../components/ui.jsx';

const blankNew = { type: '', amount: '', source: 'bank', invested_on: today(), reference: '', notes: '', is_previous: false };
const STATUS_TONE = { active: 'b-adv', redeemed: 'b-ok' };

export default function Investments() {
  const { buildingId } = useParams();
  const [summary, setSummary] = useState(null);
  const [buildingStats, setBuildingStats] = useState(null);
  const [form, setForm] = useState(null);
  const [redeemForm, setRedeemForm] = useState(null); // investment being redeemed
  const toast = useToast();

  const load = () => {
    api.get(`/buildings/${buildingId}/investments`).then(setSummary).catch((e) => toast(e.message));
    api.get(`/buildings/${buildingId}/summary`).then((s) => setBuildingStats(s.totals)).catch(() => {});
  };
  useEffect(() => { load(); }, [buildingId]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/buildings/${buildingId}/investments`, form);
      toast(form.is_previous ? 'Previous investment recorded' : 'Investment recorded');
      setForm(null); load();
    } catch (err) { toast(err.message); }
  };

  const redeem = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/investments/${redeemForm.id}/redeem`, redeemForm);
      toast('Investment redeemed'); setRedeemForm(null); load();
    } catch (err) { toast(err.message); }
  };

  const remove = async (inv) => {
    if (!confirm(`Remove this ${inr(inv.amount)} ${inv.type} entry?`)) return;
    try {
      await api.del(`/investments/${inv.id}`);
      toast('Investment removed'); load();
    } catch (err) { toast(err.message); }
  };

  const invested = summary?.totals.invested || 0;
  const available = buildingStats?.availableBalance ?? 0;

  return (
    <Layout title="Investments" sub="Fixed deposits and other society investments" backTo={`/b/${buildingId}`}
      actions={<button className="btn primary" onClick={() => setForm({ ...blankNew })}>{Icons.trendUp} + New Investment</button>}
      headerIcon={Icons.trendUp}
      mobileExtra={<button className="btn primary sm" onClick={() => setForm({ ...blankNew })}>{Icons.trendUp} + New Investment</button>}>

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="glass stat accent-ok"><div className="label">Available Balance</div><div className="value num">{inr(available)}</div></div>
        <div className="glass stat accent-adv"><div className="label">Invested Balance</div><div className="value num">{inr(invested)}</div></div>
        <div className="glass stat"><div className="label">Total Funds</div><div className="value num">{inr(available + invested)}</div></div>
      </div>

      {summary && summary.rows.length === 0 && (
        <Empty title="No investments yet" hint="Record a fixed deposit or other society investment." />
      )}

      <div className="grid cards">
        {(summary?.rows || []).map((inv) => (
          <div key={inv.id} className="glass card-hover" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>{inv.type}</h3>
                <div className="mut">{inv.investedOn} · {inv.source}{inv.isPrevious ? ' · previous' : ''}</div>
              </div>
              <span className={'chip ' + (inv.status === 'redeemed' ? 'paid' : 'partial')}>{inv.status === 'redeemed' ? 'Redeemed' : 'Active'}</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: inv.status === 'redeemed' ? '1fr 1fr' : '1fr', gap: 6, fontSize: 13 }}>
              <div><div className="mut">Invested</div><b className="num" style={{ color: 'var(--adv)' }}>{inr(inv.amount)}</b></div>
              {inv.status === 'redeemed' && (
                <div><div className="mut">Returned</div><b className="num" style={{ color: 'var(--ok)' }}>{inr(inv.redeemedAmount)}</b></div>
              )}
            </div>
            {inv.reference && <div className="mut" style={{ fontSize: 12.5 }}>Ref: {inv.reference}</div>}
            {inv.notes && <div className="mut" style={{ fontSize: 12.5 }}>{inv.notes}</div>}
            {inv.status === 'redeemed' && (
              <div className="mut" style={{ fontSize: 12.5 }}>Redeemed {inv.redeemedOn} → {inv.redeemedSource}{inv.redeemedNotes ? ` · ${inv.redeemedNotes}` : ''}</div>
            )}
            {inv.status === 'active' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm primary" style={{ flex: 1 }}
                  onClick={() => setRedeemForm({ id: inv.id, redeemed_amount: inv.amount, redeemed_on: today(), redeemed_source: inv.source, redeemed_notes: '' })}>
                  Redeem
                </button>
                <button className="btn sm icon-only danger" onClick={() => remove(inv)} data-label="Remove" aria-label="Remove">{Icons.trash}</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {summary && summary.rows.length > 0 && (
        <>
          <h3 className="section-title">Investment History</h3>
          <div className="glass tablewrap" style={{ padding: 0 }}>
            <table className="data responsive">
              <thead><tr><th>Date</th><th>Type</th><th className="t-right">Amount</th><th>Source</th><th>Status</th><th>Notes</th></tr></thead>
              <tbody>
                {summary.rows.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.investedOn}</td>
                    <td>{inv.isPrevious ? 'Previous Investment' : inv.type}</td>
                    <td className="t-right num">{inr(inv.amount)}</td>
                    <td className="mut" style={{ textTransform: 'capitalize' }}>{inv.source}</td>
                    <td><span className={'chip ' + (inv.status === 'redeemed' ? 'paid' : 'partial')}>{inv.status === 'redeemed' ? 'Redeemed' : 'Active'}</span></td>
                    <td className="mut">{inv.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title="Record investment">
        {form && (
          <form onSubmit={save}>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.is_previous} onChange={(e) => setForm({ ...form, is_previous: e.target.checked })} style={{ width: 'auto' }} />
                This is a previous / pre-existing investment
              </label>
              {form.is_previous && (
                <div className="mut" style={{ fontSize: 12.5, marginTop: 6 }}>
                  Adds to Invested Balance without reducing the current Bank/Cash balance — use this for
                  investments the society already held before this software started tracking money.
                </div>
              )}
            </div>
            <div className="field"><label>Investment type / purpose *</label>
              <input required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="e.g. Fixed Deposit (FD)" /></div>
            <div className="form-row">
              <div className="field"><label>Amount (₹) *</label>
                <input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div className="field"><label>Investment date *</label>
                <input required type="date" value={form.invested_on} onChange={(e) => setForm({ ...form, invested_on: e.target.value })} /></div>
            </div>
            <div className="field"><label>Source *</label>
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select>
              {!form.is_previous && (
                <div className="mut" style={{ fontSize: 12.5, marginTop: 6 }}>
                  Available {form.source}: {inr(form.source === 'bank' ? buildingStats?.bank : buildingStats?.cash)}
                </div>
              )}
            </div>
            <div className="field"><label>Reference / details</label>
              <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. FD account number" /></div>
            <div className="field"><label>Notes</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn primary">Save investment</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!redeemForm} onClose={() => setRedeemForm(null)} title="Redeem investment">
        {redeemForm && (
          <form onSubmit={redeem}>
            <div className="form-row">
              <div className="field"><label>Amount returned (₹) *</label>
                <input required type="number" min="0.01" step="0.01" value={redeemForm.redeemed_amount} onChange={(e) => setRedeemForm({ ...redeemForm, redeemed_amount: e.target.value })} /></div>
              <div className="field"><label>Redemption date *</label>
                <input required type="date" value={redeemForm.redeemed_on} onChange={(e) => setRedeemForm({ ...redeemForm, redeemed_on: e.target.value })} /></div>
            </div>
            <div className="field"><label>Returned to *</label>
              <select value={redeemForm.redeemed_source} onChange={(e) => setRedeemForm({ ...redeemForm, redeemed_source: e.target.value })}>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </select></div>
            <div className="field"><label>Notes</label>
              <input value={redeemForm.redeemed_notes} onChange={(e) => setRedeemForm({ ...redeemForm, redeemed_notes: e.target.value })} placeholder="e.g. Matured with interest" /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setRedeemForm(null)}>Cancel</button>
              <button className="btn primary">Redeem</button>
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
