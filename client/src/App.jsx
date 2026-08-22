import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/ui.jsx';
import { AuthProvider, useAuth } from './auth.jsx';
import { RequireAuth, Guard } from './components/guards.jsx';
import LoginGateway from './pages/LoginGateway.jsx';
import MasterLogin from './pages/MasterLogin.jsx';
import BuildingLogin from './pages/BuildingLogin.jsx';
import FlatLogin from './pages/FlatLogin.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Buildings from './pages/Buildings.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Flats from './pages/Flats.jsx';
import Ledger from './pages/Ledger.jsx';
import Payments from './pages/Payments.jsx';
import Expenses from './pages/Expenses.jsx';
import Funds from './pages/Funds.jsx';
import Investments from './pages/Investments.jsx';
import Sheets from './pages/Sheets.jsx';
import Notices from './pages/Notices.jsx';
import PaymentApprovals from './pages/PaymentApprovals.jsx';
import ResidentDashboard from './pages/resident/Dashboard.jsx';
import PayMaintenance from './pages/resident/PayMaintenance.jsx';
import Credits from './pages/resident/Credits.jsx';
import MyLedger from './pages/resident/MyLedger.jsx';
import Receipts from './pages/resident/Receipts.jsx';
import ResidentNotices from './pages/resident/Notices.jsx';
import Profile from './pages/resident/Profile.jsx';

// Root "/" just routes each role to where it actually belongs — nobody
// lands on a shared home screen since the three roles see entirely
// different data.
function Home() {
  const { user } = useAuth();
  if (user === undefined) return <div className="empty">Loading…</div>;
  if (user === null) return <Navigate to="/login" replace />;
  if (user.role === 'master_admin') return <Navigate to="/admin/buildings" replace />;
  if (user.role === 'building_admin') return <Navigate to={`/b/${user.buildingId}`} replace />;
  return <Navigate to="/me" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginGateway />} />
          <Route path="/login/master" element={<MasterLogin />} />
          <Route path="/login/building" element={<BuildingLogin />} />
          <Route path="/login/flat" element={<FlatLogin />} />
          <Route path="/change-password" element={<RequireAuth><ChangePassword /></RequireAuth>} />
          <Route path="/" element={<Home />} />

          {/* master admin */}
          <Route path="/admin/buildings" element={<Guard roles={['master_admin']}><Buildings /></Guard>} />

          {/* building admin (+ master admin can also drill into any building) */}
          <Route path="/b/:buildingId" element={<Guard roles={['building_admin', 'master_admin']}><Dashboard /></Guard>} />
          <Route path="/b/:buildingId/flats" element={<Guard roles={['building_admin', 'master_admin']}><Flats /></Guard>} />
          <Route path="/b/:buildingId/flats/:flatId/ledger" element={<Guard roles={['building_admin', 'master_admin']}><Ledger /></Guard>} />
          <Route path="/b/:buildingId/payments" element={<Guard roles={['building_admin', 'master_admin']}><Payments /></Guard>} />
          <Route path="/b/:buildingId/approvals" element={<Guard roles={['building_admin', 'master_admin']}><PaymentApprovals /></Guard>} />
          <Route path="/b/:buildingId/expenses" element={<Guard roles={['building_admin', 'master_admin']}><Expenses /></Guard>} />
          <Route path="/b/:buildingId/funds" element={<Guard roles={['building_admin', 'master_admin']}><Funds /></Guard>} />
          <Route path="/b/:buildingId/investments" element={<Guard roles={['building_admin', 'master_admin']}><Investments /></Guard>} />
          <Route path="/b/:buildingId/notices" element={<Guard roles={['building_admin', 'master_admin']}><Notices /></Guard>} />
          <Route path="/b/:buildingId/sheets" element={<Guard roles={['building_admin', 'master_admin']}><Sheets /></Guard>} />

          {/* resident */}
          <Route path="/me" element={<Guard roles={['resident']}><ResidentDashboard /></Guard>} />
          <Route path="/me/pay" element={<Guard roles={['resident']}><PayMaintenance /></Guard>} />
          <Route path="/me/credits" element={<Guard roles={['resident']}><Credits /></Guard>} />
          <Route path="/me/ledger" element={<Guard roles={['resident']}><MyLedger /></Guard>} />
          <Route path="/me/receipts" element={<Guard roles={['resident']}><Receipts /></Guard>} />
          <Route path="/me/notices" element={<Guard roles={['resident']}><ResidentNotices /></Guard>} />
          <Route path="/me/profile" element={<Guard roles={['resident']}><Profile /></Guard>} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
