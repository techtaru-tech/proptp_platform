import { Router } from 'express';
import { prisma } from '../../prisma';
import { hashPassword, type AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import { getPolicy } from '../../services/salesPolicy';
import { brokerageFor, partnerPortalRole, protectedUntil } from '../../services/partners';

/**
 * Channel partners — /api/channel-partners (staff) and /api/partner-portal (the partner's own login).
 *
 * A channel partner is an existing agent. The portal keys everything off the signed-in login's own
 * user id, never an id from the request, so a partner has no parameter to change to read another's
 * leads or brokerage.
 */
export const adminChannelPartnersRouter = Router();
export const partnerPortalRouter = Router();

const str = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const actorName = async (req: AuthedRequest) => (await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { name: true } }))?.name ?? 'Unknown';

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

adminChannelPartnersRouter.get('/', async (_req, res, next) => {
  try {
    const partners = await prisma.user.findMany({ where: { role: 'channel_partner' }, orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, name: true, phone: true, email: true, partnerCode: true, status: true, kycStatus: true, authorisedProjectIds: true, passwordHash: true, panelRoleId: true, createdAt: true } });
    const ids = partners.map((p) => p.id);
    const [leads, bookings, open] = await Promise.all([
      prisma.lead.groupBy({ by: ['partnerId'], where: { partnerId: { in: ids }, archivedAt: null }, _count: true }),
      prisma.booking.groupBy({ by: ['userId'], where: { userId: { in: ids }, isDeposit: 0, status: { not: 'cancelled' } }, _count: true }),
      prisma.partnerDispute.groupBy({ by: ['partnerId'], where: { partnerId: { in: ids }, status: 'open' }, _count: true }),
    ]);
    const n = (rows: { _count: number; [k: string]: unknown }[], key: string) => new Map(rows.map((r) => [r[key] as string, r._count]));
    const L = n(leads as never, 'partnerId'), B = n(bookings as never, 'userId'), D = n(open as never, 'partnerId');
    res.json(partners.map(({ passwordHash, panelRoleId, ...p }) => ({ ...p, createdAt: p.createdAt.toISOString(), hasLogin: !!passwordHash && !!panelRoleId, leads: L.get(p.id) ?? 0, bookings: B.get(p.id) ?? 0, openDisputes: D.get(p.id) ?? 0 })));
  } catch (err) {
    next(err);
  }
});

adminChannelPartnersRouter.get('/:id', async (req, res, next) => {
  try {
    const p = await prisma.user.findFirst({ where: { id: String(req.params.id), role: 'channel_partner' }, select: { id: true, name: true, phone: true, email: true, partnerCode: true, status: true, kycStatus: true, city: true, aadhaarNumber: true, panNumber: true, authorisedProjectIds: true, passwordHash: true, panelRoleId: true, createdAt: true } });
    if (!p) return res.status(404).json({ error: 'Channel partner not found.' });
    const policy = await getPolicy();
    const [leads, bookings, disputes, brokerage, projects] = await Promise.all([
      prisma.lead.findMany({ where: { partnerId: p.id, archivedAt: null }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, firstName: true, lastName: true, phone: true, status: true, createdAt: true, interestedProject: { select: { projectName: true } }, stage: { select: { name: true } } } }),
      prisma.booking.findMany({ where: { userId: p.id, isDeposit: 0 }, orderBy: { createdAt: 'desc' }, select: { id: true, reference: true, bookingName: true, amount: true, status: true, unit: { select: { propertyNumber: true, project: { select: { projectName: true } } } } } }),
      prisma.partnerDispute.findMany({ where: { partnerId: p.id }, orderBy: { createdAt: 'desc' } }),
      brokerageFor(p.id),
      prisma.project.findMany({ select: { id: true, projectName: true }, orderBy: { projectName: 'asc' } }),
    ]);
    const { passwordHash, panelRoleId, ...rest } = p;
    res.json({
      ...rest, createdAt: rest.createdAt.toISOString(), hasLogin: !!passwordHash && !!panelRoleId, projects,
      leads: leads.map((l) => { const until = protectedUntil(l.createdAt, policy); return { id: l.id, name: `${l.firstName} ${l.lastName}`.trim(), phone: l.phone, status: l.status, stage: l.stage?.name ?? null, projectName: l.interestedProject?.projectName ?? null, registeredAt: l.createdAt.toISOString(), protectedUntil: until.toISOString(), protected: until.getTime() > Date.now() }; }),
      bookings: bookings.map((b) => ({ id: b.id, reference: b.reference, buyerName: b.bookingName, amount: b.amount, status: b.status, unit: b.unit.propertyNumber, projectName: b.unit.project.projectName })),
      disputes: disputes.map((d) => ({ ...d, createdAt: d.createdAt.toISOString(), resolvedAt: d.resolvedAt?.toISOString() ?? null })),
      brokerage,
    });
  } catch (err) {
    next(err);
  }
});

