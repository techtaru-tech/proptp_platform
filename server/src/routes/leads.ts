import { Router } from 'express';
import { prisma } from '../prisma';
import { buildLeadWhere } from '../services/leadFilters';
import { Prisma } from '@prisma/client';
import { fireTrigger } from '../services/automationEngine';
import type { AuthedRequest } from '../services/auth';
import {
  actorNameOf,
  archivedLeadWhere,
  assignableUsers,
  canAssignTo,
  canUnassign,
  findLeadInScope,
  inLeadScope,
  leadIdsInScope,
  scopeOf,
  viaLead,
} from '../services/hierarchy';

export const leadsRouter = Router();

function leadFullName(l: { firstName: string; lastName: string }) {
  return `${l.firstName} ${l.lastName}`.trim();
}

leadsRouter.get('/', async (req, res) => {
  const {
    page = '1',
    pageSize = '10',
    search,
    status,
    priority,
    source,
    pipelineId,
    stageId,
    assignedUserId,
    temperature,
    campaignName,
    adName,
    formName,
    dateFrom,
    dateTo,
    lastActivityFrom,
    lastActivityTo,
    sortBy,
    sortDir,
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, Number(page) || 1);
  // Capped at what the rows-per-page picker offers: a hand-edited URL asking for ten thousand
  // leads would build the whole list in memory and pre-join every one of them.
  const size = Math.min(100, Math.max(1, Number(pageSize) || 10));

  const scope = await scopeOf(req);
  const where = inLeadScope(
    buildLeadWhere({
      search, status, priority, source, pipelineId, stageId, assignedUserId, temperature,
      campaignName, adName, formName, dateFrom, dateTo, lastActivityFrom, lastActivityTo,
    }),
    scope
  );

  const orderBy: Prisma.LeadOrderByWithRelationInput =
    sortBy === 'leadScore'
      ? { leadScore: sortDir === 'asc' ? 'asc' : 'desc' }
      : sortBy === 'dealValue'
        ? { dealValue: sortDir === 'asc' ? 'asc' : 'desc' }
        : { createdAt: sortDir === 'asc' ? 'asc' : 'desc' };

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy,
      skip: (pageNum - 1) * size,
      take: size,
      include: {
        tags: { include: { tag: true } },
        stage: true,
        pipeline: true,
        // Just the newest one: the list shows when a lead was last touched, not its history.
        activities: { orderBy: { createdAt: 'desc' }, take: 1, select: { type: true, description: true, createdAt: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  res.json({
    items: items.map(({ activities, ...l }) => ({
      ...l,
      tagIds: l.tags.map((t) => t.tagId),
      lastActivity: activities[0]
        ? { type: activities[0].type, description: activities[0].description, at: activities[0].createdAt.toISOString() }
        : null,
    })),
    total,
    page: pageNum,
    pageSize: size,
  });
});

/**
 * Every lead id the current filter matches, for "select all" on the list.
 *
 * Ids only, and capped: the page needs them to run a bulk action, not to render anything, and
 * a filter that matches the whole database should not ship the whole database to do it.
 */
/**
 * The campaigns and ads that have actually produced leads, for the filter dropdowns.
 *
 * Read from the leads rather than from Meta: the point is to filter what is in front of you,
 * and an ad that has never produced a lead is only noise in a list.
 */
leadsRouter.get('/ad-sources', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    const campaigns = await prisma.lead.groupBy({
      by: ['utmCampaign'],
      where: inLeadScope({ utmCampaign: { not: null } }, scope),
      _count: { _all: true },
      orderBy: { _count: { utmCampaign: 'desc' } },
      take: 100,
    });

    // adDetail is JSON, so the ad names are counted in memory. Bounded by the Meta leads that
    // have one, which is only those ingested since the column existed.
    const withAd = await prisma.lead.findMany({
      where: inLeadScope({ adDetail: { not: Prisma.DbNull } }, scope),
      select: { adDetail: true },
      take: 5000,
    });
    const adCounts = new Map<string, number>();
    const formCounts = new Map<string, number>();
    for (const row of withAd) {
      const detail = row.adDetail as { adName?: string; formName?: string } | null;
      if (detail?.adName) adCounts.set(detail.adName, (adCounts.get(detail.adName) ?? 0) + 1);
      if (detail?.formName) formCounts.set(detail.formName, (formCounts.get(detail.formName) ?? 0) + 1);
    }
    const byCount = (a: { count: number }, b: { count: number }) => b.count - a.count;

    res.json({
      campaigns: campaigns
        .filter((c) => c.utmCampaign)
        .map((c) => ({ name: c.utmCampaign as string, count: c._count._all })),
      ads: Array.from(adCounts.entries()).map(([name, count]) => ({ name, count })).sort(byCount),
      forms: Array.from(formCounts.entries()).map(([name, count]) => ({ name, count })).sort(byCount),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The people the caller may assign a lead to (and filter the list by): their own hierarchy,
 * or everybody for an administrator. Served from here rather than the partner list because
 * that one needs the Partners module, which a sales user does not have.
 */
leadsRouter.get('/assignees', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    res.json({ canAssign: scope.canAssign, canUnassign: canUnassign(scope), kind: scope.kind, users: await assignableUsers(scope) });
  } catch (err) {
    next(err);
  }
});

/** The projects a sales user can name as a buyer's interest or a visit — without needing the Projects module. */
leadsRouter.get('/project-options', async (_req, res, next) => {
  try {
    res.json(await prisma.project.findMany({ where: { status: 1 }, select: { id: true, projectName: true }, orderBy: { projectName: 'asc' } }));
  } catch (err) {
    next(err);
  }
});

/** Archived leads the caller could see, newest first. Registered before `/:id`, which only reaches live leads. */
leadsRouter.get('/archived', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    const rows = await prisma.lead.findMany({ where: archivedLeadWhere(scope), orderBy: { archivedAt: 'desc' }, take: 200, select: { id: true, firstName: true, lastName: true, phone: true, source: true, archivedAt: true, assignedUserId: true } });
    res.json(rows.map((l) => ({ ...l, name: `${l.firstName} ${l.lastName}`.trim(), archivedAt: l.archivedAt?.toISOString() })));
  } catch (err) {
    next(err);
  }
});

leadsRouter.post('/archived/:leadId/restore', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);
    const lead = await prisma.lead.findFirst({ where: { AND: [{ id: String(req.params.leadId) }, archivedLeadWhere(scope)] }, select: { id: true } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    await prisma.lead.update({ where: { id: lead.id }, data: { archivedAt: null } });
    await prisma.leadActivity.create({ data: { leadId: lead.id, type: 'restored', description: 'Lead restored from the archive.', userName: await actorNameOf(req) } });
    res.json({ restored: true });
  } catch (err) {
    next(err);
  }
});

leadsRouter.get('/ids', async (req, res, next) => {
  try {
    const {
      search, status, priority, source, pipelineId, stageId, assignedUserId, temperature,
      campaignName, adName, formName, dateFrom, dateTo, lastActivityFrom, lastActivityTo,
    } =
      req.query as Record<string, string>;
    const scope = await scopeOf(req);
    const where = inLeadScope(
      buildLeadWhere({
        search, status, priority, source, pipelineId, stageId, assignedUserId, temperature,
        campaignName, adName, formName, dateFrom, dateTo, lastActivityFrom, lastActivityTo,
      }),
      scope
    );

    const LIMIT = 5000;
    const [rows, total] = await Promise.all([
      prisma.lead.findMany({ where, select: { id: true }, orderBy: { createdAt: 'desc' }, take: LIMIT }),
      prisma.lead.count({ where }),
    ]);

    res.json({ ids: rows.map((r) => r.id), total, capped: total > LIMIT, limit: LIMIT });
  } catch (err) {
    next(err);
  }
});

/**
 * Who a new lead belongs to. A lead a non-admin creates must land somewhere they can see it —
 * left unassigned it would vanish from the creator's own list — so it defaults to them, and an
 * explicit assignee has to be somebody in their hierarchy.
 */
async function resolveNewLeadOwner(
  scope: Awaited<ReturnType<typeof scopeOf>>,
  requested: string | null | undefined
): Promise<{ ok: true; userId: string | null } | { ok: false; error: string }> {
  const wanted = requested || null;
  if (scope.kind === 'all') return { ok: true, userId: wanted };
  if (!wanted) return { ok: true, userId: scope.userId };
  if (wanted === scope.userId) return { ok: true, userId: wanted };
  if (!(await canAssignTo(scope, wanted))) {
    return { ok: false, error: 'You can only assign leads to people in your own team.' };
  }
  return { ok: true, userId: wanted };
}

const TEMPERATURES = ['hot', 'warm', 'cold'];

leadsRouter.post('/', async (req, res) => {
  const body = req.body;
  if (body.temperature && !TEMPERATURES.includes(body.temperature)) return res.status(400).json({ error: 'Temperature must be hot, warm or cold.' });
  if (body.interestedProjectId && !(await prisma.project.count({ where: { id: String(body.interestedProjectId) } }))) {
    return res.status(400).json({ error: 'That project does not exist.' });
  }
  const scope = await scopeOf(req);
  const owner = await resolveNewLeadOwner(scope, body.assignedUserId);
  if (!owner.ok) return res.status(403).json({ error: owner.error });
  const created = await prisma.lead.create({
    data: {
      firstName: body.firstName ?? '',
      lastName: body.lastName ?? '',
      email: body.email || undefined,
      phone: body.phone ?? '',
      city: body.city || undefined,
      jobTitle: body.jobTitle || undefined,
      purpose: body.purpose || undefined,
      propertyType: body.propertyType || undefined,
      budgetRange: body.budgetRange || undefined,
      preferredLocations: Array.isArray(body.preferredLocations) ? body.preferredLocations.filter(Boolean) : [],
      source: body.source ?? 'manual',
      priority: body.priority ?? 'normal',
      assignedUserId: owner.userId || undefined,
      temperature: TEMPERATURES.includes(body.temperature) ? body.temperature : undefined,
      interestedProjectId: body.interestedProjectId || undefined,
      pipelineId: body.pipelineId || undefined,
      pipelineStageId: body.pipelineStageId || undefined,
      stageEnteredAt: body.pipelineStageId ? new Date() : undefined,
      dealValue: body.dealValue ?? undefined,
      expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : undefined,
      notes: body.notes || undefined,
    },
  });
  await prisma.leadActivity.create({
    data: { leadId: created.id, type: 'created', description: `Lead "${leadFullName(created)}" created.` },
  });
  await fireTrigger('lead_created', created.id);
  res.status(201).json(created);
});

// ---------------------------------------------------------------------------
// Bulk actions and CSV import — registered BEFORE the `/:id/...` routes below,
// since a path like `/bulk/assign` would otherwise be shadowed by `/:id/assign`
// (Express matches routes in registration order, and both shapes are `/segment/segment`).
// ---------------------------------------------------------------------------

leadsRouter.post('/bulk/assign', async (req, res) => {
  const { ids, userId } = req.body as { ids: string[]; userId: string };
  const scope = await scopeOf(req);
  if (!userId || !(await canAssignTo(scope, userId))) {
    return res.status(403).json({ error: 'You can only assign leads to people in your own team.' });
  }
  const actor = await actorNameOf(req);
  // Only leads the caller can already see: an id from outside their hierarchy is skipped, as if
  // it were not in the list — they cannot use a bulk call to reach a lead they cannot open.
  const allowed = await leadIdsInScope(scope, ids);
  const leads = await prisma.lead.findMany({ where: { id: { in: allowed } }, select: { id: true, assignedUserId: true } });
  await Promise.all(
    leads.map(async (lead) => {
      await prisma.lead.update({ where: { id: lead.id }, data: { assignedUserId: userId } });
      await prisma.leadAssignmentHistoryEntry.create({
        data: { leadId: lead.id, fromUserId: lead.assignedUserId, toUserId: userId, actorName: actor },
      });
      await prisma.leadActivity.create({ data: { leadId: lead.id, type: 'assigned', description: 'Bulk-assigned.', userName: actor } });
      await fireTrigger('lead_assigned', lead.id);
    })
  );
  res.json({ assigned: leads.length, skipped: (ids?.length ?? 0) - leads.length });
});

leadsRouter.post('/bulk/status', async (req, res) => {
  const { ids, status } = req.body as { ids: string[]; status: string };
  const allowed = await leadIdsInScope(await scopeOf(req), ids);
  await prisma.lead.updateMany({ where: { id: { in: allowed } }, data: { status: status as any } });
  res.status(204).send();
});

leadsRouter.post('/bulk/priority', async (req, res) => {
  const { ids, priority } = req.body as { ids: string[]; priority: string };
  const allowed = await leadIdsInScope(await scopeOf(req), ids);
  await prisma.lead.updateMany({ where: { id: { in: allowed } }, data: { priority: priority as any } });
  res.status(204).send();
});

leadsRouter.post('/bulk/source', async (req, res) => {
  const { ids, source, otherSource } = req.body as { ids: string[]; source: string; otherSource?: string };
  const allowed = await leadIdsInScope(await scopeOf(req), ids);
  await prisma.lead.updateMany({
    where: { id: { in: allowed } },
    data: { source, otherSource: source === 'other' ? otherSource || undefined : null },
  });
  res.status(204).send();
});

leadsRouter.post('/bulk/tag', async (req, res) => {
  const { ids, tagId } = req.body as { ids: string[]; tagId: string };
  const allowed = await leadIdsInScope(await scopeOf(req), ids);
  await Promise.all(
    allowed.map((leadId) => prisma.leadTagOnLead.create({ data: { leadId, tagId } }).catch(() => undefined))
  );
  res.status(204).send();
});

leadsRouter.post('/bulk/untag', async (req, res) => {
  const { ids, tagId } = req.body as { ids: string[]; tagId: string };
  const allowed = await leadIdsInScope(await scopeOf(req), ids);
  await prisma.leadTagOnLead.deleteMany({ where: { leadId: { in: allowed }, tagId } });
  res.status(204).send();
});

leadsRouter.post('/bulk/stage', async (req, res) => {
  const { ids, pipelineId, stageId } = req.body as { ids: string[]; pipelineId: string; stageId: string };
  const toStage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
  const actor = await actorNameOf(req);
  const allowed = await leadIdsInScope(await scopeOf(req), ids);
  const leads = await prisma.lead.findMany({ where: { id: { in: allowed } }, include: { stage: true } });

  const data: Record<string, unknown> = { pipelineId, pipelineStageId: stageId, stageEnteredAt: new Date() };
  if (toStage?.isWon) data.status = 'won';
  if (toStage?.isLost) data.status = 'lost';

  await Promise.all(
    leads.map(async (lead) => {
      await prisma.lead.update({ where: { id: lead.id }, data: data as any });
      await prisma.leadStageHistoryEntry.create({
        data: { leadId: lead.id, fromStageName: lead.stage?.name, toStageName: toStage?.name ?? 'Unknown', actorName: actor },
      });
      await prisma.leadActivity.create({
        data: { leadId: lead.id, type: 'stage_moved', description: `Bulk-moved to "${toStage?.name ?? 'Unknown'}".`, userName: actor },
      });
      await fireTrigger('lead_stage_changed', lead.id, { fromStageId: lead.pipelineStageId ?? undefined, toStageId: stageId });
    })
  );
  res.status(204).send();
});

leadsRouter.post('/bulk/delete', async (req, res) => {
  const { ids } = req.body as { ids: string[] };
  const allowed = await leadIdsInScope(await scopeOf(req), ids);
  await prisma.lead.updateMany({ where: { id: { in: allowed } }, data: { archivedAt: new Date() } });
  res.status(204).send();
});

/**
 * CSV Import — header-mapped rows in, dedupe by email/phone, same net effect as the
 * frontend's previous mock importer (see src/utils/csvHeaderMatcher.ts for the mapping UI).
 */
leadsRouter.post('/import', async (req, res) => {
  const { rows, defaultPipelineId, defaultStageId } = req.body as {
    rows: Record<string, string>[];
    defaultPipelineId?: string;
    defaultStageId?: string;
  };

  const scope = await scopeOf(req);
  // An import by anybody but an admin lands in their own list, for the same reason a single
  // new lead does: otherwise the person who uploaded it could not see what they uploaded.
  const importOwner = scope.kind === 'all' ? undefined : scope.userId;

  const seen = new Set<string>();
  const results: { row: number; status: 'imported' | 'duplicate' | 'skipped'; reason?: string; leadId?: string }[] = [];
  let imported = 0;
  let duplicates = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = row.email?.trim().toLowerCase() || undefined;
    const phone = row.phone?.trim() || '';
    const phoneNormalized = phone.replace(/\D/g, '');

    if (!phone && !email) {
      results.push({ row: i + 1, status: 'skipped', reason: 'No email or phone provided.' });
      skipped += 1;
      continue;
    }

    const dedupeKeys = [email ? `e:${email}` : null, phoneNormalized ? `p:${phoneNormalized}` : null].filter(
      (k): k is string => !!k
    );
    const alreadySeen = dedupeKeys.some((k) => seen.has(k));
    const existsInDb =
      email || phoneNormalized
        ? await prisma.lead.findFirst({
            where: {
              OR: [email ? { email } : undefined, phoneNormalized ? { phone: phoneNormalized } : undefined].filter(
                Boolean
              ) as any,
            },
          })
        : null;

    if (alreadySeen || existsInDb) {
      results.push({ row: i + 1, status: 'duplicate', reason: 'Matches an existing lead by email or phone.' });
      duplicates += 1;
      continue;
    }
    dedupeKeys.forEach((k) => seen.add(k));

    let firstName: string | undefined = row.first_name?.trim();
    let lastName: string | undefined = row.last_name?.trim();
    if (!firstName && !lastName && row.full_name) {
      const parts = row.full_name.trim().split(/\s+/);
      firstName = parts[0];
      lastName = parts.slice(1).join(' ') || undefined;
    }

    const created = await prisma.lead.create({
      data: {
        firstName: firstName || 'Unknown',
        lastName: lastName || '',
        email,
        phone,
        city: row.city?.trim() || undefined,
        company: row.company?.trim() || undefined,
        source: 'manual',
        otherSource: row.source?.trim() || undefined,
        pipelineId: defaultPipelineId || undefined,
        pipelineStageId: defaultStageId || undefined,
        stageEnteredAt: defaultStageId ? new Date() : undefined,
        dealValue: row.deal_value ? Number(row.deal_value.replace(/[^0-9.]/g, '')) || undefined : undefined,
        assignedTo: row.assigned?.trim() || undefined,
        assignedUserId: importOwner,
        notes: row.notes?.trim() || undefined,
      },
    });
    await prisma.leadActivity.create({
      data: { leadId: created.id, type: 'imported', description: `Lead "${leadFullName(created)}" imported from CSV.` },
    });
    await fireTrigger('lead_created', created.id);

    if (row.follow_up?.trim()) {
      const due = new Date(row.follow_up.trim());
      if (!Number.isNaN(due.getTime())) {
        await prisma.leadFollowUp.create({
          data: { leadId: created.id, title: 'Follow up (imported)', dueAt: due, reminderAt: due, priority: 'normal' },
        });
      }
    }

    results.push({ row: i + 1, status: 'imported', leadId: created.id });
    imported += 1;
  }

  res.json({ imported, duplicates, skipped, results });
});

