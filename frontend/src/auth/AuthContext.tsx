import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import { apiFetch, TOKEN_STORAGE_KEY, USER_STORAGE_KEY, EXP_STORAGE_KEY } from '../lib/api';
import type { LoginResponse, StoredAuth, User } from '../lib/types';

interface AuthState {
  user: User | null;
  token: string | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error: string | null }>;
  loginPin: (pin: string) => Promise<{ ok: boolean; error: string | null }>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readJwtExpiry(token: string): number | null {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function loadStoredAuth(): StoredAuth | null {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const userRaw = localStorage.getItem(USER_STORAGE_KEY);
  const expRaw = localStorage.getItem(EXP_STORAGE_KEY);
  if (!token || !userRaw || !expRaw) return null;
  try {
    const user = JSON.parse(userRaw) as User;
    const expiresAt = parseInt(expRaw, 10);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) {
      return null;
    }
    return { token, user, expiresAt };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const expiryTimer = useRef<number | null>(null);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(EXP_STORAGE_KEY);
    setUser(null);
    setToken(null);
    if (expiryTimer.current !== null) {
      window.clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
    }
  }, []);

  const scheduleExpiry = useCallback((expiresAt: number) => {
    if (expiryTimer.current !== null) {
      window.clearTimeout(expiryTimer.current);
    }
    const ms = expiresAt * 1000 - Date.now();
    if (ms <= 0) {
      clearAuth();
      return;
    }
    expiryTimer.current = window.setTimeout(() => {
      clearAuth();
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }, ms);
  }, [clearAuth]);

  const persistAuth = useCallback((payload: LoginResponse) => {
    const expiresAt = readJwtExpiry(payload.accessToken);
    if (!expiresAt) return false;
    localStorage.setItem(TOKEN_STORAGE_KEY, payload.accessToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(payload.user));
    localStorage.setItem(EXP_STORAGE_KEY, String(expiresAt));
    setToken(payload.accessToken);
    setUser(payload.user);
    scheduleExpiry(expiresAt);
    return true;
  }, [scheduleExpiry]);

  useEffect(() => {
    const stored = loadStoredAuth();
    if (stored) {
      setUser(stored.user);
      setToken(stored.token);
      scheduleExpiry(stored.expiresAt);
    } else {
      clearAuth();
    }
    setReady(true);
  }, [scheduleExpiry, clearAuth]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok || !res.data) {
      return { ok: false, error: res.errorMessage ?? 'Login failed' };
    }
    if (!persistAuth(res.data)) {
      return { ok: false, error: 'Server returned an unparseable token' };
    }
    return { ok: true, error: null };
  }, [persistAuth]);

  const loginPin = useCallback(async (pin: string) => {
    const res = await apiFetch<LoginResponse>('/auth/login-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    if (!res.ok || !res.data) {
      return { ok: false, error: res.errorMessage ?? 'PIN login failed' };
    }
    if (!persistAuth(res.data)) {
      return { ok: false, error: 'Server returned an unparseable token' };
    }
    return { ok: true, error: null };
  }, [persistAuth]);

  const value = useMemo<AuthState>(
    () => ({ user, token, ready, login, loginPin, logout: clearAuth }),
    [user, token, ready, login, loginPin, clearAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function homePathForRole(role: User['role']): string {
  switch (role) {
    case 'WAITER': return '/waiter';
    case 'CASHIER': return '/cashier';
    case 'MANAGER':
    case 'ADMIN': return '/manager';
    case 'KITCHEN': return '/kitchen';
    default: return '/login';
  }
}
