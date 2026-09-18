import type { EmailSequenceStep } from '@prisma/client';
import { prisma } from '../prisma';
import { deliverLeadEmail, renderPlaceholders } from './email';

/**
 * Email sequences: an ordered list of steps, each with a delay measured from the previous
 * step (or from enrollment, for the first). A lead is enrolled once per sequence; the poller
 * below sends whatever is due and advances the enrollment.
 *
 * The stop rules ("stop when the lead replies", "stop when the lead is won") are evaluated
 * here rather than at every place that could change a lead, for two reasons: there is one
 * implementation to get right, and a rule added later applies to enrollments that already
 * exist. The cost is that an enrollment is marked stopped on the next tick rather than the
 * same instant — but a send can never slip through, because the same check runs immediately
 * before every send.
 */

const MS_PER_HOUR = 60 * 60 * 1000;

export function stepDueAt(step: Pick<EmailSequenceStep, 'delayDays' | 'delayHours'>, from: Date): Date {
  return new Date(from.getTime() + (step.delayDays * 24 + step.delayHours) * MS_PER_HOUR);
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export interface EnrollResult {
  enrolled: number;
  skipped: number;
  message: string;
}

/**
 * Enrolls leads. A lead already actively enrolled is skipped; one that finished or was
 * stopped earlier is restarted from the top, which is what "enrol again" means to a user.
 */
export async function enrollLeads(sequenceId: string, leadIds: string[]): Promise<EnrollResult> {
  const sequence = await prisma.emailSequence.findUnique({
    where: { id: sequenceId },
    include: { steps: { orderBy: { sortOrder: 'asc' }, take: 1 } },
  });
  if (!sequence) return { enrolled: 0, skipped: leadIds.length, message: 'Sequence not found.' };
  if (sequence.steps.length === 0) {
    return { enrolled: 0, skipped: leadIds.length, message: 'This sequence has no steps yet.' };
  }

  const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, email: true } });
  const firstDueAt = stepDueAt(sequence.steps[0], new Date());

  let enrolled = 0;
  let skipped = 0;
  const reasons: string[] = [];

  for (const lead of leads) {
    if (!lead.email) {
      skipped += 1;
      continue;
    }
    const existing = await prisma.emailSequenceEnrollment.findUnique({
      where: { sequenceId_leadId: { sequenceId, leadId: lead.id } },
      select: { id: true, status: true },
    });
    if (existing?.status === 'active') {
      skipped += 1;
      continue;
    }
    await prisma.emailSequenceEnrollment.upsert({
      where: { sequenceId_leadId: { sequenceId, leadId: lead.id } },
      create: { sequenceId, leadId: lead.id, nextSendAt: firstDueAt },
      update: {
        status: 'active',
        currentStep: 0,
        nextSendAt: firstDueAt,
        completedAt: null,
        stoppedAt: null,
        stoppedReason: null,
      },
    });
    enrolled += 1;
  }

  skipped += leadIds.length - leads.length;
  if (skipped > 0) reasons.push('already active, missing an email address, or no longer exists');

  return {
    enrolled,
    skipped,
    message: skipped === 0 ? `${enrolled} lead(s) enrolled.` : `${enrolled} enrolled, ${skipped} skipped (${reasons.join('; ')}).`,
  };
}

export async function stopEnrollment(enrollmentId: string, reason: string): Promise<boolean> {
  const updated = await prisma.emailSequenceEnrollment
    .update({
      where: { id: enrollmentId },
      data: { status: 'stopped', stoppedAt: new Date(), stoppedReason: reason, nextSendAt: null },
    })
    .catch(() => null);
  return !!updated;
}

// ---------------------------------------------------------------------------
// Stop rules
// ---------------------------------------------------------------------------

/** The reason an active enrollment should stop, or null if it should carry on. */
async function stopReasonFor(enrollment: {
  id: string;
  leadId: string;
  createdAt: Date;
  sequence: { status: string; stopOnReply: boolean; stopOnWon: boolean };
}): Promise<string | null> {
  if (enrollment.sequence.stopOnWon) {
    const lead = await prisma.lead.findUnique({ where: { id: enrollment.leadId }, select: { status: true } });
    if (lead?.status === 'won') return 'Lead was marked won.';
  }
  if (enrollment.sequence.stopOnReply) {
    const reply = await prisma.leadActivity.findFirst({
      where: { leadId: enrollment.leadId, type: 'email_received', createdAt: { gte: enrollment.createdAt } },
      select: { id: true },
    });
    if (reply) return 'Lead replied.';
  }
  return null;
}

