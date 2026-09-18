import { Router } from 'express';
import { prisma } from '../prisma';
import { buildLeadWhere } from '../services/leadFilters';
import { Prisma } from '@prisma/client';
import { fireTrigger } from '../services/automationEngine';

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

  const where = buildLeadWhere({
    search, status, priority, source, pipelineId, stageId, assignedUserId,
    campaignName, adName, formName, dateFrom, dateTo, lastActivityFrom, lastActivityTo,
  });

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
leadsRouter.get('/ad-sources', async (_req, res, next) => {
  try {
    const campaigns = await prisma.lead.groupBy({
      by: ['utmCampaign'],
      where: { utmCampaign: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { utmCampaign: 'desc' } },
      take: 100,
    });

    // adDetail is JSON, so the ad names are counted in memory. Bounded by the Meta leads that
    // have one, which is only those ingested since the column existed.
    const withAd = await prisma.lead.findMany({
      where: { adDetail: { not: Prisma.DbNull } },
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

leadsRouter.get('/ids', async (req, res, next) => {
  try {
    const {
      search, status, priority, source, pipelineId, stageId, assignedUserId,
      campaignName, adName, formName, dateFrom, dateTo, lastActivityFrom, lastActivityTo,
    } =
      req.query as Record<string, string>;
    const where = buildLeadWhere({
      search, status, priority, source, pipelineId, stageId, assignedUserId,
      campaignName, adName, formName, dateFrom, dateTo, lastActivityFrom, lastActivityTo,
    });

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

leadsRouter.post('/', async (req, res) => {
  const body = req.body;
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
      assignedUserId: body.assignedUserId || undefined,
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
  const leads = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, assignedUserId: true } });
  await Promise.all(
    leads.map(async (lead) => {
      await prisma.lead.update({ where: { id: lead.id }, data: { assignedUserId: userId } });
      await prisma.leadAssignmentHistoryEntry.create({
        data: { leadId: lead.id, fromUserId: lead.assignedUserId, toUserId: userId, actorName: 'Priyanka Singh' },
      });
      await prisma.leadActivity.create({ data: { leadId: lead.id, type: 'assigned', description: 'Bulk-assigned.' } });
      await fireTrigger('lead_assigned', lead.id);
    })
  );
  res.status(204).send();
});

leadsRouter.post('/bulk/status', async (req, res) => {
  const { ids, status } = req.body as { ids: string[]; status: string };
  await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { status: status as any } });
  res.status(204).send();
});

leadsRouter.post('/bulk/priority', async (req, res) => {
  const { ids, priority } = req.body as { ids: string[]; priority: string };
  await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { priority: priority as any } });
  res.status(204).send();
});

leadsRouter.post('/bulk/source', async (req, res) => {
  const { ids, source, otherSource } = req.body as { ids: string[]; source: string; otherSource?: string };
  await prisma.lead.updateMany({
    where: { id: { in: ids } },
    data: { source, otherSource: source === 'other' ? otherSource || undefined : null },
  });
  res.status(204).send();
});

leadsRouter.post('/bulk/tag', async (req, res) => {
  const { ids, tagId } = req.body as { ids: string[]; tagId: string };
  await Promise.all(
    ids.map((leadId) => prisma.leadTagOnLead.create({ data: { leadId, tagId } }).catch(() => undefined))
  );
  res.status(204).send();
});

leadsRouter.post('/bulk/untag', async (req, res) => {
  const { ids, tagId } = req.body as { ids: string[]; tagId: string };
  await prisma.leadTagOnLead.deleteMany({ where: { leadId: { in: ids }, tagId } });
  res.status(204).send();
});

leadsRouter.post('/bulk/stage', async (req, res) => {
  const { ids, pipelineId, stageId } = req.body as { ids: string[]; pipelineId: string; stageId: string };
  const toStage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
  const leads = await prisma.lead.findMany({ where: { id: { in: ids } }, include: { stage: true } });

  const data: Record<string, unknown> = { pipelineId, pipelineStageId: stageId, stageEnteredAt: new Date() };
  if (toStage?.isWon) data.status = 'won';
  if (toStage?.isLost) data.status = 'lost';

  await Promise.all(
    leads.map(async (lead) => {
      await prisma.lead.update({ where: { id: lead.id }, data: data as any });
      await prisma.leadStageHistoryEntry.create({
        data: { leadId: lead.id, fromStageName: lead.stage?.name, toStageName: toStage?.name ?? 'Unknown', actorName: 'Priyanka Singh' },
      });
      await prisma.leadActivity.create({
        data: { leadId: lead.id, type: 'stage_moved', description: `Bulk-moved to "${toStage?.name ?? 'Unknown'}".` },
      });
      await fireTrigger('lead_stage_changed', lead.id, { fromStageId: lead.pipelineStageId ?? undefined, toStageId: stageId });
    })
  );
  res.status(204).send();
});

leadsRouter.post('/bulk/delete', async (req, res) => {
  const { ids } = req.body as { ids: string[] };
  await prisma.lead.deleteMany({ where: { id: { in: ids } } });
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
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);

  const where: Prisma.LeadActivityWhereInput = {};
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

leadsRouter.get('/:id', async (req, res) => {
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
  const before = req.body?.leadScore !== undefined ? await prisma.lead.findUnique({ where: { id: req.params.id }, select: { leadScore: true } }) : null;
  const updated = await prisma.lead.update({ where: { id: req.params.id }, data: req.body }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Lead not found' });
  if (before && updated.leadScore !== before.leadScore) await fireTrigger('lead_score_threshold', updated.id);
  res.json(updated);
});

leadsRouter.delete('/:id', async (req, res) => {
  await prisma.lead.delete({ where: { id: req.params.id } }).catch(() => undefined);
  res.status(204).send();
});

leadsRouter.post('/:id/status', async (req, res) => {
  const { status, lostReason } = req.body as { status: string; lostReason?: string };
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
    data: { leadId: lead.id, type: 'status_changed', description: `Status changed from "${lead.status}" to "${status}".` },
  });
  res.json(updated);
});

leadsRouter.post('/:id/assign', async (req, res) => {
  const { userId } = req.body as { userId?: string };
  const before = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Lead not found' });

  const updated = await prisma.lead.update({ where: { id: req.params.id }, data: { assignedUserId: userId || null } });
  await prisma.leadAssignmentHistoryEntry.create({
    data: { leadId: updated.id, fromUserId: before.assignedUserId, toUserId: userId || null, actorName: 'Priyanka Singh' },
  });
  await prisma.leadActivity.create({
    data: { leadId: updated.id, type: 'assigned', description: userId ? 'Reassigned.' : 'Unassigned.' },
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
      actorName: 'Priyanka Singh',
    },
  });
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: 'stage_moved',
      description: `Moved from "${lead.stage?.name ?? 'Unassigned'}" to "${toStage?.name ?? 'Unknown'}".`,
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
    data: { leadId: req.params.id, type, description, userName: 'Priyanka Singh' },
  });
  res.status(201).json(row);
});

leadsRouter.get('/:id/notes', async (req, res) => {
  const rows = await prisma.leadNote.findMany({ where: { leadId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json(rows);
});

leadsRouter.post('/:id/notes', async (req, res) => {
  const { body } = req.body as { body: string };
  const note = await prisma.leadNote.create({
    data: { leadId: req.params.id, userId: 'ADMIN-1', userName: 'Priyanka Singh', body },
  });
  await prisma.leadActivity.create({
    data: { leadId: req.params.id, type: 'note_added', description: 'Note added.', userName: 'Priyanka Singh' },
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
