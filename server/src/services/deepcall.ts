import crypto from 'crypto';
import axios from 'axios';
import type { TelephonySettings } from '@prisma/client';
import { prisma } from '../prisma';
import { decrypt } from './crypto';
import { logTelephonyEvent } from './telephonyEvents';

/**
 * DeepCall telephony. Two halves that must not be confused:
 *
 *  - Outbound (this file): the click-to-call endpoint DeepCall hosts and we call.
 *  - Inbound (routes/webhooks.ts, services/callLogs.ts): the call report DeepCall pushes to a URL
 *    of ours after every call. Who answers an incoming call is decided inside DeepCall, by the
 *    call flow on the business number, not by us.
 *
 * DeepCall's API identifies the account by `user_id` and authenticates with a `token`, both as
 * query parameters. The token is stored encrypted and never leaves the server.
 */

const REQUEST_TIMEOUT_MS = 15_000;

export type Settings = TelephonySettings;

/** Single row, created on first read so the settings screen always has something to edit. */
export async function getSettings(): Promise<Settings> {
  const existing = await prisma.telephonySettings.findUnique({ where: { id: 'default' } });
  if (existing) return existing;
  return prisma.telephonySettings.create({
    data: { id: 'default', webhookToken: crypto.randomBytes(18).toString('hex') },
  });
}

export function apiToken(settings: Settings): string | null {
  return settings.apiToken ? decrypt(settings.apiToken) : null;
}

export class TelephonyError extends Error {
  constructor(message: string, readonly httpStatus = 400) {
    super(message);
  }
}

async function requireReady(): Promise<{ settings: Settings; token: string; accountId: string }> {
  const settings = await getSettings();
  if (!settings.enabled) throw new TelephonyError('Telephony is turned off in Settings → Telephony.');
  const token = apiToken(settings);
  if (!token) throw new TelephonyError('No API token is saved in Settings → Telephony.');
  if (!settings.accountId) throw new TelephonyError('No DeepCall account ID (user_id) is saved in Settings → Telephony.');
  return { settings, token, accountId: settings.accountId };
}

/** Last 10 digits — every number the provider sends is an Indian mobile in some format. */
export function normalizeNumber(input: unknown): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** "H:i:s" from the provider, or a bare number of seconds, to seconds. */
export function durationToSeconds(input: unknown): number {
  const raw = String(input ?? '').trim();
  if (!raw) return 0;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw));
  const parts = raw.split(':').map((p) => Number(p) || 0);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, sec] = parts.slice(-3);
  return h * 3600 + m * 60 + sec;
}

/** 10 digits to 91 + 10 digits, which is how DeepCall stores every agent's number. */
export function toDeepCallAgentNumber(input: unknown): string {
  const local = normalizeNumber(input);
  return local.length === 10 ? `91${local}` : local;
}

// ---------------------------------------------------------------------------
// Connection probe — used by the Test Connection button before a live call.
// ---------------------------------------------------------------------------

export interface ConnectionTestResult {
  ok: boolean;
  checks: { label: string; ok: boolean; detail: string }[];
  httpStatus?: number;
}

/**
 * Deliberately free of side effects: DeepCall has no read-only endpoint to prove a token with,
 * and the only way to prove one is to place a call. So this checks what is ours to check — that
 * everything needed is saved — and that the provider's host answers at all. Whether the token
 * is accepted shows up on the first real click-to-call, whose reply is kept under Recent
 * requests on the same screen.
 */
