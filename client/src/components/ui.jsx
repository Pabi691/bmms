import React, { createContext, useContext, useState, useCallback } from 'react';
import { NavLink, useParams, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

/* ---------- minimal inline icon set ---------- */
const I = ({ d }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
export const Icons = {
  home: <I d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />,
  building: <I d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M4 21h16M8 7h2m-2 4h2m-2 4h2m6-2h2a2 2 0 0 1 2 2v6" />,
  rupee: <I d="M6 4h12M6 8h12M14.5 8a4.5 4.5 0 0 1-4.5 4.5H6l8 7.5" />,
  expense: <I d="M4 7h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M9 13h6" />,
  fund: <I d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />,
  sheet: <I d="M5 3h10l4 4v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 12h6m-6 4h6" />,
  ledger: <I d="M6 3h12a1 1 0 0 1 1 1v16l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1zM9 8h6m-6 4h4" />,
  sun: <I d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-15v2m0 16v2M4 12H2m20 0h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />,
  moon: <I d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z" />,
  back: <I d="M15 5l-7 7 7 7" />,
  wallet: <I d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4M3 7l4-4h9M15 13h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a2 2 0 0 1 0-4z" />,
  check: <I d="M4 12.5 9.5 18 20 6" />,
  alert: <I d="M12 3 2 20h20L12 3zm0 6.5v5M12 17h.01" />,
  edit: <I d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  trash: <I d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16ZM10 11v6M14 11v6" />,
  archive: <I d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />,
  history: <I d="M12 8v4l2.5 2.5M20.5 12a8.5 8.5 0 1 1-2.6-6.12M20.5 3v5h-5" />,
  shield: <I d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />,
  upload: <I d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  bell: <I d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9zM9.5 17a2.5 2.5 0 0 0 5 0" />,
  receipt: <I d="M6 3h12v18l-2.5-1.5L13 21l-2-1.5L9 21l-2.5-1.5L4 21V5a2 2 0 0 1 2-2zM8 8h8M8 12h8M8 16h5" />,
  user: <I d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />,
  logout: <I d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  cog: <I d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 12a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h5l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" />,
};

/* ---------- toast ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const toast = useCallback((m) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

/* ---------- theme toggle ---------- */
export function ThemeToggle({ compact }) {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('bmms-theme', next);
    setTheme(next);
  };
  return (
    <button className={'switch' + (theme === 'dark' ? ' on' : '')} onClick={flip} aria-label="Switch theme" data-label="Switch theme">
      <span className="track" />
      {!compact && <span className="sw-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>}
    </button>
  );
}

/* ---------- radial gauge (single-value progress ring) ---------- */
export function RadialGauge({ percent = 0, size = 128, stroke = 12, color = 'var(--adv)', value, label }) {
  const pct = Math.max(0, Math.min(100, percent));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="g-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="g-arc" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke}
          stroke={color} strokeDasharray={`${(pct / 100) * c} ${c}`}
        />
      </svg>
      <div className="g-center">
        <div className="g-value" style={{ fontSize: size * 0.19 }}>{value ?? `${Math.round(pct)}%`}</div>
        {label && <div className="g-label">{label}</div>}
      </div>
    </div>
  );
}

export const residentNavLinks = () => [
  { to: '/me', label: 'Dashboard', icon: Icons.home, end: true },
  { to: '/me/pay', label: 'Pay maintenance', icon: Icons.rupee, short: 'Pay' },
  { to: '/me/ledger', label: 'My ledger', icon: Icons.ledger, short: 'Ledger' },
  { to: '/me/receipts', label: 'Receipts', icon: Icons.receipt },
  { to: '/me/notices', label: 'Notices', icon: Icons.bell },
  { to: '/me/profile', label: 'Profile', icon: Icons.user },
];

/* ---------- layout with sidebar (desktop) + bottom nav (mobile) ---------- */
export function Layout({ children, title, sub, actions, backTo, navOverride }) {
  const { buildingId } = useParams();
  const { logout } = useAuth();
  const links = navOverride || (buildingId
    ? [
        { to: `/b/${buildingId}`, label: 'Dashboard', icon: Icons.home, end: true },
        { to: `/b/${buildingId}/flats`, label: 'Flats', icon: Icons.building },
        { to: `/b/${buildingId}/payments`, label: 'Payments', icon: Icons.rupee },
        { to: `/b/${buildingId}/approvals`, label: 'Payment approvals', icon: Icons.check, short: 'Approvals' },
        { to: `/b/${buildingId}/expenses`, label: 'Expenses', icon: Icons.expense },
        { to: `/b/${buildingId}/funds`, label: 'Emergency fund', icon: Icons.fund, short: 'Fund' },
        { to: `/b/${buildingId}/notices`, label: 'Notices', icon: Icons.bell },
        { to: `/b/${buildingId}/sheets`, label: 'Google Sheet', icon: Icons.sheet, short: 'Sheet' },
      ]
    : [{ to: '/admin/buildings', label: 'Buildings', icon: Icons.building, end: true, short: 'Buildings' }]);
  // separate from the `backTo` topbar button below — this sidebar link exits
  // the building context entirely, back to the buildings list.
  const showBuildingsLink = buildingId && !navOverride;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand" data-label="Society Ledger">{Icons.ledger}</div>
        <nav className="nav-pill">
          {showBuildingsLink && (
            <NavLink to="/" className="navlink" data-label="All buildings" aria-label="All buildings">{Icons.back}</NavLink>
          )}
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} data-label={l.label} aria-label={l.label}
              className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
              {l.icon}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <button className="navlink" onClick={logout} data-label="Sign out" aria-label="Sign out">{Icons.logout}</button>
          <ThemeToggle compact />
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {backTo && <Link to={backTo} className="btn sm" aria-label="Back">{Icons.back}</Link>}
            <div style={{ minWidth: 0 }}>
              <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h1>
              {sub && <div className="sub">{sub}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="mobile-theme"><ThemeToggle /></span>
            {actions}
          </div>
        </div>
        {children}
      </main>

      <nav className="bottomnav">
        {links.slice(0, 5).map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.icon}<span>{l.short || l.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/* ---------- modal bottom-sheet ---------- */
export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function StatusChip({ status, advance }) {
  const map = { paid: 'Paid', partial: 'Partially paid', due: 'Due' };
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      <span className={'chip ' + status}>{map[status] || status}</span>
      {advance > 0 && <span className="chip advance">Advance</span>}
    </span>
  );
}

export function Empty({ title, hint }) {
  return <div className="empty glass"><b>{title}</b>{hint}</div>;
}