/** Cross-lead activity feed (the CRM "Activities" page) — registered before `GET /:id`. */
leadsRouter.get('/activities', async (req, res) => {
  const { page = '1', pageSize = '20', search, type, dateFrom, dateTo } = req.query as Record<string, string>;
  const scope = await scopeOf(req);
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);

  const where: Prisma.LeadActivityWhereInput = { ...viaLead(scope) };
  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { userName: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (type && type !== 'all') where.type = type;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as any).gte = new Date(dateFrom);
    if (dateTo) (where.createdAt as any).lte = new Date(dateTo);
  }

  const [items, total] = await Promise.all([
    prisma.leadActivity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * size,
      take: size,
      include: { lead: { select: { firstName: true, lastName: true } } },
    }),
    prisma.leadActivity.count({ where }),
  ]);

  res.json({
    items: items.map(({ lead, ...a }) => ({ ...a, leadName: leadFullName(lead) })),
    total,
    page: pageNum,
    pageSize: size,
  });
});

// ---------------------------------------------------------------------------
// Single-lead routes
// ---------------------------------------------------------------------------

/**
 * Every `/:id/...` route below — the detail page, its notes, activities, follow-ups, history,
 * tags, stage and assignment — passes through this first. A lead outside the caller's
 * hierarchy answers exactly like one that does not exist, so the only way to learn that a
 * colleague's lead is there would be to already be allowed to see it.
 */
