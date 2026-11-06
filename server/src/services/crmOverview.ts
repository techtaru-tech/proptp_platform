import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { inLeadScope, scopeOf } from './hierarchy';

/**
 * GET /api/reports/crm-overview — every CRM section summarised in one call, for the CRM Overview.
 *
 * Filters: `from`, `to` (ISO dates), `pipelineId`, `formName` (the Meta lead form), `assignedUserId`
 * (or "unassigned") and `stageId`. They narrow the set of leads; everything hanging off a lead —
 * follow-ups, visits, calls — is counted for those leads only. Counts are always within the
 * caller's own scope, so an employee sees their leads and a leader the team's.
 *
 * Dates: a lead-population figure (total, by stage, by source…) uses `from`/`to` on the lead's
 * creation date only when they are given. Activity figures (calls, visits, follow-ups done, the
 * trend) always need a window, so without dates they cover the last 30 days.
 */

const DAY = 86_400_000;

function parseDate(raw: unknown, endOfDay = false): Date | null {
  if (!raw) return null;
  const s = String(raw);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const sum = (rows: { _count: { _all: number } }[]) => rows.reduce((a, r) => a + r._count._all, 0);
const istDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.ORG_TIME_ZONE || 'Asia/Kolkata' }).format(d);

export async function crmOverview(req: Request, res: Response, next: NextFunction) {
  try {
    const scope = await scopeOf(req);
    const now = new Date();
    const fromIn = parseDate(req.query.from);
    const toIn = parseDate(req.query.to, true);
    if (fromIn && toIn && fromIn > toIn) return res.status(400).json({ error: '"From" must be on or before "To".' });
    const windowTo = toIn ?? now;
    const windowFrom = fromIn ?? new Date(windowTo.getTime() - 29 * DAY);
    const pipelineId = req.query.pipelineId ? String(req.query.pipelineId) : null;
    const stageId = req.query.stageId ? String(req.query.stageId) : null;
    const formName = req.query.formName ? String(req.query.formName) : null;
    const assigned = req.query.assignedUserId ? String(req.query.assignedUserId) : null;

    // The lead set every section is counted over.
    const filters: Prisma.LeadWhereInput[] = [{ archivedAt: null }];
    if (pipelineId) filters.push({ pipelineId });
    if (stageId) filters.push({ pipelineStageId: stageId });
    if (formName) filters.push({ adDetail: { path: ['formName'], equals: formName } });
    if (assigned === 'unassigned') filters.push({ assignedUserId: null });
    else if (assigned) filters.push({ assignedUserId: assigned });
    const base = inLeadScope({ AND: filters }, scope);
    const created = fromIn || toIn ? { createdAt: { ...(fromIn ? { gte: fromIn } : {}), ...(toIn ? { lte: toIn } : {}) } } : {};
    const leads = { AND: [base, created] } as Prisma.LeadWhereInput;
    const byLead = { lead: { is: base } };
    const inWindow = { gte: windowFrom, lte: windowTo };
    // Visits are booked ahead, so without an explicit end the window runs a week into the future.
    const visitWindow = { gte: windowFrom, lte: toIn ?? new Date(now.getTime() + 7 * DAY) };

    const todayStart = new Date(`${istDay(now)}T00:00:00.000+05:30`);
    const todayEnd = new Date(todayStart.getTime() + DAY);
    const weekAgo = new Date(now.getTime() - 7 * DAY);

    // Which pipeline the stage chart shows: the chosen one, or the one holding most of these leads.
    let chartPipelineId = pipelineId;
    if (!chartPipelineId) {
      const top = await prisma.lead.groupBy({ by: ['pipelineId'], where: { AND: [leads, { pipelineId: { not: null } }] }, _count: { _all: true }, orderBy: { _count: { pipelineId: 'desc' } }, take: 1 });
      chartPipelineId = top[0]?.pipelineId ?? (await prisma.pipeline.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ?? null;
    }

    const [
      total, newToday, newWeek, open, wonAgg, lost, unassigned, untouched,
      byStatus, byStage, bySource, wonBySource, byTemp, lostReasons, stages, pipeline,
      trendRows,
      fuOverdue, fuToday, fuUpcoming, fuDone, fuMissed, overdueList,
      visitByStatus, visitsToday, upcomingVisits,
      callRows, callTrendRows,
      perOwner, ownerCalls, ownerVisits, ownerFollowOverdue,
      stageMoves, metaForms,
      autoTotal, autoEnabled, autoRuns, seqActive, seqEnroll, waConversations, waActive, campaigns, drips, sdrAgents, webForms, formSubs,
      recent,
    ] = await Promise.all([
      prisma.lead.count({ where: leads }),
      prisma.lead.count({ where: { AND: [base, { createdAt: { gte: todayStart } }] } }),
      prisma.lead.count({ where: { AND: [base, { createdAt: { gte: weekAgo } }] } }),
      prisma.lead.count({ where: { AND: [leads, { status: { notIn: ['won', 'lost'] } }] } }),
      prisma.lead.aggregate({ where: { AND: [leads, { status: 'won' }] }, _count: { _all: true }, _sum: { wonValue: true } }),
      prisma.lead.count({ where: { AND: [leads, { status: 'lost' }] } }),
      prisma.lead.count({ where: { AND: [leads, { assignedUserId: null }, { status: { notIn: ['won', 'lost'] } }] } }),
      prisma.lead.findMany({ where: { AND: [base, { status: 'new' }, { contactedAt: null }] }, select: { createdAt: true } }),

      prisma.lead.groupBy({ by: ['status'], where: leads, _count: { _all: true } }),
      prisma.lead.groupBy({ by: ['pipelineStageId'], where: { AND: [leads, chartPipelineId ? { pipelineId: chartPipelineId } : {}] }, _count: { _all: true }, _sum: { dealValue: true } }),
      prisma.lead.groupBy({ by: ['source'], where: leads, _count: { _all: true } }),
      prisma.lead.groupBy({ by: ['source'], where: { AND: [leads, { status: 'won' }] }, _count: { _all: true } }),
      prisma.lead.groupBy({ by: ['temperature'], where: { AND: [leads, { status: { notIn: ['won', 'lost'] } }] }, _count: { _all: true } }),
      prisma.lead.groupBy({ by: ['lostReason'], where: { AND: [leads, { status: 'lost' }, { lostReason: { not: null } }] }, _count: { _all: true }, orderBy: { _count: { lostReason: 'desc' } }, take: 6 }),
      chartPipelineId ? prisma.pipelineStage.findMany({ where: { pipelineId: chartPipelineId }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, color: true, isWon: true, isLost: true } }) : Promise.resolve([]),
      chartPipelineId ? prisma.pipeline.findUnique({ where: { id: chartPipelineId }, select: { id: true, name: true } }) : Promise.resolve(null),

      prisma.lead.findMany({ where: { AND: [base, { createdAt: inWindow }] }, select: { createdAt: true, status: true } }),

      prisma.leadFollowUp.count({ where: { ...byLead, completed: false, status: { not: 'missed' }, dueAt: { lt: now } } }),
      prisma.leadFollowUp.count({ where: { ...byLead, completed: false, dueAt: { gte: now, lt: todayEnd } } }),
      prisma.leadFollowUp.count({ where: { ...byLead, completed: false, dueAt: { gte: todayEnd, lt: new Date(now.getTime() + 7 * DAY) } } }),
      prisma.leadFollowUp.count({ where: { ...byLead, completed: true, completedAt: inWindow } }),
      prisma.leadFollowUp.count({ where: { ...byLead, status: 'missed', dueAt: inWindow } }),
      prisma.leadFollowUp.findMany({
        where: { ...byLead, completed: false, status: { not: 'missed' }, dueAt: { lt: now } }, orderBy: { dueAt: 'asc' }, take: 6,
        select: { id: true, title: true, dueAt: true, leadId: true, lead: { select: { firstName: true, lastName: true } } },
      }),

      prisma.siteVisit.groupBy({ by: ['status'], where: { ...byLead, scheduledAt: visitWindow }, _count: { _all: true } }),
      prisma.siteVisit.count({ where: { ...byLead, status: { in: ['scheduled', 'confirmed'] }, scheduledAt: { gte: todayStart, lt: todayEnd } } }),
      prisma.siteVisit.findMany({
        where: { ...byLead, status: { in: ['scheduled', 'confirmed'] }, scheduledAt: { gte: now } }, orderBy: { scheduledAt: 'asc' }, take: 6,
        select: { id: true, scheduledAt: true, status: true, leadId: true, visitorCount: true, lead: { select: { firstName: true, lastName: true } }, project: { select: { projectName: true } }, host: { select: { name: true } } },
      }),

      prisma.callLog.groupBy({ by: ['direction', 'status'], where: { ...byLead, startedAt: inWindow }, _count: { _all: true }, _sum: { durationSeconds: true } }),
      prisma.callLog.findMany({ where: { ...byLead, startedAt: inWindow }, select: { startedAt: true, status: true } }),

      prisma.lead.groupBy({ by: ['assignedUserId', 'status'], where: { AND: [leads, { assignedUserId: { not: null } }] }, _count: { _all: true } }),
      prisma.callLog.groupBy({ by: ['agentUserId', 'status'], where: { ...byLead, startedAt: inWindow, agentUserId: { not: null } }, _count: { _all: true }, _sum: { durationSeconds: true } }),
      prisma.siteVisit.groupBy({ by: ['hostId'], where: { ...byLead, status: 'done', scheduledAt: inWindow, hostId: { not: null } }, _count: { _all: true } }),
      prisma.leadFollowUp.groupBy({ by: ['assignedUserId'], where: { ...byLead, completed: false, status: { not: 'missed' }, dueAt: { lt: now }, assignedUserId: { not: null } }, _count: { _all: true } }),

      prisma.leadStageHistoryEntry.groupBy({ by: ['toStageName'], where: { ...byLead, createdAt: inWindow }, _count: { _all: true }, orderBy: { _count: { toStageName: 'desc' } }, take: 8 }),
      prisma.lead.findMany({ where: { AND: [leads, { adDetail: { not: Prisma.DbNull } }] }, select: { adDetail: true, status: true }, take: 10000 }),

      prisma.automation.count(),
      prisma.automation.count({ where: { enabled: true } }),
      prisma.automationRun.groupBy({ by: ['status'], where: { ranAt: inWindow }, _count: { _all: true } }),
      prisma.emailSequence.count({ where: { status: 'active' } }),
      prisma.emailSequenceEnrollment.groupBy({ by: ['status'], where: byLead, _count: { _all: true } }),
      prisma.whatsAppConversation.count({ where: { lead: { is: base } } }),
      prisma.whatsAppConversation.count({ where: { lead: { is: base }, lastMessageAt: inWindow } }),
      prisma.waCampaign.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.whatsAppDrip.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.aiSdrAgent.groupBy({ by: ['active'], _count: { _all: true } }),
      prisma.leadForm.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      prisma.leadFormSubmission.groupBy({ by: ['formId'], where: { createdAt: inWindow }, _count: { _all: true } }),

      prisma.lead.findMany({
        where: leads, orderBy: { createdAt: 'desc' }, take: 7,
        select: { id: true, firstName: true, lastName: true, source: true, status: true, temperature: true, createdAt: true, assignedTo: true, stage: { select: { name: true } } },
      }),
    ]);

    // --- trend: leads per day across the window, with the won ones marked.
    const days: string[] = [];
    for (let t = new Date(`${istDay(windowFrom)}T12:00:00+05:30`).getTime(); t <= windowTo.getTime() + 12 * 3_600_000; t += DAY) days.push(istDay(new Date(t)));
    const trend = new Map(days.map((d) => [d, { date: d, leads: 0, won: 0, calls: 0, connected: 0 }]));
    for (const r of trendRows) {
      const d = trend.get(istDay(r.createdAt));
      if (d) { d.leads += 1; if (r.status === 'won') d.won += 1; }
    }
    for (const c of callTrendRows) {
      const d = trend.get(istDay(c.startedAt));
      if (d) { d.calls += 1; if (c.status === 'completed') d.connected += 1; }
    }

    // --- pending: new leads nobody has contacted, by how long they have waited.
    const ages = { under24: 0, from24to48: 0, over48: 0 };
    for (const l of untouched) {
      const h = (now.getTime() - l.createdAt.getTime()) / 3_600_000;
      if (h < 24) ages.under24++; else if (h < 48) ages.from24to48++; else ages.over48++;
    }

    // --- deeper cuts: previous period, speed to lead, when leads arrive, source quality, demand, aging
    const span = windowTo.getTime() - windowFrom.getTime();
    const prevFrom = new Date(windowFrom.getTime() - span);
    const prevWindow = { gte: prevFrom, lt: windowFrom };
    const open_ = { status: { notIn: ['won', 'lost'] as ('won' | 'lost')[] } };
    const [
      population, newInWindow, newPrev, wonIn, wonPrev, callsPrev,
      closing, openValue, byBudget, byType, byCity, byProject, locRows, fuDoneRows, visitDone,
    ] = await Promise.all([
      prisma.lead.findMany({ where: leads, select: { createdAt: true, contactedAt: true, source: true, status: true, wonValue: true } }),
      prisma.lead.count({ where: { AND: [base, { createdAt: inWindow }] } }),
      prisma.lead.count({ where: { AND: [base, { createdAt: prevWindow }] } }),
      prisma.lead.aggregate({ where: { AND: [base, { wonAt: inWindow }] }, _count: { _all: true }, _sum: { wonValue: true } }),
      prisma.lead.aggregate({ where: { AND: [base, { wonAt: prevWindow }] }, _count: { _all: true }, _sum: { wonValue: true } }),
      prisma.callLog.groupBy({ by: ['status'], where: { ...byLead, startedAt: prevWindow }, _count: { _all: true } }),
      prisma.lead.aggregate({ where: { AND: [leads, open_, { expectedCloseDate: { gte: now, lte: new Date(now.getTime() + 30 * DAY) } }] }, _count: { _all: true }, _sum: { dealValue: true } }),
      prisma.lead.aggregate({ where: { AND: [leads, open_] }, _count: { _all: true }, _sum: { dealValue: true } }),
      prisma.lead.groupBy({ by: ['budgetRange'], where: { AND: [leads, { budgetRange: { not: null } }] }, _count: { _all: true } }),
      prisma.lead.groupBy({ by: ['propertyType'], where: { AND: [leads, { propertyType: { not: null } }] }, _count: { _all: true }, orderBy: { _count: { propertyType: 'desc' } }, take: 8 }),
      prisma.lead.groupBy({ by: ['city'], where: { AND: [leads, { city: { not: null } }] }, _count: { _all: true }, orderBy: { _count: { city: 'desc' } }, take: 8 }),
      prisma.lead.groupBy({ by: ['interestedProjectId'], where: { AND: [leads, { interestedProjectId: { not: null } }] }, _count: { _all: true }, orderBy: { _count: { interestedProjectId: 'desc' } }, take: 8 }),
      prisma.lead.findMany({ where: { AND: [leads, { preferredLocations: { isEmpty: false } }] }, select: { preferredLocations: true }, take: 20000 }),
      prisma.leadFollowUp.findMany({ where: { ...byLead, completed: true, completedAt: inWindow }, select: { dueAt: true, completedAt: true } }),
      prisma.siteVisit.findMany({ where: { ...byLead, status: 'done', scheduledAt: visitWindow }, select: { leadId: true, lead: { select: { status: true } } } }),
    ]);

    // Speed to lead: from arriving to the first contact, over leads that have been contacted.
    const waits = population.filter((l) => l.contactedAt).map((l) => Math.max(0, (l.contactedAt!.getTime() - l.createdAt.getTime()) / 60000)).sort((a, b) => a - b);
    const neverContacted = population.filter((l) => !l.contactedAt && l.status === 'new').length;
    const median = waits.length ? waits[Math.floor(waits.length / 2)] : null;
    const responseBuckets = [
      { label: 'Under 5 min', leads: waits.filter((m) => m < 5).length },
      { label: '5–60 min', leads: waits.filter((m) => m >= 5 && m < 60).length },
      { label: '1–24 hours', leads: waits.filter((m) => m >= 60 && m < 1440).length },
      { label: 'Over a day', leads: waits.filter((m) => m >= 1440).length },
      { label: 'Not contacted yet', leads: neverContacted },
    ];

    // When leads arrive: weekday (Mon first) by hour, in the org's time zone.
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    const tz = process.env.ORG_TIME_ZONE || 'Asia/Kolkata';
    const partsOf = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
    const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    for (const l of population) {
      const parts = partsOf.formatToParts(l.createdAt);
      const d = DOW[parts.find((x) => x.type === 'weekday')!.value];
      const h = Number(parts.find((x) => x.type === 'hour')!.value) % 24;
      heat[d][h] += 1;
    }

    // Source quality: how far each source's leads get, and how fast they were picked up.
    const quality = new Map<string, { source: string; leads: number; contacted: number; qualified: number; won: number; lost: number; wonValue: number; waits: number[] }>();
    for (const l of population) {
      const q = quality.get(l.source) ?? { source: l.source, leads: 0, contacted: 0, qualified: 0, won: 0, lost: 0, wonValue: 0, waits: [] };
      q.leads++;
      if (l.status !== 'new') q.contacted++;
      if (l.status === 'qualified' || l.status === 'won') q.qualified++;
      if (l.status === 'won') { q.won++; q.wonValue += l.wonValue ?? 0; }
      if (l.status === 'lost') q.lost++;
      if (l.contactedAt) q.waits.push((l.contactedAt.getTime() - l.createdAt.getTime()) / 60000);
      quality.set(l.source, q);
    }

    // Aging of what is still open.
    const aging = [
      { label: '0–7 days', leads: 0 }, { label: '8–30 days', leads: 0 }, { label: '31–90 days', leads: 0 }, { label: 'Over 90 days', leads: 0 },
    ];
    for (const l of population) {
      if (l.status === 'won' || l.status === 'lost') continue;
      const d = (now.getTime() - l.createdAt.getTime()) / DAY;
      aging[d <= 7 ? 0 : d <= 30 ? 1 : d <= 90 ? 2 : 3].leads++;
    }

    const locations = new Map<string, number>();
    for (const r of locRows) for (const loc of r.preferredLocations) locations.set(loc, (locations.get(loc) ?? 0) + 1);
    const projectNames = new Map(
      (await prisma.project.findMany({ where: { id: { in: byProject.map((r) => r.interestedProjectId!) } }, select: { id: true, projectName: true } })).map((p) => [p.id, p.projectName])
    );
    const BUDGET_ORDER = ['Under ₹25 L', '₹25 L – ₹50 L', '₹50 L – ₹1 Cr', '₹1 Cr – ₹2 Cr', 'Above ₹2 Cr'];
    const budgetRank = (name: string) => { const i = BUDGET_ORDER.indexOf(name); return i < 0 ? BUDGET_ORDER.length : i; };
    const onTime = fuDoneRows.filter((f) => f.completedAt && f.completedAt <= new Date(f.dueAt.getTime() + 60 * 60_000)).length;
    const connectedPrev = callsPrev.filter((r) => r.status === 'completed').reduce((a, r) => a + r._count._all, 0);

    const deeper = {
      period: {
        from: windowFrom.toISOString(), to: windowTo.toISOString(), prevFrom: prevFrom.toISOString(),
        newLeads: newInWindow, newLeadsPrev: newPrev,
        won: wonIn._count._all, wonPrev: wonPrev._count._all, wonValue: wonIn._sum.wonValue ?? 0, wonValuePrev: wonPrev._sum.wonValue ?? 0,
        callsConnectedPrev: connectedPrev,
      },
      responseTime: {
        medianMinutes: median === null ? null : Math.round(median),
        averageMinutes: waits.length ? Math.round(waits.reduce((a, m) => a + m, 0) / waits.length) : null,
        within5: waits.filter((m) => m < 5).length, within60: waits.filter((m) => m < 60).length, contacted: waits.length,
        buckets: responseBuckets,
      },
      heatmap: heat,
      sourceQuality: [...quality.values()]
        .map(({ waits: w, ...q }) => ({ ...q, medianResponseMinutes: w.length ? Math.round(w.sort((a, b) => a - b)[Math.floor(w.length / 2)]) : null }))
        .sort((a, b) => b.leads - a.leads),
      aging,
      value: {
        openDeals: openValue._count._all, openValue: openValue._sum.dealValue ?? 0,
        closing30: closing._count._all, closing30Value: closing._sum.dealValue ?? 0,
      },
      demand: {
        budgets: byBudget.map((r) => ({ name: r.budgetRange!, leads: r._count._all })).sort((a, b) => budgetRank(a.name) - budgetRank(b.name)),
        propertyTypes: byType.map((r) => ({ name: r.propertyType!, leads: r._count._all })),
        cities: byCity.map((r) => ({ name: r.city!, leads: r._count._all })),
        projects: byProject.map((r) => ({ id: r.interestedProjectId!, name: projectNames.get(r.interestedProjectId!) ?? 'Project', leads: r._count._all })),
        locations: [...locations.entries()].map(([name, n]) => ({ name, leads: n })).sort((a, b) => b.leads - a.leads).slice(0, 8),
      },
      followUpOnTime: { completed: fuDoneRows.length, onTime },
      visitToBooking: { visitsDone: new Set(visitDone.map((v) => v.leadId)).size, booked: new Set(visitDone.filter((v) => v.lead.status === 'won').map((v) => v.leadId)).size },
    };

    // --- calls
    const calls = { total: 0, outgoing: 0, incoming: 0, connected: 0, missed: 0, talkSeconds: 0 };
    for (const r of callRows) {
      const n = r._count._all;
      calls.total += n;
      if (r.direction === 'outgoing') calls.outgoing += n; else calls.incoming += n;
      if (r.status === 'completed') { calls.connected += n; calls.talkSeconds += r._sum.durationSeconds ?? 0; }
      if (r.status === 'missed' || r.status === 'no_answer') calls.missed += n;
    }

    // --- team: one row per person who owns leads in this set
    type Person = { userId: string; name: string; leads: number; open: number; untouched: number; won: number; lost: number; dialled: number; connected: number; talkSeconds: number; visitsDone: number; overdueFollowUps: number };
    const people = new Map<string, Person>();
    const person = (id: string) => {
      let p = people.get(id);
      if (!p) { p = { userId: id, name: '', leads: 0, open: 0, untouched: 0, won: 0, lost: 0, dialled: 0, connected: 0, talkSeconds: 0, visitsDone: 0, overdueFollowUps: 0 }; people.set(id, p); }
      return p;
    };
    for (const r of perOwner) {
      const p = person(r.assignedUserId!);
      p.leads += r._count._all;
      if (r.status === 'won') p.won += r._count._all;
      else if (r.status === 'lost') p.lost += r._count._all;
      else p.open += r._count._all;
      if (r.status === 'new') p.untouched += r._count._all;
    }
    for (const r of ownerCalls) {
      const p = people.get(r.agentUserId!);
      if (!p) continue;
      p.dialled += r._count._all;
      if (r.status === 'completed') { p.connected += r._count._all; p.talkSeconds += r._sum.durationSeconds ?? 0; }
    }
    for (const r of ownerVisits) { const p = people.get(r.hostId!); if (p) p.visitsDone += r._count._all; }
    for (const r of ownerFollowOverdue) { const p = people.get(r.assignedUserId!); if (p) p.overdueFollowUps += r._count._all; }
    const names = await prisma.user.findMany({ where: { id: { in: [...people.keys()] } }, select: { id: true, name: true } });
    for (const u of names) { const p = people.get(u.id); if (p) p.name = u.name; }
    const team = [...people.values()].filter((p) => p.name).sort((a, b) => b.leads - a.leads).slice(0, 12);

    // --- forms: Meta lead forms counted from each lead's ad detail, web forms from submissions
    const metaCounts = new Map<string, { leads: number; won: number }>();
    for (const l of metaForms) {
      const name = (l.adDetail as { formName?: string } | null)?.formName;
      if (!name) continue;
      const m = metaCounts.get(name) ?? { leads: 0, won: 0 };
      m.leads += 1; if (l.status === 'won') m.won += 1;
      metaCounts.set(name, m);
    }
    const formName_ = new Map(webForms.map((f) => [f.id, f.name]));

    const stageCount = new Map(byStage.map((r) => [r.pipelineStageId, r]));
    const wonSource = new Map(wonBySource.map((r) => [r.source, r._count._all]));
    const statusCount = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const closed = (wonAgg._count._all ?? 0) + lost;

    res.json({
      ...deeper,
      window: { from: windowFrom.toISOString(), to: windowTo.toISOString(), defaulted: !fromIn && !toIn },
      kpis: {
        total, newToday, newThisWeek: newWeek, open, unassigned,
        won: wonAgg._count._all ?? 0, wonValue: wonAgg._sum.wonValue ?? 0, lost,
        conversionRate: closed ? Math.round(((wonAgg._count._all ?? 0) / closed) * 1000) / 10 : 0,
        winRateOfAll: total ? Math.round(((wonAgg._count._all ?? 0) / total) * 1000) / 10 : 0,
      },
      pipeline: pipeline ? {
        id: pipeline.id, name: pipeline.name,
        stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color, isWon: s.isWon, isLost: s.isLost, leads: stageCount.get(s.id)?._count._all ?? 0, value: stageCount.get(s.id)?._sum.dealValue ?? 0 })),
      } : null,
      statuses: ['new', 'contacted', 'qualified', 'won', 'lost'].map((s) => ({ status: s, leads: statusCount(s) })),
      sources: bySource.map((r) => ({ source: r.source, leads: r._count._all, won: wonSource.get(r.source) ?? 0 })).sort((a, b) => b.leads - a.leads),
      temperature: ['hot', 'warm', 'cold', null].map((t) => ({ temperature: t ?? 'unrated', leads: byTemp.find((r) => r.temperature === t)?._count._all ?? 0 })),
      lostReasons: lostReasons.map((r) => ({ reason: r.lostReason!, leads: r._count._all })),
      trend: [...trend.values()],
      pending: { ...ages, overdueFollowUps: fuOverdue, unassigned },
      followUps: { overdue: fuOverdue, dueToday: fuToday, next7Days: fuUpcoming, completed: fuDone, missed: fuMissed,
        overdueList: overdueList.map((f) => ({ id: f.id, title: f.title, dueAt: f.dueAt.toISOString(), leadId: f.leadId, leadName: `${f.lead.firstName} ${f.lead.lastName}`.trim() })) },
      siteVisits: {
        byStatus: ['scheduled', 'confirmed', 'done', 'no_show', 'cancelled'].map((s) => ({ status: s, visits: visitByStatus.find((r) => r.status === s)?._count._all ?? 0 })),
        total: sum(visitByStatus), today: visitsToday,
        upcoming: upcomingVisits.map((v) => ({ id: v.id, scheduledAt: v.scheduledAt.toISOString(), status: v.status, leadId: v.leadId, leadName: `${v.lead.firstName} ${v.lead.lastName}`.trim(), project: v.project.projectName, host: v.host?.name ?? null, visitors: v.visitorCount })),
      },
      calls,
      team,
      stageMoves: stageMoves.map((r) => ({ stage: r.toStageName, moves: r._count._all })),
      forms: {
        meta: [...metaCounts.entries()].map(([name, m]) => ({ name, ...m })).sort((a, b) => b.leads - a.leads).slice(0, 8),
        web: formSubs.map((r) => ({ id: r.formId, name: formName_.get(r.formId) ?? 'Form', submissions: r._count._all })).sort((a, b) => b.submissions - a.submissions).slice(0, 6),
        activeWebForms: webForms.length,
      },
      engagement: {
        automations: { total: autoTotal, enabled: autoEnabled, runs: Object.fromEntries(autoRuns.map((r) => [r.status, r._count._all])) },
        emailSequences: { active: seqActive, enrollments: Object.fromEntries(seqEnroll.map((r) => [r.status, r._count._all])) },
        whatsapp: { conversations: waConversations, activeInWindow: waActive, campaigns: Object.fromEntries(campaigns.map((r) => [r.status, r._count._all])), drips: Object.fromEntries(drips.map((r) => [r.status, r._count._all])) },
        sdrAgents: { active: sdrAgents.find((r) => r.active)?._count._all ?? 0, total: sum(sdrAgents) },
      },
      recentLeads: recent.map((l) => ({ id: l.id, name: `${l.firstName} ${l.lastName}`.trim(), source: l.source, status: l.status, temperature: l.temperature, stage: l.stage?.name ?? null, owner: l.assignedTo, createdAt: l.createdAt.toISOString() })),
    });
  } catch (err) {
    next(err);
  }
}
