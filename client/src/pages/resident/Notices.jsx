import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Layout, Empty, useToast, residentNavLinks } from '../../components/ui.jsx';

export default function ResidentNotices() {
  const [notices, setNotices] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api.get('/me/notices').then(setNotices).catch((e) => toast(e.message));
  }, []);

  if (!notices) return <Layout title="Loading…" navOverride={residentNavLinks()} />;

  return (
    <Layout title="Notices" sub="Announcements from your building admin" navOverride={residentNavLinks()}>
      {notices.length === 0 && <Empty title="No notices yet" hint="Your building admin hasn't posted anything." />}
      <div className="list">
        {notices.map((n) => (
          <div key={n.id} className="glass" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 16 }}>{n.title}</strong>
                {n.pinned && <span className="chip advance">Pinned</span>}
              </span>
              <span className="mut" style={{ fontSize: 12 }}>{n.createdAt?.slice(0, 10)}</span>
            </div>
            <div className="mut" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{n.body}</div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
