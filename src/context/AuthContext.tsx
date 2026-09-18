import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AdminSession } from '../types';
import * as authService from '../services/authService';
import { onUnauthorized } from '../services/apiClient';

interface AuthContextValue {
  session: AdminSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Resolves to a challenge token when the account has 2FA on and the code is still needed. */
  login: (email: string, password: string, remember: boolean) => Promise<{ twoFactorChallenge?: string }>;
  /** Completes a 2FA sign-in with an authenticator or recovery code. */
  completeTwoFactorLogin: (challengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads the profile from /auth/me — call it after editing your own name or photo. */
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Optimistic: the stored session renders the app immediately, then is validated against
  // the backend below. Without that check a token the server has stopped accepting would
  // leave the panel looking signed in while every request 401s.
  const [session, setSession] = useState<AdminSession | null>(() => authService.getStoredSession());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!authService.getStoredSession()) return;
    let cancelled = false;
    void authService.verifyStoredSession().then((verified) => {
      if (!cancelled) setSession(verified);
    });
    return () => {
      cancelled = true;
    };
    // Runs once on mount: re-validating on every session change would loop.
  }, []);

  // Any request coming back 401 — an expired token, or this device signed out from another
  // one — drops the session here, which sends ProtectedRoute to /login on the same tick.
  useEffect(() => onUnauthorized(() => setSession(null)), []);

  const login = useCallback(async (email: string, password: string, _remember: boolean) => {
    setIsLoading(true);
    try {
      const result = await authService.login(email, password);
      if (result.kind === 'twoFactor') return { twoFactorChallenge: result.challengeToken };
      setSession(result.session);
      return {};
    } finally {
      setIsLoading(false);
    }
  }, []);

  const completeTwoFactorLogin = useCallback(async (challengeToken: string, code: string) => {
    setIsLoading(true);
    try {
      setSession(await authService.verifyTwoFactorLogin(challengeToken, code));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setSession(null);
  }, []);

  const refreshSession = useCallback(async () => {
    setSession(await authService.verifyStoredSession());
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, isAuthenticated: !!session, isLoading, login, completeTwoFactorLogin, logout, refreshSession }),
    [session, isLoading, login, completeTwoFactorLogin, logout, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
