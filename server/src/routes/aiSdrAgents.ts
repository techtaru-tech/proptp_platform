import { Router } from 'express';
import { prisma } from '../prisma';
import {
  NOT_CONFIGURED_NOTE, enrollLead, evaluateEligibility, handOff, logMessage, stopEnrollment,
} from '../services/aiSdrEngine';
import { leadIdsInScope, leadScopeWhere, scopeOf } from '../services/hierarchy';

export const aiSdrRouter = Router();

const GOALS = ['qualify_lead', 'book_meeting'];
const CHANNELS = ['email', 'sms', 'whatsapp'];

function validateAgentBody(body: any): string | null {
  if (!body?.name?.trim()) return 'Name is required.';
  if (!GOALS.includes(body.goal)) return 'Goal must be "qualify_lead" or "book_meeting".';
  if (!CHANNELS.includes(body.channel)) return 'Channel must be email, sms or whatsapp.';
  const max = Number(body.maxFollowUps);
  if (!Number.isFinite(max) || max < 1 || max > 20) return 'Max follow-ups must be between 1 and 20.';
  const gap = Number(body.minHoursBetweenFollowUps);
  if (!Number.isFinite(gap) || gap < 1 || gap > 720) return 'Min hours between follow-ups must be between 1 and 720.';
  return null;
}

function agentWriteData(body: any) {
  return {
    name: body.name.trim(),
    active: body.active === undefined ? true : !!body.active,
    goal: body.goal,
    channel: body.channel,
    persona: body.persona?.trim() || null,
    offerContext: body.offerContext?.trim() || null,
    maxFollowUps: Number(body.maxFollowUps),
    minHoursBetweenFollowUps: Number(body.minHoursBetweenFollowUps),
    respectBusinessHours: !!body.respectBusinessHours,
    handoffUserId: body.handoffUserId || null,
    meetingType: body.meetingType?.trim() || null,
  };
}

/** Tells every client, in one place, that composition/delivery isn't wired up yet. */
aiSdrRouter.get('/capabilities', (_req, res) => {
  res.json({ aiProviderConfigured: false, messagingProviderConfigured: false, note: NOT_CONFIGURED_NOTE });
});

aiSdrRouter.get('/', async (req, res) => {
  const scope = await scopeOf(req);
  const mine = scope.kind === 'all' ? {} : { lead: leadScopeWhere(scope) };
  const agents = await prisma.aiSdrAgent.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { enrollments: { where: mine } } } },
  });

  const activeCounts = await prisma.aiSdrEnrollment.groupBy({ by: ['agentId'], where: { status: 'active', ...mine }, _count: { _all: true } });
  const activeByAgent = new Map(activeCounts.map((c) => [c.agentId, c._count._all]));

  res.json(
    agents.map(({ _count, ...agent }) => ({
      ...agent,
      enrollmentCount: _count.enrollments,
      activeEnrollmentCount: activeByAgent.get(agent.id) ?? 0,
    }))
  );
});

aiSdrRouter.get('/:id', async (req, res) => {
  const scope = await scopeOf(req);
  const agent = await prisma.aiSdrAgent.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { enrollments: { where: scope.kind === 'all' ? {} : { lead: leadScopeWhere(scope) } } } } },
  });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const { _count, ...rest } = agent;
  res.json({ ...rest, enrollmentCount: _count.enrollments });
});

aiSdrRouter.post('/', async (req, res) => {
  const error = validateAgentBody(req.body);
  if (error) return res.status(400).json({ error });
  const created = await prisma.aiSdrAgent.create({ data: agentWriteData(req.body) });
  res.status(201).json({ ...created, enrollmentCount: 0, activeEnrollmentCount: 0 });
});

aiSdrRouter.patch('/:id', async (req, res) => {
  const existing = await prisma.aiSdrAgent.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Agent not found' });
  const error = validateAgentBody(req.body);
  if (error) return res.status(400).json({ error });
  const updated = await prisma.aiSdrAgent.update({ where: { id: existing.id }, data: agentWriteData(req.body) });
  res.json(updated);
});