/** Which projects this partner may sell. Empty means no restriction has been set. */
adminChannelPartnersRouter.patch('/:id/projects', async (req: AuthedRequest, res, next) => {
  try {
    const ids: unknown = req.body?.projectIds;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'projectIds must be a list.' });
    const unique = Array.from(new Set(ids.map(String)));
    if (unique.length && (await prisma.project.count({ where: { id: { in: unique } } })) !== unique.length) return res.status(400).json({ error: 'One of those projects does not exist.' });
    const partner = await prisma.user.findFirst({ where: { id: String(req.params.id), role: 'channel_partner' }, select: { id: true, name: true } });
    if (!partner) return res.status(404).json({ error: 'Channel partner not found.' });
    await prisma.user.update({ where: { id: partner.id }, data: { authorisedProjectIds: unique } });
    await writeAudit(req, { module: 'Partners', action: 'Set authorised projects', recordId: partner.id, recordLabel: partner.name, description: `${unique.length} project(s).` });
    res.json({ projectIds: unique });
  } catch (err) {
    next(err);
  }
});

/** Gives the partner a web login (or sets a new password for the one they have). */
adminChannelPartnersRouter.put('/:id/login', async (req: AuthedRequest, res, next) => {
  try {
    const partner = await prisma.user.findFirst({ where: { id: String(req.params.id), role: 'channel_partner' }, select: { id: true, name: true, email: true, passwordHash: true, panelRoleId: true } });
    if (!partner) return res.status(404).json({ error: 'Channel partner not found.' });
    const email = String(req.body?.email ?? partner.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid login email is required.' });
    if (password.length < 8) return res.status(400).json({ error: 'The password must be at least 8 characters.' });
    if (await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, id: { not: partner.id } } })) return res.status(409).json({ error: 'That email already belongs to another account.' });
    const role = await partnerPortalRole();
    await prisma.user.update({ where: { id: partner.id }, data: { email, passwordHash: await hashPassword(password), panelRoleId: role.id } });
    await writeAudit(req, { module: 'Partners', action: partner.passwordHash ? 'Reset partner login' : 'Gave partner a portal login', recordId: partner.id, recordLabel: partner.name, description: email });
    res.json({ hasLogin: true, email });
  } catch (err) {
    next(err);
  }
});

