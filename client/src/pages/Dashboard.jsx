import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api, inr, MONTHS } from '../api.js';
import { Layout, StatusChip, useToast, RadialGauge, Icons } from '../components/ui.jsx';

export default function Dashboard() {
  const { buildingId } = useParams();
  const [s, setS] = useState(null);
  const nav = useNavigate();
  const toast = useToast();

  const load = () => api.get(`/buildings/${buildingId}/summary`).then(setS).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [buildingId]);

  if (!s) return <Layout title="Loading…" backTo="/"><div className="empty">Fetching building data…</div></Layout>;
  const t = s.totals;
  const paidCount = s.flatStates.filter((f) => f.status === 'paid').length;
  const partCount = s.flatStates.filter((f) => f.status === 'partial').length;
  const dueCount = s.flatStates.length - paidCount - partCount;
  const pct = (n) => (s.flatStates.length ? (n / s.flatStates.length) * 100 : 0);

  const sync = async () => {
    try { const r = await api.post(`/buildings/${buildingId}/sheet/sync`); toast(`Synced ${r.rows} rows to Google Sheet`); }
    catch (e) { toast(e.message); }
  };

  const stats = [
    ['Total flats', t.flats, ''],
    ['Expected monthly', inr(t.expected), ''],
    ['Cash balance', inr(t.cash), ''],
    ['Bank balance', inr(t.bank), ''],
    ['Total income', inr(t.totalIncome), 'accent-ok'],
    ['Total expenses', inr(t.totalExpenses), 'accent-warn'],
    ['Income this month', inr(t.monthIncome), ''],
    ['Expenses this month', inr(t.monthExpense), ''],
  ];

  const collectionPct = t.expected > 0 ? (t.collectedMonth / t.expected) * 100 : 0;
  const hero = [
    { label: 'Available balance', value: inr(t.availableBalance), icon: Icons.wallet, cls: 'b-adv' },
    { label: 'Collected this month', value: inr(t.collectedMonth), icon: Icons.check, cls: 'b-ok' },
    { label: 'Pending this month', value: inr(t.pendingMonth), icon: Icons.alert, cls: t.pendingMonth > 0 ? 'b-bad' : 'b-ok' },
    { label: 'Emergency fund', value: inr(t.emergencyFund), icon: Icons.fund, cls: 'b-adv' },
  ];

  return (
    <Layout
      title={s.building.name}
      sub={`${MONTHS[s.month - 1]} ${s.year} · financial overview`}
      backTo="/"
    >
      {/* quick actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn primary sm" onClick={() => nav(`/b/${buildingId}/payments?add=1`)}>+ Payment</button>
        <button className="btn sm" onClick={() => nav(`/b/${buildingId}/expenses?add=1`)}>+ Expense</button>
        <button className="btn sm" onClick={() => nav(`/b/${buildingId}/flats?add=1`)}>+ Flat</button>
        <button className="btn sm" onClick={() => nav(`/b/${buildingId}/funds`)}>Emergency fund</button>
        <button className="btn sm" onClick={sync}>Sync Google Sheet</button>
      </div>

      {/* hero row — the at-a-glance state of the month */}
      <div className="grid hero" style={{ marginBottom: 16 }}>
        <div className="glass card-hover" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <RadialGauge percent={collectionPct} size={104} stroke={10} color="var(--ok)" label={MONTHS[s.month - 1].slice(0, 3)} />
          <div>
            <div className="mut" style={{ fontSize: 12.5, fontWeight: 500 }}>Collected this month</div>
            <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{inr(t.collectedMonth)}</div>
            <div className="mut" style={{ fontSize: 12 }}>of {inr(t.expected)} expected</div>
          </div>
        </div>
        {hero.map((h) => (
          <div key={h.label} className="glass card-hover hero-stat">
            <div className="hs-top">
              <span className={'icon-badge ' + h.cls}>{h.icon}</span>
            </div>
            <div>
              <div className="label">{h.label}</div>
              <div className="value num">{h.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <strong>Flat-wise collection · {MONTHS[s.month - 1]}</strong>
          <span className="mut num">{paidCount + partCount} of {s.flatStates.length} flats paying</span>
        </div>
        <div className="meter" aria-label="Collection progress">
          <i className="m-ok" style={{ width: pct(paidCount) + '%' }} />
          <i className="m-warn" style={{ width: pct(partCount) + '%' }} />
          <i className="m-bad" style={{ width: pct(dueCount) + '%' }} />
        </div>
        <div className="mut" style={{ marginTop: 8 }}>
          <span style={{ color: 'var(--ok)' }}>{paidCount} paid</span> · <span style={{ color: 'var(--warn)' }}>{partCount} partial</span> · <span style={{ color: 'var(--bad)' }}>{dueCount} due</span>
        </div>
      </div>

      <div className="grid stats">
        {stats.map(([label, value, cls]) => (
          <div key={label} className={'glass stat card-hover ' + cls}>
            <div className="label">{label}</div>
            <div className="value num">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="glass">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Income vs expense · last 6 months</h3>
          <div style={{ width: '100%', height: 230 }}>
            <ResponsiveContainer>
              <BarChart data={s.series} barGap={3}>
                <CartesianGrid strokeOpacity={0.12} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  formatter={(v, n) => [inr(v), n === 'income' ? 'Income' : 'Expense']}
                  contentStyle={{ background: 'var(--nav-bg)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text)' }}
                />
                <Bar dataKey="income" fill="#2dd4a7" radius={[7, 7, 0, 0]} maxBarSize={22} />
                <Bar dataKey="expense" fill="#f26d6d" radius={[7, 7, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Flat-wise status · {MONTHS[s.month - 1]}</h3>
          <div className="list">
            {s.flatStates.length === 0 && <div className="mut">No flats yet — add flats to begin.</div>}
            {s.flatStates.map((f) => (
              <Link key={f.id} to={`/b/${buildingId}/flats/${f.id}/ledger`} className="rowline" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <strong>{f.number}</strong>
                  <div className="mut">{f.owner_name || f.resident_name || '—'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <StatusChip status={f.status} advance={f.advance} />
                  <div className="mut num">{f.due > 0 ? `Due ${inr(f.due)}` : f.advance > 0 ? `Advance ${inr(f.advance)}` : `Paid ${inr(f.paid)}`}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="glass">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Recent payments</h3>
          {s.recentPayments.length === 0 && <div className="mut">No payments recorded yet.</div>}
          {s.recentPayments.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13.5 }}>
              <span>{p.flat_number} · {p.month}/{p.year} <span className="mut">({p.method})</span></span>
              <strong className="num" style={{ color: 'var(--ok)' }}>{inr(p.amount)}</strong>
            </div>
          ))}
        </div>
        <div className="glass">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Recent expenses</h3>
          {s.recentExpenses.length === 0 && <div className="mut">No expenses recorded yet.</div>}
          {s.recentExpenses.map((e) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13.5 }}>
              <span>{e.custom_name || e.category} <span className="mut">{e.date}</span></span>
              <strong className="num" style={{ color: 'var(--bad)' }}>−{inr(e.amount)}</strong>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