leadsRouter.param('id', async (req, res, next, id) => {
  try {
    const scope = await scopeOf(req);
    if (scope.kind !== 'all' && !(await findLeadInScope(scope, String(id)))) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    next();
  } catch (err) {
    next(err);
  }
});

leadsRouter.get('/:id', async (req, res) => {
  // A lead outside the caller's own team answers as not found, as it does in the list.
  if (!(await findLeadInScope(await scopeOf(req), req.params.id))) return res.status(404).json({ error: 'Lead not found' });
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      tags: { include: { tag: true } },
      stage: true,
      pipeline: true,
      sourceConnection: true,
      // Answers to custom fields — form questions the built-in columns have no home for.
      customValues: { include: { field: true } },
    },
  });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json({
    ...lead,
    tagIds: lead.tags.map((t) => t.tagId),
    customFields: lead.customValues
      .sort((a, b) => a.field.sortOrder - b.field.sortOrder || a.field.label.localeCompare(b.field.label))
      .map((v) => ({ key: v.field.key, label: v.field.label, type: v.field.type, value: v.value })),
  });
});

leadsRouter.patch('/:id', async (req, res) => {
  const scope = await scopeOf(req);
  // originalSource is never writable — the database also keeps it fixed, this just says so plainly.
  const { id: _id, createdAt: _c, updatedAt: _u, assignedUserId, originalSource: _o, ...fields } = req.body ?? {};
  if (fields.temperature !== undefined && fields.temperature !== null && !TEMPERATURES.includes(fields.temperature)) {
    return res.status(400).json({ error: 'Temperature must be hot, warm or cold.' });
  }
  if (fields.interestedProjectId && !(await prisma.project.count({ where: { id: String(fields.interestedProjectId) } }))) {
    return res.status(400).json({ error: 'That project does not exist.' });
  }

  // The edit form sends the whole record back, assignee included. Only an actual change of
  // owner is an assignment — and that one has to be somebody this caller may assign to.
  const current = await prisma.lead.findUnique({ where: { id: req.params.id }, select: { leadScore: true, assignedUserId: true } });
  const reassigning = assignedUserId !== undefined && (assignedUserId || null) !== (current?.assignedUserId ?? null);
  if (reassigning) {
    if (!assignedUserId ? !canUnassign(scope) : !(await canAssignTo(scope, assignedUserId))) {
      return res.status(403).json({ error: 'You can only assign leads to people in your own team.' });
    }
  }

  const before = fields.leadScore !== undefined ? current : null;
  const updated = await prisma.lead
    .update({ where: { id: req.params.id }, data: { ...fields, ...(reassigning ? { assignedUserId: assignedUserId || null } : {}) } })
    .catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Lead not found' });
  if (reassigning) {
    const actor = await actorNameOf(req);
    await prisma.leadAssignmentHistoryEntry.create({
      data: { leadId: updated.id, fromUserId: current?.assignedUserId ?? null, toUserId: assignedUserId || null, actorName: actor },
    });
    await prisma.leadActivity.create({
      data: { leadId: updated.id, type: 'assigned', description: assignedUserId ? 'Reassigned.' : 'Unassigned.', userName: actor },
    });
    if (assignedUserId) await fireTrigger('lead_assigned', updated.id);
  }
  if (before && updated.leadScore !== before.leadScore) await fireTrigger('lead_score_threshold', updated.id);
  res.json(updated);
});

