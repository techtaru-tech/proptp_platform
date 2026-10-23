import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { enrollLeads, runWhatsAppDripTick, stopEnrollment } from '../services/whatsappDripEngine';
import { inLeadScope, leadIdsInScope, leadScopeWhere, scopeOf, type Scope } from '../services/hierarchy';
import { buildLeadWhere, type LeadFilter } from '../services/leadFilters';
import { writeAudit } from '../services/audit';
import type { AuthedRequest } from '../services/auth';

/**
 * WhatsApp drip campaigns. Same lifecycle as email sequences — draft, active, paused — with
 * an approved template as every step. Creating the templates themselves is under
 * Notifications → WhatsApp Templates; a step only picks one.
 */
export const whatsappDripsRouter = Router();

const STATUSES = ['draft', 'active', 'paused'];
/** One run reaches at most this many leads, so a careless filter cannot message the whole database. */
const MAX_ENROLL = 1000;

interface StepInput {
  delayDays?: number;
  delayHours?: number;
  templateName?: string;
  language?: string;
  params?: unknown;
  headerMediaUrl?: string;
}

function readSteps(body: any): StepInput[] {
  return Array.isArray(body?.steps) ? body.steps : [];
}

function stepRows(steps: StepInput[]) {
  return steps.map((step, index) => ({
    sortOrder: index,
    delayDays: Math.max(0, Math.floor(Number(step.delayDays) || 0)),
    delayHours: Math.max(0, Math.floor(Number(step.delayHours) || 0)),
    templateName: String(step.templateName ?? '').trim(),
    language: String(step.language ?? 'en').trim() || 'en',
    params: Array.isArray(step.params) ? step.params.map((p) => String(p ?? '')) : [],
    headerMediaUrl: String(step.headerMediaUrl ?? '').trim() || null,
  }));
}

/** Same validation for create and update, so a campaign can never be saved unsendable. */
function validate(body: any, steps: StepInput[]): string | null {
  if (!String(body?.name ?? '').trim()) return 'name is required.';
  if (body?.status !== undefined && !STATUSES.includes(String(body.status))) return 'status must be draft, active or paused.';
  if (steps.length === 0) return 'A campaign needs at least one step.';
  const rows = stepRows(steps);
  if (rows.some((s) => !s.templateName)) return 'Every step needs a template.';
  if (rows.some((s) => s.headerMediaUrl && !/^https:\/\/\S+$/i.test(s.headerMediaUrl))) {
    return 'A header file link must be a public https address.';
  }
  return null;
}

async function enrollmentCounts(dripIds: string[], scope: Scope) {
  const grouped = await prisma.whatsAppDripEnrollment.groupBy({
    by: ['dripId', 'status'],
    where: { dripId: { in: dripIds }, ...(scope.kind === 'all' ? {} : { lead: leadScopeWhere(scope) }) },
    _count: { _all: true },
  });
  const map = new Map<string, { active: number; completed: number; stopped: number }>();
  for (const id of dripIds) map.set(id, { active: 0, completed: 0, stopped: 0 });
  for (const row of grouped) {
    const entry = map.get(row.dripId);
    if (entry && row.status in entry) entry[row.status as keyof typeof entry] = row._count._all;
  }
  return map;
}

function summary(d: { id: string; name: string; description: string | null; status: string; stopOnReply: boolean; stopOnWon: boolean; createdAt: Date }, stepCount: number, tally: { active: number; completed: number; stopped: number }) {
  return {
    id: d.id,
    name: d.name,
    description: d.description ?? undefined,
    status: d.status,
    stopOnReply: d.stopOnReply,
    stopOnWon: d.stopOnWon,
    stepCount,
    activeEnrollments: tally.active,
    completedEnrollments: tally.completed,
    stoppedEnrollments: tally.stopped,
    createdAt: d.createdAt.toISOString(),
  };
}

