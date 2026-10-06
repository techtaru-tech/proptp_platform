import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { followUpScopeWhere, inLeadScope, leadScopeWhere, scopeOf, visibleLeadIds } from '../services/hierarchy';

export const reportsRouter = Router();

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

reportsRouter.get('/dashboard-stats', async (req, res) => {
  // Every figure on the CRM dashboards is counted over the caller's own hierarchy, in the query
  // itself — an employee's "total leads" is their leads, a leader's is the whole team's.
  const scope = await scopeOf(req);
  const inScope = (where: Prisma.LeadWhereInput = {}) => inLeadScope(where, scope);
  const todayStart = startOfDay(new Date());
  const weekStart = daysAgo(7);
  const monthStart = daysAgo(30);

  const [totalLeads, newToday, newThisWeek, newThisMonth, won, lost, activeInPipeline, wonAgg] = await Promise.all([
    prisma.lead.count({ where: inScope() }),
    prisma.lead.count({ where: inScope({ createdAt: { gte: todayStart } }) }),
    prisma.lead.count({ where: inScope({ createdAt: { gte: weekStart } }) }),
    prisma.lead.count({ where: inScope({ createdAt: { gte: monthStart } }) }),
    prisma.lead.count({ where: inScope({ status: 'won' }) }),
    prisma.lead.count({ where: inScope({ status: 'lost' }) }),
    prisma.lead.count({ where: inScope({ status: { notIn: ['won', 'lost'] } }) }),
    prisma.lead.aggregate({ where: inScope({ status: 'won' }), _sum: { wonValue: true } }),
  ]);

  const closed = won + lost;
  const conversionRate = closed > 0 ? Math.round((won / closed) * 1000) / 10 : 0;

  res.json({
    totalLeads,
    newToday,
    newThisWeek,
    newThisMonth,
    conversionRate,
    activeInPipeline,
    wonDeals: won,
    wonValue: wonAgg._sum.wonValue ?? 0,
  });
});

reportsRouter.get('/lead-trend', async (req, res) => {
  const days = Math.max(1, Number(req.query.days) || 14);
  const since = startOfDay(daysAgo(days - 1));
  const rows = await prisma.lead.findMany({
    where: inLeadScope({ createdAt: { gte: since } }, await scopeOf(req)),
    select: { createdAt: true },
  });

  const counts = new Map<string, number>();
  rows.forEach((r) => {
    const key = r.createdAt.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  const points = Array.from({ length: days }, (_, i) => {
    const d = daysAgo(days - 1 - i);
    const key = d.toISOString().slice(0, 10);
    return { date: key.slice(5), leads: counts.get(key) ?? 0 };
  });
  res.json(points);
});

reportsRouter.get('/status-breakdown', async (req, res) => {
  const groups = await prisma.lead.groupBy({ by: ['status'], where: inLeadScope({}, await scopeOf(req)), _count: { _all: true } });
  const order = ['new', 'contacted', 'qualified', 'won', 'lost'];
  const byStatus = new Map(groups.map((g) => [g.status, g._count._all]));
  res.json(order.map((s) => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: byStatus.get(s as any) ?? 0 })));
});

