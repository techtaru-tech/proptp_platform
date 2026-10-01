import { Router } from 'express';
import type { NotificationAudience, NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { adminNotification } from '../../services/adminMappers';
import { listResult, parseListQuery } from '../../services/list';
import { notify, resolveRecipients } from '../../services/notify';
import { isPushConfigured, pushProjectId } from '../../services/push';

export const adminNotificationsRouter = Router();

const AUDIENCES: NotificationAudience[] = ['all', 'agents', 'employees', 'leaders', 'custom'];
const TYPES: NotificationType[] = ['booking', 'payout', 'team', 'system'];


/**
 * Delivery counts are read back from the fan-out rows rather than stored on the broadcast,
 * so the numbers on screen always match how many partners actually have the notification.
 */
async function withCounts(ids: string[]) {
  if (ids.length === 0) return new Map<string, { delivered: number; failed: number }>();
  const grouped = await prisma.notificationRecipient.groupBy({
    by: ['notificationId', 'failed'],
    where: { notificationId: { in: ids } },
    _count: { _all: true },
  });
  const map = new Map<string, { delivered: number; failed: number }>();
  for (const row of grouped) {
    const entry = map.get(row.notificationId) ?? { delivered: 0, failed: 0 };
    if (row.failed) entry.failed += row._count._all;
    else entry.delivered += row._count._all;
    map.set(row.notificationId, entry);
  }
  return map;
}

/**
 * Who a broadcast would reach, answered while it is still being composed. Counts the phones
 * separately from the people: the difference is who will only see it in the app's feed.
 */
adminNotificationsRouter.post('/audience', async (req, res, next) => {
  try {
    const audience = String(req.body?.audience ?? 'all') as NotificationAudience;
    const userIds: string[] = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [];
    if (!AUDIENCES.includes(audience)) return res.status(400).json({ error: 'Invalid audience.' });

    const recipients = await resolveRecipients(audience === 'custom' ? { userIds } : { audience });
    res.json({
      count: recipients.length,
      withDevice: recipients.filter((r) => r.fcmToken).length,
      byRole: recipients.reduce<Record<string, number>>((acc, r) => {
        acc[r.role] = (acc[r.role] ?? 0) + 1;
        return acc;
      }, {}),
      sample: recipients.slice(0, 6).map((r) => ({ id: r.id, name: r.name, role: r.role, hasDevice: !!r.fcmToken })),
    });
  } catch (err) {
    next(err);
  }
});

/** The people a custom audience can be built from. */
adminNotificationsRouter.get('/recipients', async (req, res, next) => {
  try {
    const search = String(req.query.search ?? '').trim();
    const users = await prisma.user.findMany({
      where: {
        status: 'active',
        role: { in: ['agent', 'employee', 'leader', 'team_leader'] },
        ...(search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] }
          : {}),
      },
      select: { id: true, name: true, phone: true, role: true, fcmToken: true },
      orderBy: { name: 'asc' },
      take: 50,
    });
    res.json({
      users: users.map((u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, hasDevice: !!u.fcmToken })),
    });
  } catch (err) {
    next(err);
  }
});

/** Whether pushes can actually leave this server, and how many partners could receive one. */
adminNotificationsRouter.get('/push-status', async (_req, res, next) => {
  try {
    const [withDevice, active] = await Promise.all([
      prisma.user.count({ where: { status: 'active', fcmToken: { not: null } } }),
      prisma.user.count({ where: { status: 'active', role: { in: ['agent', 'employee', 'leader', 'team_leader'] } } }),
    ]);
    res.json({
      configured: isPushConfigured(),
      projectId: pushProjectId(),
      devicesRegistered: withDevice,
      partnersActive: active,
    });
  } catch (err) {
    next(err);
  }
});

adminNotificationsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const where: Prisma.NotificationWhereInput = {};
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { body: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: { _count: { select: { recipients: true } } },
        orderBy: { createdAt: query.sortBy === 'createdAt' ? query.sortDir : 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.notification.count({ where }),
    ]);
    const counts = await withCounts(rows.map((r) => r.id));
    res.json(
      listResult(
        rows.map((r) => {
          const c = counts.get(r.id);
          return adminNotification({ ...r, deliveredCount: c?.delivered ?? 0, failedCount: c?.failed ?? 0 });
        }),
        total,
        query
      )
    );
  } catch (err) {
    next(err);
  }
});

adminNotificationsRouter.get('/:id', async (req, res, next) => {
  try {
    const row = await prisma.notification.findUnique({
      where: { id: String(req.params.id) },
      include: { _count: { select: { recipients: true } } },
    });
    if (!row) return res.status(404).json({ error: 'Notification not found' });
    const counts = await withCounts([row.id]);
    const c = counts.get(row.id);
    res.json(adminNotification({ ...row, deliveredCount: c?.delivered ?? 0, failedCount: c?.failed ?? 0 }));
  } catch (err) {
    next(err);
  }
});

/**
 * Creating a broadcast fans it out to one row per partner in the audience, which is what
 * makes the app's per-user read state (§6.2/§6.3) possible.
 */
adminNotificationsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '').trim();
    const audience = String(req.body?.audience ?? 'all') as NotificationAudience;
    const type = String(req.body?.type ?? 'system') as NotificationType;

    if (!title || !body) return res.status(400).json({ error: 'title and body are required.' });
    if (!AUDIENCES.includes(audience)) return res.status(400).json({ error: 'Invalid audience.' });
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type.' });

    const userIds: string[] = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [];
    if (audience === 'custom' && userIds.length === 0) {
      return res.status(400).json({ error: 'Pick at least one person to send this to.' });
    }

    // A time in the past is somebody meaning "now", not a request to send retroactively.
    const scheduledForRaw = req.body?.scheduledFor ? new Date(String(req.body.scheduledFor)) : null;
    const scheduledFor = scheduledForRaw && !Number.isNaN(scheduledForRaw.valueOf()) && scheduledForRaw > new Date()
      ? scheduledForRaw
      : null;

    if (scheduledFor) {
      // Held, not sent. Role audiences are resolved when it goes out; a hand-picked list is
      // pinned now, because "these six people" is the whole instruction.
      const pinned = audience === 'custom' ? await resolveRecipients({ userIds }) : [];
      const held = await prisma.notification.create({
        data: {
          title,
          body,
          type,
          audience,
          deliveryStatus: 'scheduled',
          scheduledFor,
          createdBy: req.auth?.sub ?? null,
          recipients: { create: pinned.map((r) => ({ userId: r.id })) },
        },
        include: { _count: { select: { recipients: true } } },
      });

      await writeAudit(req, {
        module: 'Notifications',
        action: 'Scheduled notification',
        recordId: held.id,
        recordLabel: title,
        description: `"${title}" scheduled for ${scheduledFor.toISOString()}.`,
      });
      return res.status(201).json(adminNotification({ ...held, deliveredCount: 0, failedCount: 0 }));
    }

    // The shared path, so a broadcast from this screen reaches a phone exactly the way one
    // raised by a booking or a payout does.
    const result = await notify({
      title,
      body,
      type,
      audience,
      userIds: audience === 'custom' ? userIds : undefined,
      createdBy: req.auth?.sub ?? null,
    });

    const created = await prisma.notification.findUniqueOrThrow({
      where: { id: result.notificationId },
      include: { _count: { select: { recipients: true } } },
    });

    await writeAudit(req, {
      module: 'Notifications',
      action: 'Sent notification',
      recordId: created.id,
      recordLabel: title,
      description: `Broadcast "${title}" sent to ${result.recipients} ${audience === 'all' ? 'partners' : audience}; ${result.pushed} reached a device.`,
    });
    res.status(201).json(
      adminNotification({
        ...created,
        deliveredCount: result.recipients - result.pushFailed,
        failedCount: result.pushFailed,
      })
    );
  } catch (err) {
    next(err);
  }
});