/**
 * "Delete" archives: the lead and everything on it stay in the database, out of every list, and can be
 * restored. Nothing here removes a customer's record for good.
 */
leadsRouter.delete('/:id', async (req, res) => {
  await prisma.lead.update({ where: { id: req.params.id }, data: { archivedAt: new Date() } }).catch(() => undefined);
  await prisma.leadActivity.create({ data: { leadId: req.params.id, type: 'archived', description: 'Lead archived.', userName: await actorNameOf(req) } }).catch(() => undefined);
  res.status(204).send();
});

leadsRouter.post('/:id/status', async (req, res) => {
  const { status, lostReason } = req.body as { status: string; lostReason?: string };
  if (!(await findLeadInScope(await scopeOf(req), req.params.id))) return res.status(404).json({ error: 'Lead not found' });
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const data: Record<string, unknown> = { status };
  if (status === 'won') {
    data.wonAt = new Date();
    data.wonValue = lead.dealValue;
  }
  if (status === 'lost') {
    data.lostAt = new Date();
    data.lostReason = lostReason;
  }

  const updated = await prisma.lead.update({ where: { id: req.params.id }, data });
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: 'status_changed',
      description: `Status changed from "${lead.status}" to "${status}".`,
      userName: await actorNameOf(req),
    },
  });
  res.json(updated);
});