export async function testConnection(): Promise<ConnectionTestResult> {
  const settings = await getSettings();
  const token = apiToken(settings);

  const checks: ConnectionTestResult['checks'] = [
    { label: 'Telephony enabled', ok: settings.enabled, detail: settings.enabled ? 'On' : 'Off — click-to-call is blocked and the call-log webhook rejects every request.' },
    { label: 'Account ID (user_id) saved', ok: !!settings.accountId, detail: settings.accountId ?? 'Missing — every DeepCall API call needs it.' },
    { label: 'Click-to-call flow ID saved', ok: !!settings.clickToCallFlowId, detail: settings.clickToCallFlowId ?? 'Missing — DeepCall needs a call flow with a Click To Call module to place a call.' },
    { label: 'API token stored', ok: !!token, detail: token ? `Stored, ${token.length} characters` : 'Missing — click-to-call cannot authenticate.' },
  ];

  let httpStatus: number | undefined;
  try {
    const probe = await axios.get(settings.baseUrl, { timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true });
    httpStatus = probe.status;
    checks.push({ label: 'DeepCall reachable', ok: probe.status < 500, detail: `${settings.baseUrl} answered HTTP ${probe.status}.` });
  } catch (err) {
    const message = axios.isAxiosError(err) ? `${err.code ?? ''} ${err.message}`.trim() : String(err);
    checks.push({ label: 'DeepCall reachable', ok: false, detail: `${settings.baseUrl} could not be reached — ${message}` });
  }

  return { ok: checks.every((c) => c.ok), checks, httpStatus };
}

// ---------------------------------------------------------------------------
// POST /v3/clickToCall/para — rings the agent first, then the customer.
// ---------------------------------------------------------------------------

export interface ClickToCallResult {
  /** DeepCall's id for the call, when the reply carries one — what the call report is matched on. */
  callId?: string;
  ok: boolean;
  message: string;
}

/** Whatever shape the reply has, the first present key wins. */
function firstOf(obj: any, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = obj?.[key] ?? obj?.data?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return undefined;
}

export async function clickToCall(input: { agent: string; customer: string }): Promise<ClickToCallResult> {
  const { settings, token, accountId } = await requireReady();
  const params = {
    user_id: accountId,
    token,
    callFirst: 'agent',
    customer: normalizeNumber(input.customer),
    agentType: 'agent_number',
    // DeepCall keeps an agent's number with the country code (919549193870) and matches on it as
    // sent. A bare 10-digit number is not matched, and the call fails at the agent's leg. The
    // customer's number is different: DeepCall adds the 91 itself.
    agent_number: toDeepCallAgentNumber(input.agent),
    // DeepCall runs a click-to-call through a call flow that has a Click To Call module, and
    // answers "Found invalid CTC ivr" or fails the agent leg without one.
    ...(settings.clickToCallFlowId ? { callFlow_id: settings.clickToCallFlowId } : {}),
  };
  const url = `${settings.baseUrl}/v3/clickToCall/para`;
  // The reply is kept whatever it says: the shape of a DeepCall answer is learned from real
  // calls, and the token is never written down.
  const { token: _omit, ...loggable } = params;
  const request = { method: 'POST', path: url, query: loggable } as any;

  try {
    const res = await axios.post(url, null, { params, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true });
    const data = typeof res.data === 'string' ? safeJson(res.data) ?? { message: res.data } : res.data ?? {};

    const statusRaw = firstOf(data, 'status', 'success', 'code', 'result');
    const text = String(statusRaw ?? '').toLowerCase();
    const failedWord = /^(error|fail|failed|failure|false|0|invalid)$/.test(text);
    const ok = res.status < 400 && !failedWord && !firstOf(data, 'error', 'errors');
    const message = String(firstOf(data, 'message', 'msg', 'error', 'description') ?? (ok ? 'Call requested.' : `DeepCall answered HTTP ${res.status}.`));
    const callId = firstOf(data, 'callId', 'call_id', 'unique_id', 'uniqueId', 'id');

    await logTelephonyEvent({
      kind: 'click_to_call',
      outcome: ok ? 'ok' : 'failed',
      request,
      response: { httpStatus: res.status, body: data },
      errorMessage: ok ? undefined : message,
    });
    return { ok, message, callId: callId !== undefined ? String(callId) : undefined };
  } catch (err) {
    const message = axios.isAxiosError(err) ? `${err.code ?? ''} ${err.message}`.trim() : String(err);
    await logTelephonyEvent({ kind: 'click_to_call', outcome: 'failed', request, errorMessage: message });
    throw new TelephonyError(`DeepCall could not be reached — ${message}`, 502);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
