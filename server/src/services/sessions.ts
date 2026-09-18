import type { Request } from 'express';
import { prisma } from '../prisma';

/**
 * Signed-in devices. The JWT carries a session id, so "sign this device out" is a row update
 * rather than a wish — which is the whole difference between a real session list and a
 * decorative one.
 */

/** A busy tab would otherwise write on every request; a minute's resolution is plenty. */
const LAST_SEEN_THROTTLE_MS = 60_000;

/**
 * Enough of the User-Agent to recognise your own devices in a list. Deliberately coarse:
 * this is a label to help someone spot a session they do not recognise, not analytics.
 */
export function describeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  if (!ua) return 'Unknown device';

  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : /Dart|Flutter|okhttp/i.test(ua) ? 'ShreeRam app'
    : 'Unknown browser';

  const platform =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : '';

  return platform ? `${browser} on ${platform}` : browser;
}

/** The client address as it reached us. No geo-IP lookup — a city here would be invented. */
export function clientAddress(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first?.trim() || req.ip || req.socket.remoteAddress || null)?.replace(/^::ffff:/, '') ?? null;
}

export async function createSession(userId: string, req: Request): Promise<string> {
  const userAgent = req.headers['user-agent'];
  const session = await prisma.session.create({
    data: {
      userId,
      device: describeDevice(userAgent),
      userAgent: userAgent ?? null,
      ipAddress: clientAddress(req),
    },
    select: { id: true },
  });
  return session.id;
}

/** Null when the session is gone or revoked — the caller turns that into a 401. */
export async function touchSession(sessionId: string): Promise<{ id: string } | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, revokedAt: true, lastSeenAt: true },
  });
  if (!session || session.revokedAt) return null;

  if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    // Not awaited into the request's critical path, and a failure here must never 500 a
    // request that is otherwise perfectly authenticated.
    prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch((err) => console.error('[sessions] could not update lastSeenAt:', err));
  }

  return { id: session.id };
}

export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/** Used when signing every other device out, and after a password change. */
export async function revokeOtherSessions(userId: string, keepSessionId?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, device: true, ipAddress: true, createdAt: true, lastSeenAt: true },
  });
}
