import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Layout, useToast, Icons } from '../components/ui.jsx';

export default function Sheets() {
  const { buildingId } = useParams();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ sheet_id: '', sheet_tab: 'Sheet1', sheet_name: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => api.get(`/buildings/${buildingId}/sheet`).then((d) => {
    setData(d);
    if (d.connection) setForm({ sheet_id: d.connection.sheet_id, sheet_tab: d.connection.sheet_tab, sheet_name: d.connection.sheet_name || '' });
  }).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [buildingId]);

  const save = async (e) => {
    e.preventDefault();
    try { await api.post(`/buildings/${buildingId}/sheet`, form); toast('Google Sheet connected'); load(); }
    catch (err) { toast(err.message); }
  };

  const sync = async () => {
    setBusy(true);
    try { const r = await api.post(`/buildings/${buildingId}/sheet/sync`); toast(`Synced ${r.rows} rows`); load(); }
    catch (err) { toast('Sync failed: ' + err.message); load(); }
    finally { setBusy(false); }
  };

  const c = data?.connection;

  return (
    <Layout title="Google Sheet" sub="This building's synchronized external record" backTo={`/b/${buildingId}`} headerIcon={Icons.sheet}>
      <div className="grid two">
        <div className="glass">
          <h3 style={{ marginTop: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 10 }}><span className="icon-badge sm b-ok">{Icons.sheet}</span> Connection</h3>
          {c && (
            <div style={{ marginBottom: 14 }}>
              <span className={'chip ' + (c.status === 'connected' ? 'paid' : 'due')}>
                {c.status === 'connected' ? 'Connected' : 'Sync error'}
              </span>
              <div className="mut" style={{ marginTop: 8 }}>
                Last sync: {c.last_sync ? new Date(c.last_sync).toLocaleString() : 'never'}
              </div>
              <a className="btn sm" style={{ marginTop: 10 }} target="_blank" rel="noreferrer"
                href={`https://docs.google.com/spreadsheets/d/${c.sheet_id}`}>Open sheet ↗</a>{' '}
              <button className="btn sm primary" style={{ marginTop: 10 }} onClick={sync} disabled={busy}>
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          )}
          <form onSubmit={save}>
            <div className="field"><label>Google Sheet link or ID *</label>
              <input required value={form.sheet_id} placeholder="Paste the full sheet URL"
                onChange={(e) => setForm({ ...form, sheet_id: e.target.value })} /></div>
            <div className="form-row">
              <div className="field"><label>Tab name</label>
                <input value={form.sheet_tab} onChange={(e) => setForm({ ...form, sheet_tab: e.target.value })} /></div>
              <div className="field"><label>Display name</label>
                <input value={form.sheet_name} onChange={(e) => setForm({ ...form, sheet_name: e.target.value })} /></div>
            </div>
            <button className="btn primary">{c ? 'Update connection' : 'Connect sheet'}</button>
          </form>
          <div className="mut" style={{ marginTop: 14, lineHeight: 1.6 }}>
            Setup: create a Google Cloud service account, put its email and private key in <code>server/.env</code>, and share the sheet
            with the service-account email (Editor access). The local database always remains the source of truth —
            the sheet is a synced reporting copy.
          </div>
        </div>

        <div className="glass">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Sync log</h3>
          {(!data || data.logs.length === 0) && <div className="mut">No syncs yet.</div>}
          {data?.logs.map((l) => (
            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span className="mut">{l.created_at}</span>
              <span style={{ color: l.status === 'success' ? 'var(--ok)' : 'var(--bad)', textAlign: 'right' }}>
                {l.status === 'success' ? l.message : l.message}
              </span>
            </div>
          ))}
          {data?.logs.some((l) => l.status === 'error') && (
            <button className="btn sm" style={{ marginTop: 12 }} onClick={sync}>Retry sync</button>
          )}
        </div>
      </div>
    </Layout>
  );
}
