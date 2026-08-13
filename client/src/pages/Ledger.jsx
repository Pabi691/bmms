import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Layout, useToast, Icons } from '../components/ui.jsx';
import LedgerView from '../components/LedgerView.jsx';

export default function Ledger() {
  const { buildingId, flatId } = useParams();
  const [data, setData] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api.get(`/flats/${flatId}/ledger`).then(setData).catch((e) => toast(e.message));
  }, [flatId]);

  if (!data) return <Layout title="Loading…" backTo={`/b/${buildingId}/flats`} />;

  return (
    <Layout title={`Flat ${data.flat.number} · ledger`} sub={data.flat.owner_name || data.flat.resident_name || 'Complete financial history'} backTo={`/b/${buildingId}/flats`} headerIcon={Icons.ledger}>
      <LedgerView data={data} />
    </Layout>
  );
}
