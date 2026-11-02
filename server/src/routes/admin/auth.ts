import { Router } from 'express';
import QRCode from 'qrcode';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../prisma';
import {
  canUsePanel,
  hashPassword,
  requireAuth,
  signToken,
  signTwoFactorChallenge,
  verifyPassword,
  verifyTwoFactorChallenge,
  type AuthedRequest,
} from '../../services/auth';
import { createSession, listSessions, revokeOtherSessions, revokeSession } from '../../services/sessions';
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUri, verifyCode } from '../../services/totp';
import { decrypt, encrypt } from '../../services/crypto';
import { adminUser } from '../../services/adminMappers';
import { isAlwaysAllowed, moduleForPath, resolveAccess } from '../../services/permissions';
import { resolveScope } from '../../services/hierarchy';

/**
 * Where this person sits in the CRM hierarchy, for the panel to shape itself around — which
 * assignment controls to show, whether there is a team to look at. The server enforces all of
 * it regardless; this only stops the UI offering what would be refused.
 */
async function hierarchyProfile(userId: string) {
  const [user, scope] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, reportingLeaderId: true } }),
    resolveScope(userId),
  ]);
  return { accountRole: user.role, managerId: user.reportingLeaderId, scope: scope.kind, canAssign: scope.canAssign };
}

/**
 * Admin-panel sign-in. Admins are the only accounts with a password; partners are
 * OTP-only and authenticate through /api/v1/app/auth. Both end up with the same JWT.
 */
export const adminAuthRouter = Router();

adminAuthRouter.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        // A panel role is what grants panel access; `role = admin` with none is the original
        // account, which predates panel roles and keeps working.
        OR: [{ role: 'admin' }, { panelRoleId: { not: null } }],
      },
    });
    // The same message for "no such admin" and "wrong password", so the response cannot
    // be used to discover which email addresses are admin accounts.
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'This admin account is not active.' });
    }

    // Password was right, but it is only the first half of the answer when 2FA is on. The
    // challenge below unlocks nothing except the verify step.
    if (user.twoFactorEnabledAt && user.twoFactorSecret) {
      return res.json({ twoFactorRequired: true, challengeToken: signTwoFactorChallenge(user.id) });
    }

    res.json(await sessionResponse(user.id, req));
  } catch (err) {
    next(err);
  }
});

/** The signed-in payload the panel stores, built once so login and 2FA verify cannot drift. */
async function sessionResponse(userId: string, req: Request) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const access = await resolveAccess(user.id);
  const sessionId = await createSession(user.id, req);
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? '',
    role: 'Admin' as const,
    avatarUrl: user.avatarUrl ?? undefined,
    roleName: access.roleName ?? undefined,
    isFullAccess: access.isFullAccess,
    modules: access.modules,
    ...(await hierarchyProfile(user.id)),
    token: signToken({ sub: user.id, role: user.role, sid: sessionId }),
  };
}

