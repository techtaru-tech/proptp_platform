import { Router } from 'express';
import type { Prisma, SiteVisitStatus } from '@prisma/client';
import { prisma } from '../prisma';
import type { AuthedRequest } from '../services/auth';
import { actorNameOf, canAssignTo, findLeadInScope, leadScopeWhere, scopeOf, type Scope } from '../services/hierarchy';

/**
 * Site visits — /api/site-visits.
 *
 * A visit hangs off a lead and a project. The lead's pipeline stage and the follow-up reminders
 * move with it so nobody has to remember to do it by hand: scheduling puts the lead at "Site Visit
 * Planned" and raises a reminder for the host; completing it records the outcome, puts the lead
 * at "Site Visit Done" and schedules the follow-up. Conversion (visit -> booking) is read from the
 * lead afterwards in the reports, never typed in.
 *
 * Who may see a visit follows the lead (services/hierarchy.ts), plus the host's own visits.
 */
export const siteVisitsRouter = Router();

const OUTCOMES = ['ready_to_book', 'interested', 'thinking', 'not_interested'] as const;
const TEMPS = ['hot', 'warm', 'cold'];
const OPEN: SiteVisitStatus[] = ['scheduled', 'confirmed'];
const DAY = 86_400_000;

function visitScope(scope: Scope): Prisma.SiteVisitWhereInput {
  if (scope.kind === 'all') return {};
  return { OR: [{ lead: leadScopeWhere(scope) }, { hostId: { in: scope.userIds } }] };
}

const include = {
  lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true, temperature: true } },
  project: { select: { id: true, projectName: true } },
  host: { select: { id: true, name: true } },
} satisfies Prisma.SiteVisitInclude;

type Row = Prisma.SiteVisitGetPayload<{ include: typeof include }>;

const shape = (v: Row) => ({
  id: v.id, leadId: v.leadId, leadName: `${v.lead.firstName} ${v.lead.lastName}`.trim(), leadPhone: v.lead.phone, leadStatus: v.lead.status,
  projectId: v.projectId, projectName: v.project.projectName, hostId: v.hostId, hostName: v.host?.name ?? null,
  scheduledAt: v.scheduledAt.toISOString(), status: v.status, visitorCount: v.visitorCount, confirmedAt: v.confirmedAt?.toISOString() ?? null,
  completedAt: v.completedAt?.toISOString() ?? null, outcome: v.outcome, interest: v.interest, feedback: v.feedback, nextAction: v.nextAction, cancelReason: v.cancelReason,
  // A visit still open an hour after its time is overdue for an outcome, not "upcoming".
  needsOutcome: OPEN.includes(v.status) && v.scheduledAt.getTime() < Date.now() - 3_600_000,
});

async function findVisit(scope: Scope, id: string) {
  return prisma.siteVisit.findFirst({ where: { AND: [{ id }, visitScope(scope)] }, include });
}

/** Moves a lead forward in its pipeline to the named stage; never backwards, never out of Won/Lost. */
async function advanceLead(leadId: string, stageName: string, actor: string, reason: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { stage: true } });
  if (!lead || !lead.pipelineId || lead.status === 'won' || lead.status === 'lost') return;
  const target = await prisma.pipelineStage.findFirst({ where: { pipelineId: lead.pipelineId, name: stageName } });
  if (!target || (lead.stage && target.sortOrder <= lead.stage.sortOrder)) return;
  await prisma.lead.update({
    where: { id: leadId },
    data: { pipelineStageId: target.id, stageEnteredAt: new Date(), ...(lead.status === 'new' || lead.status === 'contacted' ? { status: 'qualified' } : {}) },
  });
  await prisma.leadStageHistoryEntry.create({ data: { leadId, fromStageName: lead.stage?.name, toStageName: target.name, actorName: actor } });
  await prisma.leadActivity.create({ data: { leadId, type: 'stage_moved', description: `Moved to "${target.name}" — ${reason}.`, userName: actor } });
}

/** Closes the reminder raised for a visit. */
async function closeReminder(followUpId: string | null, status: 'completed' | 'cancelled' | 'missed') {
  if (!followUpId) return;
  await prisma.leadFollowUp.updateMany({ where: { id: followUpId, status: { in: ['pending', 'rescheduled'] } }, data: { status, completed: status === 'completed', completedAt: status === 'completed' ? new Date() : null } });
}

