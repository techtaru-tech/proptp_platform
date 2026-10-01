import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { enrollLeads, runEmailSequenceTick, stopEnrollment } from '../services/emailSequenceEngine';
import { isEmailConfigured } from '../services/email';
import { leadIdsInScope, leadScopeWhere, scopeOf, type Scope } from '../services/hierarchy';

export const emailSequencesRouter = Router();

const STATUSES = ['draft', 'active', 'paused'];

interface StepInput {
  delayDays?: number;
  delayHours?: number;
  subject?: string;
  body?: string;
}

function readSteps(body: any): StepInput[] {
  return Array.isArray(body?.steps) ? body.steps : [];
}

function stepRows(steps: StepInput[]) {
  return steps.map((step, index) => ({
    sortOrder: index,
    delayDays: Math.max(0, Number(step.delayDays) || 0),
    delayHours: Math.max(0, Number(step.delayHours) || 0),
    subject: String(step.subject ?? '').trim(),
    body: String(step.body ?? ''),
  }));
}

/** Same validation for create and update, so a sequence can never be saved unsendable. */
function validate(body: any, steps: StepInput[]): string | null {
  if (!String(body?.name ?? '').trim()) return 'name is required.';
  if (body?.status !== undefined && !STATUSES.includes(String(body.status))) {
    return 'status must be draft, active or paused.';
  }
  if (steps.length === 0) return 'A sequence needs at least one step.';
  const rows = stepRows(steps);
  if (rows.some((s) => !s.subject)) return 'Every step needs a subject.';
  if (rows.some((s) => !s.body.trim())) return 'Every step needs a body.';
  return null;
}

const listInclude = {
  _count: { select: { steps: true } },
} satisfies Prisma.EmailSequenceInclude;

/** Enrollment tallies are counted per status in one grouped query rather than per row. */
async function enrollmentCounts(sequenceIds: string[], scope: Scope) {
  const grouped = await prisma.emailSequenceEnrollment.groupBy({
    by: ['sequenceId', 'status'],
    where: { sequenceId: { in: sequenceIds }, ...(scope.kind === 'all' ? {} : { lead: leadScopeWhere(scope) }) },
    _count: { _all: true },
  });
  const map = new Map<string, { active: number; completed: number; stopped: number }>();
  for (const id of sequenceIds) map.set(id, { active: 0, completed: 0, stopped: 0 });
  for (const row of grouped) {
    const entry = map.get(row.sequenceId);
    if (entry && row.status in entry) entry[row.status as keyof typeof entry] = row._count._all;
  }
  return map;
}

emailSequencesRouter.get('/capabilities', async (_req, res, next) => {
  try {
    res.json({ emailProviderConfigured: await isEmailConfigured() });
  } catch (err) {
    next(err);
  }
});

