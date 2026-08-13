import React, { useEffect, useState } from 'react';
import { api, inr, MONTHS } from '../../api.js';
import { Layout, Modal, useToast, residentNavLinks, Icons } from '../../components/ui.jsx';

export default function Receipts() {
  const [payments, setPayments] = useState(null);
  const [flat, setFlat] = useState(null);
  const [selected, setSelected] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api.get('/me/payments').then(setPayments).catch((e) => toast(e.message));
    api.get('/me/flat').then(setFlat).catch(() => {});
  }, []);

  if (!payments) return <Layout title="Loading…" navOverride={residentNavLinks()} />;

  return (
    <Layout title="Receipts" sub="Every approved payment on your account" navOverride={residentNavLinks()} headerIcon={Icons.receipt}>
      {payments.length === 0 && <div className="glass mut" style={{ padding: 18 }}>No payments recorded yet.</div>}
      <div className="list">
        {payments.map((p) => (
          <div key={p.id} className="glass rowcard" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="icon-badge sm b-ok">{Icons.receipt}</span>
              <div>
                <strong>{MONTHS[p.month - 1]} {p.year}</strong>
                <div className="mut">{p.paid_on} · {p.method}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <strong className="num" style={{ color: 'var(--ok)' }}>{inr(p.amount)}</strong>
              <button className="btn sm" onClick={() => setSelected(p)}>View receipt</button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Payment receipt">
        {selected && flat && (
          <div>
            <div className="printable-receipt glass" style={{ padding: 22 }}>
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0 }}>Payment Receipt</h2>
                <div className="mut">Society Ledger</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 14 }}>
                <div><span className="mut">Flat</span><div style={{ fontWeight: 600 }}>{flat.number}</div></div>
                <div><span className="mut">Receipt #</span><div style={{ fontWeight: 600 }}>{selected.id}</div></div>
                <div><span className="mut">For month</span><div style={{ fontWeight: 600 }}>{MONTHS[selected.month - 1]} {selected.year}</div></div>
                <div><span className="mut">Payment date</span><div style={{ fontWeight: 600 }}>{selected.paid_on}</div></div>
                <div><span className="mut">Method</span><div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{selected.method}</div></div>
                <div><span className="mut">Amount received</span><div className="num" style={{ fontWeight: 700, color: 'var(--ok)' }}>{inr(selected.amount)}</div></div>
              </div>
              {selected.notes && <div style={{ marginTop: 14 }}><span className="mut">Notes</span><div>{selected.notes}</div></div>}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setSelected(null)}>Close</button>
              <button className="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
