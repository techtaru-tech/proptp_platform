import { prisma } from '../prisma';
import { notify } from './notify';

/**
 * Follow-up reminders.
 *
 * The follow-up table has carried a `reminderAt` since it was written, and nothing ever read
 * it: a follow-up only existed on a screen somebody had to remember to open. This poller is
 * the missing half — when a reminder falls due it goes to whoever owns the task, through the
 * same `notify()` every other notification uses, so it lands in the panel's bell and on the
 * phone in one call.
 *
 * Sent exactly once, and only ever once: `reminderSentAt` is stamped in the same tick.
 */

/** Older than this and the moment has passed — mark it done rather than nag about last week. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** One tick's worth. Bounded so a long outage drains over several ticks instead of one storm. */
const BATCH = 100;

function whenText(due: Date): string {
  return due.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export async function sendDueFollowUpReminders(): Promise<{ sent: number; skipped: number; stale: number }> {
  const now = new Date();

  const due = await prisma.leadFollowUp.findMany({
    where: {
      reminderSentAt: null,
      reminderAt: { not: null, lte: now },
      completed: false,
      status: { in: ['pending', 'rescheduled'] },
    },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, phone: true, assignedUserId: true } },
    },
    orderBy: { reminderAt: 'asc' },
    take: BATCH,
  });

  let sent = 0;
  let skipped = 0;
  let stale = 0;

  for (const followUp of due) {
    const isStale = now.getTime() - followUp.reminderAt!.getTime() > STALE_AFTER_MS;
    if (isStale) {
      await prisma.leadFollowUp.update({ where: { id: followUp.id }, data: { reminderSentAt: now } });
      stale += 1;
      continue;
    }

    // The task's own assignee first, then whoever owns the lead. Nobody at all means nobody to
    // tell: left alone, so it goes out the moment the lead is assigned rather than vanishing.
    const recipientId = followUp.assignedUserId ?? followUp.lead.assignedUserId;
    if (!recipientId) {
      skipped += 1;
      continue;
    }

    const leadName = `${followUp.lead.firstName} ${followUp.lead.lastName}`.trim() || followUp.lead.phone;

    try {
      await notify({
        title: `Follow-up due: ${leadName}`,
        body: `${followUp.title} · ${whenText(followUp.dueAt)}`,
        userIds: [recipientId],
        type: 'system',
        // What the app needs to open the lead straight from the notification.
        data: { kind: 'follow_up', leadId: followUp.leadId, followUpId: followUp.id },
      });
      await prisma.leadFollowUp.update({ where: { id: followUp.id }, data: { reminderSentAt: now } });
      sent += 1;
    } catch (err) {
      // Left unstamped on purpose: a Firebase hiccup should mean "try again next minute",
      // not "this person never hears about their call".
      console.error(`[followUpReminders] could not send reminder ${followUp.id}:`, err);
    }
  }

  return { sent, skipped, stale };
}

let pollerHandle: NodeJS.Timeout | null = null;

export function startFollowUpReminderPoller(intervalMs = 60_000): void {
  if (pollerHandle) return;
  const tick = () => {
    sendDueFollowUpReminders()
      .then(({ sent, stale }) => {
        if (sent || stale) console.log(`[followUpReminders] sent ${sent}, retired ${stale} stale`);
      })
      .catch((err) => console.error('[followUpReminders] tick failed:', err));
  };
  tick();
  pollerHandle = setInterval(tick, intervalMs);
}
