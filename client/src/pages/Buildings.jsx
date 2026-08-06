import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, inr } from '../api.js';
import { Layout, Modal, Empty, useToast, Icons, StatusChip } from '../components/ui.jsx';

const blank = { name: '', address: '', description: '', floors: '', total_flats: '', manager_name: '', contact: '', notes: '' };

export default function Buildings() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // null closed | object = create/edit
  const [adminModal, setAdminModal] = useState(null); // building being managed
  const nav = useNavigate();
  const toast = useToast();

  const load = () => api.get('/admin/buildings').then(setList).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) { await api.put(`/buildings/${form.id}`, form); toast('Building updated'); }
      else {
        const b = await api.post('/buildings', form);
        toast('Building created — now create its admin login');
        setForm(null); load();
        return;
      }
      setForm(null); load();
    } catch (err) { toast(err.message); }
  };

  const archive = async (b) => {
    if (!confirm(`Archive "${b.name}"? Its records are kept but it will be hidden.`)) return;
    await api.del(`/buildings/${b.id}`); toast('Building archived'); load();
  };

  const remove = async (b) => {
    if (!confirm(
      `Permanently delete "${b.name}"? This erases the building and EVERYTHING in it forever — ` +
      `all flats, payments, expenses, emergency funds, notices, and the admin + resident logins. This cannot be undone.`
    )) return;
    await api.del(`/buildings/${b.id}/permanent`); toast('Building permanently deleted'); load();
  };

  const toggleStatus = async (b) => {
    const next = b.status === 'suspended' ? 'active' : 'suspended';
    if (next === 'suspended' && !confirm(`Suspend "${b.name}"? Its admin and residents will be signed out and blocked from logging in until reactivated.`)) return;
    await api.post(`/admin/buildings/${b.id}/status`, { status: next });
    toast(next === 'suspended' ? 'Building suspended' : 'Building reactivated');
    load();
  };

  const filtered = (list || []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Layout
      title="My buildings"
      sub="Every building keeps its own flats, payments and balances"
      actions={<button className="btn primary" onClick={() => setForm({ ...blank })}>+ New building</button>}
    >
      <div className="searchbar">
        <input placeholder="Search buildings…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {list && filtered.length === 0 && (
        <Empty title="No buildings yet" hint="Create your first building to start tracking maintenance." />
      )}

      <div className="grid cards">
        {filtered.map((b) => (
          <div key={b.id} className="glass card-hover" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17 }}>{b.name}</h3>
                <div className="mut">{b.address || `Building #${b.id}`}</div>
              </div>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span className="mut num">{b.stats.flats} flats</span>
                {b.status === 'suspended' && <span className="chip due">Suspended</span>}
              </span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><div className="mut">Available balance</div><div className="num" style={{ fontWeight: 700 }}>{inr(b.stats.availableBalance)}</div></div>
              <div><div className="mut">This month collected</div><div className="num" style={{ fontWeight: 700, color: 'var(--ok)' }}>{inr(b.stats.collectedMonth)}</div></div>
              <div><div className="mut">Pending</div><div className="num" style={{ fontWeight: 700, color: b.stats.pendingMonth > 0 ? 'var(--bad)' : 'inherit' }}>{inr(b.stats.pendingMonth)}</div></div>
              <div><div className="mut">Emergency fund</div><div className="num" style={{ fontWeight: 700, color: 'var(--adv)' }}>{inr(b.stats.emergencyFund)}</div></div>
            </div>
            <div className="mut">
              Admin login: {b.admin ? <strong style={{ color: 'var(--text)' }}>{b.admin.username}</strong> : <em>not created yet</em>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <button className="btn primary sm" style={{ flex: 1 }} onClick={() => nav(`/b/${b.id}`)}>Open dashboard</button>
              <button className="btn sm" onClick={() => setAdminModal(b)}>Admin login</button>
              <button className="btn sm icon-only" onClick={() => setForm({ ...blank, ...b })} data-label="Edit" aria-label="Edit">{Icons.edit}</button>
              <button className="btn sm icon-only" onClick={() => toggleStatus(b)} data-label={b.status === 'suspended' ? 'Reactivate' : 'Suspend'} aria-label="Suspend/Activate">{Icons.shield}</button>
              <button className="btn sm icon-only danger" onClick={() => archive(b)} data-label="Archive" aria-label="Archive">{Icons.archive}</button>
              <button className="btn sm icon-only danger" onClick={() => remove(b)} data-label="Delete" aria-label="Delete">{Icons.trash}</button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit building' : 'Create building'}>
        {form && (
          <form onSubmit={save}>
            <div className="field"><label>Building name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>Address</label>
              <input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="form-row">
              <div className="field"><label>Total floors</label>
                <input type="number" min="0" value={form.floors || ''} onChange={(e) => setForm({ ...form, floors: e.target.value })} /></div>
              <div className="field"><label>Total flats</label>
                <input type="number" min="0" value={form.total_flats || ''} onChange={(e) => setForm({ ...form, total_flats: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Manager name</label>
                <input value={form.manager_name || ''} onChange={(e) => setForm({ ...form, manager_name: e.target.value })} /></div>
              <div className="field"><label>Contact number</label>
                <input value={form.contact || ''} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
            </div>
            <div className="field"><label>Description</label>
              <textarea rows="2" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="field"><label>Notes</label>
              <textarea rows="2" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn primary">{form.id ? 'Save changes' : 'Create building'}</button>
            </div>
          </form>
        )}
      </Modal>

      <BuildingAdminModal building={adminModal} onClose={() => setAdminModal(null)} onChange={load} />
    </Layout>
  );
}

function BuildingAdminModal({ building, onClose, onChange }) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState(null);

  useEffect(() => { setUsername(''); setFullName(''); setGeneratedPassword(null); }, [building]);

  if (!building) return null;
  const admin = building.admin;

  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`/admin/buildings/${building.id}/admins`, { username, full_name: fullName || undefined });
      setGeneratedPassword(r.password);
      onChange();
    } catch (err) { toast(err.message); }
  };

  const resetPassword = async () => {
    if (!confirm(`Reset the password for "${admin.username}"? They'll be signed out everywhere and must change it on next login.`)) return;
    const r = await api.post(`/admin/users/${admin.id}/reset-password`);
    setGeneratedPassword(r.password);
  };

  const toggleAdminStatus = async () => {
    const next = admin.status === 'suspended' ? 'active' : 'suspended';
    await api.put(`/admin/users/${admin.id}`, { status: next });
    toast(next === 'suspended' ? 'Admin login suspended' : 'Admin login reactivated');
    onChange();
  };

  return (
    <Modal open={!!building} onClose={onClose} title={`${building.name} · admin login`}>
      {generatedPassword && (
        <div className="glass" style={{ padding: 14, marginBottom: 16, borderColor: 'var(--adv)' }}>
          <strong>Save this password now — it won't be shown again:</strong>
          <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 8, userSelect: 'all' }}>{generatedPassword}</div>
        </div>
      )}
      {admin ? (
        <div className="list">
          <div className="glass" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{admin.username}</strong>
                <div className="mut">{admin.fullName || '—'}</div>
              </div>
              <StatusChip status={admin.status === 'active' ? 'paid' : 'due'} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={resetPassword}>Reset password</button>
            <button className="btn" onClick={toggleAdminStatus}>{admin.status === 'suspended' ? 'Reactivate' : 'Suspend'} login</button>
          </div>
        </div>
      ) : (
        <form onSubmit={create}>
          <div className="mut" style={{ marginBottom: 14 }}>No admin login exists for this building yet.</div>
          <div className="field"><label>Username *</label>
            <input required value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="e.g. kalinditwina" /></div>
          <div className="field"><label>Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn primary">Create admin login</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
