import React, { useEffect, useState } from 'react';
import { api, inr, MONTHS, today } from '../../api.js';
import { Layout, useToast, residentNavLinks } from '../../components/ui.jsx';

const now = new Date();
const blank = { month: now.getMonth() + 1, year: now.getFullYear(), amount: '', method: 'upi', paid_on: today(), transaction_ref: '', notes: '' };

const statusChip = { pending: ['warn', 'Pending review'], approved: ['ok', 'Approved'], rejected: ['bad', 'Rejected'] };

export default function PayMaintenance() {
  const [info, setInfo] = useState(null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({ ...blank });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => {
    api.get('/me/building-payment-info').then(setInfo).catch((e) => toast(e.message));
    api.get('/me/payment-submissions').then(setHistory).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { toast('Please attach a payment screenshot'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('screenshot', file);
      await api.upload('/me/payment-submissions', fd);
      toast('Payment submitted — pending approval');
      setForm({ ...blank }); setFile(null); setPreview(null);
      load();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resubmit = (s) => {
    setForm({ month: s.month, year: s.year, amount: s.amount, method: s.method, paid_on: today(), transaction_ref: s.transactionRef || '', notes: '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!info) return <Layout title="Loading…" navOverride={residentNavLinks()} />;

  return (
    <Layout title="Pay maintenance" sub="Pay via UPI or bank transfer, then upload your proof for approval" navOverride={residentNavLinks()}>
      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="glass">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Payment details</h3>
          {!info.bank_account_number && !info.bank_upi_id ? (
            <div className="mut">Your building admin hasn't added payment details yet.</div>
          ) : (
            <div className="list" style={{ fontSize: 14 }}>
              {info.bank_upi_id && <div><span className="mut">UPI ID</span><div className="num" style={{ fontWeight: 600 }}>{info.bank_upi_id}</div></div>}
              {info.bank_account_name && <div><span className="mut">Account name</span><div style={{ fontWeight: 600 }}>{info.bank_account_name}</div></div>}
              {info.bank_account_number && <div><span className="mut">Account number</span><div className="num" style={{ fontWeight: 600 }}>{info.bank_account_number}</div></div>}
              {info.bank_ifsc && <div><span className="mut">IFSC</span><div className="num" style={{ fontWeight: 600 }}>{info.bank_ifsc}</div></div>}
            </div>
          )}
          {info.hasQr && (
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <img src={info.qrUrl} alt="Payment QR code" style={{ maxWidth: 200, borderRadius: 12, border: '1px solid var(--border)' }} />
            </div>
          )}
        </div>

        <div className="glass">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Submit payment proof</h3>
          <form onSubmit={submit}>
            <div className="form-row">
              <div className="field"><label>Month *</label>
                <select value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select></div>
              <div className="field"><label>Year *</label>
                <input type="number" min="2000" max="2100" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Amount paid (₹) *</label>
                <input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div className="field"><label>Method *</label>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  <option value="upi">UPI</option><option value="bank">Bank transfer</option><option value="other">Other</option>
                </select></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Payment date *</label>
                <input required type="date" value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} /></div>
              <div className="field"><label>Transaction ID</label>
                <input value={form.transaction_ref} onChange={(e) => setForm({ ...form, transaction_ref: e.target.value })} /></div>
            </div>
            <div className="field"><label>Payment screenshot *</label>
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={onFile} required />
            </div>
            {preview && <img src={preview} alt="Preview" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 10, marginBottom: 12 }} />}
            <div className="field"><label>Notes</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </button>
          </form>
        </div>
      </div>

      <h3 className="section-title">Your submissions</h3>
      {history.length === 0 && <div className="glass mut" style={{ padding: 18 }}>No submissions yet.</div>}
      <div className="list">
        {history.map((s) => {
          const [cls, label] = statusChip[s.status];
          return (
            <div key={s.id} className="glass" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong>{MONTHS[s.month - 1]} {s.year}</strong> <span className="mut">· {inr(s.amount)} · {s.method}</span>
                  <div className="mut" style={{ fontSize: 12 }}>Submitted {s.createdAt?.slice(0, 10)}</div>
                </div>
                <span className={'chip ' + (cls === 'ok' ? 'paid' : cls === 'warn' ? 'partial' : 'due')}>{label}</span>
              </div>
              {s.status === 'rejected' && (
                <div style={{ marginTop: 8 }}>
                  <div className="mut" style={{ color: 'var(--bad)' }}>Reason: {s.rejectionReason}</div>
                  <button className="btn sm" style={{ marginTop: 8 }} onClick={() => resubmit(s)}>Resubmit</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
