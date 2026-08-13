import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, inr } from '../api.js';
import { Layout, Modal, Empty, useToast, Icons, StatusChip } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

const blank = { name: '', address: '', description: '', floors: '', total_flats: '', manager_name: '', contact: '', notes: '' };

// purely visual — gives each building card a recognizable identity at a
// glance (like an avatar color), cycled by list position, not real data
const ACCENTS = [
  { fg: '#3aa0ff', bg: 'rgba(58,160,255,.16)' },
  { fg: '#2dd4a7', bg: 'rgba(45,212,167,.16)' },
  { fg: '#f5b84d', bg: 'rgba(245,184,77,.16)' },
  { fg: '#b48bff', bg: 'rgba(180,139,255,.16)' },
];

const STATUS_FILTERS = [
  { key: 'all', label: 'All buildings' },
  { key: 'active', label: 'Active only' },
  { key: 'suspended', label: 'Suspended only' },
];

export default function Buildings() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [form, setForm] = useState(null); // null closed | object = create/edit
  const [adminModal, setAdminModal] = useState(null); // building being managed
  const nav = useNavigate();
  const toast = useToast();
  const { logout } = useAuth();

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

  const filtered = (list || []).filter((b) =>
    b.name.toLowerCase().includes(q.toLowerCase()) &&
    (statusFilter === 'all' || (b.status || 'active') === statusFilter)
  );

  return (
    <Layout
      title="My buildings"
      sub="Every building keeps its own flats, payments and balances"
      actions={<button className="btn primary" onClick={() => setForm({ ...blank })}>+ New building</button>}
      headerIcon={Icons.building}
      mobileExtra={<button className="btn primary sm" onClick={() => setForm({ ...blank })}>+ New building</button>}
      more={[{ label: 'Sign out', onClick: logout }]}
    >
      <div className="buildings-search-row">
        <div className="searchbar">
          <input placeholder="Search buildings…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="filter-wrap" tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFilterOpen(false); }}>
          <button className="btn icon-only" onClick={() => setFilterOpen((o) => !o)} data-label="Filter" aria-label="Filter" aria-expanded={filterOpen}>{Icons.filter}</button>
          {filterOpen && (
            <div className="filter-menu">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} className={statusFilter === f.key ? 'active' : ''} onClick={() => { setStatusFilter(f.key); setFilterOpen(false); }}>
                  {f.label}{statusFilter === f.key && Icons.check}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {list && filtered.length === 0 && (list.length === 0 ? (
        <Empty title="No buildings yet" hint="Create your first building to start tracking maintenance." />
      ) : (
        <Empty title="No buildings match" hint="Try a different search or switch the filter back to All buildings." />
      ))}

      <div className="grid cards">
        {filtered.map((b, i) => {
          const accent = ACCENTS[i % ACCENTS.length];
          return (
            <div key={b.id} className="glass card-hover building-card">
              <div className="bc-head">
                <div className="bc-avatar" style={{ background: accent.bg, color: accent.fg }}>{Icons.building}</div>
                <div className="bc-name-block">
                  <h3>{b.name}</h3>
                  <div className="mut">{b.address || `Building #${b.id}`}</div>
                </div>
                <div className="bc-badges">
                  <span className="bc-flats-pill" style={{ background: accent.bg, color: accent.fg }}>{b.stats.flats} flat{b.stats.flats === 1 ? '' : 's'}</span>
                  {b.status === 'suspended' && <span className="chip due">Suspended</span>}
                </div>
              </div>
              <div className="bc-stats">
                <div><div className="lbl">Available balance</div><div className="val">{inr(b.stats.availableBalance)}</div></div>
                <div><div className="lbl">This month collected</div><div className="val" style={{ color: 'var(--ok)' }}>{inr(b.stats.collectedMonth)}</div></div>
                <div><div className="lbl">Pending</div><div className="val" style={{ color: b.stats.pendingMonth > 0 ? 'var(--bad)' : 'var(--ok)' }}>{inr(b.stats.pendingMonth)}</div></div>
                <div><div className="lbl">Emergency fund</div><div className="val" style={{ color: 'var(--adv)' }}>{inr(b.stats.emergencyFund)}</div></div>
              </div>
              <div className="bc-admin">
                Admin login: {b.admin ? <strong>{b.admin.username}</strong> : <em>not created yet</em>}
              </div>
              <div className="bc-actions">
                <div className="bc-actions-primary">
                  <button className="btn primary sm" onClick={() => nav(`/b/${b.id}`)}>Open dashboard</button>
                  <button className="btn sm" onClick={() => setAdminModal(b)}>Admin login</button>
                </div>
                <div className="bc-actions-icons">
                  <button className="btn sm icon-only" onClick={() => setForm({ ...blank, ...b })} data-label="Edit" aria-label="Edit">{Icons.edit}</button>
                  <button className="btn sm icon-only" onClick={() => toggleStatus(b)} data-label={b.status === 'suspended' ? 'Reactivate' : 'Suspend'} aria-label="Suspend/Activate">{Icons.shield}</button>
                  <button className="btn sm icon-only danger" onClick={() => archive(b)} data-label="Archive" aria-label="Archive">{Icons.archive}</button>
                  <button className="btn sm icon-only danger" onClick={() => remove(b)} data-label="Delete" aria-label="Delete">{Icons.trash}</button>
                </div>
              </div>
            </div>
          );
        })}
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