emailSequencesRouter.get('/', async (req, res, next) => {
  try {
    const sequences = await prisma.emailSequence.findMany({ include: listInclude, orderBy: { createdAt: 'desc' } });
    const counts = await enrollmentCounts(sequences.map((s) => s.id), await scopeOf(req));
    res.json(
      sequences.map((s) => {
        const tally = counts.get(s.id)!;
        return {
          id: s.id,
          name: s.name,
          description: s.description ?? undefined,
          status: s.status,
          stopOnReply: s.stopOnReply,
          stopOnWon: s.stopOnWon,
          stepCount: s._count.steps,
          activeEnrollments: tally.active,
          completedEnrollments: tally.completed,
          stoppedEnrollments: tally.stopped,
          createdAt: s.createdAt.toISOString(),
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

emailSequencesRouter.get('/:id', async (req, res, next) => {
  try {
    const sequence = await prisma.emailSequence.findUnique({
      where: { id: String(req.params.id) },
      include: { steps: { orderBy: { sortOrder: 'asc' } }, ...listInclude },
    });
    if (!sequence) return res.status(404).json({ error: 'Sequence not found' });
    const tally = (await enrollmentCounts([sequence.id], await scopeOf(req))).get(sequence.id)!;
    res.json({
      id: sequence.id,
      name: sequence.name,
      description: sequence.description ?? undefined,
      status: sequence.status,
      stopOnReply: sequence.stopOnReply,
      stopOnWon: sequence.stopOnWon,
      stepCount: sequence._count.steps,
      activeEnrollments: tally.active,
      completedEnrollments: tally.completed,
      stoppedEnrollments: tally.stopped,
      createdAt: sequence.createdAt.toISOString(),
      steps: sequence.steps.map((s) => ({
        id: s.id,
        delayDays: s.delayDays,
        delayHours: s.delayHours,
        subject: s.subject,
        body: s.body,
      })),
    });
  } catch (err) {
    next(err);
  }
});

emailSequencesRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const steps = readSteps(body);
    const error = validate(body, steps);
    if (error) return res.status(400).json({ error });

    const created = await prisma.emailSequence.create({
      data: {
        name: String(body.name).trim(),
        description: body.description ? String(body.description).trim() : null,
        status: String(body.status ?? 'draft'),
        stopOnReply: body.stopOnReply !== false,
        stopOnWon: body.stopOnWon !== false,
        steps: { create: stepRows(steps) },
      },
      select: { id: true },
    });
    res.status(201).json({ id: created.id });
  } catch (err) {
    next(err);
  }
});

emailSequencesRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const body = req.body ?? {};
    const steps = readSteps(body);
    const error = validate(body, steps);
    if (error) return res.status(400).json({ error });

    // Steps are replaced wholesale — they are edited as one list in the UI, and a diff would
    // buy nothing here. Existing sends keep their own rendered copy, so history survives.
    await prisma.$transaction(async (tx) => {
      await tx.emailSequenceStep.deleteMany({ where: { sequenceId: id } });
      await tx.emailSequence.update({
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
    res.json({ id });
  } catch (err) {
    next(err);
  }
});

emailSequencesRouter.delete('/:id', async (req, res, next) => {
  try {
    await prisma.emailSequence.delete({ where: { id: String(req.params.id) } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

emailSequencesRouter.post('/:id/enroll', async (req, res, next) => {
  try {
    // Only leads the caller can see may be enrolled — a sequence would otherwise email a lead
    // from outside their team on their say-so.
    const leadIds = await leadIdsInScope(await scopeOf(req), req.body?.leadIds);
    if (leadIds.length === 0) return res.status(400).json({ error: 'leadIds is required.' });
    res.json(await enrollLeads(String(req.params.id), leadIds));
  } catch (err) {
    next(err);
  }
});

emailSequencesRouter.get('/:id/enrollments', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    const rows = await prisma.emailSequenceEnrollment.findMany({
      where: { sequenceId: String(req.params.id), ...(scope.kind === 'all' ? {} : { lead: leadScopeWhere(scope) }) },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
        _count: { select: { sends: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(
      rows.map((r) => ({
        id: r.id,
        leadId: r.leadId,
        leadName: `${r.lead.firstName} ${r.lead.lastName}`.trim(),
        leadEmail: r.lead.email ?? undefined,
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

// An enrollment is its lead's: anything on one is checked against the caller's hierarchy first.
emailSequencesRouter.use('/enrollments/:enrollmentId', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    if (scope.kind !== 'all') {
      const visible = await prisma.emailSequenceEnrollment.count({
        where: { id: String(req.params.enrollmentId), lead: leadScopeWhere(scope) },
      });
      if (!visible) return res.status(404).json({ error: 'Enrollment not found' });
    }
    next();
  } catch (err) {
    next(err);
  }
});

emailSequencesRouter.get('/enrollments/:enrollmentId/sends', async (req, res, next) => {
  try {
    const sends = await prisma.emailSequenceSend.findMany({
      where: { enrollmentId: String(req.params.enrollmentId) },
      orderBy: { sentAt: 'asc' },
    });
    res.json(
      sends.map((s) => ({
        id: s.id,
        stepIndex: s.stepIndex,
        subject: s.subject,
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

emailSequencesRouter.post('/enrollments/:enrollmentId/stop', async (req, res, next) => {
  try {
    const ok = await stopEnrollment(String(req.params.enrollmentId), 'Stopped manually.');
    if (!ok) return res.status(404).json({ error: 'Enrollment not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Forces a poller tick — the "Run due steps now" action, so nobody has to wait a minute. */
emailSequencesRouter.post('/run-due', async (_req, res, next) => {
  try {
    await runEmailSequenceTick();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
