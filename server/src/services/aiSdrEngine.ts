import type { AiSdrAgent, AiSdrEnrollment } from '@prisma/client';
import { prisma } from '../prisma';
import { isWithinBusinessHours } from './businessHours';

// ---------------------------------------------------------------------------
// AI SDR agent runtime. Real today: enrollment lifecycle, the follow-up cadence and its
// guardrails, business-hours gating, and handoff (which genuinely reassigns the lead).
//
// Deliberately NOT real: composing and delivering messages. There is no LLM provider and no
// email/SMS/WhatsApp provider configured in this app, so instead of inventing message text or
// pretending to deliver it, an enrollment simply becomes "due" and a human logs what they
// actually sent. `NOT_CONFIGURED_NOTE` is the single place that explains this to the UI, and
// `composeAndSend` below is the one function to fill in when a provider is added.
// ---------------------------------------------------------------------------

export const NOT_CONFIGURED_NOTE =
  'No AI provider is configured, so nothing was written or sent automatically — log the message you actually sent to keep this thread accurate.';

export interface EnrollmentEligibility {
  /** Cadence + guardrails say a follow-up may go out now. */
  isDue: boolean;
  /** Why not, when `isDue` is false — shown verbatim in the UI. */
  reason: string;
  followUpsRemaining: number;
}

/** Guardrail arithmetic for one enrollment: cadence, ceiling, and the business-hours window. */
export async function evaluateEligibility(
  agent: Pick<AiSdrAgent, 'maxFollowUps' | 'minHoursBetweenFollowUps' | 'respectBusinessHours' | 'active' | 'channel'>,
  enrollment: Pick<AiSdrEnrollment, 'status' | 'followUpsSent' | 'nextEligibleAt'>,
  lead?: { phone?: string | null; email?: string | null }
): Promise<EnrollmentEligibility> {
  const followUpsRemaining = Math.max(0, agent.maxFollowUps - enrollment.followUpsSent);

  if (enrollment.status !== 'active') return { isDue: false, reason: `Enrollment is ${enrollment.status}.`, followUpsRemaining };
  if (!agent.active) return { isDue: false, reason: 'Agent is paused.', followUpsRemaining };
  if (followUpsRemaining === 0) {
    return { isDue: false, reason: `Follow-up ceiling reached (${agent.maxFollowUps}) — ready to hand off.`, followUpsRemaining };
  }

  // The channel needs somewhere to actually reach the lead.
  if (lead) {
    if (agent.channel === 'email' && !lead.email) return { isDue: false, reason: 'Lead has no email address.', followUpsRemaining };
    if ((agent.channel === 'sms' || agent.channel === 'whatsapp') && !lead.phone) {
      return { isDue: false, reason: 'Lead has no phone number.', followUpsRemaining };
    }
  }

  if (enrollment.nextEligibleAt && enrollment.nextEligibleAt > new Date()) {
    return {
      isDue: false,
      reason: `Cadence: next follow-up allowed ${enrollment.nextEligibleAt.toLocaleString('en-IN')} (min ${agent.minHoursBetweenFollowUps}h apart).`,
      followUpsRemaining,
    };
  }

  if (agent.respectBusinessHours && !(await isWithinBusinessHours())) {
    return { isDue: false, reason: 'Outside business hours — waiting for the next open window.', followUpsRemaining };
  }

  return { isDue: true, reason: 'Due now.', followUpsRemaining };
}

/**
 * Enrolls a lead, or reactivates an existing enrollment for the same agent+lead. Never throws —
 * both the manual action and the automation step call it in bulk.
 */