const when = (d: Date) => d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// ---------------------------------------------------------------------------

siteVisitsRouter.get('/', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    const view = String(req.query.view ?? 'upcoming');
    const where: Prisma.SiteVisitWhereInput = { AND: [visitScope(scope)] };
    const and = where.AND as Prisma.SiteVisitWhereInput[];
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
    if (view === 'today') and.push({ scheduledAt: { gte: startOfDay, lte: endOfDay }, status: { in: OPEN } });
    else if (view === 'upcoming') and.push({ scheduledAt: { gte: startOfDay }, status: { in: OPEN } });
    else if (view === 'needs_outcome') and.push({ scheduledAt: { lt: new Date(now.getTime() - 3_600_000) }, status: { in: OPEN } });
    else if (view === 'done') and.push({ status: 'done' });
    else if (view === 'closed') and.push({ status: { in: ['cancelled', 'no_show'] } });
    if (req.query.hostId) and.push({ hostId: String(req.query.hostId) });
    if (req.query.projectId) and.push({ projectId: String(req.query.projectId) });
    if (req.query.leadId) and.push({ leadId: String(req.query.leadId) });
    const rows = await prisma.siteVisit.findMany({ where, include, orderBy: { scheduledAt: view === 'done' || view === 'closed' || view === 'needs_outcome' ? 'desc' : 'asc' }, take: 300 });
    res.json(rows.map(shape));
  } catch (err) {
    next(err);
  }
});

/** The few figures at the top of the page, over the caller's own visits. */
siteVisitsRouter.get('/summary', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    const now = new Date();
    const sod = new Date(now); sod.setHours(0, 0, 0, 0);
    const eod = new Date(now); eod.setHours(23, 59, 59, 999);
    const base = visitScope(scope);
    const [today, upcoming, needsOutcome, doneThisMonth] = await Promise.all([
      prisma.siteVisit.count({ where: { AND: [base, { scheduledAt: { gte: sod, lte: eod }, status: { in: OPEN } }] } }),
      prisma.siteVisit.count({ where: { AND: [base, { scheduledAt: { gt: eod }, status: { in: OPEN } }] } }),
      prisma.siteVisit.count({ where: { AND: [base, { scheduledAt: { lt: new Date(now.getTime() - 3_600_000) }, status: { in: OPEN } }] } }),
      prisma.siteVisit.count({ where: { AND: [base, { status: 'done', completedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } }] } }),
    ]);
    res.json({ today, upcoming, needsOutcome, doneThisMonth });
  } catch (err) {
    next(err);
  }
});

siteVisitsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeOf(req);
    const b = req.body ?? {};
    const lead = await findLeadInScope(scope, String(b.leadId ?? ''));
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const project = await prisma.project.findUnique({ where: { id: String(b.projectId ?? '') }, select: { id: true, projectName: true } });
    if (!project) return res.status(400).json({ error: 'Choose the project they will visit.' });
    const scheduledAt = new Date(String(b.scheduledAt ?? ''));
    if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'Choose the date and time of the visit.' });
    if (scheduledAt.getTime() < Date.now() - 5 * 60_000) return res.status(400).json({ error: 'A visit cannot be scheduled in the past.' });
    const visitors = Math.round(Number(b.visitorCount ?? 1));
    if (!Number.isFinite(visitors) || visitors < 1 || visitors > 50) return res.status(400).json({ error: 'Visitors must be between 1 and 50.' });

    // The sales executive taking them round: whoever the form names, else the lead's owner, else the caller.
    const hostId = String(b.hostId ?? '') || lead.assignedUserId || req.auth!.sub;
    if (hostId !== scope.userId && !(await canAssignTo(scope, hostId))) {
      return res.status(403).json({ error: 'You can only assign a visit to people in your own team.' });
    }
    // The same buyer, project and time twice is a double-click, not two visits.
    const clash = await prisma.siteVisit.findFirst({ where: { leadId: lead.id, projectId: project.id, status: { in: OPEN }, scheduledAt } });
    if (clash) return res.status(409).json({ error: 'This visit is already scheduled.' });

    const actor = await actorNameOf(req);
    const reminder = await prisma.leadFollowUp.create({
      data: {
        leadId: lead.id, title: `Site visit — ${project.projectName}`, description: `${visitors} visitor(s) at ${when(scheduledAt)}.`, dueAt: scheduledAt,
        // A reminder two hours ahead, or at the time itself for a visit sooner than that.
        reminderAt: new Date(Math.max(Date.now(), scheduledAt.getTime() - 2 * 3_600_000)), priority: 'high', assignedUserId: hostId,
      },
    });
    const visit = await prisma.siteVisit.create({
      data: { leadId: lead.id, projectId: project.id, scheduledAt, hostId, visitorCount: visitors, createdById: req.auth!.sub, reminderId: reminder.id },
      include,
    });
    await prisma.lead.update({ where: { id: lead.id }, data: { interestedProjectId: lead.interestedProjectId ?? project.id, nextFollowUpAt: lead.nextFollowUpAt ?? scheduledAt } });
    await prisma.leadActivity.create({ data: { leadId: lead.id, type: 'site_visit', description: `Site visit to ${project.projectName} scheduled for ${when(scheduledAt)}.`, userName: actor } });
    await advanceLead(lead.id, 'Site Visit Planned', actor, 'site visit scheduled');
    res.status(201).json(shape(visit));
  } catch (err) {
    next(err);
  }
});

