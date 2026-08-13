import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, inr, MONTHS } from '../../api.js';
import { Layout, RadialGauge, Icons, StatusChip, residentNavLinks, useToast, Wave, CityIllustration } from '../../components/ui.jsx';
import { useAuth } from '../../auth.jsx';

export default function ResidentDashboard() {
  const [flat, setFlat] = useState(null);
  const [month, setMonth] = useState(null);
  const [credits, setCredits] = useState(null);
  const [notices, setNotices] = useState([]);
  const nav = useNavigate();
  const toast = useToast();
  const { logout } = useAuth();

  useEffect(() => {
    api.get('/me/flat').then(setFlat).catch((e) => toast(e.message));
    api.get('/me/month-state').then(setMonth).catch((e) => toast(e.message));
    api.get('/me/credits').then(setCredits).catch(() => {});
    api.get('/me/notices').then((n) => setNotices(n.slice(0, 3))).catch(() => {});
  }, []);

  if (!flat || !month) return <Layout title="Loading…" navOverride={residentNavLinks()} />;
  const ct = credits?.totals || { available: 0, used: 0, pending: 0 };
  const hasCreditActivity = ct.available > 0 || ct.used > 0 || ct.pending > 0;

  const now = new Date();
  const pct = month.required > 0 ? (month.paid / month.required) * 100 : 100;
  const dueTone = month.due > 0 ? 'b-bad' : 'b-ok';

  return (
    <Layout title={`Flat ${flat.number}`} sub={`${MONTHS[now.getMonth()]} ${now.getFullYear()} · your maintenance overview`} navOverride={residentNavLinks()}
      actions={<button className="btn primary sm" onClick={() => nav('/me/pay')}>+ Pay maintenance</button>}
      headerIcon={Icons.home}
      mobileExtra={<button className="btn primary sm" onClick={() => nav('/me/pay')}>{Icons.wallet} + Pay maintenance</button>}
      more={[
        { label: 'Notices', onClick: () => nav('/me/notices') },
        { label: 'Profile', onClick: () => nav('/me/profile') },
        { label: 'Sign out', onClick: logout },
      ]}>

      <div className="grid hero" style={{ marginBottom: 16 }}>
        <div className="glass card-hover hero-gauge" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <RadialGauge percent={pct} size={104} stroke={10} color={month.status === 'due' ? 'var(--bad)' : 'var(--ok)'} label={MONTHS[now.getMonth()].slice(0, 3)} />
          <div>
            <div className="mut" style={{ fontSize: 12.5, fontWeight: 500 }}>This month</div>
            <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{inr(month.paid)}</div>
            <div className="mut" style={{ fontSize: 12 }}>of {inr(month.required)} required</div>
          </div>
          <CityIllustration />
        </div>
        <div className="glass card-hover hero-stat">
          <div className="hs-top"><span className={'icon-badge ' + dueTone}>{Icons.alert}</span></div>
          <div><div className="label">Current due</div><div className="value num">{inr(month.due)}</div></div>
          <Wave tone={dueTone} />
        </div>
        <div className="glass card-hover hero-stat">
          <div className="hs-top"><span className="icon-badge b-adv">{Icons.wallet}</span></div>
          <div><div className="label">Advance balance</div><div className="value num">{inr(month.advance)}</div></div>
          <Wave tone="b-adv" />
        </div>
        <div className="glass card-hover hero-stat">
          <div className="hs-top"><span className="icon-badge b-credit">{Icons.rupee}</span></div>
          <div><div className="label">Monthly maintenance</div><div className="value num">{inr(flat.monthly_amount)}</div></div>
          <Wave tone="b-credit" />
        </div>
      </div>

      <div className="glass" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong>Status: </strong><StatusChip status={month.status} advance={month.advance} />
        </div>
        <button className="btn sm" onClick={() => nav('/me/ledger')}>View full ledger</button>
      </div>

      {hasCreditActivity && (
        <div className="glass" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <strong>Resident credit (direct vendor payments)</strong>
            <button className="btn sm" onClick={() => nav('/me/credits')}>View credit history</button>
          </div>
          <div className="grid stats">
            <div className="glass stat accent-adv"><div className="icon-badge b-credit">{Icons.card}</div><div className="label">Available credit</div><div className="value num">{inr(ct.available)}</div></div>
            <div className="glass stat accent-ok"><div className="icon-badge b-ok">{Icons.check}</div><div className="label">Used credit</div><div className="value num">{inr(ct.used)}</div></div>
            <div className="glass stat"><div className="icon-badge b-warn">{Icons.history}</div><div className="label">Pending credit</div><div className="value num">{inr(ct.pending)}</div></div>
          </div>
        </div>
      )}

      <h3 className="section-title">Recent notices</h3>
      {notices.length === 0 && <div className="glass mut" style={{ padding: 18 }}>No notices yet.</div>}
      <div className="list">
        {notices.map((n) => (
          <div key={n.id} className="glass" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{n.title}</strong>
              <span className="mut" style={{ fontSize: 12 }}>{n.createdAt?.slice(0, 10)}</span>
            </div>
            <div className="mut" style={{ marginTop: 4 }}>{n.body}</div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
