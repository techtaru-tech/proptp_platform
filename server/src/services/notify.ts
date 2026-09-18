import type { NotificationAudience, NotificationType, UserRole } from '@prisma/client';
import { prisma } from '../prisma';
import { sendPush } from './push';

/**
 * One way to notify somebody.
 *
 * Anything in the codebase that wants to tell a partner something — a booking confirmed, a
 * payout approved, an admin broadcast — calls `notify()` and gets both halves: the row the
 * app's notification feed reads, and the push that makes their phone light up. Keeping the
 * two together is the point; a feed entry nobody is told about is not a notification.
 */

const ROLE_FOR_AUDIENCE: Record<Exclude<NotificationAudience, 'custom'>, UserRole[]> = {
  all: ['agent', 'employee', 'leader'],
  agents: ['agent'],
  employees: ['employee'],
  leaders: ['leader'],
};

/**
 * Who a broadcast reaches, resolved fresh each time it is asked.
 *
 * The composer calls this to show a count before anyone commits, and the sender calls it again
 * at the moment of sending. For a scheduled broadcast those are different moments on purpose:
 * a partner who joins between them should still get tomorrow's announcement.
 */
export async function resolveRecipients(input: { audience?: NotificationAudience; userIds?: string[] }) {
  if (input.userIds?.length) {
    return prisma.user.findMany({
      where: { id: { in: input.userIds }, status: 'active' },
      select: { id: true, name: true, role: true, fcmToken: true },
      orderBy: { name: 'asc' },
    });
  }
  const audience = input.audience && input.audience !== 'custom' ? input.audience : 'all';
  return prisma.user.findMany({
    where: { role: { in: ROLE_FOR_AUDIENCE[audience] }, status: 'active' },
    select: { id: true, name: true, role: true, fcmToken: true },
    orderBy: { name: 'asc' },
  });
}

export interface NotifyInput {
  title: string;
  body: string;
  type?: NotificationType;
  /** Everyone in a role group… */
  audience?: NotificationAudience;
  /** …or exactly these people. Given both, the ids win. */
  userIds?: string[];
  /** Passed through to the app so a tap can open the right screen. */
  data?: Record<string, string>;
  /** The admin who composed it, when a person did. */
  createdBy?: string | null;
}

export interface NotifyResult {
  notificationId: string;
  /** People the notification was recorded for, whether or not their phone could be reached. */
  recipients: number;
  /** Of those, how many had a device token that Firebase accepted. */
  pushed: number;
  pushFailed: number;
}

/**
 * Records a notification and pushes it.
 *
 * A recipient is marked `failed` only when their device could not be reached — not when they
 * simply have no device token. Someone who has never opened the app has not failed to receive
 * anything; they will see it in the feed next time they sign in.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new Error('A notification needs both a title and a body.');

  const audience: NotificationAudience = input.userIds?.length ? 'custom' : input.audience ?? 'all';
  const recipients = await resolveRecipients(input);

  const created = await prisma.notification.create({
    data: {
      title,
      body,
      type: input.type ?? 'system',
      audience,
      deliveryStatus: recipients.length > 0 ? 'sent' : 'draft',
      sentAt: new Date(),
      createdBy: input.createdBy ?? null,
      recipients: { create: recipients.map((r) => ({ userId: r.id })) },
    },
    select: { id: true },
  });

  const withDevices = recipients.filter((r) => r.fcmToken);
  const outcomes = await sendPush(
    withDevices.map((r) => r.fcmToken as string),
    { title, body, data: { notificationId: created.id, type: input.type ?? 'system', ...(input.data ?? {}) } }
  );

  // Mark only the people whose phone we tried and could not reach.
  const failedTokens = new Set(outcomes.filter((o) => !o.ok).map((o) => o.token));
  const failedUserIds = withDevices.filter((r) => failedTokens.has(r.fcmToken as string)).map((r) => r.id);
  if (failedUserIds.length > 0) {
    await prisma.notificationRecipient.updateMany({
      where: { notificationId: created.id, userId: { in: failedUserIds } },
      data: { failed: true },
    });
  }

  return {
    notificationId: created.id,
    recipients: recipients.length,
    pushed: outcomes.filter((o) => o.ok).length,
    pushFailed: failedUserIds.length,
  };
}

/** Records the device token the app hands over when it signs in. */
export async function rememberDeviceToken(userId: string, fcmToken: unknown): Promise<void> {
  const token = String(fcmToken ?? '').trim();
  if (!token) return;
  try {
    // The same device can be handed to a different person; only the newest owner keeps it,
    // otherwise a push meant for one of them would ring on the other's screen.
    await prisma.user.updateMany({
      where: { fcmToken: token, id: { not: userId } },
      data: { fcmToken: null },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token, fcmTokenUpdatedAt: new Date() },
    });
  } catch (err) {
    // Never fail a sign-in over this: the session matters, the push address can wait.
    console.error('[push] could not store the device token:', err);
  }
}


