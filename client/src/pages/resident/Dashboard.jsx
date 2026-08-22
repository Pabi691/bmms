import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, inr, MONTHS } from '../../api.js';
import { Layout, Icons, Logo, MoreMenu, StatusChip, residentNavLinks, useToast, DashboardSkeleton } from '../../components/ui.jsx';
import { useAuth } from '../../auth.jsx';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Good Morning!', icon: Icons.sun };
  if (h < 17) return { text: 'Good Afternoon!', icon: Icons.sun };
  return { text: 'Good Evening!', icon: Icons.moon };
}

// same real-data trend primitives as the Building Dashboard (Dashboard.jsx)
// — kept local since each page derives its own series shape from its own data.
function TrendWave({ values, color, dot }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * 100,
    82 - ((v - min) / range) * 64,
  ]);
  const d = pts.map(([x, y], i) => (i === 0 ? `M${x} ${y}` : ` L${x} ${y}`)).join('');
  const last = pts[pts.length - 1];
  return (
    <div className="dh-wave-wrap">
      <svg className="dh-wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {dot && <span className="dh-wave-dot" style={{ left: last[0] + '%', top: last[1] + '%', background: color, boxShadow: `0 0 10px ${color}` }} />}
    </div>
  );
}

function MiniBars({ values, color }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values, 1);
  return (
    <div className="dh-bars" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: color }} />
      ))}
    </div>
  );
}

// last 6 calendar months ending this month, oldest first
function last6Months() {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { m: d.getMonth() + 1, y: d.getFullYear() };
  });
}