aiSdrRouter.post('/:id/toggle', async (req, res) => {
  const existing = await prisma.aiSdrAgent.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Agent not found' });
  const updated = await prisma.aiSdrAgent.update({ where: { id: existing.id }, data: { active: !existing.active } });
  res.json(updated);
});

aiSdrRouter.delete('/:id', async (req, res) => {
  const deleted = await prisma.aiSdrAgent.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!deleted) return res.status(404).json({ error: 'Agent not found' });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------

aiSdrRouter.post('/:id/enroll', async (req, res) => {
  const requested = (req.body as { leadIds?: string[] }).leadIds;
  if (!Array.isArray(requested) || requested.length === 0) return res.status(400).json({ error: 'leadIds is required.' });
  // Only leads the caller can see; the rest are skipped rather than enrolled on their say-so.
  const leadIds = await leadIdsInScope(await scopeOf(req), requested);

  const results = await Promise.all(leadIds.map(async (leadId) => ({ leadId, ...(await enrollLead(req.params.id, leadId)) })));
  res.json({
    enrolled: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => !r.ok).length,
    results,
  });
});

aiSdrRouter.get('/:id/enrollments', async (req, res) => {
  const agent = await prisma.aiSdrAgent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const scope = await scopeOf(req);
  const enrollments = await prisma.aiSdrEnrollment.findMany({
    where: { agentId: agent.id, ...(scope.kind === 'all' ? {} : { lead: leadScopeWhere(scope) }) },
    orderBy: { createdAt: 'desc' },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, assignedUserId: true } },
      _count: { select: { messages: true } },
    },
  });

  const rows = await Promise.all(
    enrollments.map(async ({ lead, _count, ...e }) => ({
      ...e,
      leadName: `${lead.firstName} ${lead.lastName}`.trim(),
      leadPhone: lead.phone,
      leadEmail: lead.email,
      messageCount: _count.messages,
      eligibility: await evaluateEligibility(agent, e, lead),
    }))
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// One enrollment's thread and lifecycle actions. Mounted on the same router under
// /enrollments/... so the frontend only needs one base path.
// ---------------------------------------------------------------------------

// Anything on one enrollment is checked against the lead's owner first.
aiSdrRouter.use('/enrollments/:enrollmentId', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    if (scope.kind !== 'all') {
      const visible = await prisma.aiSdrEnrollment.count({
        where: { id: String(req.params.enrollmentId), lead: leadScopeWhere(scope) },
      });
      if (!visible) return res.status(404).json({ error: 'Enrollment not found' });
    }
    next();
  } catch (err) {
    next(err);
  }
});

aiSdrRouter.get('/enrollments/:enrollmentId/messages', async (req, res) => {
  const messages = await prisma.aiSdrMessage.findMany({
    where: { enrollmentId: req.params.enrollmentId },
    orderBy: { createdAt: 'asc' },
  });
  res.json(messages);
});

aiSdrRouter.post('/enrollments/:enrollmentId/messages', async (req, res) => {
  const { direction, body } = req.body as { direction?: string; body?: string };
  if (direction !== 'outbound' && direction !== 'inbound') return res.status(400).json({ error: 'direction must be "outbound" or "inbound".' });
  if (!body?.trim()) return res.status(400).json({ error: 'Message body is required.' });

  const result = await logMessage(req.params.enrollmentId, { direction, body: body.trim() });
  if (!result.ok) return res.status(400).json({ error: result.message });
  res.status(201).json(result);
});

aiSdrRouter.post('/enrollments/:enrollmentId/handoff', async (req, res) => {
  const { outcome } = req.body as { outcome?: 'qualified' | 'exhausted' };
  const result = await handOff(req.params.enrollmentId, outcome === 'exhausted' ? 'exhausted' : 'qualified');
  if (!result.ok) return res.status(400).json({ error: result.message });
  res.json(result);
});

aiSdrRouter.post('/enrollments/:enrollmentId/stop', async (req, res) => {
  const { reason } = req.body as { reason?: string };
  const result = await stopEnrollment(req.params.enrollmentId, reason);
  if (!result.ok) return res.status(400).json({ error: result.message });
  res.json(result);
});
