import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user === undefined) {
    return <div className="empty">Loading…</div>;
  }
  if (user === null) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

export function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!user) return null; // RequireAuth (wrapping this) already handles the redirect
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

// Composes both — the common case for a route that needs "signed in AND
// has one of these roles".
export function Guard({ roles, children }) {
  return (
    <RequireAuth>
      <RequireRole roles={roles}>{children}</RequireRole>
    </RequireAuth>
  );
}