export default function ResidentDashboard() {
  const [flat, setFlat] = useState(null);
  const [buildingName, setBuildingName] = useState('');
  const [month, setMonth] = useState(null);
  const [credits, setCredits] = useState(null);
  const [notices, setNotices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [ledger, setLedger] = useState(null);
  const [previousDue, setPreviousDue] = useState(null);
  const nav = useNavigate();
  const toast = useToast();
  const { logout } = useAuth();

  useEffect(() => {
    api.get('/me/flat').then(setFlat).catch((e) => toast(e.message));
    api.get('/me/month-state').then(setMonth).catch((e) => toast(e.message));
    api.get('/me/credits').then(setCredits).catch(() => {});
    api.get('/me/notices').then(setNotices).catch(() => {});
    api.get('/me/payments').then(setPayments).catch(() => {});
    api.get('/me/ledger').then((l) => setLedger(l.ledger)).catch(() => {});
    api.get('/me/building-payment-info').then((b) => setBuildingName(b.name)).catch(() => {});
    // Stays null for every flat without an admin-flagged Previous Pending
    // balance — the Outstanding Summary card below only renders when set.
    api.get('/me/previous-dues').then((d) => setPreviousDue(d.active ? d : null)).catch(() => {});
  }, []);

  if (!flat || !month) return <Layout customHeader={<DashboardSkeleton />} navOverride={residentNavLinks()} />;

  const g = greeting();
  const now = new Date();
  const ct = credits?.totals || { available: 0, used: 0, pending: 0 };
  const required = flat.monthly_amount;
  const collectionPct = required > 0 ? Math.round((month.paid / required) * 100) : 100;
  const pctOf = (n) => (required > 0 ? Math.min(100, (n / required) * 100) : 0);

  // real, data-derived mini-graphs (same approach as the Building Dashboard):
  // paid/due are reconstructed from this flat's own ledger history per month;
  // advance balance is read straight off each month's actual running balance.
  const window6 = last6Months();
  const paidTrend = window6.map(({ m, y }) =>
    (ledger || [])
      .filter((r) => r.month === m && r.year === y && (r.type === 'payment' || r.type === 'advance_used'))
      .reduce((s, r) => s + r.credit, 0)
  );
  const dueTrend = paidTrend.map((p) => Math.max(0, required - p));
  const advanceTrend = window6.map(({ m, y }) => {
    const eom = new Date(y, m, 0).toISOString().slice(0, 10);
    const upto = (ledger || []).filter((r) => r.date <= eom);
    return upto.length ? upto[upto.length - 1].advanceRemaining : 0;
  });

  const recentPayments = payments.slice(0, 5);
  const recentNotices = notices.slice(0, 5);

  const customHeader = (
    <div className="dhh">
      <div className="dhh-row">
        <div className="dhh-brand">
          <Link to="/me" className="dhh-logo-link" aria-label="Society Ledger">
            <Logo className="dhh-logo-img" />
          </Link>
          <span className="dhh-divider" />
          <div>
            <div className="dhh-name">Flat {flat.number}</div>
            <div className="dhh-sub">{buildingName || 'Your building'}{flat.resident_name ? ` · ${flat.resident_name}` : ''}</div>
          </div>
        </div>
        <div className="dhh-greeting">
          <div className="dhh-greeting-text">{g.text} <span className="dhh-greeting-icon">{g.icon}</span></div>
          <div className="dhh-sub">Here's your maintenance overview</div>
        </div>
        <div className="dhh-actions">
          <button className="btn primary sm" onClick={() => nav('/me/pay')}>+ Pay maintenance</button>
          <button className="dhh-icon-btn" onClick={() => nav('/me/notices')} aria-label="Notices" data-label="Notices">
            {Icons.bell}
            {notices.length > 0 && <span className="dhh-badge">{notices.length}</span>}
          </button>
          <MoreMenu
            icon={Icons.user}
            label="Account"
            triggerClassName="dhh-icon-btn"
            items={[
              { label: 'Profile', onClick: () => nav('/me/profile') },
              { label: 'Change password', onClick: () => nav('/change-password') },
              { label: 'Sign out', onClick: logout },
            ]}
          />
        </div>
      </div>
    </div>
  );

  const miniCards = [
    { label: 'Monthly Maintenance', value: inr(flat.monthly_amount), icon: Icons.rupee, tone: 'tone-blue', to: '/me/pay' },
    { label: 'Advance Balance', value: inr(month.advance), icon: Icons.wallet, tone: 'tone-teal', to: '/me/ledger' },
    { label: 'Available Credit', value: inr(ct.available), icon: Icons.card, tone: 'tone-violet', to: '/me/credits' },
    { label: 'Used Credit', value: inr(ct.used), icon: Icons.check, tone: 'tone-blue', to: '/me/credits' },
  ];

  return (
    <Layout customHeader={customHeader} navOverride={residentNavLinks()}>
      <div className="dh-hero-row">
        <div className="dh-hero-card">
          <span className="dh-hero-pct">{collectionPct}%</span>
          <div className="dh-hero-icon tone-teal">{Icons.download}</div>
          <div className="dh-hero-label">Paid This Month</div>
          <div className="dh-hero-value num">{inr(month.paid)}</div>
          <div className="dh-hero-sub">of {inr(month.required)} required</div>
          <MiniBars values={paidTrend} color="var(--dh-teal)" />
        </div>

        <div className="dh-hero-card">
          <div className="dh-hero-icon tone-violet">{Icons.clock}</div>
          <div className="dh-hero-label">Current Due</div>
          <div className="dh-hero-value num">{inr(month.due)}</div>
          <div className="dh-hero-sub">Amount yet to be paid</div>
          <TrendWave values={dueTrend} color="var(--dh-violet)" />
        </div>

        <div className="dh-hero-card">
          <div className="dh-hero-icon tone-blue">{Icons.wallet}</div>
          <div className="dh-hero-label">Advance Balance</div>
          <div className="dh-hero-value num">{inr(month.advance)}</div>
          <div className="dh-hero-sub">Carried forward credit</div>
          <TrendWave values={advanceTrend} color="var(--dh-blue)" dot />
        </div>
      </div>

      <div className="glass dh-flatwise">
        <div className="dh-flatwise-head">
          <strong className="dh-flatwise-title"><span className="dh-title-bar" />This Month's Maintenance · {MONTHS[now.getMonth()]}</strong>
          <StatusChip status={month.status} advance={month.advance} />
        </div>
        <div className="dh-meter" aria-label="Payment progress">
          <i className="dh-m-paid" style={{ width: pctOf(month.paid) + '%' }} />
          <i className="dh-m-due" style={{ width: pctOf(month.due) + '%' }} />
        </div>
        <div className="dh-flatwise-foot">
          <div className="dh-legend">
            <span><i className="dot dot-paid" />Paid {inr(month.paid)}</span>
            <span><i className="dot dot-due" />Due {inr(month.due)}</span>
          </div>
          <div className="dh-progress-line">Collection Progress <strong>{collectionPct}%</strong> {Icons.trendUp}</div>
        </div>
      </div>

      {/* Only ever rendered once a building admin has entered a Previous
          Pending record for this flat — every other resident's dashboard
          ends here, unchanged. */}
      {previousDue && (
        <div className="glass dh-flatwise" style={{ marginBottom: 16 }}>
          <div className="dh-flatwise-head">
            <strong className="dh-flatwise-title"><span className="dh-title-bar dh-title-bar-due" />Outstanding Summary</strong>
          </div>
          <div className="dh-legend" style={{ marginBottom: 12 }}>
            <span><i className="dot dot-due" />Previous Pending {inr(previousDue.totals.remaining)}</span>
            <span><i className="dot dot-partial" />Current Maintenance {inr(month.due)}</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>
            Total Outstanding <span className="num">{inr(previousDue.totals.remaining + month.due)}</span>
          </div>
          <div className="dh-flat-list">
            {previousDue.rows.filter((r) => r.remaining > 0).map((r) => (
              <div key={r.id} className="dh-flat-row">
                <div className="dh-flat-icon tone-violet">{Icons.history}</div>
                <div className="dh-flat-info">
                  <div className="dh-flat-number">{r.category === 'maintenance' ? `${r.months} months maintenance` : r.label}</div>
                  <div className="dh-flat-resident">{r.notes || (r.category === 'maintenance' ? `${r.months} months pending` : r.label)}</div>
                </div>
                <div className="dh-flat-right">
                  <div className="dh-flat-amount num">{inr(r.remaining)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dh-mini-row">
        {miniCards.map((c) => (
          <Link key={c.label} to={c.to} className="dh-mini-card">
            <div className={'dh-mini-icon ' + c.tone}>{c.icon}</div>
            <div className="dh-mini-body">
              <div className="dh-mini-label">{c.label}</div>
              <div className="dh-mini-value num">{c.value}</div>
            </div>
            <span className="dh-mini-arrow">{Icons.chevronRight}</span>
          </Link>
        ))}
      </div>

      <div className="dh-lists-row">
        <div className="glass dh-list-card">
          <div className="dh-list-head">
            <strong className="dh-flatwise-title"><span className="dh-title-bar dh-title-bar-paid" />Recent Payments</strong>
            <div className="dh-list-sub">Your last maintenance payments</div>
          </div>
          {recentPayments.length === 0 ? (
            <div className="dh-list-empty">{Icons.check} No payments recorded yet</div>
          ) : (
            <div className="dh-flat-list">
              {recentPayments.map((p) => (
                <div key={p.id} className="dh-flat-row">
                  <div className="dh-flat-icon tone-teal">{Icons.receipt}</div>
                  <div className="dh-flat-info">
                    <div className="dh-flat-number">{MONTHS[p.month - 1]} {p.year}</div>
                    <div className="dh-flat-resident">{p.paid_on} · {p.method}</div>
                  </div>
                  <div className="dh-flat-right">
                    <div className="dh-flat-amount num">{inr(p.amount)}</div>
                    <span className="dh-status-pill status-paid">{Icons.check} Paid</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass dh-list-card">
          <div className="dh-list-head">
            <strong className="dh-flatwise-title"><span className="dh-title-bar dh-title-bar-due" />Recent Notices</strong>
            <div className="dh-list-sub">Latest updates from your building</div>
          </div>
          {recentNotices.length === 0 ? (
            <div className="dh-list-empty">{Icons.check} No notices yet</div>
          ) : (
            <div className="dh-flat-list">
              {recentNotices.map((n) => (
                <div key={n.id} className="dh-flat-row">
                  <div className="dh-flat-icon tone-violet">{Icons.bell}</div>
                  <div className="dh-flat-info">
                    <div className="dh-flat-number">{n.title}</div>
                    <div className="dh-flat-resident">{n.body}</div>
                  </div>
                  <div className="dh-flat-right">
                    <div className="dh-flat-date">{n.createdAt?.slice(0, 10)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="dh-footer">{Icons.shield} All amounts are in INR</div>
    </Layout>
  );
}
