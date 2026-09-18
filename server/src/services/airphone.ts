import crypto from 'crypto';
import axios from 'axios';
import type { TelephonySettings } from '@prisma/client';
import { prisma } from '../prisma';
import { decrypt } from './crypto';

/**
 * Airphone telephony. Two halves that must not be confused:
 *
 *  - Outbound (this file): endpoints Airphone hosts and we call — live extension status,
 *    click-to-call, and the mobile dial-call.
 *  - Inbound (routes/webhooks.ts): endpoints WE host and Airphone calls — "who should take
 *    this call?" before it connects, and the call log after hangup.
 *
 * The portal auth key is stored encrypted and used two ways, because the provider's own API
 * is inconsistent about it: click-to-call wants it as a `token` form field, the mobile
 * dial-call wants it as a Bearer header.
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

async function requireReady(): Promise<{ settings: Settings; token: string }> {
  const settings = await getSettings();
  if (!settings.enabled) throw new TelephonyError('Telephony is turned off in Settings → Telephony.');
  const token = apiToken(settings);
  if (!token) throw new TelephonyError('No API token is saved in Settings → Telephony.');
  return { settings, token };
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
  if (/^\d+$/.test(raw)) return Number(raw);
  const parts = raw.split(':').map((p) => Number(p) || 0);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, sec] = parts.slice(-3);
  return h * 3600 + m * 60 + sec;
}

// ---------------------------------------------------------------------------
// POST /getExtensionStatus/{comma-separated-extensions}
// ---------------------------------------------------------------------------

export interface ExtensionStatus {
  resource: string;
  state: string;
  on_call: boolean;
}

export async function getExtensionStatus(extensions: string[]): Promise<ExtensionStatus[]> {
  const settings = await getSettings();
  if (!settings.enabled) throw new TelephonyError('Telephony is turned off in Settings → Telephony.');
  if (extensions.length === 0) return [];
  const { data } = await rawExtensionStatus(settings, extensions);
  return Array.isArray(data) ? data : [];
}

/**
 * The documented call carries no auth, which is unusual enough to be worth hedging against:
 * the token goes out as both a Bearer header and a form field, the two shapes the rest of
 * this API uses. An endpoint that wants neither ignores both.
 */
async function rawExtensionStatus(settings: Settings, extensions: string[]) {
  const token = apiToken(settings);
  const form = token ? new URLSearchParams({ token }).toString() : null;
  return axios.post<ExtensionStatus[]>(
    `${settings.baseUrl}/getExtensionStatus/${extensions.map(encodeURIComponent).join(',')}`,
    form,
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Report whatever the provider says rather than throwing: this is also the probe
      // behind the Test Connection button, where the error body is the useful part.
      validateStatus: () => true,
    }
  );
}

// ---------------------------------------------------------------------------
// Connection probe — used by the Test Connection button before a live call.
// ---------------------------------------------------------------------------

export interface ConnectionTestResult {
  ok: boolean;
  checks: { label: string; ok: boolean; detail: string }[];
  httpStatus?: number;
  providerResponse?: unknown;
}

/**
 * Deliberately read-only: it reaches the provider without placing a call, so it can be run
 * on a live account. What it proves is that the base URL resolves and answers us; whether
 * the token is accepted is only visible if the provider says so, which is why its raw reply
 * is handed back untouched.
 */
export async function testConnection(): Promise<ConnectionTestResult> {
  const settings = await getSettings();
  const token = apiToken(settings);

  const checks: ConnectionTestResult['checks'] = [
    { label: 'Telephony enabled', ok: settings.enabled, detail: settings.enabled ? 'On' : 'Off — webhooks reject every request and no call can be placed.' },
    { label: 'API token stored', ok: !!token, detail: token ? `Stored, ${token.length} characters` : 'Missing — click-to-call cannot authenticate.' },
    { label: 'Virtual number set', ok: !!settings.virtualNumber, detail: settings.virtualNumber || 'Missing — click-to-call has no number to originate from.' },
  ];

  let httpStatus: number | undefined;
  let providerResponse: unknown;
  let reachable = false;

  try {
    const probe = await rawExtensionStatus(settings, ['0']);
    httpStatus = probe.status;
    providerResponse = probe.data;
    reachable = probe.status < 500;
    checks.push({
      label: 'Provider reachable',
      ok: reachable,
      detail: `${settings.baseUrl} answered HTTP ${probe.status}.`,
    });
  } catch (err) {
    const message = axios.isAxiosError(err) ? `${err.code ?? ''} ${err.message}`.trim() : String(err);
    checks.push({ label: 'Provider reachable', ok: false, detail: `${settings.baseUrl} could not be reached — ${message}` });
  }

  return { ok: checks.every((c) => c.ok), checks, httpStatus, providerResponse };
}

// ---------------------------------------------------------------------------
// POST /c2c — click to call. Form-encoded, token as a field.
// ---------------------------------------------------------------------------

export interface ClickToCallResult {
  uniqueId?: string;
  status: string;
  message: string;
}

export async function clickToCall(input: { agent: string; caller: string; virtualNumber?: string }): Promise<ClickToCallResult> {
  const { settings, token } = await requireReady();
  const vnm = input.virtualNumber || settings.virtualNumber;
  if (!vnm) throw new TelephonyError('No virtual number is saved in Settings → Telephony.');

  const form = new URLSearchParams({
    vnm: normalizeNumber(vnm),
    agent: normalizeNumber(input.agent),
    caller: normalizeNumber(input.caller),
    token,
  });

  const { data } = await axios.post(`${settings.baseUrl}/c2c`, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: REQUEST_TIMEOUT_MS,
    // The provider answers its own errors with a 200 and `status: "error"`, so a non-2xx is
    // a transport problem; let those throw and be reported as such.
  });

  return {
    uniqueId: data?.unique_id ? String(data.unique_id) : undefined,
    status: String(data?.status ?? 'error'),
    message: String(data?.message ?? 'No message returned by the provider.'),
  };
}

// ---------------------------------------------------------------------------
// POST /dial-call — mobile app calling. JSON, Bearer token.
// ---------------------------------------------------------------------------

export async function dialCall(input: { agent: string; caller: string; virtualNumber?: string }): Promise<{ ok: boolean; message: string }> {
  const { settings, token } = await requireReady();
  const vnm = input.virtualNumber || settings.virtualNumber;
  if (!vnm) throw new TelephonyError('No virtual number is saved in Settings → Telephony.');

  const { data } = await axios.post(
    `${settings.baseUrl}/dial-call`,
    {
      virtual_number: normalizeNumber(vnm),
      caller: normalizeNumber(input.caller),
      agent: normalizeNumber(input.agent),
    },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, timeout: REQUEST_TIMEOUT_MS }
  );

  return {
    ok: data?.status === true,
    message: String(data?.message ?? (data?.error_code ? `${data.error_code}` : 'No message returned by the provider.')),
  };
}
