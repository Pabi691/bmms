import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Icons, Logo } from './ui.jsx';

// Shared by MasterLogin/BuildingLogin/FlatLogin — each passes the role its
// page is meant for. After a successful password check, if the account's
// actual role doesn't match, the session is immediately dropped again and
// the user is told to use the correct login option, rather than silently
// letting e.g. a building admin's credentials in through the Flat Login page.
export default function LoginForm({ expectedRole, roleLabel, subtitle, icon, usernameLabel = 'Username' }) {
  const { user, login, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Handles the "already signed in, visited this URL directly" case. Deliberately
  // NOT a reactive `if (user) return <Navigate/>` — that would also fire the
  // instant our own submit() below calls login(), racing ahead of the role
  // check and redirecting home before the mismatch-triggered logout() runs.
  const skipAutoRedirect = useRef(false);
  useEffect(() => {
    if (user && !skipAutoRedirect.current) {
      nav(location.state?.from?.pathname || '/', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    skipAutoRedirect.current = true;
    try {
      const loggedIn = await login(username, password);
      if (loggedIn.role !== expectedRole) {
        await logout();
        setError(`That account isn't a ${roleLabel} — please go back and choose the right login.`);
        skipAutoRedirect.current = false;
        return;
      }
      nav(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err.message);
      skipAutoRedirect.current = false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="glass login-card">
        <Link to="/login" className="btn sm icon-only" data-label="Back" aria-label="Back" style={{ marginBottom: 14 }}>{Icons.back}</Link>
        <Logo className="gateway-logo-img" style={{ marginBottom: 18 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <div className="brand" style={{ marginBottom: 0 }}>{icon}</div>
          <h1 style={{ margin: 0, fontSize: 20 }}>{roleLabel}</h1>
          <div className="mut">{subtitle}</div>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label>{usernameLabel}</label>
            <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {error && <div className="mut" style={{ color: 'var(--bad)', marginBottom: 12 }}>{error}</div>}
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
