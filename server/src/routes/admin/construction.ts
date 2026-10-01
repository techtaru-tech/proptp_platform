import { Router } from 'express';
import { prisma } from '../../prisma';
import type { AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import { notify } from '../../services/notify';
import { projectProgress, rollup, activityProgress, statusSentence } from '../../services/construction';

/**
 * Construction & progress — /api/construction.
 *
 * Site staff post updates from the app (routes/app/construction.ts). This is the project
 * manager's side: set up the schedule, review what came in, track issues. Every progress figure
 * comes from services/construction.ts, from approved updates only.
 */
export const adminConstructionRouter = Router();

const asDate = (v: unknown) => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

adminConstructionRouter.get('/projects', async (_req, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      select: { id: true, projectName: true, projectLocation: true, thumbnail: true },
      orderBy: { projectName: 'asc' },
    });
    const [activities, pendingByProject, openIssues] = await Promise.all([
      prisma.constructionActivity.findMany({ include: { updates: { select: { status: true, percentComplete: true, capturedAt: true } } } }),
      prisma.progressUpdate.groupBy({ by: ['activityId'], where: { status: 'pending' }, _count: { _all: true } }),
      prisma.siteIssue.groupBy({ by: ['projectId'], where: { status: { not: 'closed' } }, _count: { _all: true } }),
    ]);
    const projectOfActivity = new Map(activities.map((a) => [a.id, a.projectId]));
    const pending = new Map<string, number>();
    for (const g of pendingByProject) {
      const pid = projectOfActivity.get(g.activityId);
      if (pid) pending.set(pid, (pending.get(pid) ?? 0) + g._count._all);
    }
    const issues = new Map(openIssues.map((g) => [g.projectId, g._count._all]));
    const now = new Date();

    res.json(
      projects.map((p) => {
        const mine = activities.filter((a) => a.projectId === p.id).map((a) => ({ weight: a.weight, progress: activityProgress(a, now) }));
        return { ...p, ...rollup(mine), pendingReviews: pending.get(p.id) ?? 0, openIssues: issues.get(p.id) ?? 0 };
      })
    );
  } catch (err) {
    next(err);
  }
});

adminConstructionRouter.get('/projects/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, projectName: true, projectLocation: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const progress = await projectProgress(id);
    res.json({
      project,
      summary: progress.project,
      blocks: progress.blocks,
      phases: progress.phases,
      activities: progress.rows.map((a) => ({
        id: a.id,
        phase: a.phase,
        block: a.block,
        name: a.name,
        plannedStart: a.plannedStart.toISOString(),
        plannedEnd: a.plannedEnd.toISOString(),
        weight: a.weight,
        assigneeId: a.assigneeId,
        assigneeName: a.assignee?.name ?? null,
        ...a.progress,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

function readActivity(body: any, partial = false) {
  const data: Record<string, unknown> = {};
  const errors: string[] = [];
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) errors.push('Activity name is required.');
    data.name = name;
  }
  for (const key of ['phase', 'block'] as const) {
    if (body[key] !== undefined) data[key] = String(body[key]).trim().slice(0, 80);
  }
  for (const key of ['plannedStart', 'plannedEnd'] as const) {
    if (!partial || body[key] !== undefined) {
      const d = asDate(body[key]);
      if (!d) errors.push(`${key === 'plannedStart' ? 'Planned start' : 'Planned end'} must be a valid date.`);
      data[key] = d;
    }
  }
  if (body.weight !== undefined) data.weight = Math.min(100, Math.max(1, Math.round(Number(body.weight)) || 1));
  if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId ? String(body.assigneeId) : null;
  return { data, errors };
}

adminConstructionRouter.post('/projects/:id/activities', async (req: AuthedRequest, res, next) => {
  try {
    const projectId = String(req.params.id);
    if (!(await prisma.project.count({ where: { id: projectId } }))) return res.status(404).json({ error: 'Project not found.' });
    const { data, errors } = readActivity(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0] });
    if ((data.plannedEnd as Date) < (data.plannedStart as Date)) return res.status(400).json({ error: 'The end date cannot be before the start date.' });

    const created = await prisma.constructionActivity.create({ data: { ...(data as any), projectId } });
    await writeAudit(req, { module: 'Construction', action: 'Added activity', recordId: created.id, recordLabel: created.name, description: '' });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminConstructionRouter.patch('/activities/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.constructionActivity.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Activity not found.' });
    const { data, errors } = readActivity(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors[0] });
    const start = (data.plannedStart as Date) ?? existing.plannedStart;
    const end = (data.plannedEnd as Date) ?? existing.plannedEnd;
    if (end < start) return res.status(400).json({ error: 'The end date cannot be before the start date.' });
    res.json(await prisma.constructionActivity.update({ where: { id: existing.id }, data: data as any }));
  } catch (err) {
    next(err);
  }
});

