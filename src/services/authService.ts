import type { AdminSession } from '../types';
import { SESSION_STORAGE_KEY, api } from './apiClient';

/**
 * Real admin authentication against the shared users table (role = admin, bcrypt password).
 * The returned JWT is stored alongside the profile and attached to every subsequent request
 * by apiClient. Partners never sign in here — they authenticate by OTP against
 * /api/v1/app/auth from the Flutter app.
 */

/** Either a finished sign-in, or the account's second factor standing in the way of one. */
export type LoginResult =
  | { kind: 'session'; session: AdminSession }
  | { kind: 'twoFactor'; challengeToken: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }
  const result = await api.post<AdminSession & { twoFactorRequired?: boolean; challengeToken?: string }>(
    '/auth/login',
    { email, password }
  );
  if (result.twoFactorRequired && result.challengeToken) {
    return { kind: 'twoFactor', challengeToken: result.challengeToken };
  }
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(result));
  return { kind: 'session', session: result };
}

/** Second step of a 2FA sign-in. Takes an authenticator code or one recovery code. */
export async function verifyTwoFactorLogin(challengeToken: string, code: string): Promise<AdminSession> {
  const session = await api.post<AdminSession>('/auth/2fa/verify', { challengeToken, code });
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export async function logout(): Promise<void> {
  // The token is stateless, so signing out is purely a local discard.
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function getStoredSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AdminSession) : null;
  } catch {
    return null;
  }
}

/**
 * Confirms a stored token is still accepted, and refreshes the cached profile.
 * Returns null when the session is gone, which is the signal to send the user to /login.
 */
export async function verifyStoredSession(): Promise<AdminSession | null> {
  const stored = getStoredSession();
  if (!stored?.token) return null;
  try {
    const fresh = await api.get<Omit<AdminSession, 'token'>>('/auth/me');
    // /auth/me deliberately does not reissue a token; the stored one is still the live one.
    const session: AdminSession = { ...fresh, token: stored.token };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ otherSessionsSignedOut: number }> {
  return api.post('/auth/change-password', { currentPassword, newPassword });
}

// ---------------------------------------------------------------------------
// Signed-in devices
// ---------------------------------------------------------------------------

export interface AdminDeviceSession {
  id: string;
  device: string;
  ipAddress?: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export async function listDeviceSessions(): Promise<AdminDeviceSession[]> {
  const { sessions } = await api.get<{ sessions: AdminDeviceSession[] }>('/auth/sessions');
  return sessions;
}

export async function revokeDeviceSession(id: string): Promise<void> {
  await api.delete(`/auth/sessions/${id}`);
}

export async function revokeOtherDeviceSessions(): Promise<number> {
  const { signedOut } = await api.post<{ signedOut: number }>('/auth/sessions/revoke-others');
  return signedOut;
}

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt?: string;
  recoveryCodesRemaining: number;
}

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  return api.get('/auth/2fa');
}

/** Stores a secret but leaves 2FA off until a working code confirms the phone can read it. */
export async function startTwoFactorSetup(): Promise<{ secret: string; otpauthUri: string; qrDataUrl: string }> {
  return api.post('/auth/2fa/setup');
}

export async function enableTwoFactor(code: string): Promise<{ recoveryCodes: string[] }> {
  return api.post('/auth/2fa/enable', { code });
}

export async function disableTwoFactor(password: string): Promise<void> {
  await api.post('/auth/2fa/disable', { password });
}
