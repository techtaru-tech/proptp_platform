import type {
  AgentExtensionRow, CallDirection, CallLog, CallStatus,
  TelephonyConnectionTest, TelephonyEvent, TelephonySettings, TelephonySettingsPatch,
  UnmappedExtension,
} from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

// ---------------------------------------------------------------------------
// Telephony (server/src/routes/calls.ts + services/deepcall.ts).
// ---------------------------------------------------------------------------

export const CALL_DIRECTION_OPTIONS: { value: CallDirection | 'all'; label: string }[] = [
  { value: 'all', label: 'All Directions' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'outgoing', label: 'Outgoing' },
];

export const CALL_STATUS_OPTIONS: { value: CallStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'routing', label: 'In progress' },
  { value: 'answered', label: 'Answered' },
  { value: 'missed', label: 'Missed' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'off_hour', label: 'Off hour' },
  { value: 'failed', label: 'Failed' },
];

export const CALL_STATUS_TONE: Record<CallStatus, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  routing: 'info',
  answered: 'success',
  missed: 'danger',
  no_answer: 'warning',
  off_hour: 'neutral',
  failed: 'danger',
};

/** hh:mm:ss for anything an hour or longer, m:ss otherwise. */
export function formatCallDuration(seconds: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export interface CallListParams extends ListParams {
  direction?: CallDirection | 'all';
  status?: CallStatus | 'all';
  agentUserId?: string;
}

export async function listCalls(params: CallListParams = {}): Promise<ListResult<CallLog>> {
  return api.get<ListResult<CallLog>>(`/calls${toQueryString(params)}`);
}

export async function getCall(id: string): Promise<CallLog | undefined> {
  return api.get<CallLog>(`/calls/${id}`).catch(() => undefined);
}

export interface ClickToCallInput {
  leadId?: string;
  caller?: string;
  agent?: string;
}

export async function placeCall(input: ClickToCallInput): Promise<{ status: string; message: string; call?: CallLog }> {
  return api.post('/calls/click-to-call', input);
}

export async function getTelephonySettings(): Promise<TelephonySettings> {
  return api.get<TelephonySettings>('/calls/settings/telephony');
}

export async function updateTelephonySettings(patch: TelephonySettingsPatch): Promise<TelephonySettings> {
  return api.patch<TelephonySettings>('/calls/settings/telephony', patch);
}

export async function rotateTelephonyWebhook(): Promise<TelephonySettings> {
  return api.post<TelephonySettings>('/calls/settings/telephony/rotate-webhook');
}

/** Places no call: checks what is saved and that DeepCall answers. */
export async function testTelephonyConnection(): Promise<TelephonyConnectionTest> {
  return api.post<TelephonyConnectionTest>('/calls/settings/telephony/test');
}

export async function getAgentExtensions(): Promise<{ users: AgentExtensionRow[]; unmapped: UnmappedExtension[] }> {
  return api.get('/calls/extensions/mapping');
}

/** Also claims the calls already logged against this extension, which is the point of it. */
export async function setAgentExtension(
  userId: string,
  extension: string
): Promise<{ callsLinked: number; callsReleased: number }> {
  return api.patch('/calls/extensions/mapping', { userId, extension });
}

export async function listTelephonyEvents(limit = 25): Promise<TelephonyEvent[]> {
  const { events } = await api.get<{ events: TelephonyEvent[] }>(`/calls/settings/telephony/events?limit=${limit}`);
  return events;
}
