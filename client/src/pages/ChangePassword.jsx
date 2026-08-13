import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/ui.jsx';

export default function ChangePassword() {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) { setError('New passwords do not match'); return; }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast('Password changed');
      await refresh();
      nav('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="glass login-card">
        <h1 style={{ marginTop: 0, fontSize: 20 }}>Set a new password</h1>
        <div className="mut" style={{ marginBottom: 20 }}>
          {user?.mustChangePassword
            ? 'Your account was just created — choose a password only you know.'
            : 'Update your password below.'}
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Current password</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="field">
            <label>New password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required minLength={10} />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={10} />
          </div>
          <div className="mut" style={{ marginBottom: 12 }}>At least 10 characters, with both letters and numbers.</div>
          {error && <div className="mut" style={{ color: 'var(--bad)', marginBottom: 12 }}>{error}</div>}
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }} disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
          <button type="button" className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={logout}>
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
}
