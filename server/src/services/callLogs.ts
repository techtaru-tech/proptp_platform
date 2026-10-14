import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { durationToSeconds, normalizeNumber } from './deepcall';

/**
 * Recording the call report DeepCall pushes after every call.
 *
 * DeepCall decides who answers an incoming call (the call flow on the business number does
 * that), so there is nothing for us to answer while the customer waits — the CRM learns about a
 * call when it is over. This is where that report becomes a row in the call history, matched to
 * the lead by the customer's number and to the staff member by the number they answered on.
 */

/** Matches on the last 10 digits, because the provider is not consistent about the +91. */
async function findLeadByNumber(number: string) {
  const local = normalizeNumber(number);
  if (local.length < 10) return null;
  return prisma.lead.findFirst({
    where: { phone: { endsWith: local } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
}

/** A number the provider gave us could be either an agent's phone or the number mapped to them. */
async function findAgentByNumber(number?: string | null) {
  const local = normalizeNumber(number);
  if (!local && !number) return null;
  return prisma.user.findFirst({
    where: {
      status: 'active',
      OR: [
        ...(local.length >= 10 ? [{ phone: { endsWith: local } }, { callExtension: { endsWith: local } }] : []),
        ...(number ? [{ callExtension: String(number) }] : []),
      ],
    },
    select: { id: true, name: true },
  });
}

/**
 * The provider stamps its call times in IST and sends them with no offset at all
 * ("2026-09-16 15:11:12"). The server runs in UTC, so parsing that string as-is books every
 * call five and a half hours into the future — a 3pm call read back as 8:30pm.
 */
function parseProviderTime(input: unknown): Date | null {
  const raw = String(input ?? '').trim();
  if (!raw || raw === '0000-00-00 00:00:00') return null;
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000);
  // Left alone if the provider ever starts sending its own offset or a Z.
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const parsed = new Date(`${raw.replace(' ', 'T')}${hasOffset ? '' : '+05:30'}`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/**
 * DeepCall's `callStatus` is a number from 0 to 25 ("3 Both Answered", "7 Agent Unanswered"...).
 * "Cust." is the customer and "Agent" the staff member, on incoming and outgoing calls alike.
 * Anything not listed keeps its own text so it still shows up rather than being guessed at.
 */
const STATUS_BY_CODE: Record<number, string> = {
  0: 'failed', 1: 'routing', 2: 'routing',
  3: 'answered', 4: 'missed', 5: 'answered', 6: 'no_answer', 7: 'missed', 8: 'no_answer', 9: 'no_answer',
  10: 'answered', 11: 'failed', 12: 'failed', 13: 'failed', 14: 'failed', 15: 'failed', 16: 'missed',
  17: 'missed', 18: 'missed', 19: 'no_answer', 20: 'missed', 21: 'missed', 22: 'no_answer', 23: 'missed',
  24: 'no_answer', 25: 'failed',
};

function mapStatus(raw: unknown, talkSeconds: number): string {
  const value = String(raw ?? '').trim();
  if (!value) return 'failed';
  if (/^\d+$/.test(value)) {
    const code = Number(value);
    // "Cust. Hangup" (21) is only a miss if nothing was said; hanging up after a conversation
    // is how most calls end.
    if (code === 21 && talkSeconds > 0) return 'answered';
    return STATUS_BY_CODE[code] ?? `status_${code}`;
  }
  const text = value.toLowerCase().replace(/[_.-]+/g, ' ').replace(/\s+/g, ' ');
  if (text.includes('both answered') || text === 'answered' || text.includes('agent ans')) return 'answered';
  if (text.includes('unans') || text.includes('no answer')) return text.includes('agent unans') ? 'missed' : 'no_answer';
  if (text.includes('missed')) return 'missed';
  if (text.includes('fail')) return 'failed';
  return text.replace(/ /g, '_');
}

/** DeepCall's call types: IBD and DID are incoming; OBD, CTC (click-to-call) and QC (quick call) are outgoing. */
function directionOf(raw: unknown, fallback: string | undefined): string {
  const value = String(raw ?? '').toLowerCase();
  if (/^(obd|ctc|qc)$/.test(value) || /out|click|c2c|api|campaign|broadcast/.test(value)) return 'outgoing';
  if (/^(ibd|did)$/.test(value) || /in/.test(value)) return 'incoming';
  return fallback ?? 'incoming';
}

/** A list the provider sends as real JSON, as a JSON string, or as one value; its first entry. */
function firstOf(raw: unknown): string | undefined {
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : undefined;
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  if (text.startsWith('[')) {
    try {
      const list = JSON.parse(text);
      return Array.isArray(list) && list.length ? String(list[0]) : undefined;
    } catch {
      /* not JSON after all */
    }
  }
  return text;
}

/** One recording link out of whatever DeepCall sends: a URL, a JSON list, or a list of objects. */
function recordingOf(raw: unknown): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return recordingOf(raw[0]);
  if (typeof raw === 'object') return recordingOf((raw as any).url ?? (raw as any).link ?? (raw as any).file ?? (raw as any).recording ?? Object.values(raw as object)[0]);
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      return recordingOf(JSON.parse(text));
    } catch {
      /* not JSON after all */
    }
  }
  // DeepCall's own payload carries a file path (/202104/...wav) rather than a link; a path is no
  // use as a link, so only a full URL is kept (the path stays on the raw payload).
  const url = text.match(/https?:\/\/[^\s,"']+/);
  return url ? url[0] : null;
}

/**
 * The first present name wins. The webhook template in DeepCall decides what each field is
 * called, so both the names the settings screen suggests and DeepCall's own variable names are
 * understood — and the raw payload is kept on the row either way.
 */
function pick(source: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = source[name] ?? source[name.toLowerCase()];
    if (value !== undefined && value !== null && String(value).trim() !== '' && String(value) !== 'null') return String(value).trim();
  }
  return undefined;
}

/**
 * Records the call report DeepCall pushes after a call.
 *
 * A call we started ourselves (click-to-call) already has a row, matched by DeepCall's call id
 * or, failing that, by the customer's number on a recent outgoing call that is still open. A call
 * with no row — every incoming call — gets one here, so a call is never dropped just because we
 * did not start it.
 */
export async function recordCallLog(payload: Record<string, unknown>): Promise<{ id: string; created: boolean }> {
  const uniqueId = pick(payload, 'callId', 'call_id', 'unique_id', 'uniqueId') ?? null;
  // For a click-to-call, cNumber is not the customer: the number that was called is in nH.
  const isCtc = /^ctc$/i.test(pick(payload, 'callType', 'cType', 'call_type') ?? '');
  const customer = normalizeNumber(
    pick(payload, 'customerNumber', 'cNumber10') ?? (isCtc ? firstOf(payload.nH) : undefined) ?? pick(payload, 'cNumber', 'customer', 'caller', 'caller_id')
  );
  const aHDetail = Array.isArray(payload.aHDetail) ? (payload.aHDetail as any[]) : [];
  const agentRaw = pick(payload, 'agentNumber', 'masterAgentNumber', 'agent_number', 'received_id') ?? (aHDetail[0]?.agentNumber ? String(aHDetail[0].agentNumber) : undefined);
  const agentNumber = agentRaw ? (normalizeNumber(agentRaw).length >= 10 ? normalizeNumber(agentRaw) : agentRaw) : null;
  const talkSeconds = durationToSeconds(pick(payload, 'talkDuration', 'lastFirstDuration', 'duration', 'agentOnCallDuration', 'custAnswerDuration'));

  let existing = uniqueId ? await prisma.callLog.findUnique({ where: { uniqueId } }) : null;
  if (!existing && customer) {
    existing = await prisma.callLog.findFirst({
      where: { direction: 'outgoing', status: 'routing', callerNumber: customer, startedAt: { gte: new Date(Date.now() - 45 * 60_000) } },
      orderBy: { startedAt: 'desc' },
    });
  }

  const [lead, agent] = await Promise.all([findLeadByNumber(customer), findAgentByNumber(agentNumber)]);

  const startedAt = parseProviderTime(pick(payload, 'callTime', 'ivrSTime', 'startTime', 'callFlowSTime', 'datetime')) ?? existing?.startedAt ?? new Date();
  const hangupAt = parseProviderTime(pick(payload, 'hangupTime', 'lastHangupTime', 'ivrETime'));
  const businessNumber = pick(payload, 'businessNumber', 'businessNum', 'business_number', 'did');
  const dtmf = pick(payload, 'keyInput', 'dtmf');
  const disposition = pick(payload, 'disposition', 'callDisposition');

  const data: Prisma.CallLogUncheckedUpdateInput = {
    uniqueId,
    direction: directionOf(pick(payload, 'callType', 'cType', 'call_type'), existing?.direction),
    status: mapStatus(pick(payload, 'callStatus', 'call_status'), talkSeconds),
    callerNumber: customer || existing?.callerNumber || '',
    agentNumber: agentNumber ?? existing?.agentNumber ?? null,
    virtualNumber: businessNumber ? normalizeNumber(businessNumber) : (existing?.virtualNumber ?? null),
    leadId: lead?.id ?? existing?.leadId ?? null,
    agentUserId: agent?.id ?? existing?.agentUserId ?? null,
    durationSeconds: talkSeconds,
    recordingUrl: recordingOf(payload.recordings ?? payload.recording ?? payload.recording_url) ?? existing?.recordingUrl ?? null,
    dtmf: dtmf && dtmf !== '0' ? dtmf : null,
    feedback: disposition ?? null,
    rawPayload: payload as Prisma.InputJsonValue,
    startedAt,
    endedAt: hangupAt ?? new Date(startedAt.getTime() + talkSeconds * 1000),
  };

  // Never let a unique-constraint error lose a log. If this call id already belongs to a
  // different row, leave the field alone rather than colliding.
  if (existing && uniqueId && existing.uniqueId !== uniqueId) {
    const clash = await prisma.callLog.findUnique({ where: { uniqueId }, select: { id: true } });
    if (clash && clash.id !== existing.id) delete data.uniqueId;
  }

  const row = existing
    ? await prisma.callLog.update({ where: { id: existing.id }, data })
    : await prisma.callLog.create({
        data: { ...(data as Prisma.CallLogUncheckedCreateInput), requestId: uniqueId ? `dc-${uniqueId}` : `ext-${crypto.randomBytes(6).toString('hex')}` },
      });

  // A call is worth seeing on the lead's timeline, not only in the call list — once. DeepCall
  // can send the same report again, and a repeat must not add a second line.
  const firstTimeFinished = !existing || existing.status === 'routing';
  if (row.leadId && firstTimeFinished && row.status !== 'routing') {
    await prisma.leadActivity.create({
      data: {
        leadId: row.leadId,
        // `call_logged` already exists in LeadActivityType and the timeline renders it.
        type: 'call_logged',
        description: `${row.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} call — ${row.status.replace(/_/g, ' ')}${
          talkSeconds > 0 ? `, ${Math.max(1, Math.round(talkSeconds / 60))} min` : ''
        }.`,
        userId: row.agentUserId ?? undefined,
        userName: agent?.name ?? undefined,
      },
    });
  }

  return { id: row.id, created: !existing };
}
