import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { UserAccountStatus, UserRole } from '@prisma/client';
import { prisma } from '../prisma';
import { touchSession } from './sessions';

/**
 * One auth system for both API surfaces:
 *  - Admins sign in with email + password (admin panel).
 *  - Partners sign in with phone + OTP (Flutter app).
 * Both receive the same JWT, and every protected route reads it through `requireAuth`.
 */

const JWT_SECRET = process.env.JWT_SECRET || 'shreeram-dev-jwt-secret-change-me';
/** No refresh-token flow exists yet (see API docs §1.2) — a long-lived token instead. */
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

export interface AuthPayload {
  sub: string;
  role: UserRole;
  /// The panel role this user signs in with, when they have one. Read from the row rather than
  /// the token so a role granted or withdrawn applies on the next request.
  panelRoleId?: string | null;
  /// The Session row this token belongs to. Absent only on tokens issued before sessions
  /// existed, which are rejected — see `requireAuth`.
  sid?: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthPayload;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

/**
 * The short-lived token handed out between "your password was right" and "here is your
 * one-time code". It is not an access token: nothing accepts it except the 2FA verify step.
 */
export function signTwoFactorChallenge(userId: string): string {
  return jwt.sign({ sub: userId, purpose: '2fa' }, JWT_SECRET, { expiresIn: '5m' });
}

export function verifyTwoFactorChallenge(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub?: string; purpose?: string };
    return payload.purpose === '2fa' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function readToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

const BLOCKED_ACCOUNT_MESSAGE: Record<Exclude<UserAccountStatus, 'active'>, string> = {
  inactive: 'This account has been deactivated. Please contact your administrator.',
  suspended: 'This account has been suspended. Please contact support.',
};

/**
 * 401s unless a valid Bearer token is present AND the account behind it is still `active`.
 *
 * The token is stateless and long-lived, so the signature alone cannot answer "is this
 * account still allowed in?" — deactivating a partner would otherwise leave their existing
 * session working until the token expired. One row read per request settles it, and the
 * role is taken from that row rather than the token so a role change also applies at once.
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: { code: 'unauthenticated', message: 'Authentication required.' } });

  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return res.status(401).json({ error: { code: 'invalid_token', message: 'Your session has expired. Please sign in again.' } });
  }

  // A token with no session behind it cannot be signed out from the Security screen, so it
  // is not honoured. Only tokens issued before sessions existed look like this, and the
  // holder simply signs in again.
  if (!payload.sid) {
    return res.status(401).json({ error: { code: 'invalid_token', message: 'Your session has expired. Please sign in again.' } });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, panelRoleId: true },
    });
    if (!user) {
      return res.status(401).json({ error: { code: 'invalid_token', message: 'Your session has expired. Please sign in again.' } });
    }
    if (user.status !== 'active') {
      return res.status(401).json({ error: { code: `account_${user.status}`, message: BLOCKED_ACCOUNT_MESSAGE[user.status] } });
    }

    const session = await touchSession(payload.sid);
    if (!session) {
      return res.status(401).json({ error: { code: 'session_revoked', message: 'This device was signed out. Please sign in again.' } });
    }

    req.auth = { sub: user.id, role: user.role, panelRoleId: user.panelRoleId, sid: session.id };
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * May this account use the admin panel?
 *
 * Being a panel user and being `role = admin` used to be the same thing. They are not: the
 * sales team are employees who also work in the panel, and what they can do there is decided
 * by their panel role. So the gate is "has a panel role, or is a legacy admin with none".
 */
export function canUsePanel(auth: AuthPayload | undefined): boolean {
  return !!auth && (auth.role === 'admin' || !!auth.panelRoleId);
}

/** Admin-panel routes. Must run after `requireAuth`. */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!canUsePanel(req.auth)) {
    return res.status(403).json({ error: { code: 'forbidden', message: 'Admin access required.' } });
  }
  return next();
}

/** App routes. An admin token is accepted too, so the panel can exercise app endpoints. */
export function requirePartner(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: { code: 'unauthenticated', message: 'Authentication required.' } });
  return next();
}

/** The authenticated user row, or null if the token points at a deleted account. */
export function currentUser(req: AuthedRequest) {
  if (!req.auth) return Promise.resolve(null);
  return prisma.user.findUnique({ where: { id: req.auth.sub } });
}

const ROLE_PREFIX: Record<UserRole, string> = {
  agent: 'AGT',
  admin: 'ADM',
  employee: 'EMP',
  leader: 'LDR',
};

/**
 * Server-owned partner code, format SR-<ROLE>-<n> (API docs §1.3 — the client fakes one
 * during onboarding and it is always discarded). Uniqueness is guaranteed by retrying on
 * the unique-constraint collision rather than by reading a max(), which would race.
 */
export async function generatePartnerCode(role: UserRole): Promise<string> {
  const prefix = `SR-${ROLE_PREFIX[role]}-`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${prefix}${crypto.randomInt(1000, 10000)}`;
    const clash = await prisma.user.findFirst({
      where: { OR: [{ partnerCode: candidate }, { referralCode: candidate }] },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  // Fall back to a value that cannot collide.
  return `${prefix}${Date.now().toString().slice(-8)}`;
}