reportsRouter.get('/source-performance', async (req, res) => {
  const scope = await scopeOf(req);
  const [totals, wonBySource] = await Promise.all([
    prisma.lead.groupBy({ by: ['source'], where: inLeadScope({}, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['source'], where: inLeadScope({ status: 'won' }, scope), _count: { _all: true } }),
  ]);
  const wonMap = new Map(wonBySource.map((g) => [g.source, g._count._all]));
  const rows = totals
    .map((g) => {
      const total = g._count._all;
      const won = wonMap.get(g.source) ?? 0;
      return { source: g.source, total, won, conversionRate: total > 0 ? Math.round((won / total) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.total - a.total);
  res.json(rows);
});

reportsRouter.get('/stage-distribution', async (req, res) => {
  const pipelineId = (req.query.pipelineId as string) || undefined;
  const pipeline = pipelineId
    ? await prisma.pipeline.findUnique({ where: { id: pipelineId } })
    : await prisma.pipeline.findFirst({ where: { isDefault: true } });
  if (!pipeline) return res.json([]);

  const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { sortOrder: 'asc' } });
  const counts = await prisma.lead.groupBy({
    by: ['pipelineStageId'],
    where: inLeadScope({ pipelineStageId: { in: stages.map((s) => s.id) } }, await scopeOf(req)),
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.pipelineStageId, c._count._all]));
  res.json(stages.map((s) => ({ name: s.name, value: countMap.get(s.id) ?? 0, color: s.color })));
});

reportsRouter.get('/assignee-performance', async (req, res) => {
  const scope = await scopeOf(req);
  const [totals, won, lost] = await Promise.all([
    prisma.lead.groupBy({ by: ['assignedUserId'], where: inLeadScope({ assignedUserId: { not: null } }, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['assignedUserId'], where: inLeadScope({ assignedUserId: { not: null }, status: 'won' }, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['assignedUserId'], where: inLeadScope({ assignedUserId: { not: null }, status: 'lost' }, scope), _count: { _all: true } }),
  ]);
  const wonMap = new Map(won.map((g) => [g.assignedUserId, g._count._all]));
  const lostMap = new Map(lost.map((g) => [g.assignedUserId, g._count._all]));
  const rows = totals
    .map((g) => {
      const total = g._count._all;
      const w = wonMap.get(g.assignedUserId) ?? 0;
      const l = lostMap.get(g.assignedUserId) ?? 0;
      return { userId: g.assignedUserId as string, total, won: w, lost: l, conversionRate: total > 0 ? Math.round((w / total) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.total - a.total);
  res.json(rows);
});

reportsRouter.get('/followup-performance', async (req, res) => {
  const mine = followUpScopeWhere(await scopeOf(req));
  const count = (status?: string) => prisma.leadFollowUp.count({ where: { AND: [status ? { status } : {}, mine] } });
  const [total, completed, missed, pending, rescheduled] = await Promise.all([
    count(),
    count('completed'),
    count('missed'),
    count('pending'),
    count('rescheduled'),
  ]);
  const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
  res.json({ total, completed, missed, pending, rescheduled, completionRate });
});

reportsRouter.get('/lead-rows', async (req, res) => {
  const { dateFrom, dateTo } = req.query as Record<string, string>;
  const where: Record<string, unknown> = {};
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as any).gte = new Date(dateFrom);
    if (dateTo) (where.createdAt as any).lte = new Date(dateTo);
  }
  const rows = await prisma.lead.findMany({ where: inLeadScope(where, await scopeOf(req)), orderBy: { createdAt: 'desc' } });
  res.json(
    rows.map((l) => ({
      id: l.id,
      name: `${l.firstName} ${l.lastName}`.trim(),
      source: l.source,
      status: l.status,
      priority: l.priority,
      assignedUserId: l.assignedUserId,
      assignedTo: l.assignedTo,
      dealValue: l.dealValue ?? 0,
      createdAt: l.createdAt,
    }))
  );
});

// ---------------------------------------------------------------------------
// Report Center — a dedicated multi-report section (CRM > Report Center), distinct from
// the analytics dashboard above. Every endpoint here accepts optional `from`/`to` (ISO
// dates) and most accept a free-text `source` filter, matching the shared filter bar the
// frontend renders across all of these reports.
// ---------------------------------------------------------------------------

/** Local calendar date (YYYY-MM-DD). Never `toISOString().slice(0,10)` — see ist-timezone notes:
 * a local midnight serialises to the previous day and every "day" bucket would be off by one. */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The Monday that starts `d`'s week, as a local date key — used to bucket "week" grouping. */
function localWeekKey(d: Date): string {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return localDateKey(monday);
}

function localMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Reads the shared `from`/`to` query params into a Prisma date-range filter, or `{}` if neither is set. */
function parseDateRange(query: Record<string, string>): { gte?: Date; lte?: Date } {
  const range: { gte?: Date; lte?: Date } = {};
  if (query.from) range.gte = new Date(query.from);
  if (query.to) {
    // A bare date (no time) should include the whole day, not stop at 00:00:00.
    const to = new Date(query.to);
    if (query.to.length <= 10) to.setHours(23, 59, 59, 999);
    range.lte = to;
  }
  return range;
}

reportsRouter.get('/lead-volume', async (req, res) => {
  const { source, groupBy } = req.query as Record<string, string>;
  const dateRange = parseDateRange(req.query as Record<string, string>);

  const where: Record<string, unknown> = {};
  if (Object.keys(dateRange).length > 0) where.createdAt = dateRange;
  if (source?.trim()) {
    where.OR = [
      { source: { contains: source.trim(), mode: 'insensitive' } },
      { otherSource: { contains: source.trim(), mode: 'insensitive' } },
    ];
  }

  const rows = await prisma.lead.findMany({ where: inLeadScope(where, await scopeOf(req)), select: { createdAt: true } });
  const keyFor = groupBy === 'week' ? localWeekKey : groupBy === 'month' ? localMonthKey : localDateKey;

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(keyFor(row.createdAt), (counts.get(keyFor(row.createdAt)) ?? 0) + 1);

  const points = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, count]) => ({ period, count }));
  res.json({ total: rows.length, points });
});

reportsRouter.get('/source-performance-report', async (req, res) => {
  const { source } = req.query as Record<string, string>;
  const dateRange = parseDateRange(req.query as Record<string, string>);
  const where: Prisma.LeadWhereInput = {};
  if (Object.keys(dateRange).length > 0) where.createdAt = dateRange;
  // Attribution is by the channel that first earned the lead, so a later transfer or edit of the
  // working source cannot move a booking from one channel to another.
  if (source?.trim()) where.originalSource = { contains: source.trim(), mode: 'insensitive' };

  const scope = await scopeOf(req);
  const key = (v: string | null) => v ?? 'unknown';
  const [totals, won, lost, wonValueAgg, visited] = await Promise.all([
    prisma.lead.groupBy({ by: ['originalSource'], where: inLeadScope(where, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['originalSource'], where: inLeadScope({ ...where, status: 'won' }, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['originalSource'], where: inLeadScope({ ...where, status: 'lost' }, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['originalSource'], where: inLeadScope({ ...where, status: 'won' }, scope), _sum: { wonValue: true } }),
    prisma.lead.groupBy({ by: ['originalSource'], where: inLeadScope({ ...where, siteVisits: { some: { status: 'done' } } }, scope), _count: { _all: true } }),
  ]);
  const wonMap = new Map(won.map((g) => [key(g.originalSource), g._count._all]));
  const lostMap = new Map(lost.map((g) => [key(g.originalSource), g._count._all]));
  const valueMap = new Map(wonValueAgg.map((g) => [key(g.originalSource), g._sum.wonValue ?? 0]));
  const visitMap = new Map(visited.map((g) => [key(g.originalSource), g._count._all]));

  const rows = totals
    .map((g) => {
      const total = g._count._all;
      const k = key(g.originalSource);
      const wonCount = wonMap.get(k) ?? 0;
      const visits = visitMap.get(k) ?? 0;
      return {
        source: k,
        total,
        siteVisits: visits,
        won: wonCount,
        lost: lostMap.get(k) ?? 0,
        conversionRate: total > 0 ? Math.round((wonCount / total) * 1000) / 10 : 0,
        visitToBooking: visits > 0 ? Math.round((wonCount / visits) * 1000) / 10 : 0,
        wonValue: valueMap.get(k) ?? 0,
      };
    })
    .sort((a, b) => b.total - a.total);
  res.json(rows);
});

reportsRouter.get('/source-attribution', async (req, res) => {
  const dateRange = parseDateRange(req.query as Record<string, string>);
  const where: Record<string, unknown> = {};
  if (Object.keys(dateRange).length > 0) where.createdAt = dateRange;

  const rows = await prisma.lead.findMany({
    where: inLeadScope(where, await scopeOf(req)),
    select: { utmSource: true, utmMedium: true, utmCampaign: true, source: true },
  });

  const bySourceMap = new Map<string, number>();
  const byCampaignMap = new Map<string, number>();
  for (const row of rows) {
    // Falls back to the plain `source` for leads with no UTM tagging (e.g. manually created).
    const utmKey = row.utmSource?.trim() || row.source;
    bySourceMap.set(utmKey, (bySourceMap.get(utmKey) ?? 0) + 1);
    if (row.utmCampaign?.trim()) {
      const label = row.utmMedium?.trim() ? `${row.utmCampaign} (${row.utmMedium})` : row.utmCampaign;
      byCampaignMap.set(label, (byCampaignMap.get(label) ?? 0) + 1);
    }
  }

  res.json({
    total: rows.length,
    bySource: [...bySourceMap.entries()].map(([utmSource, total]) => ({ utmSource, total })).sort((a, b) => b.total - a.total),
    byCampaign: [...byCampaignMap.entries()]
      .map(([campaign, total]) => ({ campaign, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15),
  });
});

reportsRouter.get('/pipeline-funnel', async (req, res) => {
  const { pipelineId } = req.query as Record<string, string>;
  const dateRange = parseDateRange(req.query as Record<string, string>);

  const pipeline = pipelineId
    ? await prisma.pipeline.findUnique({ where: { id: pipelineId } })
    : await prisma.pipeline.findFirst({ where: { isDefault: true } });
  if (!pipeline) return res.json({ pipelineId: null, stages: [] });

  const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { sortOrder: 'asc' } });
  const where: Record<string, unknown> = { pipelineStageId: { in: stages.map((s) => s.id) } };
  if (Object.keys(dateRange).length > 0) where.createdAt = dateRange;

  const counts = await prisma.lead.groupBy({ by: ['pipelineStageId'], where: inLeadScope(where, await scopeOf(req)), _count: { _all: true } });
  const countMap = new Map(counts.map((c) => [c.pipelineStageId, c._count._all]));

  /**
   * "Reached stage N" = currently at stage N or any later stage — the closest funnel view
   * available without a per-stage entry/exit history table (only the *current* stage is
   * tracked on Lead; LeadStageHistoryEntry logs moves but not a clean "time in stage N" span
   * for leads still mid-pipeline). Directionally correct for a forward-moving pipeline.
   */
  const rawCounts = stages.map((s) => countMap.get(s.id) ?? 0);
  const reached = rawCounts.map((_, i) => rawCounts.slice(i).reduce((sum, c) => sum + c, 0));

  const result = stages.map((stage, i) => ({
    stageId: stage.id,
    stage: stage.name,
    color: stage.color,
    count: rawCounts[i],
    reached: reached[i],
    conversionFromPrevious: i === 0 ? 100 : reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 1000) / 10 : 0,
  }));

  res.json({ pipelineId: pipeline.id, pipelineName: pipeline.name, stages: result });
});

reportsRouter.get('/pipeline-bottlenecks', async (req, res) => {
  const { pipelineId } = req.query as Record<string, string>;
  const pipeline = pipelineId
    ? await prisma.pipeline.findUnique({ where: { id: pipelineId } })
    : await prisma.pipeline.findFirst({ where: { isDefault: true } });
  if (!pipeline) return res.json({ pipelineId: null, stages: [] });

  const stages = await prisma.pipelineStage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { sortOrder: 'asc' } });
  const leads = await prisma.lead.findMany({
    where: inLeadScope({ pipelineStageId: { in: stages.map((s) => s.id) } }, await scopeOf(req)),
    select: { pipelineStageId: true, stageEnteredAt: true, createdAt: true },
  });

  const now = Date.now();
  const byStage = new Map<string, number[]>();
  for (const lead of leads) {
    const enteredAt = (lead.stageEnteredAt ?? lead.createdAt).getTime();
    const days = (now - enteredAt) / 86_400_000;
    const bucket = byStage.get(lead.pipelineStageId as string);
    if (bucket) bucket.push(days);
    else byStage.set(lead.pipelineStageId as string, [days]);
  }

  const result = stages
    .map((stage) => {
      const days = byStage.get(stage.id) ?? [];
      const avgDays = days.length > 0 ? days.reduce((sum, d) => sum + d, 0) / days.length : 0;
      return { stageId: stage.id, stage: stage.name, color: stage.color, leadsInStage: days.length, avgDaysInStage: Math.round(avgDays * 10) / 10 };
    })
    .sort((a, b) => b.avgDaysInStage - a.avgDaysInStage);

  res.json({ pipelineId: pipeline.id, pipelineName: pipeline.name, stages: result });
});

reportsRouter.get('/agent-performance-report', async (req, res) => {
  const dateRange = parseDateRange(req.query as Record<string, string>);
  const base: Record<string, unknown> = { assignedUserId: { not: null } };
  if (Object.keys(dateRange).length > 0) base.createdAt = dateRange;

  const scope = await scopeOf(req);
  const [totals, won, lost, wonValueAgg] = await Promise.all([
    prisma.lead.groupBy({ by: ['assignedUserId'], where: inLeadScope(base, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['assignedUserId'], where: inLeadScope({ ...base, status: 'won' }, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['assignedUserId'], where: inLeadScope({ ...base, status: 'lost' }, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['assignedUserId'], where: inLeadScope({ ...base, status: 'won' }, scope), _sum: { wonValue: true } }),
  ]);
  const wonMap = new Map(won.map((g) => [g.assignedUserId, g._count._all]));
  const lostMap = new Map(lost.map((g) => [g.assignedUserId, g._count._all]));
  const valueMap = new Map(wonValueAgg.map((g) => [g.assignedUserId, g._sum.wonValue ?? 0]));

  const rows = totals
    .map((g) => {
      const total = g._count._all;
      const w = wonMap.get(g.assignedUserId) ?? 0;
      return {
        userId: g.assignedUserId as string,
        total,
        won: w,
        lost: lostMap.get(g.assignedUserId) ?? 0,
        conversionRate: total > 0 ? Math.round((w / total) * 1000) / 10 : 0,
        wonValue: valueMap.get(g.assignedUserId) ?? 0,
      };
    })
    .sort((a, b) => b.total - a.total);
  res.json(rows);
});

/**
 * The leads behind one agent's row, for the drill-down on the report.
 *
 * Deliberately uses the same `parseDateRange` and the same `assignedUserId` test as the row
 * above it: a drawer that opens off a figure and then disagrees with it is worse than no
 * drawer at all.
 */
reportsRouter.get('/agent-performance-report/:userId/leads', async (req, res, next) => {
  try {
    const userId = String(req.params.userId);
    const dateRange = parseDateRange(req.query as Record<string, string>);

    const scope = await scopeOf(req);
    // A rep outside the caller's hierarchy is not a row they could have clicked on.
    if (scope.kind !== 'all' && !scope.userIds.includes(userId)) return res.status(404).json({ error: 'Not found.' });

    const where: Prisma.LeadWhereInput = { assignedUserId: userId };
    if (Object.keys(dateRange).length > 0) where.createdAt = dateRange;

    const [leads, byStatus] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          status: true,
          priority: true,
          source: true,
          dealValue: true,
          wonValue: true,
          createdAt: true,
          stage: { select: { name: true } },
          pipeline: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      prisma.lead.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);

    res.json({
      total: leads.length,
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      leads: leads.map((l) => ({
        id: l.id,
        name: `${l.firstName} ${l.lastName}`.trim(),
        phone: l.phone,
        status: l.status,
        priority: l.priority,
        source: l.source,
        stageName: l.stage?.name ?? null,
        pipelineName: l.pipeline?.name ?? null,
        dealValue: l.dealValue ?? null,
        wonValue: l.wonValue ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get('/revenue-by-rep', async (req, res) => {
  const dateRange = parseDateRange(req.query as Record<string, string>);
  // Revenue is dated by when the deal closed, not when the lead first came in.
  const where: Record<string, unknown> = { status: 'won' };
  if (Object.keys(dateRange).length > 0) where.wonAt = dateRange;

  const scope = await scopeOf(req);
  const [totals, valueAgg] = await Promise.all([
    prisma.lead.groupBy({ by: ['assignedUserId'], where: inLeadScope(where, scope), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['assignedUserId'], where: inLeadScope(where, scope), _sum: { wonValue: true } }),
  ]);
  const valueMap = new Map(valueAgg.map((g) => [g.assignedUserId, g._sum.wonValue ?? 0]));

  const rows = totals
    .map((g) => ({
      userId: (g.assignedUserId as string) ?? null,
      deals: g._count._all,
      revenue: valueMap.get(g.assignedUserId) ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
  res.json(rows);
});

reportsRouter.get('/automation-stats', async (req, res) => {
  const dateRange = parseDateRange(req.query as Record<string, string>);
  const where: Record<string, unknown> = {};
  if (Object.keys(dateRange).length > 0) where.ranAt = dateRange;

  // Runs carry a bare lead id, so the scope is applied as the set of leads the caller can see.
  const visible = await visibleLeadIds(await scopeOf(req));
  if (visible) where.leadId = { in: visible };

  const runs = await prisma.automationRun.findMany({ where, select: { automationId: true, automationName: true, status: true } });
  const byAutomation = new Map<string, { name: string; success: number; failed: number; skipped: number }>();
  for (const run of runs) {
    const entry = byAutomation.get(run.automationId) ?? { name: run.automationName, success: 0, failed: 0, skipped: 0 };
    if (run.status === 'success') entry.success += 1;
    else if (run.status === 'failed') entry.failed += 1;
    else entry.skipped += 1;
    byAutomation.set(run.automationId, entry);
  }

  const rows = [...byAutomation.entries()]
    .map(([automationId, e]) => ({
      automationId,
      name: e.name,
      total: e.success + e.failed + e.skipped,
      success: e.success,
      failed: e.failed,
      skipped: e.skipped,
      successRate: e.success + e.failed > 0 ? Math.round((e.success / (e.success + e.failed)) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.total - a.total);
  res.json(rows);
});

reportsRouter.get('/response-time', async (req, res) => {
  const { source } = req.query as Record<string, string>;
  const dateRange = parseDateRange(req.query as Record<string, string>);
  const where: Record<string, unknown> = {};
  if (Object.keys(dateRange).length > 0) where.createdAt = dateRange;
  if (source?.trim()) where.source = { contains: source.trim(), mode: 'insensitive' };

  const leads = await prisma.lead.findMany({
    where: inLeadScope(where, await scopeOf(req)),
    select: { source: true, createdAt: true, contactedAt: true },
  });
  const contacted = leads.filter((l) => l.contactedAt);
  const minutesFor = (l: (typeof contacted)[number]) => (l.contactedAt!.getTime() - l.createdAt.getTime()) / 60_000;

  const bySourceMinutes = new Map<string, number[]>();
  for (const lead of contacted) {
    const bucket = bySourceMinutes.get(lead.source);
    const minutes = minutesFor(lead);
    if (bucket) bucket.push(minutes);
    else bySourceMinutes.set(lead.source, [minutes]);
  }

  const avg = (values: number[]) => (values.length > 0 ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : 0);

  res.json({
    totalLeads: leads.length,
    contactedCount: contacted.length,
    notContactedCount: leads.length - contacted.length,
    avgResponseMinutes: avg(contacted.map(minutesFor)),
    bySource: [...bySourceMinutes.entries()]
      .map(([src, values]) => ({ source: src, count: values.length, avgResponseMinutes: avg(values) }))
      .sort((a, b) => a.avgResponseMinutes - b.avgResponseMinutes),
  });
});

reportsRouter.get('/form-analytics-summary', async (req, res) => {
  const dateRange = parseDateRange(req.query as Record<string, string>);
  const scope = await scopeOf(req);
  // Submissions are counted through the lead they produced, so a team sees only its own.
  const mine: Prisma.LeadFormSubmissionWhereInput = scope.kind === 'all' ? {} : { lead: leadScopeWhere(scope) };
  const submissionWhere: Prisma.LeadFormSubmissionWhereInput = {
    ...mine,
    ...(Object.keys(dateRange).length > 0 ? { createdAt: dateRange } : {}),
  };

  const forms = await prisma.leadForm.findMany({
    include: {
      _count: { select: { submissions: { where: mine } } },
      submissions: { where: submissionWhere, select: { leadId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows = forms.map((form) => ({
    id: form.id,
    name: form.name,
    slug: form.slug,
    isActive: form.isActive,
    allTimeSubmissions: form._count.submissions,
    submissionsInRange: form.submissions.length,
    leadsInRange: form.submissions.filter((s) => s.leadId).length,
  }));

  res.json({
    totalForms: forms.length,
    activeForms: forms.filter((f) => f.isActive).length,
    totalSubmissionsInRange: rows.reduce((sum, r) => sum + r.submissionsInRange, 0),
    totalLeadsInRange: rows.reduce((sum, r) => sum + r.leadsInRange, 0),
    forms: rows.sort((a, b) => b.submissionsInRange - a.submissionsInRange),
  });
});

// ---------------------------------------------------------------------------
// Site visits -> bookings, and the telecaller's day
// ---------------------------------------------------------------------------

/**
 * Visits against what came of them, by project, by the executive who hosted, and by the lead's
 * original source. A visit counts as converted when its lead is now won — read from the lead, so
 * there is no second place to mark it.
 */
reportsRouter.get('/site-visits', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    const range = parseDateRange(req.query as Record<string, string>);
    const where: Prisma.SiteVisitWhereInput = {
      AND: [scope.kind === 'all' ? {} : { OR: [{ lead: leadScopeWhere(scope) }, { hostId: { in: scope.userIds } }] }, Object.keys(range).length ? { scheduledAt: range } : {}],
    };
    const visits = await prisma.siteVisit.findMany({
      where,
      select: { status: true, leadId: true, project: { select: { projectName: true } }, host: { select: { id: true, name: true } }, lead: { select: { status: true, originalSource: true, source: true } } },
    });
    const group = (keyOf: (v: (typeof visits)[number]) => string) => {
      const m = new Map<string, { name: string; scheduled: number; done: number; noShow: number; cancelled: number; leadsDone: Set<string>; converted: Set<string> }>();
      for (const v of visits) {
        const name = keyOf(v);
        const e = m.get(name) ?? { name, scheduled: 0, done: 0, noShow: 0, cancelled: 0, leadsDone: new Set(), converted: new Set() };
        e.scheduled += 1;
        if (v.status === 'done') { e.done += 1; e.leadsDone.add(v.leadId); if (v.lead.status === 'won') e.converted.add(v.leadId); }
        if (v.status === 'no_show') e.noShow += 1;
        if (v.status === 'cancelled') e.cancelled += 1;
        m.set(name, e);
      }
      return [...m.values()]
        .map((e) => ({ name: e.name, scheduled: e.scheduled, done: e.done, noShow: e.noShow, cancelled: e.cancelled, booked: e.converted.size, conversionRate: e.leadsDone.size ? Math.round((e.converted.size / e.leadsDone.size) * 1000) / 10 : 0 }))
        .sort((a, b) => b.scheduled - a.scheduled);
    };
    const total = group(() => 'All')[0] ?? { scheduled: 0, done: 0, noShow: 0, cancelled: 0, booked: 0, conversionRate: 0 };
    res.json({
      total,
      byProject: group((v) => v.project.projectName),
      byExecutive: group((v) => v.host?.name ?? 'Unassigned'),
      bySource: group((v) => v.lead.originalSource ?? v.lead.source),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Each telecaller's day: calls, connected calls, follow-ups, visits and bookings, over the
 * caller's own team. "Zero activity" lists people who did nothing in the period and were not on
 * approved leave — so management sees silence without penalising a day off.
 */
reportsRouter.get('/telecallers', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    const q = req.query as Record<string, string>;
    const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    const fromDay = day(q.from) ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const toDay = day(q.to) ?? fromDay;
    const from = new Date(`${fromDay}T00:00:00.000+05:30`);
    const to = new Date(`${toDay}T23:59:59.999+05:30`);
    if (to < from) return res.status(400).json({ error: 'The end date cannot be before the start date.' });
    if ((to.getTime() - from.getTime()) / 86_400_000 > 92) return res.status(400).json({ error: 'Choose a range of at most 92 days.' });

    const people = await prisma.user.findMany({
      where: { status: 'active', role: { in: ['employee', 'team_leader', 'leader'] }, ...(scope.kind === 'all' ? {} : { id: { in: scope.userIds } }) },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    const ids = people.map((p) => p.id);
    const inRange = { gte: from, lte: to };
    const [calls, newLeads, fuDone, fuOpen, visits, won, leave] = await Promise.all([
      prisma.callLog.findMany({ where: { agentUserId: { in: ids }, startedAt: inRange }, select: { agentUserId: true, status: true, durationSeconds: true } }),
      prisma.lead.groupBy({ by: ['assignedUserId'], where: { assignedUserId: { in: ids }, createdAt: inRange }, _count: { _all: true } }),
      prisma.leadFollowUp.groupBy({ by: ['assignedUserId'], where: { assignedUserId: { in: ids }, completedAt: inRange }, _count: { _all: true } }),
      prisma.leadFollowUp.groupBy({ by: ['assignedUserId'], where: { assignedUserId: { in: ids }, status: { in: ['pending', 'rescheduled'] }, dueAt: { lt: new Date() } }, _count: { _all: true } }),
      prisma.siteVisit.findMany({ where: { hostId: { in: ids }, scheduledAt: inRange }, select: { hostId: true, status: true } }),
      prisma.lead.groupBy({ by: ['assignedUserId'], where: { assignedUserId: { in: ids }, status: 'won', wonAt: inRange }, _count: { _all: true } }),
      prisma.leaveRequest.findMany({ where: { userId: { in: ids }, status: 'approved', startDate: { lte: to }, endDate: { gte: from } }, select: { userId: true } }),
    ]);
    const cnt = (rows: { assignedUserId: string | null; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.assignedUserId as string, r._count._all]));
    const [nl, fd, fo, wn] = [cnt(newLeads), cnt(fuDone), cnt(fuOpen), cnt(won)];
    const onLeave = new Set(leave.map((l) => l.userId));

    const rows = people.map((p) => {
      const mine = calls.filter((c) => c.agentUserId === p.id);
      const connected = mine.filter((c) => c.status === 'answered');
      const v = visits.filter((x) => x.hostId === p.id);
      const row = {
        userId: p.id, name: p.name, role: p.role, onLeave: onLeave.has(p.id),
        calls: mine.length, connected: connected.length, connectedRate: mine.length ? Math.round((connected.length / mine.length) * 100) : 0,
        talkMinutes: Math.round(connected.reduce((s, c) => s + c.durationSeconds, 0) / 60),
        newLeads: nl.get(p.id) ?? 0, followUpsDone: fd.get(p.id) ?? 0, followUpsOverdue: fo.get(p.id) ?? 0,
        visitsScheduled: v.length, visitsDone: v.filter((x) => x.status === 'done').length, bookings: wn.get(p.id) ?? 0,
      };
      return { ...row, zeroActivity: row.calls === 0 && row.followUpsDone === 0 && row.visitsScheduled === 0 && !row.onLeave };
    });
    // Anybody who made no calls, did no follow-ups and hosted no visits and does not take calls at all is not a telecaller.
    const active = rows.filter((r) => r.calls + r.followUpsDone + r.visitsScheduled + r.newLeads + r.followUpsOverdue + r.bookings > 0 || r.onLeave || r.zeroActivity);
    const sum = (k: 'calls' | 'connected' | 'followUpsDone' | 'visitsScheduled' | 'bookings' | 'newLeads') => active.reduce((s, r) => s + r[k], 0);
    res.json({
      from: fromDay, to: toDay,
      totals: { calls: sum('calls'), connected: sum('connected'), followUpsDone: sum('followUpsDone'), visitsScheduled: sum('visitsScheduled'), bookings: sum('bookings'), newLeads: sum('newLeads') },
      rows: active.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
      zeroActivity: rows.filter((r) => r.zeroActivity).map((r) => ({ userId: r.userId, name: r.name })),
      onLeave: rows.filter((r) => r.onLeave).map((r) => ({ userId: r.userId, name: r.name })),
    });
  } catch (err) {
    next(err);
  }
});