leadsRouter.post('/:id/assign', async (req, res) => {
  const { userId } = req.body as { userId?: string };
  const scope = await scopeOf(req);
  // Handing a lead on is a manager's action, and only to somebody in their own hierarchy.
  // Unassigning is the same action, so it needs the same standing.
  if (userId ? !(await canAssignTo(scope, userId)) : !canUnassign(scope)) {
    return res.status(403).json({ error: 'You can only assign leads to people in your own team.' });
  }
  const before = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Lead not found' });
  const actor = await actorNameOf(req);

  const updated = await prisma.lead.update({ where: { id: req.params.id }, data: { assignedUserId: userId || null } });
  await prisma.leadAssignmentHistoryEntry.create({
    data: { leadId: updated.id, fromUserId: before.assignedUserId, toUserId: userId || null, actorName: actor },
  });
  await prisma.leadActivity.create({
    data: { leadId: updated.id, type: 'assigned', description: userId ? 'Reassigned.' : 'Unassigned.', userName: actor },
  });
  if (userId) await fireTrigger('lead_assigned', updated.id);
  res.json(updated);
});

leadsRouter.post('/:id/star', async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const updated = await prisma.lead.update({ where: { id: req.params.id }, data: { isStarred: !lead.isStarred } });
  res.json(updated);
});

