import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Layout, Modal, Empty, useToast, Icons } from '../components/ui.jsx';

const blank = { title: '', body: '', pinned: false };

export default function Notices() {
  const { buildingId } = useParams();
  const [notices, setNotices] = useState(null);
  const [form, setForm] = useState(null);
  const toast = useToast();

  const load = () => api.get(`/buildings/${buildingId}/notices`).then(setNotices).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [buildingId]);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) { await api.put(`/notices/${form.id}`, form); toast('Notice updated'); }
      else { await api.post(`/buildings/${buildingId}/notices`, form); toast('Notice posted'); }
      setForm(null); load();
    } catch (err) { toast(err.message); }
  };

  const remove = async (n) => {
    if (!confirm(`Delete notice "${n.title}"?`)) return;
    await api.del(`/notices/${n.id}`); toast('Notice removed'); load();
  };

  return (
    <Layout title="Notices" sub="Announcements visible to all residents" backTo={`/b/${buildingId}`}
      actions={<button className="btn primary" onClick={() => setForm({ ...blank })}>+ New notice</button>}>

      {notices && notices.length === 0 && <Empty title="No notices yet" hint="Post an announcement for residents to see." />}

      <div className="list">
        {(notices || []).map((n) => (
          <div key={n.id} className="glass" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 16 }}>{n.title}</strong>
                  {n.pinned && <span className="chip advance">Pinned</span>}
                </span>
                <div className="mut" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                <div className="mut" style={{ marginTop: 6, fontSize: 12 }}>{n.createdAt?.slice(0, 10)}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm icon-only" onClick={() => setForm(n)} data-label="Edit" aria-label="Edit">{Icons.edit}</button>
                <button className="btn sm icon-only danger" onClick={() => remove(n)} data-label="Delete" aria-label="Delete">{Icons.trash}</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit notice' : 'Post notice'}>
        {form && (
          <form onSubmit={save}>
            <div className="field"><label>Title *</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="field"><label>Message *</label>
              <textarea required rows="5" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 14 }}>
              <input type="checkbox" checked={!!form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
              Pin to top
            </label>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn primary">{form.id ? 'Save changes' : 'Post notice'}</button>
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
