import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icons, Logo } from '../components/ui.jsx';

const SPLASH_MS = 2500;

const ROLES = [
  { to: '/login/master', label: 'Master Login', desc: 'Full control over every building', icon: Icons.shield },
  { to: '/login/building', label: 'Building Login', desc: "Manage your building's finances", icon: Icons.building },
  { to: '/login/flat', label: 'Flat Login', desc: 'View your maintenance & payments', icon: Icons.home },
];

export default function LoginGateway() {
  const { user } = useAuth();
  const location = useLocation();
  const [phase, setPhase] = useState('splash');

  useEffect(() => {
    const t = setTimeout(() => setPhase('select'), SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  if (user) return <Navigate to={location.state?.from?.pathname || '/'} replace />;

  if (phase === 'splash') {
    return (
      <div className="splash" onClick={() => setPhase('select')}>
        <Logo className="splash-logo-img" />
        <h1 className="splash-title">Welcome to Society Ledger</h1>
        <div className="splash-hint mut">Tap to continue</div>
      </div>
    );
  }

  return (
    <div className="role-select">
      <div className="role-select-brand">
        <Logo className="gateway-logo-img" />
        <div className="mut">Choose how you'd like to sign in</div>
      </div>
      <div className="role-cards">
        {ROLES.map((r, i) => (
          <Link key={r.to} to={r.to} className="role-card glass card-hover" style={{ animationDelay: `${i * 0.12}s` }}>
            <span className="icon-badge b-adv">{r.icon}</span>
            <div>
              <strong>{r.label}</strong>
              <div className="mut">{r.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
