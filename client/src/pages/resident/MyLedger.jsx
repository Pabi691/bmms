import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Layout, useToast, residentNavLinks } from '../../components/ui.jsx';
import LedgerView from '../../components/LedgerView.jsx';

export default function MyLedger() {
  const [data, setData] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api.get('/me/ledger').then(setData).catch((e) => toast(e.message));
  }, []);

  if (!data) return <Layout title="Loading…" navOverride={residentNavLinks()} />;

  return (
    <Layout title={`Flat ${data.flat.number} · ledger`} sub="Your complete financial history" navOverride={residentNavLinks()}>
      <LedgerView data={data} />
    </Layout>
  );
}
