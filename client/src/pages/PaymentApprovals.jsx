import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, inr, MONTHS } from '../api.js';
import { Layout, Modal, Empty, useToast, Icons } from '../components/ui.jsx';

const statusChip = { pending: ['partial', 'Pending'], approved: ['paid', 'Approved'], rejected: ['due', 'Rejected'] };
const STATUS_TONE = { pending: 'b-warn', approved: 'b-ok', rejected: 'b-bad' };
const ADJUSTMENT_LABELS = { electricity: 'Electricity', internet: 'Internet', water: 'Water', sweeper: 'Sweeper', security: 'Security', cleaning: 'Cleaning', generator: 'Generator', custom: 'Custom' };

export default function PaymentApprovals() {
  const { buildingId } = useParams();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [viewing, setViewing] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const toast = useToast();

  const load = () => api.get(`/buildings/${buildingId}/payment-submissions?status=${filter}`).then(setRows).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [buildingId, filter]);

  const approve = async (s) => {
    if (!confirm(`Approve ₹${s.amount} for flat ${s.flatNumber}? This will record the bank payment and/or resident credit adjustment.`)) return;
    try {
      const r = await api.post(`/payment-submissions/${s.id}/approve`);
      const parts = [];
      if (r.payment?.cascade?.length) parts.push(`bank overpayment auto-applied to ${r.payment.cascade.length} future month(s)`);
      if (r.credit?.cascade?.length) parts.push(`credit auto-applied to ${r.credit.cascade.length} month(s)`);
      toast(parts.length ? `Approved — ${parts.join('; ')}` : 'Approved');
      load();
    } catch (err) { toast(err.message); }
  };

  const submitReject = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/payment-submissions/${rejecting.id}/reject`, { reason });
      toast('Submission rejected'); setRejecting(null); setReason(''); load();
    } catch (err) { toast(err.message); }
  };

  return (
    <Layout title="Payment approvals" sub="Review resident-submitted payment proofs" backTo={`/b/${buildingId}`} headerIcon={Icons.check}>
      <div className="searchbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {rows && rows.length === 0 && <Empty title={`No ${filter} submissions`} hint="Resident payment claims will show up here." />}

      <div className="list">
        {(rows || []).map((s) => {
          const [cls, label] = statusChip[s.status];
          return (
            <div key={s.id} className="glass" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                <div className={'icon-badge ' + STATUS_TONE[s.status]} style={{ flexShrink: 0 }}>{Icons.receipt}</div>
                <div>
                  <strong>Flat {s.flatNumber}</strong> <span className="mut">· {MONTHS[s.month - 1]} {s.year} · {s.method}</span>
                  <div className="mut" style={{ fontSize: 12 }}>Submitted {s.createdAt?.slice(0, 10)}{s.transactionRef ? ` · ref ${s.transactionRef}` : ''}</div>
                  {s.adjustmentCategory && (
                    <div className="mut" style={{ fontSize: 12, marginTop: 4 }}>
                      Bank {inr(s.bankAmount)} · {ADJUSTMENT_LABELS[s.adjustmentCategory] || s.adjustmentCategory}
                      {s.adjustmentCustomTitle ? ` — ${s.adjustmentCustomTitle}` : ''} adjustment {inr(s.adjustmentAmount)}
                    </div>
                  )}
                </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <strong className="num">{inr(s.amount)}</strong>
                  <span className={'chip ' + cls}>{label}</span>
                </div>
              </div>
              {s.status === 'rejected' && <div className="mut" style={{ marginTop: 6, color: 'var(--bad)' }}>Reason: {s.rejectionReason}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => setViewing(s)}>View screenshot</button>
                {s.status === 'pending' && (
                  <>
                    <button className="btn sm primary" onClick={() => approve(s)}>Approve</button>
                    <button className="btn sm danger" onClick={() => { setRejecting(s); setReason(''); }}>Reject</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Payment screenshot">
        {viewing && <img src={`/api/payment-submissions/${viewing.id}/screenshot`} alt="Payment proof" style={{ width: '100%', borderRadius: 12 }} />}
      </Modal>

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject submission">
        {rejecting && (
          <form onSubmit={submitReject}>
            <div className="field"><label>Reason *</label>
              <textarea required rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Screenshot doesn't match the claimed amount" /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn primary danger">Reject submission</button>
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