siteVisitsRouter.post('/:id/confirm', async (req, res, next) => {
  try {
    const v = await findVisit(await scopeOf(req), String(req.params.id));
    if (!v) return res.status(404).json({ error: 'Visit not found.' });
    if (v.status !== 'scheduled') return res.status(409).json({ error: `This visit is already ${v.status}.` });
    const updated = await prisma.siteVisit.update({ where: { id: v.id }, data: { status: 'confirmed', confirmedAt: new Date() }, include });
    await prisma.leadActivity.create({ data: { leadId: v.leadId, type: 'site_visit', description: `Site visit to ${v.project.projectName} confirmed by the buyer.`, userName: await actorNameOf(req) } });
    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});

siteVisitsRouter.post('/:id/reschedule', async (req, res, next) => {
  try {
    const v = await findVisit(await scopeOf(req), String(req.params.id));
    if (!v) return res.status(404).json({ error: 'Visit not found.' });
    if (!OPEN.includes(v.status)) return res.status(409).json({ error: `A ${v.status.replace('_', ' ')} visit cannot be rescheduled.` });
    const at = new Date(String(req.body?.scheduledAt ?? ''));
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 5 * 60_000) return res.status(400).json({ error: 'Choose a date and time in the future.' });
    const updated = await prisma.siteVisit.update({ where: { id: v.id }, data: { scheduledAt: at, status: 'scheduled', confirmedAt: null }, include });
    if (v.reminderId) await prisma.leadFollowUp.updateMany({ where: { id: v.reminderId }, data: { dueAt: at, status: 'rescheduled', reminderAt: new Date(Math.max(Date.now(), at.getTime() - 2 * 3_600_000)), reminderSentAt: null } });
    await prisma.leadActivity.create({ data: { leadId: v.leadId, type: 'site_visit', description: `Site visit to ${v.project.projectName} moved to ${when(at)}.`, userName: await actorNameOf(req) } });
    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});

siteVisitsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const v = await findVisit(await scopeOf(req), String(req.params.id));
    if (!v) return res.status(404).json({ error: 'Visit not found.' });
    if (!OPEN.includes(v.status)) return res.status(409).json({ error: `This visit is already ${v.status.replace('_', ' ')}.` });
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) return res.status(400).json({ error: 'Say why the visit is cancelled.' });
    const updated = await prisma.siteVisit.update({ where: { id: v.id }, data: { status: 'cancelled', cancelReason: reason }, include });
    await closeReminder(v.reminderId, 'cancelled');
    await prisma.leadActivity.create({ data: { leadId: v.leadId, type: 'site_visit', description: `Site visit to ${v.project.projectName} cancelled: ${reason}`, userName: await actorNameOf(req) } });
    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});

