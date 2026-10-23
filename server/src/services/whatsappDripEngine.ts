import type { WhatsAppDripStep } from '@prisma/client';
import { prisma } from '../prisma';
import {
  fillPlaceholders, listApprovedTemplates, localPart, resolveTemplateParams, sendTemplateToNumber,
  type ApprovedTemplate,
} from './whatsapp';

/**
 * WhatsApp drip campaigns: an ordered list of approved templates, each with a delay measured
 * from the previous step (or from enrollment, for the first). Built the same way as email
 * sequences — enrol once, a poller sends whatever is due and advances the enrollment, and the
 * stop rules are checked again immediately before every send.
 *
 * The one thing WhatsApp adds: a template is the only thing that may start a conversation, so
 * every step is a template read live from Meta. If it has stopped being approved by the time
 * its turn comes, that enrollment stops with the reason rather than sending something else.
 */

const MS_PER_HOUR = 60 * 60 * 1000;
const SEND_GAP_MS = 200;

export function stepDueAt(step: Pick<WhatsAppDripStep, 'delayDays' | 'delayHours'>, from: Date): Date {
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
 * A lead already actively enrolled is skipped; one that finished or was stopped earlier is
 * restarted from the top. A lead with no usable mobile number cannot be messaged, so is skipped.
 */
export async function enrollLeads(dripId: string, leadIds: string[]): Promise<EnrollResult> {
  const drip = await prisma.whatsAppDrip.findUnique({
    where: { id: dripId },
    include: { steps: { orderBy: { sortOrder: 'asc' }, take: 1 } },
  });
  if (!drip) return { enrolled: 0, skipped: leadIds.length, message: 'Drip campaign not found.' };
  if (drip.steps.length === 0) return { enrolled: 0, skipped: leadIds.length, message: 'This campaign has no steps yet.' };

  const leads = await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, phone: true } });
  const now = new Date();
  const firstDueAt = stepDueAt(drip.steps[0], now);

  let enrolled = 0;
  let skipped = leadIds.length - leads.length;

  for (const lead of leads) {
    if (localPart(lead.phone).length !== 10) {
      skipped += 1;
      continue;
    }
    const existing = await prisma.whatsAppDripEnrollment.findUnique({
      where: { dripId_leadId: { dripId, leadId: lead.id } },
      select: { status: true },
    });
    if (existing?.status === 'active') {
      skipped += 1;
      continue;
    }
    await prisma.whatsAppDripEnrollment.upsert({
      where: { dripId_leadId: { dripId, leadId: lead.id } },
      create: { dripId, leadId: lead.id, nextSendAt: firstDueAt, startedAt: now },
      update: {
        status: 'active', currentStep: 0, nextSendAt: firstDueAt, startedAt: now,
        completedAt: null, stoppedAt: null, stoppedReason: null,
      },
    });
    enrolled += 1;
  }

  return {
    enrolled,
    skipped,
    message: skipped === 0 ? `${enrolled} lead(s) enrolled.` : `${enrolled} enrolled, ${skipped} skipped (already active, no valid mobile number, or no longer exists).`,
  };
}

export async function stopEnrollment(enrollmentId: string, reason: string): Promise<boolean> {
  const updated = await prisma.whatsAppDripEnrollment
    .update({ where: { id: enrollmentId }, data: { status: 'stopped', stoppedAt: new Date(), stoppedReason: reason, nextSendAt: null } })
    .catch(() => null);
  return !!updated;
}

// ---------------------------------------------------------------------------
// Stop rules
// ---------------------------------------------------------------------------

async function stopReasonFor(enrollment: {
  leadId: string;
  startedAt: Date;
  drip: { stopOnReply: boolean; stopOnWon: boolean };
}): Promise<string | null> {
  if (enrollment.drip.stopOnWon) {
    const lead = await prisma.lead.findUnique({ where: { id: enrollment.leadId }, select: { status: true } });
    if (lead?.status === 'won') return 'Lead was marked won.';
  }
  if (enrollment.drip.stopOnReply) {
    // Any inbound WhatsApp message on one of this lead's threads since the run began.
    const reply = await prisma.whatsAppMessage.findFirst({
      where: { direction: 'inbound', sentAt: { gte: enrollment.startedAt }, conversation: { leadId: enrollment.leadId } },
      select: { id: true },
    });
    if (reply) return 'Lead replied on WhatsApp.';
  }
  return null;
}

