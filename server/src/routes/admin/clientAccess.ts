import crypto from 'crypto';
import { Router } from 'express';
import { prisma } from '../../prisma';
import { hashPassword, type AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import { MODULE_KEYS } from '../../services/permissions';
import { requireFullAccess } from './auth';

/**
 * Settings > Client Access — sign-ins handed to a prospect for a fixed number of days.
 *
 * A client login is an ordinary panel user with `accessExpiresAt` set. `requireAuth` refuses
 * every request after that moment and the login route refuses to sign them in, so nothing has
 * to run at the deadline for access to end. Revoking early moves the deadline to now and signs
 * out their open sessions.
 */
export const clientAccessRouter = Router();
clientAccessRouter.use(requireFullAccess);

const DEMO_ROLE_NAME = 'Client demo';
const MAX_DAYS = 365;
const DAY_MS = 86_400_000;

/** Readable and still ~70 bits: no 0/O or 1/l/I to misread when it is sent over WhatsApp. */
function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const part = () => Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
  return `${part()}-${part()}-${part()}`;
}

/**
 * Phone is the unique key on User. A client often has no reason to give one, so a number that
 * cannot belong to anybody (Indian mobiles never start with 0) stands in for it.
 */
async function placeholderPhone(): Promise<string> {
  for (let i = 0; i < 10; i += 1) {
    const phone = `0${crypto.randomInt(100_000_000, 999_999_999)}`;
    if (!(await prisma.user.findUnique({ where: { phone }, select: { id: true } }))) return phone;
  }
  throw new Error('Could not allocate a placeholder phone number.');
}

/** Everything except Settings, so a client can try every screen but not change the panel itself. */
async function demoRole() {
  const existing = await prisma.panelRole.findUnique({ where: { name: DEMO_ROLE_NAME } });
  if (existing) return existing;
  return prisma.panelRole.create({
    data: {
      name: DEMO_ROLE_NAME,
      description: 'For client trial logins: every module except Settings.',
      isFullAccess: false,
      modules: MODULE_KEYS.filter((m) => m !== 'settings' && m !== 'vendor_portal'),
    },
  });
}

function parseDays(raw: unknown): number | null {
  const days = Math.floor(Number(raw));
  return Number.isFinite(days) && days >= 1 && days <= MAX_DAYS ? days : null;
}

type Row = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows(where: object = {}) {
  return prisma.user.findMany({
    where: { accessExpiresAt: { not: null }, ...where },
    orderBy: { createdAt: 'desc' },
    include: {
      panelRole: { select: { name: true } },
      sessions: { select: { lastSeenAt: true, revokedAt: true }, orderBy: { lastSeenAt: 'desc' } },
    },
  });
}

function shape(u: Row) {
  const expiresAt = u.accessExpiresAt!;
  const live = u.sessions.filter((s) => !s.revokedAt);
  return {
    id: u.id,
    name: u.name,
    email: u.email ?? '',
    phone: u.phone.startsWith('0') ? null : u.phone,
    roleName: u.panelRole?.name ?? null,
    panelRoleId: u.panelRoleId,
    accessExpiresAt: expiresAt.toISOString(),
    state: u.status !== 'active' ? 'disabled' : expiresAt.getTime() <= Date.now() ? 'expired' : 'active',
    lastSeenAt: u.sessions[0]?.lastSeenAt.toISOString() ?? null,
    openSessions: expiresAt.getTime() > Date.now() ? live.length : 0,
    createdAt: u.createdAt.toISOString(),
  };
}

async function one(id: string) {
  const [row] = await loadRows({ id });
  return row ? shape(row) : null;
}

clientAccessRouter.get('/', async (_req, res, next) => {
  try {
    res.json((await loadRows()).map(shape));
  } catch (err) {
    next(err);
  }
});

clientAccessRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const phoneIn = String(req.body?.phone ?? '').trim();
    const days = parseDays(req.body?.days);
    const panelRoleId = String(req.body?.panelRoleId ?? '').trim();

    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid email address is required — it is the login id.' });
    if (phoneIn && !/^\d{10}$/.test(phoneIn)) return res.status(400).json({ error: 'Phone must be 10 digits, or leave it empty.' });
    if (!days) return res.status(400).json({ error: `Access must last between 1 and ${MAX_DAYS} days.` });

    const emailClash = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (emailClash) return res.status(409).json({ error: 'That email address already belongs to another account.' });
    if (phoneIn && (await prisma.user.findUnique({ where: { phone: phoneIn }, select: { id: true } }))) {
      return res.status(409).json({ error: 'That phone number already belongs to another account.' });
    }

    const role = panelRoleId ? await prisma.panelRole.findUnique({ where: { id: panelRoleId } }) : await demoRole();
    if (!role) return res.status(400).json({ error: 'That role no longer exists.' });
    if (role.isFullAccess) return res.status(400).json({ error: 'A client login cannot have full access — pick a limited role.' });

    const password = generatePassword();
    const code = `SR-CLIENT-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const created = await prisma.user.create({
      data: {
        name,
        email,
        phone: phoneIn || (await placeholderPhone()),
        role: 'admin',
        status: 'active',
        passwordHash: await hashPassword(password),
        panelRoleId: role.id,
        accessExpiresAt: new Date(Date.now() + days * DAY_MS),
        partnerCode: code,
        referralCode: code,
      },
    });

    await writeAudit(req, {
      module: 'Settings',
      action: 'Created client access',
      recordId: created.id,
      recordLabel: created.name,
      description: `Client login for ${created.name} (${email}) with role "${role.name}", valid for ${days} day${days === 1 ? '' : 's'}.`,
    });
    // The password is returned this once and never stored in a readable form.
    res.status(201).json({ user: await one(created.id), password });
  } catch (err) {
    next(err);
  }
});

/** Adds days to whatever is left — or to now, if it already lapsed — and re-enables the login. */
clientAccessRouter.post('/:id/extend', async (req: AuthedRequest, res, next) => {
  try {
    const days = parseDays(req.body?.days);
    if (!days) return res.status(400).json({ error: `Extend by 1 to ${MAX_DAYS} days.` });
    const user = await prisma.user.findFirst({ where: { id: String(req.params.id), accessExpiresAt: { not: null } } });
    if (!user) return res.status(404).json({ error: 'Client login not found.' });

    const from = Math.max(Date.now(), user.accessExpiresAt!.getTime());
    await prisma.user.update({ where: { id: user.id }, data: { accessExpiresAt: new Date(from + days * DAY_MS), status: 'active' } });
    await writeAudit(req, {
      module: 'Settings', action: 'Extended client access', recordId: user.id, recordLabel: user.name,
      description: `Client login for ${user.name} extended by ${days} day${days === 1 ? '' : 's'}.`,
    });
    res.json(await one(user.id));
  } catch (err) {
    next(err);
  }
});

/** Ends access now and signs the client out everywhere. */
clientAccessRouter.post('/:id/revoke', async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findFirst({ where: { id: String(req.params.id), accessExpiresAt: { not: null } } });
    if (!user) return res.status(404).json({ error: 'Client login not found.' });
    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { accessExpiresAt: now } }),
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    await writeAudit(req, { module: 'Settings', action: 'Ended client access', recordId: user.id, recordLabel: user.name });
    res.json(await one(user.id));
  } catch (err) {
    next(err);
  }
});

/** A new password, shown once. Existing sessions are signed out so the old one stops working everywhere. */
clientAccessRouter.post('/:id/reset-password', async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findFirst({ where: { id: String(req.params.id), accessExpiresAt: { not: null } } });
    if (!user) return res.status(404).json({ error: 'Client login not found.' });
    const password = generatePassword();
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } }),
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await writeAudit(req, { module: 'Settings', action: 'Reset client password', recordId: user.id, recordLabel: user.name });
    res.json({ user: await one(user.id), password });
  } catch (err) {
    next(err);
  }
});

clientAccessRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findFirst({ where: { id: String(req.params.id), accessExpiresAt: { not: null } } });
    if (!user) return res.status(404).json({ error: 'Client login not found.' });
    await prisma.user.delete({ where: { id: user.id } });
    await writeAudit(req, { module: 'Settings', action: 'Deleted client access', recordId: user.id, recordLabel: user.name });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