adminChannelPartnersRouter.delete('/:id/login', async (req: AuthedRequest, res, next) => {
  try {
    const partner = await prisma.user.findFirst({ where: { id: String(req.params.id), role: 'channel_partner' }, select: { id: true, name: true } });
    if (!partner) return res.status(404).json({ error: 'Channel partner not found.' });
    await prisma.user.update({ where: { id: partner.id }, data: { passwordHash: null, panelRoleId: null } });
    await prisma.session.deleteMany({ where: { userId: partner.id } }).catch(() => undefined);
    await writeAudit(req, { module: 'Partners', action: 'Removed partner login', recordId: partner.id, recordLabel: partner.name, description: '' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminChannelPartnersRouter.post('/:id/disputes', async (req: AuthedRequest, res, next) => {
  try {
    const title = String(req.body?.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'Give the dispute a title.' });
    const partner = await prisma.user.findFirst({ where: { id: String(req.params.id), role: 'channel_partner' }, select: { id: true, name: true } });
    if (!partner) return res.status(404).json({ error: 'Channel partner not found.' });
    const d = await prisma.partnerDispute.create({ data: { partnerId: partner.id, title, details: String(req.body?.details ?? '').trim(), bookingId: str(req.body?.bookingId), leadId: str(req.body?.leadId), raisedByName: await actorName(req) } });
    await writeAudit(req, { module: 'Partners', action: 'Logged partner dispute', recordId: partner.id, recordLabel: partner.name, description: title });
    res.status(201).json(d);
  } catch (err) {
    next(err);
  }
});

adminChannelPartnersRouter.patch('/disputes/:id', async (req: AuthedRequest, res, next) => {
  try {
    const resolution = String(req.body?.resolution ?? '').trim();
    if (!resolution) return res.status(400).json({ error: 'Say how it was resolved.' });
    const d = await prisma.partnerDispute.findUnique({ where: { id: String(req.params.id) } });
    if (!d) return res.status(404).json({ error: 'Dispute not found.' });
    if (d.status === 'resolved') return res.status(409).json({ error: 'This dispute is already resolved.' });
    const updated = await prisma.partnerDispute.update({ where: { id: d.id }, data: { status: 'resolved', resolution, resolvedByName: await actorName(req), resolvedAt: new Date() } });
    await writeAudit(req, { module: 'Partners', action: 'Resolved partner dispute', recordId: d.partnerId, recordLabel: d.title, description: resolution });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The partner's own portal
// ---------------------------------------------------------------------------

partnerPortalRouter.use(async (req: AuthedRequest, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.auth!.sub }, select: { role: true, status: true } });
    if (!me || me.role !== 'channel_partner' || me.status !== 'active') return res.status(403).json({ error: 'This login is not an active channel partner.' });
    next();
  } catch (err) {
    next(err);
  }
});

partnerPortalRouter.get('/me', async (req: AuthedRequest, res, next) => {
  try {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub }, select: { id: true, name: true, partnerCode: true, kycStatus: true, authorisedProjectIds: true } });
    const policy = await getPolicy();
    const [projects, leads, bookings, brokerage] = await Promise.all([
      prisma.project.findMany({ where: me.authorisedProjectIds.length ? { id: { in: me.authorisedProjectIds } } : {}, select: { id: true, projectName: true }, orderBy: { projectName: 'asc' } }),
      prisma.lead.count({ where: { partnerId: me.id, archivedAt: null } }),
      prisma.booking.count({ where: { userId: me.id, isDeposit: 0, status: { not: 'cancelled' } } }),
      brokerageFor(me.id),
    ]);
    res.json({ name: me.name, partnerCode: me.partnerCode, kycStatus: me.kycStatus, restricted: me.authorisedProjectIds.length > 0, projects, leadProtectionDays: policy.leadProtectionDays, leads, bookings, totals: brokerage.totals });
  } catch (err) {
    next(err);
  }
});

partnerPortalRouter.get('/leads', async (req: AuthedRequest, res, next) => {
  try {
    const policy = await getPolicy();
    const rows = await prisma.lead.findMany({ where: { partnerId: req.auth!.sub, archivedAt: null }, orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, firstName: true, lastName: true, phone: true, status: true, createdAt: true, interestedProject: { select: { projectName: true } }, stage: { select: { name: true } } } });
    res.json(rows.map((l) => { const until = protectedUntil(l.createdAt, policy); return { id: l.id, name: `${l.firstName} ${l.lastName}`.trim(), phone: l.phone, status: l.status, stage: l.stage?.name ?? null, projectName: l.interestedProject?.projectName ?? null, registeredAt: l.createdAt.toISOString(), protectedUntil: until.toISOString(), protected: until.getTime() > Date.now() }; }));
  } catch (err) {
    next(err);
  }
});

