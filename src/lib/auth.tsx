import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthConfig, Me } from '../../shared/types';
import { api, post, setCsrfToken } from './api';

interface AuthState {
  user: Me | null;
  config: AuthConfig;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  loginUrl: (returnTo?: string) => string;
  devLogin: (discordId: string, username: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [config, setConfig] = useState<AuthConfig>({ discordEnabled: false, devLoginEnabled: false });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [me, cfg] = await Promise.all([api<{ user: Me | null }>('/api/auth/me'), api<AuthConfig>('/api/auth/config')]);
      setUser(me.user);
      setCsrfToken(me.user?.csrfToken ?? '');
      setConfig(cfg);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await post('/api/auth/logout');
    setUser(null);
    setCsrfToken('');
  }, []);

  const devLogin = useCallback(
    async (discordId: string, username: string) => {
      await post('/api/auth/dev-login', { discordId, username });
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      config,
      loading,
      refresh,
      logout,
      devLogin,
      loginUrl: (returnTo = window.location.pathname + window.location.search) =>
        `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`,
    }),
    [user, config, loading, refresh, logout, devLogin],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
