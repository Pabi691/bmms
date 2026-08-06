import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  // undefined = still checking, null = logged out, object = logged in
  const [user, setUser] = useState(undefined);

  const refresh = useCallback(() => {
    return api.get('/auth/me').then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('sl:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sl:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (username, password) => {
    const d = await api.post('/auth/login', { username, password });
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore — clearing local state regardless */ }
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}