whatsappDripsRouter.get('/', async (req, res, next) => {
  try {
    const drips = await prisma.whatsAppDrip.findMany({ include: { _count: { select: { steps: true } } }, orderBy: { createdAt: 'desc' } });
    const counts = await enrollmentCounts(drips.map((d) => d.id), await scopeOf(req));
    res.json(drips.map((d) => summary(d, d._count.steps, counts.get(d.id)!)));
  } catch (err) {
    next(err);
  }
});

/** How many leads a filter reaches, before anyone commits to enrolling them. */
whatsappDripsRouter.post('/audience', async (req, res, next) => {
  try {
    const where = inLeadScope(buildLeadWhere((req.body?.leadFilter ?? {}) as LeadFilter), await scopeOf(req));
    const count = await prisma.lead.count({ where });
    res.json({ count, overLimit: count > MAX_ENROLL, limit: MAX_ENROLL });
  } catch (err) {
    next(err);
  }
});

/** Forces a poller tick — the "Run due steps now" action. */
whatsappDripsRouter.post('/run-due', async (_req, res, next) => {
  try {
    await runWhatsAppDripTick();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// An enrollment is its lead's: anything on one is checked against the caller's hierarchy first.
whatsappDripsRouter.use('/enrollments/:enrollmentId', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    if (scope.kind !== 'all') {
      const visible = await prisma.whatsAppDripEnrollment.count({
        where: { id: String(req.params.enrollmentId), lead: leadScopeWhere(scope) },
      });
      if (!visible) return res.status(404).json({ error: 'Enrollment not found' });
    }
    next();
  } catch (err) {
    next(err);
  }
});

whatsappDripsRouter.get('/enrollments/:enrollmentId/sends', async (req, res, next) => {
  try {
    const sends = await prisma.whatsAppDripSend.findMany({ where: { enrollmentId: String(req.params.enrollmentId) }, orderBy: { sentAt: 'asc' } });
    res.json(
      sends.map((s) => ({
        id: s.id,
        stepIndex: s.stepIndex,
        templateName: s.templateName,
        body: s.body,
        status: s.status,
        message: s.message ?? undefined,
        sentAt: s.sentAt.toISOString(),
      }))
    );
  } catch (err) {
    next(err);
  }
});

whatsappDripsRouter.post('/enrollments/:enrollmentId/stop', async (req, res, next) => {
  try {
    const ok = await stopEnrollment(String(req.params.enrollmentId), 'Stopped manually.');
    if (!ok) return res.status(404).json({ error: 'Enrollment not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

whatsappDripsRouter.get('/:id', async (req, res, next) => {
  try {
    const drip = await prisma.whatsAppDrip.findUnique({
      where: { id: String(req.params.id) },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!drip) return res.status(404).json({ error: 'Campaign not found' });
    const tally = (await enrollmentCounts([drip.id], await scopeOf(req))).get(drip.id)!;
    res.json({
      ...summary(drip, drip.steps.length, tally),
      steps: drip.steps.map((s) => ({
        id: s.id,
        delayDays: s.delayDays,
        delayHours: s.delayHours,
        templateName: s.templateName,
        language: s.language,
        params: s.params,
        headerMediaUrl: s.headerMediaUrl ?? undefined,
      })),
    });
  } catch (err) {
    next(err);
  }
});

whatsappDripsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const steps = readSteps(body);
    const error = validate(body, steps);
    if (error) return res.status(400).json({ error });

    const created = await prisma.whatsAppDrip.create({
      data: {
        name: String(body.name).trim(),
        description: body.description ? String(body.description).trim() : null,
        status: String(body.status ?? 'draft'),
        stopOnReply: body.stopOnReply !== false,
        stopOnWon: body.stopOnWon !== false,
        steps: { create: stepRows(steps) },
      },
      select: { id: true, name: true },
    });
    await writeAudit(req, { module: 'CRM', action: 'Created a WhatsApp drip campaign', recordId: created.id, recordLabel: created.name });
    res.status(201).json({ id: created.id });
  } catch (err) {
    next(err);
  }
});

whatsappDripsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const body = req.body ?? {};
    const steps = readSteps(body);
    const error = validate(body, steps);
    if (error) return res.status(400).json({ error });

    // Steps are replaced wholesale. That removes their send records with them, so a campaign
    // that already has enrollments in flight is not restructured under them: the number of steps
    // an enrollment has already passed would no longer line up.
    const inFlight = await prisma.whatsAppDripEnrollment.count({ where: { dripId: id, status: 'active' } });
    const current = await prisma.whatsAppDrip.findUnique({ where: { id }, select: { _count: { select: { steps: true } } } });
    if (!current) return res.status(404).json({ error: 'Campaign not found' });
    if (inFlight > 0 && steps.length < current._count.steps) {
      return res.status(409).json({ error: `${inFlight} lead(s) are part-way through. Pause and stop them before removing steps — you can still edit or add steps.` });
    }

    await prisma.$transaction(async (tx) => {
      await tx.whatsAppDripStep.deleteMany({ where: { dripId: id } });
      await tx.whatsAppDrip.update({
        where: { id },
        data: {
          name: String(body.name).trim(),
          description: body.description ? String(body.description).trim() : null,
          status: String(body.status ?? 'draft'),
          stopOnReply: body.stopOnReply !== false,
          stopOnWon: body.stopOnWon !== false,
          steps: { create: stepRows(steps) },
        },
      });
    });
    await writeAudit(req, { module: 'CRM', action: 'Updated a WhatsApp drip campaign', recordId: id, recordLabel: String(body.name).trim() });
    res.json({ id });
  } catch (err) {
    next(err);
  }
});

whatsappDripsRouter.patch('/:id/status', async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'status must be draft, active or paused.' });
    const updated = await prisma.whatsAppDrip.update({ where: { id: String(req.params.id) }, data: { status }, select: { id: true, name: true } });
    await writeAudit(req, { module: 'CRM', action: `Set a WhatsApp drip campaign to ${status}`, recordId: updated.id, recordLabel: updated.name });
    res.json({ id: updated.id, status });
  } catch (err) {
    next(err);
  }
});

whatsappDripsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const removed = await prisma.whatsAppDrip.delete({ where: { id: String(req.params.id) } });
    await writeAudit(req, { module: 'CRM', action: 'Deleted a WhatsApp drip campaign', recordId: removed.id, recordLabel: removed.name });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

whatsappDripsRouter.post('/:id/enroll', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeOf(req);
    let leadIds: string[];
    if (req.body?.leadFilter) {
      // Only leads the caller can see — a campaign must not message someone outside their team.
      const where: Prisma.LeadWhereInput = inLeadScope(buildLeadWhere(req.body.leadFilter as LeadFilter), scope);
      const rows = await prisma.lead.findMany({ where, select: { id: true }, take: MAX_ENROLL + 1 });
      if (rows.length > MAX_ENROLL) return res.status(400).json({ error: `That reaches more than ${MAX_ENROLL} leads. Narrow the filter.` });
      leadIds = rows.map((r) => r.id);
    } else {
      leadIds = await leadIdsInScope(scope, req.body?.leadIds);
    }
    if (leadIds.length === 0) return res.status(400).json({ error: 'No leads matched.' });

    const result = await enrollLeads(String(req.params.id), leadIds);
    await writeAudit(req, { module: 'CRM', action: `Enrolled ${result.enrolled} lead(s) in a WhatsApp drip campaign`, recordId: String(req.params.id), recordLabel: String(req.params.id) });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

whatsappDripsRouter.get('/:id/enrollments', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    const rows = await prisma.whatsAppDripEnrollment.findMany({
      where: { dripId: String(req.params.id), ...(scope.kind === 'all' ? {} : { lead: leadScopeWhere(scope) }) },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        _count: { select: { sends: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    res.json(
      rows.map((r) => ({
        id: r.id,
        leadId: r.leadId,
        leadName: `${r.lead.firstName} ${r.lead.lastName}`.trim(),
        leadPhone: r.lead.phone,
        leadStatus: r.lead.status,
        status: r.status,
        currentStep: r.currentStep,
        sendCount: r._count.sends,
        nextSendAt: r.nextSendAt?.toISOString(),
        stoppedReason: r.stoppedReason ?? undefined,
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    next(err);
  }
});
