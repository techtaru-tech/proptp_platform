import { Router } from 'express';
import { prisma } from '../prisma';
import type { Prisma } from '@prisma/client';

export const followUpsRouter = Router();

function bucketRange() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  return { todayStart, todayEnd };
}

followUpsRouter.get('/', async (req, res) => {
  const { page = '1', pageSize = '10', status, priority, assignedUserId, bucket, sortBy } = req.query as Record<string, string>;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 10);

  const where: Prisma.LeadFollowUpWhereInput = {};
  if (status && status !== 'all') where.status = status;
  if (priority && priority !== 'all') where.priority = priority as any;
  if (assignedUserId && assignedUserId !== 'all') where.assignedUserId = assignedUserId;

  if (bucket && bucket !== 'all') {
    const { todayStart, todayEnd } = bucketRange();
    const isOpen: Prisma.LeadFollowUpWhereInput = { OR: [{ status: 'pending' }, { status: 'rescheduled' }] };
    if (bucket === 'overdue') Object.assign(where, isOpen, { dueAt: { lt: todayStart } });
    if (bucket === 'today') Object.assign(where, isOpen, { dueAt: { gte: todayStart, lte: todayEnd } });
    if (bucket === 'upcoming') Object.assign(where, isOpen, { dueAt: { gt: todayEnd } });
  }

  const [items, total] = await Promise.all([
    prisma.leadFollowUp.findMany({
      where,
      orderBy: { dueAt: sortBy === 'dueAt' ? 'asc' : 'asc' },
      skip: (pageNum - 1) * size,
      take: size,
      include: { lead: { select: { firstName: true, lastName: true } } },
    }),
    prisma.leadFollowUp.count({ where }),
  ]);

  res.json({
    items: items.map(({ lead, ...f }) => ({ ...f, leadName: `${lead.firstName} ${lead.lastName}`.trim() })),
    total,
    page: pageNum,
    pageSize: size,
  });
});

/**
 * Calendar feed: every follow-up due within [from, to], un-paginated — the month grid needs the
 * whole window at once, not a page of it. Registered ABOVE `/:id` on purpose: Express matches in
 * order, so a `/calendar` request would otherwise be read as a follow-up with the id "calendar".
 */
followUpsRouter.get('/calendar', async (req, res) => {
  const { from, to, status, priority, assignedUserId } = req.query as Record<string, string>;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required.' });

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return res.status(400).json({ error: 'from and to must be valid ISO dates.' });
  }
  if (toDate < fromDate) return res.status(400).json({ error: 'to must not be earlier than from.' });
  // A month grid spans at most 42 days; the cap keeps a hand-edited URL from scanning the table.
  const spanDays = (toDate.getTime() - fromDate.getTime()) / 86_400_000;
  if (spanDays > 92) return res.status(400).json({ error: 'Range must not exceed 92 days.' });

  const where: Prisma.LeadFollowUpWhereInput = { dueAt: { gte: fromDate, lte: toDate } };
  if (status && status !== 'all') where.status = status;
  if (priority && priority !== 'all') where.priority = priority as any;
  if (assignedUserId && assignedUserId !== 'all') where.assignedUserId = assignedUserId;

  const items = await prisma.leadFollowUp.findMany({
    where,
    orderBy: { dueAt: 'asc' },
    include: { lead: { select: { firstName: true, lastName: true } } },
  });

  res.json(items.map(({ lead, ...f }) => ({ ...f, leadName: `${lead.firstName} ${lead.lastName}`.trim() })));
});

followUpsRouter.get('/:id', async (req, res) => {
  const row = await prisma.leadFollowUp.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Follow-up not found' });
  res.json(row);
});

followUpsRouter.post('/', async (req, res) => {
  const { leadId, title, description, dueAt, priority, assignedUserId, remindBeforeMinutes } = req.body as {
    leadId: string;
    title: string;
    description?: string;
    dueAt: string;
    priority?: string;
    assignedUserId?: string;
    /** How long before the due time to nudge the owner. 0 (the default) means at the due time. */
    remindBeforeMinutes?: number;
  };
  if (!leadId || !title?.trim() || !dueAt) return res.status(400).json({ error: 'leadId, title and dueAt are required.' });

  const created = await prisma.leadFollowUp.create({
    data: {
      leadId,
      title: title.trim(),
      description: description?.trim() || undefined,
      dueAt: new Date(dueAt),
      reminderAt: new Date(new Date(dueAt).getTime() - Math.max(0, Number(remindBeforeMinutes) || 0) * 60_000),
      priority: (priority as any) ?? 'normal',
      assignedUserId: assignedUserId || undefined,
    },
  });
  res.status(201).json(created);
});

followUpsRouter.post('/:id/status', async (req, res) => {
  const { status } = req.body as { status: string };
  const updated = await prisma.leadFollowUp
    .update({
      where: { id: req.params.id },
      data: {
        status,
        completed: status === 'completed',
        completedAt: status === 'completed' ? new Date() : null,
      },
    })
    .catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Follow-up not found' });

  await prisma.leadActivity.create({
    data: { leadId: updated.leadId, type: 'note_added', description: `Follow-up "${updated.title}" marked as ${status}.` },
  });
  res.json(updated);
});

followUpsRouter.post('/:id/reschedule', async (req, res) => {
  const { dueAt } = req.body as { dueAt: string };
  const updated = await prisma.leadFollowUp
    .update({ where: { id: req.params.id }, data: { dueAt: new Date(dueAt), status: 'rescheduled', completed: false, completedAt: null } })
    .catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Follow-up not found' });
  res.json(updated);
});
