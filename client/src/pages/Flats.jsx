import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api, inr } from '../api.js';
import { Layout, Modal, StatusChip, Empty, useToast, Icons } from '../components/ui.jsx';

const blank = { number: '', monthly_amount: '', owner_name: '', resident_name: '', mobile: '', floor: '', size_sqft: '', notes: '' };

export default function Flats() {
  const { buildingId } = useParams();
  const [params, setParams] = useSearchParams();
  const [flats, setFlats] = useState(null);
  const [residents, setResidents] = useState([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('number');
  const [form, setForm] = useState(params.get('add') ? { ...blank } : null);
  const [loginFlat, setLoginFlat] = useState(null); // flat being managed in the resident-login modal
  const toast = useToast();

  const load = () => {
    api.get(`/buildings/${buildingId}/flats`).then(setFlats).catch((e) => toast(e.message));
    api.get(`/buildings/${buildingId}/residents`).then(setResidents).catch(() => {});
  };
  useEffect(() => { load(); }, [buildingId]);

  const residentByFlat = useMemo(() => {
    const m = new Map();
    for (const u of residents) m.set(u.flatId, u);
    return m;
  }, [residents]);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) { await api.put(`/flats/${form.id}`, form); toast('Flat updated'); }
      else { await api.post(`/buildings/${buildingId}/flats`, form); toast('Flat added'); }
      setForm(null); params.delete('add'); setParams(params); load();
    } catch (err) { toast(err.message); }
  };

  const archive = async (f) => {
    if (!confirm(`Archive flat ${f.number}? Its financial history is preserved.`)) return;
    await api.del(`/flats/${f.id}`); toast('Flat archived'); load();
  };

  const remove = async (f) => {
    if (!confirm(`Permanently delete flat ${f.number}? This erases it and ALL its payments, advance and ledger history forever. This cannot be undone.`)) return;
    await api.del(`/flats/${f.id}/permanent`); toast('Flat permanently deleted'); load();
  };

  const list = useMemo(() => {
    let l = (flats || []).filter((f) =>
      [f.number, f.owner_name, f.resident_name].join(' ').toLowerCase().includes(q.toLowerCase()));
    if (filter !== 'all') l = l.filter((f) => f.status === filter);
    l.sort((a, b) =>
      sort === 'due' ? b.due - a.due :
      sort === 'amount' ? b.monthly_amount - a.monthly_amount :
      String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
    return l;
  }, [flats, q, filter, sort]);

  return (
    <Layout title="Flats" sub="Residents, monthly amounts and current status" backTo={`/b/${buildingId}`}
      actions={<button className="btn primary" onClick={() => setForm({ ...blank })}>+ Add flat</button>}>

      <div className="searchbar">
        <input placeholder="Search flat, owner or resident…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="paid">Paid</option>
          <option value="partial">Partially paid</option>
          <option value="due">Due</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="number">Sort by flat</option>
          <option value="due">Sort by due</option>
          <option value="amount">Sort by amount</option>
        </select>
      </div>

      {flats && list.length === 0 && <Empty title="No flats found" hint="Add a flat with its monthly maintenance amount." />}

      {/* desktop table */}
      <div className="glass tablewrap" style={{ padding: 0 }}>
        <table className="data responsive">
          <thead><tr>
            <th>Flat</th><th>Owner / resident</th><th className="t-right">Monthly</th>
            <th>Status</th><th className="t-right">Due</th><th className="t-right">Advance</th><th></th>
          </tr></thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.id}>
                <td><strong>{f.number}</strong></td>
                <td>{f.owner_name || f.resident_name || '—'}<div className="mut">{f.mobile}</div></td>
                <td className="t-right num">{inr(f.monthly_amount)}</td>
                <td><StatusChip status={f.status} advance={f.advance} /></td>
                <td className="t-right num" style={{ color: f.due > 0 ? 'var(--bad)' : 'inherit' }}>{inr(f.due)}</td>
                <td className="t-right num" style={{ color: f.advance > 0 ? 'var(--adv)' : 'inherit' }}>{inr(f.advance)}</td>
                <td className="t-right" style={{ whiteSpace: 'nowrap' }}>
                  <Link className="btn sm icon-only" to={`/b/${buildingId}/flats/${f.id}/ledger`} data-label="Ledger" aria-label="Ledger">{Icons.ledger}</Link>{' '}
                  <button className="btn sm icon-only" onClick={() => setLoginFlat(f)} data-label="Resident login" aria-label="Resident login">{Icons.user}</button>{' '}
                  <button className="btn sm icon-only" onClick={() => setForm({ ...blank, ...f })} data-label="Edit" aria-label="Edit">{Icons.edit}</button>{' '}
                  <button className="btn sm icon-only danger" onClick={() => archive(f)} data-label="Archive" aria-label="Archive">{Icons.archive}</button>{' '}
                  <button className="btn sm icon-only danger" onClick={() => remove(f)} data-label="Delete" aria-label="Delete">{Icons.trash}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <div className="list" style={{ marginTop: 12 }}>
        {list.map((f) => (
          <div key={f.id} className="glass rowcard card-hover">
            <div className="rc-top">
              <span className="rc-title">{f.number} <span className="mut">· {f.owner_name || f.resident_name || '—'}</span></span>
              <StatusChip status={f.status} advance={f.advance} />
            </div>
            <div className="rc-meta num">
              <span>Monthly {inr(f.monthly_amount)}</span>
              {f.due > 0 && <span style={{ color: 'var(--bad)' }}>Due {inr(f.due)}</span>}
              {f.advance > 0 && <span style={{ color: 'var(--adv)' }}>Advance {inr(f.advance)}</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link className="btn sm icon-only" to={`/b/${buildingId}/flats/${f.id}/ledger`} data-label="Ledger" aria-label="Ledger">{Icons.ledger}</Link>
              <button className="btn sm icon-only" onClick={() => setLoginFlat(f)} data-label="Resident login" aria-label="Resident login">{Icons.user}</button>
              <button className="btn sm icon-only" onClick={() => setForm({ ...blank, ...f })} data-label="Edit" aria-label="Edit">{Icons.edit}</button>
              <button className="btn sm icon-only danger" onClick={() => archive(f)} data-label="Archive" aria-label="Archive">{Icons.archive}</button>
              <button className="btn sm icon-only danger" onClick={() => remove(f)} data-label="Delete" aria-label="Delete">{Icons.trash}</button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `Edit flat ${form.number}` : 'Add flat'}>
        {form && (
          <form onSubmit={save}>
            <div className="form-row">
              <div className="field"><label>Flat number / name *</label>
                <input required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></div>
              <div className="field"><label>Monthly maintenance (₹) *</label>
                <input required type="number" min="0" step="0.01" value={form.monthly_amount} onChange={(e) => setForm({ ...form, monthly_amount: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Owner name</label>
                <input value={form.owner_name || ''} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /></div>
              <div className="field"><label>Resident name</label>
                <input value={form.resident_name || ''} onChange={(e) => setForm({ ...form, resident_name: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Mobile number</label>
                <input value={form.mobile || ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
              <div className="field"><label>Floor</label>
                <input type="number" value={form.floor || ''} onChange={(e) => setForm({ ...form, floor: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Size (sq ft)</label>
                <input type="number" step="0.1" value={form.size_sqft || ''} onChange={(e) => setForm({ ...form, size_sqft: e.target.value })} /></div>
              <div className="field"><label>Notes</label>
                <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn primary">{form.id ? 'Save changes' : 'Add flat'}</button>
            </div>
          </form>
        )}
      </Modal>

      <ResidentLoginModal flat={loginFlat} resident={loginFlat ? residentByFlat.get(loginFlat.id) : null}
        onClose={() => setLoginFlat(null)} onChange={load} />
    </Layout>
  );
}

function ResidentLoginModal({ flat, resident, onClose, onChange }) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState(null);

  useEffect(() => { setUsername(''); setGeneratedPassword(null); }, [flat]);

  if (!flat) return null;

  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`/flats/${flat.id}/resident-account`, { username });
      setGeneratedPassword(r.password);
      onChange();
    } catch (err) { toast(err.message); }
  };

  const resetPassword = async () => {
    if (!confirm(`Reset the password for "${resident.username}"? They'll be signed out everywhere.`)) return;
    const r = await api.post(`/flats/${flat.id}/resident-account/reset-password`);
    setGeneratedPassword(r.password);
  };

  const toggleStatus = async () => {
    const next = resident.status === 'suspended' ? 'active' : 'suspended';
    await api.put(`/flats/${flat.id}/resident-account`, { status: next });
    toast(next === 'suspended' ? 'Resident login suspended' : 'Resident login reactivated');
    onChange();
  };

  return (
    <Modal open={!!flat} onClose={onClose} title={`Flat ${flat.number} · resident login`}>
      {generatedPassword && (
        <div className="glass" style={{ padding: 14, marginBottom: 16, borderColor: 'var(--adv)' }}>
          <strong>Save this password now — it won't be shown again:</strong>
          <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 8, userSelect: 'all' }}>{generatedPassword}</div>
        </div>
      )}
      {resident ? (
        <div className="list">
          <div className="glass" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><strong>{resident.username}</strong></div>
              <StatusChip status={resident.status === 'active' ? 'paid' : 'due'} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={resetPassword}>Reset password</button>
            <button className="btn" onClick={toggleStatus}>{resident.status === 'suspended' ? 'Reactivate' : 'Suspend'} login</button>
          </div>
        </div>
      ) : (
        <form onSubmit={create}>
          <div className="mut" style={{ marginBottom: 14 }}>No resident login exists for this flat yet.</div>
          <div className="field"><label>Username *</label>
            <input required value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="e.g. flat2c" /></div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn primary">Create resident login</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
