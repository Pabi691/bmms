import React, { useEffect, useState } from 'react';
import { api, inr } from '../../api.js';
import { Layout, useToast, residentNavLinks, Icons } from '../../components/ui.jsx';

const CATEGORY_LABELS = { electricity: 'Electricity', internet: 'Internet', water: 'Water', sweeper: 'Sweeper', security: 'Security', cleaning: 'Cleaning', generator: 'Generator', custom: 'Custom' };
const STATUS_CHIP = { available: ['advance', 'Available'], used: ['paid', 'Used'], partially_used: ['partial', 'Partially used'], pending: ['partial', 'Pending review'], rejected: ['due', 'Rejected'] };

export default function Credits() {
  const [data, setData] = useState(null);
  const toast = useToast();

  useEffect(() => { api.get('/me/credits').then(setData).catch((e) => toast(e.message)); }, []);

  if (!data) return <Layout title="Loading…" navOverride={residentNavLinks()} />;
  const t = data.totals;

  return (
    <Layout title="My credits" sub="Direct payments you've made to service providers, credited toward your maintenance" navOverride={residentNavLinks()} headerIcon={Icons.sheet}>
      <div className="grid stats" style={{ marginBottom: 16 }}>
        <div className="glass stat accent-adv"><div className="icon-badge b-credit">{Icons.card}</div><div className="label">Available</div><div className="value num">{inr(t.available)}</div></div>
        <div className="glass stat accent-ok"><div className="icon-badge b-ok">{Icons.check}</div><div className="label">Used</div><div className="value num">{inr(t.used)}</div></div>
        <div className="glass stat"><div className="icon-badge b-warn">{Icons.history}</div><div className="label">Pending</div><div className="value num">{inr(t.pending)}</div></div>
        <div className="glass stat accent-bad"><div className="icon-badge b-bad">{Icons.alert}</div><div className="label">Rejected</div><div className="value num">{inr(t.rejected)}</div></div>
      </div>

      <h3 className="section-title">Credit history</h3>
      {data.history.length === 0 && <div className="glass mut" style={{ padding: 18 }}>No direct-vendor-payment adjustments yet — submit one from the Pay maintenance page.</div>}
      <div className="list">
        {data.history.map((c) => {
          const [cls, label] = STATUS_CHIP[c.status] || ['due', c.status];
          return (
            <div key={`${c.status}-${c.id}`} className="glass" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong>{CATEGORY_LABELS[c.category] || c.category}</strong>{c.customTitle ? ` — ${c.customTitle}` : ''}
                  <div className="mut" style={{ fontSize: 12 }}>{c.paidOn}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="num" style={{ fontWeight: 700 }}>{inr(c.amount)}</div>
                  <span className={'chip ' + cls}>{label}</span>
                </div>
              </div>
              {(c.status === 'used' || c.status === 'partially_used') && (
                <div className="mut num" style={{ fontSize: 12, marginTop: 6 }}>Used {inr(c.usedAmount)} · available {inr(c.availableAmount)}</div>
              )}
              {c.status === 'rejected' && c.rejectionReason && (
                <div className="mut" style={{ fontSize: 12, marginTop: 6, color: 'var(--bad)' }}>Reason: {c.rejectionReason}</div>
              )}
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