leadsRouter.post('/:id/stage', async (req, res) => {
  const { pipelineId, stageId } = req.body as { pipelineId: string; stageId: string };
  if (!(await findLeadInScope(await scopeOf(req), req.params.id))) return res.status(404).json({ error: 'Lead not found' });
  const [lead, toStage] = await Promise.all([
    prisma.lead.findUnique({ where: { id: req.params.id }, include: { stage: true } }),
    prisma.pipelineStage.findUnique({ where: { id: stageId } }),
  ]);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const data: Record<string, unknown> = { pipelineId, pipelineStageId: stageId, stageEnteredAt: new Date() };
  if (toStage?.isWon) data.status = 'won';
  if (toStage?.isLost) data.status = 'lost';

  const updated = await prisma.lead.update({ where: { id: req.params.id }, data });
  await prisma.leadStageHistoryEntry.create({
    data: {
      leadId: lead.id,
      fromStageName: lead.stage?.name,
      toStageName: toStage?.name ?? 'Unknown',
      actorName: await actorNameOf(req),
    },
  });
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: 'stage_moved',
      description: `Moved from "${lead.stage?.name ?? 'Unassigned'}" to "${toStage?.name ?? 'Unknown'}".`,
      userName: await actorNameOf(req),
    },
  });
  await fireTrigger('lead_stage_changed', lead.id, { fromStageId: lead.pipelineStageId ?? undefined, toStageId: stageId });
  res.json(updated);
});