/** Registers a buyer. The number must not already be in the system: whoever registered it first keeps it. */
partnerPortalRouter.post('/leads', async (req: AuthedRequest, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const phone = String(req.body?.phone ?? '').replace(/\D/g, '').slice(-10);
    const projectId = str(req.body?.projectId);
    if (!name) return res.status(400).json({ error: 'Enter the buyer’s name.' });
    if (!/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'Enter a 10-digit phone number.' });
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub }, select: { authorisedProjectIds: true } });
    if (projectId) {
      if (!(await prisma.project.count({ where: { id: projectId } }))) return res.status(400).json({ error: 'That project does not exist.' });
      if (me.authorisedProjectIds.length && !me.authorisedProjectIds.includes(projectId)) return res.status(403).json({ error: 'You are not authorised to sell that project.' });
    }
    const policy = await getPolicy();
    const existing = await prisma.lead.findFirst({ where: { phone: { endsWith: phone }, archivedAt: null }, select: { partnerId: true, createdAt: true } });
    if (existing) {
      if (existing.partnerId === req.auth!.sub) {
        return res.status(409).json({ error: `You already registered this number on ${existing.createdAt.toLocaleDateString('en-IN')}. It stays yours until ${protectedUntil(existing.createdAt, policy).toLocaleDateString('en-IN')}.` });
      }
      return res.status(409).json({ error: 'This number is already in our system, so it cannot be registered again.' });
    }
    const [firstName, ...rest] = name.split(/\s+/);
    const created = await prisma.lead.create({ data: { firstName, lastName: rest.join(' '), phone, preferredLocations: [], source: 'channel_partner', partnerId: req.auth!.sub, interestedProjectId: projectId ?? undefined, notes: str(req.body?.note) ?? undefined } });
    await prisma.leadActivity.create({ data: { leadId: created.id, type: 'created', description: `Registered by channel partner. Protected for ${policy.leadProtectionDays} days.`, userName: await actorName(req) } });
    res.status(201).json({ id: created.id, protectedUntil: protectedUntil(created.createdAt, policy).toISOString() });
  } catch (err) {
    next(err);
  }
});

partnerPortalRouter.get('/bookings', async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.booking.findMany({ where: { userId: req.auth!.sub, isDeposit: 0 }, orderBy: { createdAt: 'desc' }, select: { id: true, reference: true, bookingName: true, amount: true, status: true, createdAt: true, unit: { select: { propertyNumber: true, project: { select: { projectName: true } } } } } });
    res.json(rows.map((b) => ({ id: b.id, reference: b.reference, buyerName: b.bookingName, amount: b.amount, status: b.status, unit: b.unit.propertyNumber, projectName: b.unit.project.projectName, bookedAt: b.createdAt.toISOString() })));
  } catch (err) {
    next(err);
  }
});

partnerPortalRouter.get('/brokerage', async (req: AuthedRequest, res, next) => {
  try {
    res.json(await brokerageFor(req.auth!.sub));
  } catch (err) {
    next(err);
  }
});

partnerPortalRouter.get('/disputes', async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.partnerDispute.findMany({ where: { partnerId: req.auth!.sub }, orderBy: { createdAt: 'desc' } });
    res.json(rows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString(), resolvedAt: d.resolvedAt?.toISOString() ?? null })));
  } catch (err) {
    next(err);
  }
});

partnerPortalRouter.post('/disputes', async (req: AuthedRequest, res, next) => {
  try {
    const title = String(req.body?.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'Give the dispute a title.' });
    const bookingId = str(req.body?.bookingId);
    if (bookingId && !(await prisma.booking.count({ where: { id: bookingId, userId: req.auth!.sub } }))) return res.status(404).json({ error: 'That booking is not yours.' });
    const d = await prisma.partnerDispute.create({ data: { partnerId: req.auth!.sub, title, details: String(req.body?.details ?? '').trim(), bookingId, raisedByName: await actorName(req) } });
    res.status(201).json(d);
  } catch (err) {
    next(err);
  }
});