/**
 * Sends a broadcast that was composed earlier and left waiting.
 *
 * Its audience is resolved now rather than at compose time, so it reaches whoever matches when
 * it actually goes out. The row is reused rather than replaced, keeping the id that the list,
 * the audit entry and anyone who opened the detail drawer already refer to.
 */
export async function sendScheduled(notificationId: string): Promise<NotifyResult> {
  const notification = await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
  const custom = notification.audience === 'custom';

  // A custom audience was pinned when it was composed; a role audience is re-read.
  const pinned = custom
    ? await prisma.notificationRecipient.findMany({
        where: { notificationId },
        select: { userId: true },
      })
    : [];

  const recipients = await resolveRecipients(
    custom ? { userIds: pinned.map((p) => p.userId) } : { audience: notification.audience }
  );

  await prisma.$transaction([
    prisma.notificationRecipient.deleteMany({ where: { notificationId } }),
    prisma.notificationRecipient.createMany({
      data: recipients.map((r) => ({ notificationId, userId: r.id })),
      skipDuplicates: true,
    }),
    prisma.notification.update({
      where: { id: notificationId },
      data: { deliveryStatus: recipients.length > 0 ? 'sent' : 'draft', scheduledFor: null, sentAt: new Date() },
    }),
  ]);

  const withDevices = recipients.filter((r) => r.fcmToken);
  const outcomes = await sendPush(withDevices.map((r) => r.fcmToken as string), {
    title: notification.title,
    body: notification.body,
    data: { notificationId, type: notification.type },
  });

  const failedTokens = new Set(outcomes.filter((o) => !o.ok).map((o) => o.token));
  const failedUserIds = withDevices.filter((r) => failedTokens.has(r.fcmToken as string)).map((r) => r.id);
  if (failedUserIds.length > 0) {
    await prisma.notificationRecipient.updateMany({
      where: { notificationId, userId: { in: failedUserIds } },
      data: { failed: true },
    });
  }

  return {
    notificationId,
    recipients: recipients.length,
    pushed: outcomes.filter((o) => o.ok).length,
    pushFailed: failedUserIds.length,
  };
}

// ---------------------------------------------------------------------------
// Poller — the same shape as the automation resumer and the sequence engine.
// ---------------------------------------------------------------------------

let pollerHandle: ReturnType<typeof setInterval> | undefined;

async function processDueNotifications(): Promise<void> {
  const due = await prisma.notification.findMany({
    where: { deliveryStatus: 'scheduled', scheduledFor: { lte: new Date() } },
    select: { id: true },
    take: 50,
  });
  for (const { id } of due) {
    await sendScheduled(id).catch((err) => console.error(`[notify] scheduled send failed for ${id}:`, err));
  }
}

export function startNotificationPoller(intervalMs = 60_000): void {
  if (pollerHandle) return;
  const tick = () => {
    processDueNotifications().catch((err) => console.error('[notify] tick failed:', err));
  };
  tick();
  pollerHandle = setInterval(tick, intervalMs);
}

/** Exposed so a test or an admin action can force a tick instead of waiting for the interval. */
export async function runNotificationTick(): Promise<void> {
  await processDueNotifications();
}