leadsRouter.post('/:id/tags/:tagId', async (req, res) => {
  await prisma.leadTagOnLead
    .create({ data: { leadId: req.params.id, tagId: req.params.tagId } })
    .catch(() => undefined); // already applied — ignore the unique-constraint error
  await fireTrigger('tag_added', req.params.id, { tagId: req.params.tagId });
  res.status(204).send();
});

leadsRouter.delete('/:id/tags/:tagId', async (req, res) => {
  await prisma.leadTagOnLead
    .delete({ where: { leadId_tagId: { leadId: req.params.id, tagId: req.params.tagId } } })
    .catch(() => undefined);
  res.status(204).send();
});

leadsRouter.get('/:id/activities', async (req, res) => {
  const rows = await prisma.leadActivity.findMany({ where: { leadId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json(rows);
});

leadsRouter.post('/:id/activities', async (req, res) => {
  const { type, description } = req.body as { type: string; description: string };
  const row = await prisma.leadActivity.create({
    data: { leadId: req.params.id, type, description, userName: await actorNameOf(req) },
  });
  res.status(201).json(row);
});

leadsRouter.get('/:id/notes', async (req, res) => {
  const rows = await prisma.leadNote.findMany({ where: { leadId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json(rows);
});

leadsRouter.post('/:id/notes', async (req, res) => {
  const { body } = req.body as { body: string };
  if (!(await findLeadInScope(await scopeOf(req), req.params.id))) return res.status(404).json({ error: 'Lead not found' });
  const actor = await actorNameOf(req);
  const note = await prisma.leadNote.create({
    data: { leadId: req.params.id, userId: (req as AuthedRequest).auth?.sub ?? 'unknown', userName: actor, body },
  });
  await prisma.leadActivity.create({
    data: { leadId: req.params.id, type: 'note_added', description: 'Note added.', userName: actor },
  });
  res.status(201).json(note);
});

leadsRouter.get('/:id/followups', async (req, res) => {
  const rows = await prisma.leadFollowUp.findMany({ where: { leadId: req.params.id }, orderBy: { dueAt: 'asc' } });
  res.json(rows);
});

/** Stage-move + reassignment history for the lead detail page's "History" tab. */
leadsRouter.get('/:id/history', async (req, res) => {
  const [stageHistory, assignmentHistory] = await Promise.all([
    prisma.leadStageHistoryEntry.findMany({ where: { leadId: req.params.id }, orderBy: { createdAt: 'desc' } }),
    prisma.leadAssignmentHistoryEntry.findMany({ where: { leadId: req.params.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  res.json({ stageHistory, assignmentHistory });
});