async function applyStopRules(): Promise<void> {
  const active = await prisma.whatsAppDripEnrollment.findMany({
    where: { status: 'active' },
    include: { drip: { select: { stopOnReply: true, stopOnWon: true } } },
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

/** Approved templates, fetched once per tick — every due step in the tick shares the one call. */
type TemplateLookup = () => Promise<ApprovedTemplate[]>;

async function sendDueStep(enrollmentId: string, account: NonNullable<Awaited<ReturnType<typeof activeAccount>>>, templates: TemplateLookup) {
  const enrollment = await prisma.whatsAppDripEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { lead: true, drip: { include: { steps: { orderBy: { sortOrder: 'asc' } } } } },
  });
  if (!enrollment || enrollment.status !== 'active' || enrollment.drip.status !== 'active') return;

  const reason = await stopReasonFor(enrollment);
  if (reason) return void (await stopEnrollment(enrollment.id, reason));

  const step = enrollment.drip.steps[enrollment.currentStep];
  if (!step) {
    await prisma.whatsAppDripEnrollment.update({ where: { id: enrollment.id }, data: { status: 'completed', completedAt: new Date(), nextSendAt: null } });
    return;
  }

  // From here on a problem is about this step or this lead, so it ends the enrollment visibly.
  const fail = async (message: string) => {
    await prisma.whatsAppDripSend.create({
      data: { enrollmentId: enrollment.id, stepId: step.id, stepIndex: enrollment.currentStep, templateName: step.templateName, body: '', status: 'failed', message },
    });
    await stopEnrollment(enrollment.id, message);
  };

  const phone = localPart(enrollment.lead.phone);
  if (phone.length !== 10) return fail('Lead has no valid mobile number.');

  const template = (await templates()).find((t) => t.name === step.templateName && t.language === step.language)
    ?? (await templates()).find((t) => t.name === step.templateName);
  if (!template) return fail(`"${step.templateName}" is no longer an approved template.`);
  if (template.unsupported) return fail(template.unsupported);
  if (step.params.length !== template.variableCount) {
    return fail(`"${step.templateName}" needs ${template.variableCount} value(s) but this step has ${step.params.length}.`);
  }
  if (template.headerFormat && !step.headerMediaUrl) return fail(`"${step.templateName}" has a ${template.headerFormat.toLowerCase()} header — this step has no file link.`);

  const params = resolveTemplateParams(step.params, { firstName: enrollment.lead.firstName, lastName: enrollment.lead.lastName });
  const body = fillPlaceholders(template.body, params);

  try {
    await sendTemplateToNumber(
      account,
      phone,
      {
        name: template.name, language: template.language, params, body,
        headerMedia: template.headerFormat && step.headerMediaUrl ? { format: template.headerFormat, link: step.headerMediaUrl } : undefined,
      },
      null
    );
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  await prisma.whatsAppDripSend.create({
    data: { enrollmentId: enrollment.id, stepId: step.id, stepIndex: enrollment.currentStep, templateName: template.name, body, status: 'sent' },
  });

  const nextIndex = enrollment.currentStep + 1;
  const nextStep = enrollment.drip.steps[nextIndex];
  await prisma.whatsAppDripEnrollment.update({
    where: { id: enrollment.id },
    data: nextStep
      ? { currentStep: nextIndex, nextSendAt: stepDueAt(nextStep, new Date()) }
      : { currentStep: nextIndex, status: 'completed', completedAt: new Date(), nextSendAt: null },
  });
}

async function activeAccount() {
  return prisma.whatsAppAccount.findFirst({ where: { active: true, accessToken: { not: null }, wabaId: { not: null } }, orderBy: { createdAt: 'asc' } });
}

async function processDueSends(): Promise<void> {
  const due = await prisma.whatsAppDripEnrollment.findMany({
    where: { status: 'active', nextSendAt: { lte: new Date() }, drip: { status: 'active' } },
    select: { id: true },
    take: 100,
  });
  if (due.length === 0) return;

  // No linked number, or Meta not answering (an expired token, say), is not the lead's fault:
  // leave everything where it is and try again on the next tick instead of stopping people.
  const account = await activeAccount();
  if (!account) {
    console.error('[whatsapp drip] steps are due but no WhatsApp number with a token and WABA ID is linked.');
    return;
  }
  let cached: Promise<ApprovedTemplate[]> | undefined;
  const templates: TemplateLookup = () => (cached ??= listApprovedTemplates(account));
  try {
    await templates();
  } catch (err) {
    console.error('[whatsapp drip] could not read templates from Meta, will retry:', err instanceof Error ? err.message : err);
    return;
  }

  for (const { id } of due) {
    await sendDueStep(id, account, templates).catch((err) => console.error(`[whatsapp drip] send failed for enrollment ${id}:`, err));
    // Meta throttles a burst, and spacing the sends is the difference between queued and dropped.
    await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
  }
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

let pollerHandle: ReturnType<typeof setInterval> | undefined;
let running = false;

export async function runWhatsAppDripTick(): Promise<void> {
  // A slow tick must not overlap the next one — two would send the same step twice.
  if (running) return;
  running = true;
  try {
    await applyStopRules();
    await processDueSends();
  } finally {
    running = false;
  }
}

export function startWhatsAppDripPoller(intervalMs = 60_000): void {
  if (pollerHandle) return;
  const tick = () => void runWhatsAppDripTick().catch((err) => console.error('[whatsapp drip] tick failed:', err));
  tick();
  pollerHandle = setInterval(tick, intervalMs);
}