/** Marks every active enrollment whose stop rule now applies. Runs on each poller tick. */
async function applyStopRules(): Promise<void> {
  const active = await prisma.emailSequenceEnrollment.findMany({
    where: { status: 'active' },
    include: { sequence: { select: { status: true, stopOnReply: true, stopOnWon: true } } },
    take: 500,
  });
  for (const enrollment of active) {
    const reason = await stopReasonFor(enrollment);
    if (reason) await stopEnrollment(enrollment.id, reason);
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function sendDueStep(enrollmentId: string): Promise<void> {
  const enrollment = await prisma.emailSequenceEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      lead: true,
      sequence: { include: { steps: { orderBy: { sortOrder: 'asc' } } } },
    },
  });
  if (!enrollment || enrollment.status !== 'active') return;
  // A paused or draft sequence holds its enrollments where they are rather than dropping them.
  if (enrollment.sequence.status !== 'active') return;

  // Checked again here, not just in applyStopRules, so a reply that lands between two ticks
  // still cannot be followed by a send.
  const reason = await stopReasonFor(enrollment);
  if (reason) {
    await stopEnrollment(enrollment.id, reason);
    return;
  }

  const step = enrollment.sequence.steps[enrollment.currentStep];
  if (!step) {
    await prisma.emailSequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'completed', completedAt: new Date(), nextSendAt: null },
    });
    return;
  }

  const subject = renderPlaceholders(step.subject, enrollment.lead);
  const body = renderPlaceholders(step.body, enrollment.lead);
  const result = await deliverLeadEmail(enrollment.lead, {
    subject,
    body,
    source: `Sequence: ${enrollment.sequence.name}`,
  });

  await prisma.emailSequenceSend.create({
    data: {
      enrollmentId: enrollment.id,
      stepId: step.id,
      stepIndex: enrollment.currentStep,
      subject,
      body,
      status: result.ok ? 'sent' : 'failed',
      message: result.message,
    },
  });

  // A failure is terminal for this enrollment — the usual cause is a lead with no email
  // address, which retrying cannot fix. It stays visible as `stopped` with the reason.
  if (!result.ok) {
    await stopEnrollment(enrollment.id, result.message);
    return;
  }

  const nextIndex = enrollment.currentStep + 1;
  const nextStep = enrollment.sequence.steps[nextIndex];
  await prisma.emailSequenceEnrollment.update({
    where: { id: enrollment.id },
    data: nextStep
      ? { currentStep: nextIndex, nextSendAt: stepDueAt(nextStep, new Date()) }
      : { currentStep: nextIndex, status: 'completed', completedAt: new Date(), nextSendAt: null },
  });
}

async function processDueSends(): Promise<void> {
  const due = await prisma.emailSequenceEnrollment.findMany({
    where: { status: 'active', nextSendAt: { lte: new Date() }, sequence: { status: 'active' } },
    select: { id: true },
    take: 100,
  });
  for (const { id } of due) {
    await sendDueStep(id).catch((err) => console.error(`[email sequence] send failed for enrollment ${id}:`, err));
  }
}

// ---------------------------------------------------------------------------
// Poller — same shape as the automation resumer; a plain interval is enough for a
// single-server app with no external job queue.
// ---------------------------------------------------------------------------

let pollerHandle: ReturnType<typeof setInterval> | undefined;

export function startEmailSequencePoller(intervalMs = 60_000): void {
  if (pollerHandle) return;
  const tick = () => {
    applyStopRules()
      .then(processDueSends)
      .catch((err) => console.error('[email sequence] tick failed:', err));
  };
  tick();
  pollerHandle = setInterval(tick, intervalMs);
}

/** Exposed so a test or an admin action can force a tick instead of waiting for the interval. */
export async function runEmailSequenceTick(): Promise<void> {
  await applyStopRules();
  await processDueSends();
}
