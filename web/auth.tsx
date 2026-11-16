import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { api, json, sessionExpiredMessage } from './api.ts';
import { ErrorMessage, Loading } from './components/Feedback.tsx';

interface User { username: string }
interface Auth {
  user: User | null; loading: boolean; canEdit: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<Auth | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ user: User | null }>('/auth/me', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setUser(result.user);
    }).catch(() => { /* Public reading remains available when auth cannot be loaded. */ })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const expire = () => { setUser(null); setExpired(true); };
    window.addEventListener('filmsvus-session-expired', expire);
    return () => window.removeEventListener('filmsvus-session-expired', expire);
  }, []);
  const login = useCallback(async (username: string, password: string) => {
    const result = await api<{ user: User }>('/auth/login', json('POST', { username, password }));
    setUser(result.user); setExpired(false);
  }, []);
  const logout = useCallback(async () => {
    await api('/auth/logout', json('POST'));
    setUser(null); setExpired(false);
  }, []);
  const value = useMemo(() => ({ user, loading, canEdit: !!user, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}
    {expired && <SessionExpiredNotice />}
  </AuthContext.Provider>;
}
function SessionExpiredNotice() {
  const location = useLocation();
  const next = location.pathname + location.search + location.hash;
  return <ErrorMessage className="session-notice" action={<Link className="button" to={`/connexion?next=${encodeURIComponent(next)}`}>Se reconnecter</Link>}>{sessionExpiredMessage}</ErrorMessage>;
}
export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider manquant');
  return auth;
}
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth(), location = useLocation();
  if (loading) return <Loading />;
  return user ? children : <Navigate replace to={`/connexion?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} />;
}