/** Second step of a 2FA sign-in. Accepts a TOTP code or one unused recovery code. */
adminAuthRouter.post('/2fa/verify', async (req, res, next) => {
  try {
    const userId = verifyTwoFactorChallenge(String(req.body?.challengeToken ?? ''));
    if (!userId) {
      return res.status(401).json({ error: 'This sign-in attempt has expired. Please enter your password again.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorSecret || !user.twoFactorEnabledAt) {
      return res.status(400).json({ error: 'Two-factor authentication is not enabled on this account.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'This admin account is not active.' });
    }

    const code = String(req.body?.code ?? '').trim();
    const secret = decrypt(user.twoFactorSecret);

    if (!verifyCode(secret, code)) {
      // Not a live code — it may still be one of the recovery codes, which burn on use.
      const hashed = hashRecoveryCode(code);
      if (!user.twoFactorRecoveryCodes.includes(hashed)) {
        return res.status(401).json({ error: 'That code is not correct. Check your authenticator app and try again.' });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorRecoveryCodes: user.twoFactorRecoveryCodes.filter((c) => c !== hashed) },
      });
    }

    res.json(await sessionResponse(user.id, req));
  } catch (err) {
    next(err);
  }
});

/** Confirms a stored token still works, and refreshes the cached admin profile. */
/** How money is shown across the panel — every signed-in person needs it, so it is not tied to the Settings module. */
adminAuthRouter.get('/display', requireAuth, async (_req, res, next) => {
  try {
    const row = await prisma.organizationSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
    res.json({ pointsEnabled: row.pointsEnabled, pointsPerRupee: row.pointsPerRupee });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.get('/me', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
    if (!user || !(user.role === 'admin' || user.panelRoleId)) {
      return res.status(401).json({ error: 'Not an admin session.' });
    }
    const access = await resolveAccess(user.id);
    res.json({
      id: user.id,
      name: user.name,
      email: user.email ?? '',
      role: 'Admin',
      avatarUrl: user.avatarUrl ?? undefined,
      roleName: access.roleName ?? undefined,
      isFullAccess: access.isFullAccess,
      modules: access.modules,
      ...(await hierarchyProfile(user.id)),
    });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/change-password', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const current = String(req.body?.currentPassword ?? '');
    const next_ = String(req.body?.newPassword ?? '');
    if (next_.length < 8) {
      return res.status(400).json({ error: 'The new password must be at least 8 characters.' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
    if (!user?.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next_) } });
    // Whoever else was signed in was signed in with the old password.
    const signedOut = await revokeOtherSessions(user.id, req.auth!.sid);
    res.json({ ok: true, otherSessionsSignedOut: signedOut });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Signed-in devices
// ---------------------------------------------------------------------------

adminAuthRouter.get('/sessions', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const sessions = await listSessions(req.auth!.sub);
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        device: s.device,
        ipAddress: s.ipAddress ?? undefined,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        current: s.id === req.auth!.sid,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.delete('/sessions/:id', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    if (id === req.auth!.sid) {
      return res.status(400).json({ error: 'This is the device you are using. Sign out from the menu instead.' });
    }
    const revoked = await revokeSession(req.auth!.sub, id);
    if (!revoked) return res.status(404).json({ error: 'That session is already signed out.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/sessions/revoke-others', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ signedOut: await revokeOtherSessions(req.auth!.sub, req.auth!.sid) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Two-factor authentication
//
// Enrolment is two steps on purpose: `setup` stores a secret but leaves it switched off, and
// only a working code from the authenticator turns it on. Without that, a mistyped secret
// would lock the account out on the next sign-in.
// ---------------------------------------------------------------------------

const TOTP_ISSUER = 'Propto CRM';

adminAuthRouter.get('/2fa', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.auth!.sub },
      select: { twoFactorEnabledAt: true, twoFactorRecoveryCodes: true },
    });
    res.json({
      enabled: !!user.twoFactorEnabledAt,
      enabledAt: user.twoFactorEnabledAt?.toISOString(),
      recoveryCodesRemaining: user.twoFactorRecoveryCodes.length,
    });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/2fa/setup', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    if (user.twoFactorEnabledAt) {
      return res.status(400).json({ error: 'Two-factor authentication is already on. Turn it off first to re-enrol.' });
    }

    const secret = generateSecret();
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: encrypt(secret) } });

    const uri = otpauthUri({ secret, account: user.email || user.phone, issuer: TOTP_ISSUER });
    res.json({
      secret,
      otpauthUri: uri,
      // Rendered here so the panel needs no QR library of its own.
      qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }),
    });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/2fa/enable', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    if (!user.twoFactorSecret) {
      return res.status(400).json({ error: 'Start the setup again — no secret is waiting to be confirmed.' });
    }
    if (user.twoFactorEnabledAt) return res.status(400).json({ error: 'Two-factor authentication is already on.' });

    if (!verifyCode(decrypt(user.twoFactorSecret), String(req.body?.code ?? ''))) {
      return res.status(400).json({ error: 'That code is not correct. Make sure your phone clock is accurate and try the next one.' });
    }

    // Shown once, here, and never again — only their hashes are kept.
    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabledAt: new Date(), twoFactorRecoveryCodes: recoveryCodes.map(hashRecoveryCode) },
    });

    res.json({ enabled: true, recoveryCodes });
  } catch (err) {
    next(err);
  }
});

/** Turning it off asks for the password, because a borrowed session should not be enough. */
adminAuthRouter.post('/2fa/disable', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    if (!user.passwordHash || !(await verifyPassword(String(req.body?.password ?? ''), user.passwordHash))) {
      return res.status(400).json({ error: 'Your password is incorrect.' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: null, twoFactorEnabledAt: null, twoFactorRecoveryCodes: [] },
    });
    res.json({ enabled: false });
  } catch (err) {
    next(err);
  }
});

/**
 * Paths that must stay reachable without a token: the admin login itself, the Meta/webform
 * webhook receivers, and the visitor-facing public form endpoints. Everything else under
 * /api requires an admin session.
 */
const PUBLIC_PATTERNS = [
  /^\/health$/,
  /^\/auth\/login$/,
  // The second step of a 2FA sign-in: the caller holds a challenge, not yet a session.
  /^\/auth\/2fa\/verify$/,
  /^\/webhook(\/|$)/,
  // An unsubscribe link is clicked from an email client, with no session.
  /^\/unsubscribe(\/|$)/,
  /^\/forms\/public(\/|$)/,
  // A plot map link shared with a buyer, opened with no session.
  /^\/plot-map(\/|$)/,
  /^\/v1\/app(\/|$)/,
];

export function adminGuard(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC_PATTERNS.some((pattern) => pattern.test(req.path))) return next();
  return requireAuth(req as AuthedRequest, res, async () => {
    const authed = req as AuthedRequest;
    if (!canUsePanel(authed.auth)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    // Session and upload endpoints stay open to every signed-in panel user; everything else is
    // matched to a module and checked against the user's panel role. Enforcing it here rather
    // than per-router means a new route is locked down by default instead of by remembering to.
    if (isAlwaysAllowed(req.path)) return next();

    try {
      const access = await resolveAccess(authed.auth!.sub);
      if (access.isFullAccess) return next();

      const required = moduleForPath(req.path);
      if (!required) {
        // An unmapped path is only reachable by full-access roles — failing closed keeps a
        // forgotten entry in the module map from silently becoming a hole.
        return res.status(403).json({ error: 'This area is restricted to administrators.' });
      }
      if (!access.modules.includes(required)) {
        return res.status(403).json({ error: 'Your role does not have access to this module.' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  });
}

/** Route guard for the endpoints that manage roles and panel users themselves. */
export function requireFullAccess(req: Request, res: Response, next: NextFunction) {
  const authed = req as AuthedRequest;
  if (!authed.auth?.sub) return res.status(401).json({ error: 'Sign in required.' });
  resolveAccess(authed.auth.sub)
    .then((access) => {
      if (!access.isFullAccess) {
        return res.status(403).json({ error: 'Only a full-access administrator can manage roles and panel users.' });
      }
      return next();
    })
    .catch(next);
}

export { adminUser };