/** They did not turn up: closed as a no-show, with a follow-up to get them to reschedule. */
siteVisitsRouter.post('/:id/no-show', async (req: AuthedRequest, res, next) => {
  try {
    const v = await findVisit(await scopeOf(req), String(req.params.id));
    if (!v) return res.status(404).json({ error: 'Visit not found.' });
    if (!OPEN.includes(v.status)) return res.status(409).json({ error: `This visit is already ${v.status.replace('_', ' ')}.` });
    const updated = await prisma.siteVisit.update({ where: { id: v.id }, data: { status: 'no_show' }, include });
    await closeReminder(v.reminderId, 'missed');
    const due = new Date(Date.now() + DAY);
    const fu = await prisma.leadFollowUp.create({ data: { leadId: v.leadId, title: `Rebook the site visit — ${v.project.projectName}`, description: 'They did not come to the visit.', dueAt: due, reminderAt: due, priority: 'high', assignedUserId: v.hostId ?? req.auth!.sub } });
    await prisma.siteVisit.update({ where: { id: v.id }, data: { followUpId: fu.id } });
    await prisma.leadActivity.create({ data: { leadId: v.leadId, type: 'site_visit', description: `Did not turn up for the site visit to ${v.project.projectName}.`, userName: await actorNameOf(req) } });
    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});

siteVisitsRouter.post('/:id/complete', async (req: AuthedRequest, res, next) => {
  try {
    const v = await findVisit(await scopeOf(req), String(req.params.id));
    if (!v) return res.status(404).json({ error: 'Visit not found.' });
    if (!OPEN.includes(v.status)) return res.status(409).json({ error: `This visit is already ${v.status.replace('_', ' ')}.` });
    const b = req.body ?? {};
    const outcome = String(b.outcome ?? '');
    if (!(OUTCOMES as readonly string[]).includes(outcome)) return res.status(400).json({ error: 'Record how the visit went.' });
    const interest = b.interest ? String(b.interest) : null;
    if (interest && !TEMPS.includes(interest)) return res.status(400).json({ error: 'Interest must be hot, warm or cold.' });
    const visitors = b.visitorCount === undefined ? v.visitorCount : Math.round(Number(b.visitorCount));
    if (!Number.isFinite(visitors) || visitors < 1 || visitors > 50) return res.status(400).json({ error: 'Visitors must be between 1 and 50.' });

    const actor = await actorNameOf(req);
    const feedback = b.feedback ? String(b.feedback).trim().slice(0, 1500) : null;
    const nextAction = b.nextAction ? String(b.nextAction).trim().slice(0, 300) : null;
    const updated = await prisma.siteVisit.update({
      where: { id: v.id },
      data: { status: 'done', completedAt: new Date(), outcome, interest: (interest as 'hot' | 'warm' | 'cold' | null), feedback, nextAction, visitorCount: visitors },
      include,
    });
    await closeReminder(v.reminderId, 'completed');
    // How they felt about it is the buyer's temperature now.
    if (interest) await prisma.lead.update({ where: { id: v.leadId }, data: { temperature: interest as 'hot' | 'warm' | 'cold' } });
    await prisma.leadActivity.create({ data: { leadId: v.leadId, type: 'site_visit', description: `Site visit to ${v.project.projectName} done (${outcome.replace(/_/g, ' ')})${feedback ? `: ${feedback}` : '.'}`, userName: actor } });
    await advanceLead(v.leadId, 'Site Visit Done', actor, 'site visit done');

    // The automatic follow-up: tomorrow, by whoever hosted — unless the buyer said no.
    if (outcome !== 'not_interested') {
      const due = new Date(Date.now() + DAY);
      due.setHours(11, 0, 0, 0);
      const fu = await prisma.leadFollowUp.create({
        data: {
          leadId: v.leadId, title: `Follow up after site visit — ${v.project.projectName}`, description: nextAction ?? (outcome === 'ready_to_book' ? 'Ready to book — take the token.' : 'Check how they are feeling after the visit.'),
          dueAt: due, reminderAt: due, priority: outcome === 'ready_to_book' ? 'urgent' : 'high', assignedUserId: v.hostId ?? req.auth!.sub,
        },
      });
      await prisma.siteVisit.update({ where: { id: v.id }, data: { followUpId: fu.id } });
      await prisma.lead.update({ where: { id: v.leadId }, data: { nextFollowUpAt: due } });
    }
    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});