export async function enrollLead(agentId: string, leadId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const [agent, lead] = await Promise.all([
      prisma.aiSdrAgent.findUnique({ where: { id: agentId } }),
      prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    if (!agent) return { ok: false, message: 'Agent not found.' };
    if (!lead) return { ok: false, message: 'Lead not found.' };

    const existing = await prisma.aiSdrEnrollment.findUnique({ where: { agentId_leadId: { agentId, leadId } } });
    if (existing && existing.status === 'active') {
      return { ok: false, message: 'Lead is already enrolled with this agent.' };
    }

    if (existing) {
      // Re-enrolling picks up where it left off rather than resetting the guardrail counters,
      // so a lead can't be messaged past the ceiling by repeatedly re-enrolling them.
      await prisma.aiSdrEnrollment.update({
        where: { id: existing.id },
        data: { status: 'active', stoppedReason: null, nextEligibleAt: new Date() },
      });
    } else {
      await prisma.aiSdrEnrollment.create({
        data: { agentId, leadId, status: 'active', nextEligibleAt: new Date() },
      });
    }

    await prisma.leadActivity.create({
      data: { leadId, type: 'note_added', description: `Enrolled with AI SDR agent "${agent.name}".`, metadata: { agentId } },
    });
    return { ok: true, message: existing ? 'Enrollment reactivated.' : 'Lead enrolled.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Enrollment failed.' };
  }
}

/** Records a message a human actually sent (or a reply they received) against the thread. */
export async function logMessage(
  enrollmentId: string,
  input: { direction: 'outbound' | 'inbound'; body: string }
): Promise<{ ok: boolean; message: string }> {
  const enrollment = await prisma.aiSdrEnrollment.findUnique({ where: { id: enrollmentId }, include: { agent: true } });
  if (!enrollment) return { ok: false, message: 'Enrollment not found.' };

  await prisma.aiSdrMessage.create({
    data: {
      enrollmentId,
      direction: input.direction,
      channel: enrollment.agent.channel,
      body: input.body,
      author: 'human',
      status: 'logged',
      deliveryNote: input.direction === 'outbound' ? 'Logged in the CRM — delivery happened outside this app.' : null,
    },
  });

  // Only an outbound message consumes the guardrail budget and restarts the cadence clock.
  if (input.direction === 'outbound') {
    const now = new Date();
    const nextEligibleAt = new Date(now.getTime() + enrollment.agent.minHoursBetweenFollowUps * 3_600_000);
    const followUpsSent = enrollment.followUpsSent + 1;
    await prisma.aiSdrEnrollment.update({
      where: { id: enrollmentId },
      data: {
        followUpsSent,
        lastMessageAt: now,
        nextEligibleAt,
        status: followUpsSent >= enrollment.agent.maxFollowUps ? 'exhausted' : enrollment.status,
      },
    });
  }

  return { ok: true, message: 'Message logged.' };
}

/** Hands the lead to the agent's configured rep — a real reassignment, not just a status flip. */
export async function handOff(enrollmentId: string, outcome: 'qualified' | 'exhausted'): Promise<{ ok: boolean; message: string }> {
  const enrollment = await prisma.aiSdrEnrollment.findUnique({ where: { id: enrollmentId }, include: { agent: true, lead: true } });
  if (!enrollment) return { ok: false, message: 'Enrollment not found.' };

  const toUserId = enrollment.agent.handoffUserId;
  if (toUserId) {
    await prisma.lead.update({ where: { id: enrollment.leadId }, data: { assignedUserId: toUserId } });
    await prisma.leadAssignmentHistoryEntry.create({
      data: {
        leadId: enrollment.leadId,
        fromUserId: enrollment.lead.assignedUserId,
        toUserId,
        actorName: `AI SDR: ${enrollment.agent.name}`,
      },
    });
  }

  await prisma.aiSdrEnrollment.update({
    where: { id: enrollmentId },
    data: { status: 'handed_off', handedOffAt: new Date(), handedOffToUserId: toUserId ?? null },
  });

  await prisma.leadActivity.create({
    data: {
      leadId: enrollment.leadId,
      type: 'assigned',
      description: toUserId
        ? `AI SDR agent "${enrollment.agent.name}" handed this ${outcome} lead to ${toUserId}.`
        : `AI SDR agent "${enrollment.agent.name}" marked this lead ${outcome}, but has no handoff rep configured.`,
      metadata: { agentId: enrollment.agentId, outcome },
    },
  });

  return {
    ok: true,
    message: toUserId ? `Handed off to ${toUserId}.` : 'Marked handed off — no handoff rep is configured on this agent.',
  };
}

export async function stopEnrollment(enrollmentId: string, reason?: string): Promise<{ ok: boolean; message: string }> {
  const updated = await prisma.aiSdrEnrollment
    .update({ where: { id: enrollmentId }, data: { status: 'stopped', stoppedReason: reason?.trim() || 'Stopped manually.' } })
    .catch(() => null);
  if (!updated) return { ok: false, message: 'Enrollment not found.' };
  return { ok: true, message: 'Enrollment stopped.' };
}

/**
 * The one function to fill in when an LLM + messaging provider are wired up: compose the next
 * message from the agent's persona/offer/goal and the thread so far, send it on the agent's
 * channel, then record it exactly like `logMessage` does for a human. Until then it reports
 * why nothing happened, and the UI shows that against every due enrollment.
 */
export async function composeAndSend(_enrollmentId: string): Promise<{ ok: false; message: string }> {
  return { ok: false, message: NOT_CONFIGURED_NOTE };
}
