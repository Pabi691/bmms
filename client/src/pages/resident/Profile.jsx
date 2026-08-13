import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { Layout, useToast, residentNavLinks, Icons } from '../../components/ui.jsx';

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const toast = useToast();
  const nav = useNavigate();

  const load = () => api.get('/me/profile').then(setProfile).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put('/me/profile', { email: profile.email, mobile: profile.mobile });
      toast('Profile updated');
    } catch (err) { toast(err.message); }
  };

  if (!profile) return <Layout title="Loading…" navOverride={residentNavLinks()} />;

  return (
    <Layout title="Profile" sub="Your account details" navOverride={residentNavLinks()} headerIcon={Icons.user}>
      <div className="glass" style={{ maxWidth: 460 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span className="icon-badge b-credit">{Icons.user}</span>
          <strong style={{ fontSize: 15 }}>Account details</strong>
        </div>
        <form onSubmit={save}>
          <div className="field"><label>Username</label>
            <input value={profile.username} disabled /></div>
          <div className="field"><label>Full name</label>
            <input value={profile.full_name || ''} disabled /></div>
          <div className="field"><label>Mobile number</label>
            <input value={profile.mobile || ''} onChange={(e) => setProfile({ ...profile, mobile: e.target.value })} /></div>
          <div className="field"><label>Email</label>
            <input type="email" value={profile.email || ''} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></div>
          <div className="mut" style={{ marginBottom: 14 }}>Name and username are managed by your building admin.</div>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}>Save changes</button>
          <button type="button" className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => nav('/change-password')}>
            Change password
          </button>
        </form>
      </div>
    </Layout>
  );
}