adminConstructionRouter.delete('/activities/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.constructionActivity.findUnique({ where: { id: String(req.params.id) }, include: { _count: { select: { updates: true } } } });
    if (!existing) return res.status(404).json({ error: 'Activity not found.' });
    // Updates are the site's record of work done; deleting the activity would take them with it.
    if (existing._count.updates > 0) {
      return res.status(409).json({ error: `${existing._count.updates} progress update(s) are recorded against this activity, so it cannot be deleted.` });
    }
    await prisma.constructionActivity.delete({ where: { id: existing.id } });
    await writeAudit(req, { module: 'Construction', action: 'Removed activity', recordId: existing.id, recordLabel: existing.name, description: '' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

const updateInclude = {
  photos: true,
  author: { select: { id: true, name: true } },
  activity: { select: { id: true, name: true, block: true, phase: true, projectId: true, project: { select: { projectName: true } } } },
} as const;

adminConstructionRouter.get('/updates', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? 'pending');
    const projectId = String(req.query.projectId ?? '');
    const rows = await prisma.progressUpdate.findMany({
      where: {
        ...(['pending', 'approved', 'rejected'].includes(status) ? { status: status as any } : {}),
        ...(projectId ? { activity: { projectId } } : {}),
      },
      include: updateInclude,
      orderBy: { capturedAt: 'desc' },
      take: 100,
    });
    res.json(
      rows.map((u) => ({
        id: u.id,
        activityId: u.activityId,
        activityName: u.activity.name,
        block: u.activity.block,
        projectId: u.activity.projectId,
        projectName: u.activity.project.projectName,
        authorName: u.author.name,
        workDone: u.workDone,
        manpower: u.manpower,
        percentComplete: u.percentComplete,
        remarks: u.remarks,
        capturedAt: u.capturedAt.toISOString(),
        submittedAt: u.createdAt.toISOString(),
        status: u.status,
        rejectionReason: u.rejectionReason,
        photos: u.photos.map((p) => ({ id: p.id, url: p.url, takenAt: p.takenAt.toISOString(), latitude: p.latitude, longitude: p.longitude })),
      }))
    );
  } catch (err) {
    next(err);
  }
});

