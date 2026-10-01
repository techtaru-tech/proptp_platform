import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { durationToSeconds, getSettings, normalizeNumber } from './airphone';

/**
 * The inbound half of the telephony integration — the two things the provider asks of us.
 *
 * Kept out of the route file because both webhooks are answered under a time limit (the
 * provider is holding a live call open while it waits for the routing answer) and the logic
 * is worth reading in one place.
 */

/** Matches on the last 10 digits, because the provider is not consistent about the +91. */
async function findLeadByNumber(number: string) {
  const local = normalizeNumber(number);
  if (local.length < 10) return null;
  return prisma.lead.findFirst({
    where: { phone: { endsWith: local } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, assignedUserId: true },
  });
}

/** A number the provider gave us could be either an agent's phone or their extension. */
async function findAgentByNumber(number?: string | null) {
  const local = normalizeNumber(number);
  if (!local && !number) return null;
  return prisma.user.findFirst({
    where: {
      status: 'active',
      OR: [
        ...(local.length >= 10 ? [{ phone: { endsWith: local } }] : []),
        ...(number ? [{ callExtension: String(number) }] : []),
      ],
    },
    select: { id: true, name: true, phone: true, callExtension: true },
  });
}

/** Reachable staff, in a stable order so round-robin actually rotates. */
function callableAgents() {
  return prisma.user.findMany({
    where: { status: 'active', role: { in: ['admin', 'leader', 'team_leader', 'employee'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, phone: true, callExtension: true },
  });
}

export interface RoutingAnswer {
  number: string;
  requestId: string;
  /** So the webhook can point its event record at the row this call became. */
  callLogId: string;
}

/**
 * Answers "who should take this call?".
 *
 * Sticky first: if we already know the caller and their lead has an owner, the customer
 * reaches the person who owns them — which is the whole point of putting a CRM behind a
 * phone number. Otherwise round-robin across active staff, and finally the fallback number.
 * A `CallLog` row is created here, before the call connects, so a call that is never
 * answered still shows up in the history rather than vanishing.
 */
export async function resolveAgentForCall(input: {
  caller: string;
  uniqueId?: string;
  virtualNumber?: string;
}): Promise<RoutingAnswer | null> {
  const settings = await getSettings();
  const caller = normalizeNumber(input.caller);
  const uniqueId = input.uniqueId ? String(input.uniqueId) : null;

  // The same call can be asked about more than once — a retry, or a transfer. Answer with
  // the agent already chosen for it: re-running the round-robin would ring a different
  // person mid-call, and creating a second row would hit the unique constraint on uniqueId.
  if (uniqueId) {
    const already = await prisma.callLog.findUnique({
      where: { uniqueId },
      select: { id: true, requestId: true, agentNumber: true },
    });
    if (already?.agentNumber) return { number: already.agentNumber, requestId: already.requestId, callLogId: already.id };
  }

  const lead = await findLeadByNumber(caller);

  let agent: { id: string; name: string; phone: string; callExtension: string | null } | null = null;

  // Testing override. Deliberately placed before every other rule and deliberately leaving
  // agentUserId null: the call really did go to a handset nobody on the staff list owns, and
  // the history should not claim otherwise.
  const testNumber = normalizeNumber(settings.testRouteNumber);
  if (testNumber.length >= 10) {
    return persistRouting({ number: testNumber, caller, lead, agent: null, settings, input, uniqueId });
  }

  if (settings.stickyRouting && lead?.assignedUserId) {
    agent = await prisma.user.findFirst({
      where: { id: lead.assignedUserId, status: 'active' },
      select: { id: true, name: true, phone: true, callExtension: true },
    });
  }

  if (!agent) {
    const agents = await callableAgents();
    if (agents.length > 0) {
      // Round-robin by how many calls each has already been sent, so the rotation survives a
      // restart without a cursor to keep anywhere.
      const counts = await prisma.callLog.groupBy({
        by: ['agentUserId'],
        where: { agentUserId: { in: agents.map((a) => a.id) } },
        _count: { _all: true },
      });
      const tally = new Map(counts.map((c) => [c.agentUserId, c._count._all]));
      agent = agents.reduce((best, current) => ((tally.get(current.id) ?? 0) < (tally.get(best.id) ?? 0) ? current : best), agents[0]);
    }
  }

  const number = agent?.callExtension || agent?.phone || settings.fallbackNumber;
  if (!number) return null;

  return persistRouting({ number, caller, lead, agent, settings, input, uniqueId });
}

/** The row behind a routing answer — created now so an unanswered call still has a history. */
async function persistRouting(args: {
  number: string;
  caller: string;
  lead: { id: string } | null;
  agent: { id: string } | null;
  settings: Awaited<ReturnType<typeof getSettings>>;
  input: { virtualNumber?: string };
  uniqueId: string | null;
}): Promise<RoutingAnswer> {
  const { number, caller, lead, agent, settings, input, uniqueId } = args;

  const fields = {
    direction: 'incoming',
    status: 'routing',
    callerNumber: caller,
    agentNumber: number,
    virtualNumber: input.virtualNumber ? normalizeNumber(input.virtualNumber) : settings.virtualNumber,
    leadId: lead?.id ?? null,
    agentUserId: agent?.id ?? null,
  };

  // Reached only when there is no row yet for this call, or the earlier ask could not
  // resolve an agent and is being retried.
  if (uniqueId) {
    const existing = await prisma.callLog.findUnique({ where: { uniqueId }, select: { id: true, requestId: true } });
    if (existing) {
      await prisma.callLog.update({ where: { id: existing.id }, data: fields });
      return { number, requestId: existing.requestId, callLogId: existing.id };
    }
  }

  const requestId = crypto.randomBytes(6).toString('hex');
  const created = await prisma.callLog.create({ data: { ...fields, requestId, uniqueId } });

  return { number, requestId, callLogId: created.id };
}

/**
 * The provider stamps its call times in IST and sends them with no offset at all
 * ("2026-09-16 15:11:12"). The server runs in UTC, so parsing that string as-is booked every
 * call five and a half hours into the future — a 3pm call read back as 8:30pm.
 */
function parseProviderTime(input: unknown): Date | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  // Left alone if the provider ever starts sending its own offset or a Z.
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const parsed = new Date(`${raw.replace(' ', 'T')}${hasOffset ? '' : '+05:30'}`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/** Provider `call_status` -> our vocabulary. Anything unrecognised is kept verbatim. */
function mapStatus(raw: unknown): string {
  // Matched on words rather than whole strings: the provider has sent "Off Hour", "off_hour"
  // and "Off Hour Call" for the same thing, and an unrecognised one lands in the history as a
  // status no filter or badge knows about.
  const value = String(raw ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!value) return 'failed';
  if (value.includes('answered')) return 'answered';
  if (value.includes('missed')) return 'missed';
  if (value.includes('off hour')) return 'off_hour';
  if (value.includes('no answer')) return 'no_answer';
  return value.replace(/ /g, '_');
}

/**
 * Records the call log the provider pushes after hangup.
 *
 * Matched to the row created at routing time by `response_id` (the requestId we handed back)
 * or by `unique_id`. If neither matches — an outbound call placed from a handset, say — a new
 * row is created, so a call is never dropped just because we did not start it.
 */
export async function recordCallLog(payload: Record<string, unknown>): Promise<{ id: string; created: boolean }> {
  const uniqueId = payload.unique_id ? String(payload.unique_id) : null;
  const responseId = payload.response_id ? String(payload.response_id) : null;
  const caller = normalizeNumber(payload.caller_id);
  const agentNumber = payload.received_id ? String(payload.received_id) : null;

  const existing =
    (responseId ? await prisma.callLog.findUnique({ where: { requestId: responseId } }) : null) ??
    (uniqueId ? await prisma.callLog.findUnique({ where: { uniqueId } }) : null);

  const [lead, agent] = await Promise.all([findLeadByNumber(caller), findAgentByNumber(agentNumber)]);

  const durationSeconds = durationToSeconds(payload.duration);
  const startedAt = parseProviderTime(payload.datetime) ?? new Date();

  const data: Prisma.CallLogUncheckedUpdateInput = {
    uniqueId,
    direction: String(payload.call_type ?? '').toLowerCase() === 'outgoing' ? 'outgoing' : 'incoming',
    status: mapStatus(payload.call_status),
    callerNumber: caller || existing?.callerNumber || '',
    agentNumber: agentNumber ?? existing?.agentNumber ?? null,
    virtualNumber: payload.ivr_number ? normalizeNumber(payload.ivr_number) : (existing?.virtualNumber ?? null),
    leadId: lead?.id ?? existing?.leadId ?? null,
    agentUserId: agent?.id ?? existing?.agentUserId ?? null,
    durationSeconds,
    recordingUrl: payload.recording_url ? String(payload.recording_url) : null,
    recordingDurationSeconds: durationToSeconds(payload.Rec_duration ?? (payload as any).rec_duration),
    dtmf: payload.dtmf ? String(payload.dtmf) : null,
    feedback: payload.feedback ? String(payload.feedback) : null,
    rawPayload: payload as Prisma.InputJsonValue,
    startedAt,
    endedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
  };

  // Same reasoning as the routing webhook: never let a unique-constraint error lose a log.
  // If this unique_id already belongs to a different row, leave the field alone rather than
  // colliding — the row is still identified by its requestId.
  if (existing && uniqueId && existing.uniqueId !== uniqueId) {
    const clash = await prisma.callLog.findUnique({ where: { uniqueId }, select: { id: true } });
    if (clash && clash.id !== existing.id) delete data.uniqueId;
  }

  const row = existing
    ? await prisma.callLog.update({ where: { id: existing.id }, data })
    : await prisma.callLog.create({
        data: {
          ...(data as Prisma.CallLogUncheckedCreateInput),
          requestId: responseId ?? `ext-${uniqueId ?? crypto.randomBytes(6).toString('hex')}`,
        },
      });

  // A call is worth seeing on the lead's timeline, not only in the call list.
  if (row.leadId) {
    await prisma.leadActivity.create({
      data: {
        leadId: row.leadId,
        // `call_logged` already exists in LeadActivityType and the timeline renders it.
        type: 'call_logged',
        description: `${row.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} call — ${row.status.replace('_', ' ')}${
          durationSeconds > 0 ? `, ${Math.round(durationSeconds / 60)} min` : ''
        }.`,
        userId: row.agentUserId ?? undefined,
        userName: agent?.name ?? undefined,
      },
    });
  }

  return { id: row.id, created: !existing };
}
