import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, inr, MONTHS } from '../api.js';
import { Layout, useToast, Icons, MoreMenu, Logo } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

const YEARS = (() => {
  const y = new Date().getFullYear();
  return [y - 1, y, y + 1];
})();

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: 'Good Morning!', icon: Icons.sun };
  if (h < 17) return { text: 'Good Afternoon!', icon: Icons.sun };
  return { text: 'Good Evening!', icon: Icons.moon };
}

// real trend line — points are derived from actual transaction history
// (see buildDashboardSeries below), not decorative random data
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

export default function Dashboard() {
  const { buildingId } = useParams();
  const [s, setS] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const now = new Date();
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const [selYear, setSelYear] = useState(now.getFullYear());
  const nav = useNavigate();
  const toast = useToast();
  const { logout } = useAuth();

  useEffect(() => {
    api.get(`/buildings/${buildingId}/summary?month=${selMonth}&year=${selYear}`).then(setS).catch((e) => toast(e.message));
  }, [buildingId, selMonth, selYear]);

  useEffect(() => {
    api.get(`/buildings/${buildingId}/payment-submissions?status=pending`).then((rows) => setPendingApprovals(rows.length)).catch(() => {});
  }, [buildingId]);

  if (!s) return <Layout title="Loading…" backTo="/"><div className="empty">Fetching building data…</div></Layout>;
  const t = s.totals;
  const paidCount = s.flatStates.filter((f) => f.status === 'paid').length;
  const partCount = s.flatStates.filter((f) => f.status === 'partial').length;
  const dueCount = s.flatStates.length - paidCount - partCount;
  const pct = (n) => (s.flatStates.length ? (n / s.flatStates.length) * 100 : 0);
  const collectionPct = t.expected > 0 ? Math.round((t.collectedMonth / t.expected) * 100) : 0;

  const byNumber = (a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
  const paidFlats = s.flatStates.filter((f) => f.status === 'paid').sort(byNumber);
  const pendingFlats = s.flatStates.filter((f) => f.status !== 'paid').sort(byNumber);

  // real, data-derived mini-graphs — not decorative random shapes:
  // bank-balance trend reconstructed backward from today's true balance
  // using each month's real net (income - expense); collected-per-month and
  // pending-per-month use the same 6-month real payment/expense series the
  // app already tracks (buildingSummary's `series`, month-anchored to the
  // selected month/year).
  const netByMonth = s.series.map((m) => m.income - m.expense);
  const bankTrend = new Array(netByMonth.length);
  bankTrend[bankTrend.length - 1] = t.availableBalance;
  for (let i = bankTrend.length - 2; i >= 0; i--) bankTrend[i] = bankTrend[i + 1] - netByMonth[i + 1];
  const collectedTrend = s.series.map((m) => m.income);
  const pendingTrend = s.series.map((m) => Math.max(0, t.expected - m.income));

  const g = greeting();

  const monthPicker = (
    <div className="month-picker" tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setMonthPickerOpen(false); }}>
      <button className="month-picker-btn" onClick={() => setMonthPickerOpen((o) => !o)} aria-expanded={monthPickerOpen}>
        {Icons.calendar}
        <span>{MONTHS[selMonth - 1]} {selYear}</span>
        {Icons.chevronRight}
      </button>
      {monthPickerOpen && (
        <div className="month-picker-menu">
          <select value={selYear} onChange={(e) => setSelYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <div className="mp-months">
            {MONTHS.map((m, i) => (
              <button key={m} className={selMonth === i + 1 ? 'active' : ''} onClick={() => { setSelMonth(i + 1); setMonthPickerOpen(false); }}>{m.slice(0, 3)}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const customHeader = (
    <div className="dhh">
      <div className="dhh-row">
        <div className="dhh-brand">
          <Link to="/" className="dhh-logo-link" aria-label="Society Ledger">
            <Logo className="dhh-logo-img" />
          </Link>
          <span className="dhh-divider" />
          <div>
            <div className="dhh-name">{s.building.name}</div>
            <div className="dhh-sub">{s.building.address || 'Apartment Management'}</div>
          </div>
        </div>
        <div className="dhh-greeting">
          <div className="dhh-greeting-text">{g.text} <span className="dhh-greeting-icon">{g.icon}</span></div>
          <div className="dhh-sub">Here's your collection summary at a glance</div>
        </div>
        <div className="dhh-actions">
          {monthPicker}
          <button className="dhh-icon-btn" onClick={() => nav(`/b/${buildingId}/approvals`)} aria-label="Pending approvals" data-label="Pending approvals">
            {Icons.bell}
            {pendingApprovals > 0 && <span className="dhh-badge">{pendingApprovals}</span>}
          </button>
          <MoreMenu
            icon={Icons.user}
            label="Account"
            triggerClassName="dhh-icon-btn"
            items={[
              { label: 'Change password', onClick: () => nav('/change-password') },
              { label: 'Sign out', onClick: logout },
            ]}
          />
        </div>
      </div>
    </div>
  );

  const miniCards = [
    { label: 'Total Flats', value: t.flats, icon: Icons.building, tone: 'tone-blue', to: `/b/${buildingId}/flats` },
    { label: 'Cash Balance', value: inr(t.cash), icon: Icons.wallet, tone: 'tone-teal', to: `/b/${buildingId}/payments` },
    { label: 'Bank Balance', value: inr(t.bank), icon: Icons.bank, tone: 'tone-blue', to: `/b/${buildingId}/payments` },
    { label: 'Total Pending', value: inr(t.pendingMonth), icon: Icons.clock, tone: 'tone-violet', to: `/b/${buildingId}/payments` },
  ];

  return (
    <Layout customHeader={customHeader}>
      <div className="dh-hero-row">
        <div className="dh-hero-card">
          <div className="dh-hero-icon tone-blue">{Icons.bank}</div>
          <div className="dh-hero-label">Available Bank Balance</div>
          <div className="dh-hero-value num">{inr(t.availableBalance)}</div>
          <div className="dh-hero-sub">Current balance in bank</div>
          <TrendWave values={bankTrend} color="var(--dh-blue)" dot />
        </div>

        <div className="dh-hero-card">
          <span className="dh-hero-pct">{collectionPct}%</span>
          <div className="dh-hero-icon tone-teal">{Icons.download}</div>
          <div className="dh-hero-label">Collected This Month</div>
          <div className="dh-hero-value num">{inr(t.collectedMonth)}</div>
          <div className="dh-hero-sub">of {inr(t.expected)} expected</div>
          <MiniBars values={collectedTrend} color="var(--dh-teal)" />
        </div>

        <div className="dh-hero-card">
          <div className="dh-hero-icon tone-violet">{Icons.clock}</div>
          <div className="dh-hero-label">Pending This Month</div>
          <div className="dh-hero-value num">{inr(t.pendingMonth)}</div>
          <div className="dh-hero-sub">Amount yet to be collected</div>
          <TrendWave values={pendingTrend} color="var(--dh-violet)" />
        </div>
      </div>

      <div className="glass dh-flatwise">
        <div className="dh-flatwise-head">
          <strong className="dh-flatwise-title"><span className="dh-title-bar" />Flat-wise Collection · {MONTHS[selMonth - 1]}</strong>
          <span className="dh-flats-paying-pill">{Icons.users} {paidCount + partCount} of {s.flatStates.length} flats paying</span>
        </div>
        <div className="dh-meter" aria-label="Collection progress">
          <i className="dh-m-paid" style={{ width: pct(paidCount) + '%' }} />
          <i className="dh-m-partial" style={{ width: pct(partCount) + '%' }} />
          <i className="dh-m-due" style={{ width: pct(dueCount) + '%' }} />
        </div>
        <div className="dh-flatwise-foot">
          <div className="dh-legend">
            <span><i className="dot dot-paid" />{paidCount} Paid</span>
            <span><i className="dot dot-partial" />{partCount} Partial</span>
            <span><i className="dot dot-due" />{dueCount} Due</span>
          </div>
          <div className="dh-progress-line">Collection Progress <strong>{collectionPct}%</strong> {Icons.trendUp}</div>
        </div>
      </div>

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
            <strong className="dh-flatwise-title"><span className="dh-title-bar dh-title-bar-paid" />Paid This Month</strong>
            <div className="dh-list-sub">Residents who have paid their maintenance</div>
          </div>
          {paidFlats.length === 0 ? (
            <div className="dh-list-empty">{Icons.check} No payments received yet</div>
          ) : (
            <div className="dh-flat-list">
              {paidFlats.map((f) => (
                <div key={f.id} className="dh-flat-row">
                  <div className="dh-flat-icon tone-teal">{Icons.building}</div>
                  <div className="dh-flat-info">
                    <div className="dh-flat-number">Flat {f.number}</div>
                    <div className="dh-flat-resident">{f.owner_name || f.resident_name || '—'}</div>
                  </div>
                  <div className="dh-flat-right">
                    <div className="dh-flat-amount num">{inr(f.paid)}</div>
                    {f.paidOn && <div className="dh-flat-date">{f.paidOn}</div>}
                    <span className="dh-status-pill status-paid">{Icons.check} Paid</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass dh-list-card">
          <div className="dh-list-head">
            <strong className="dh-flatwise-title"><span className="dh-title-bar dh-title-bar-due" />Pending Flats</strong>
            <div className="dh-list-sub">Maintenance payments still pending</div>
          </div>
          {pendingFlats.length === 0 ? (
            <div className="dh-list-empty">{Icons.check} All maintenance payments are up to date</div>
          ) : (
            <div className="dh-flat-list">
              {pendingFlats.map((f) => (
                <div key={f.id} className="dh-flat-row">
                  <div className={'dh-flat-icon ' + (f.status === 'partial' ? 'tone-blue' : 'tone-violet')}>{Icons.building}</div>
                  <div className="dh-flat-info">
                    <div className="dh-flat-number">Flat {f.number}</div>
                    <div className="dh-flat-resident">{f.owner_name || f.resident_name || '—'}</div>
                    {f.status === 'partial' && <div className="dh-flat-split">Paid: {inr(f.paid)} · Pending: {inr(f.due)}</div>}
                  </div>
                  <div className="dh-flat-right">
                    {f.status !== 'partial' && <div className="dh-flat-amount num">{inr(f.due)} pending</div>}
                    <span className={'dh-status-pill ' + (f.status === 'partial' ? 'status-partial' : 'status-due')}>
                      {f.status === 'partial' ? 'Partial' : <>{Icons.alert} Due</>}
                    </span>
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