adminConstructionRouter.post('/updates/:id/review', async (req: AuthedRequest, res, next) => {
  try {
    const decision = String(req.body?.decision ?? '');
    const reason = String(req.body?.reason ?? '').trim();
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision must be approve or reject.' });
    if (decision === 'reject' && !reason) return res.status(400).json({ error: 'Give a reason when rejecting an update.' });

    const existing = await prisma.progressUpdate.findUnique({ where: { id: String(req.params.id) }, include: { activity: true } });
    if (!existing) return res.status(404).json({ error: 'Update not found.' });
    if (existing.status !== 'pending') return res.status(409).json({ error: `This update was already ${existing.status}.` });

    const updated = await prisma.progressUpdate.update({
      where: { id: existing.id },
      data: {
        status: decision === 'approve' ? 'approved' : 'rejected',
        rejectionReason: decision === 'reject' ? reason : null,
        reviewerId: req.auth!.sub,
        reviewedAt: new Date(),
      },
    });
    await writeAudit(req, {
      module: 'Construction',
      action: decision === 'approve' ? 'Approved progress update' : 'Rejected progress update',
      recordId: updated.id,
      recordLabel: existing.activity.name,
      description: decision === 'reject' ? reason : `${existing.percentComplete}% complete.`,
    });
    // Tell the person who posted it, so a rejection is something they can act on.
    await notify({
      title: decision === 'approve' ? 'Progress update approved' : 'Progress update rejected',
      body: decision === 'approve' ? `${existing.activity.name}: ${existing.percentComplete}% counted.` : `${existing.activity.name}: ${reason}`,
      userIds: [existing.authorId],
      type: 'system',
      data: { kind: 'progress_update', updateId: existing.id },
    }).catch(() => undefined);
    res.json({ id: updated.id, status: updated.status });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Site issues
// ---------------------------------------------------------------------------

adminConstructionRouter.get('/issues', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? 'open');
    const projectId = String(req.query.projectId ?? '');
    const where: any = {};
    if (status === 'open') where.status = { not: 'closed' };
    else if (['in_progress', 'closed'].includes(status)) where.status = status;
    if (projectId) where.projectId = projectId;
    const rows = await prisma.siteIssue.findMany({
      where,
      include: {
        project: { select: { projectName: true } },
        owner: { select: { id: true, name: true } },
        raisedBy: { select: { name: true } },
        activity: { select: { name: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    const now = Date.now();
    res.json(
      rows.map((i) => ({
        id: i.id,
        projectId: i.projectId,
        projectName: i.project.projectName,
        activityName: i.activity?.name ?? null,
        title: i.title,
        description: i.description,
        photos: i.photos,
        ownerId: i.ownerId,
        ownerName: i.owner?.name ?? null,
        raisedByName: i.raisedBy.name,
        dueDate: i.dueDate?.toISOString() ?? null,
        status: i.status,
        overdue: i.status !== 'closed' && !!i.dueDate && i.dueDate.getTime() < now,
        closedAt: i.closedAt?.toISOString() ?? null,
        closeNote: i.closeNote,
        createdAt: i.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    next(err);
  }
});

adminConstructionRouter.post('/issues', async (req: AuthedRequest, res, next) => {
  try {
    const projectId = String(req.body?.projectId ?? '');
    const title = String(req.body?.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'Describe the issue.' });
    if (!(await prisma.project.count({ where: { id: projectId } }))) return res.status(400).json({ error: 'Choose a project.' });
    const due = req.body?.dueDate ? asDate(req.body.dueDate) : null;
    if (req.body?.dueDate && !due) return res.status(400).json({ error: 'Due date is not valid.' });

    const created = await prisma.siteIssue.create({
      data: {
        projectId,
        title,
        description: req.body?.description ? String(req.body.description) : null,
        photos: Array.isArray(req.body?.photos) ? req.body.photos.map(String) : [],
        activityId: req.body?.activityId ? String(req.body.activityId) : null,
        ownerId: req.body?.ownerId ? String(req.body.ownerId) : null,
        dueDate: due,
        raisedById: req.auth!.sub,
      },
    });
    if (created.ownerId) {
      await notify({ title: 'Site issue assigned to you', body: title, userIds: [created.ownerId], type: 'system', data: { kind: 'site_issue', issueId: created.id } }).catch(() => undefined);
    }
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminConstructionRouter.patch('/issues/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.siteIssue.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Issue not found.' });
    const data: Record<string, unknown> = {};
    if (req.body?.status !== undefined) {
      const status = String(req.body.status);
      if (!['open', 'in_progress', 'closed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
      data.status = status;
      data.closedAt = status === 'closed' ? new Date() : null;
      if (status === 'closed') data.closeNote = req.body?.closeNote ? String(req.body.closeNote) : null;
    }
    if (req.body?.ownerId !== undefined) data.ownerId = req.body.ownerId ? String(req.body.ownerId) : null;
    if (req.body?.dueDate !== undefined) {
      const d = req.body.dueDate ? asDate(req.body.dueDate) : null;
      if (req.body.dueDate && !d) return res.status(400).json({ error: 'Due date is not valid.' });
      data.dueDate = d;
    }
    res.json(await prisma.siteIssue.update({ where: { id: existing.id }, data: data as any }));
  } catch (err) {
    next(err);
  }
});

/** People an activity or issue can be given to: anybody active who is not an administrator-only account. */
adminConstructionRouter.get('/people', async (_req, res, next) => {
  try {
    res.json(
      await prisma.user.findMany({
        where: { status: 'active', role: { in: ['employee', 'team_leader', 'leader', 'admin'] } },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
        take: 500,
      })
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The buyer's view of it
// ---------------------------------------------------------------------------

async function buyerStatus(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { unit: { select: { propertyNumber: true, projectId: true, project: { select: { projectName: true } } } } },
  });
  if (!booking) return null;
  const progress = await projectProgress(booking.unit.projectId);
  const sentence = statusSentence(booking.unit.project.projectName, progress.project);
  return {
    bookingId: booking.id,
    buyerName: booking.bookingName,
    phone: booking.phone,
    unit: booking.unit.propertyNumber,
    projectId: booking.unit.projectId,
    projectName: booking.unit.project.projectName,
    summary: progress.project,
    message: `Dear ${booking.bookingName}, an update on your plot ${booking.unit.propertyNumber}. ${sentence}`,
    history: await prisma.buyerProgressMessage.findMany({ where: { bookingId }, orderBy: { createdAt: 'desc' }, take: 10 }),
  };
}

adminConstructionRouter.get('/bookings/:id', async (req, res, next) => {
  try {
    const status = await buyerStatus(String(req.params.id));
    if (!status) return res.status(404).json({ error: 'Booking not found.' });
    res.json(status);
  } catch (err) {
    next(err);
  }
});

/**
 * Records that a progress message went to the buyer and returns the WhatsApp link to send it.
 * There is no buyer login to push to — a buyer is a name and a phone number on the booking — so
 * the message is handed to the person to send, and logged so it is clear what the buyer was told.
 */
adminConstructionRouter.post('/bookings/:id/send', async (req: AuthedRequest, res, next) => {
  try {
    const status = await buyerStatus(String(req.params.id));
    if (!status) return res.status(404).json({ error: 'Booking not found.' });
    const message = String(req.body?.message ?? status.message).trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: 'The message is empty.' });
    await prisma.buyerProgressMessage.create({ data: { bookingId: status.bookingId, message, sentById: req.auth!.sub } });
    const digits = status.phone.replace(/\D/g, '');
    const to = digits.length === 10 ? `91${digits}` : digits;
    res.json({ whatsappUrl: `https://wa.me/${to}?text=${encodeURIComponent(message)}` });
  } catch (err) {
    next(err);
  }
});
