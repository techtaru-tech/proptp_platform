import { api, BASE_URL, storedAuthToken } from './apiClient';

/** Section Overviews and their assistants (server/src/routes/sections.ts). */
export type SectionKey = 'hrms' | 'tasks' | 'real-estate' | 'finance' | 'construction-legal' | 'people' | 'support' | 'reports' | 'settings';

export type Fmt = 'num' | 'inr' | 'pct';
export interface SectionKpi { label: string; value: number; format?: Fmt; meta?: string; to?: string; tone?: 'danger' | 'warn' | 'good' }
export interface SectionChartRow { name: string; value: number; to?: string; target?: number; parts?: { name: string; value: number }[] }
export interface SectionChart {
  id: string;
  title: string;
  meta?: string;
  kind: 'columns' | 'bars' | 'ring' | 'split' | 'progress' | 'stack';
  rows: SectionChartRow[];
  format?: Fmt;
  side?: boolean;
  to?: string;
}
export interface SectionAttention { title: string; detail: string; to: string; level: 'act' | 'review' | 'info' }
export interface SectionOverview {
  section: SectionKey;
  label: string;
  generatedAt: string;
  kpis: SectionKpi[];
  charts: SectionChart[];
  attention: SectionAttention[];
  links: { label: string; to: string; meta: string }[];
}

export const getSectionOverview = (section: SectionKey) => api.get<SectionOverview>(`/overview/${section}`);

// ------------------------------------------------------------------------------- the assistant

export interface SectionAgentMessage { id: string; role: 'user' | 'assistant'; text: string; steps: { label: string; failed?: boolean }[]; at: string }
export interface SectionAgentChat { id: string; title: string; messages: SectionAgentMessage[] }
export interface SectionAgentChatSummary { id: string; title: string; updatedAt: string }
export type SectionAgentEvent =
  | { type: 'conversation'; id: string; title: string }
  | { type: 'step'; id: string; label: string }
  | { type: 'step_done'; id: string; ok: boolean; note?: string }
  | { type: 'progress'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'notice'; text: string }
  | { type: 'done'; conversationId: string }
  | { type: 'error'; message: string };

export const getSectionAgentStatus = (s: SectionKey) => api.get<{ configured: boolean; model: string }>(`/module-agent/${s}/status`);
export const listSectionAgentChats = (s: SectionKey) => api.get<SectionAgentChatSummary[]>(`/module-agent/${s}/conversations`);
export const getSectionAgentChat = (s: SectionKey, id: string) => api.get<SectionAgentChat>(`/module-agent/${s}/conversations/${id}`);
export const deleteSectionAgentChat = (s: SectionKey, id: string) => api.delete(`/module-agent/${s}/conversations/${id}`);

/** Asks a question and calls `onEvent` for every server-sent event as it arrives; abort `signal` to stop. */
export async function askSectionAgent(
  section: SectionKey,
  body: { message: string; conversationId?: string },
  onEvent: (e: SectionAgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = storedAuthToken();
  const res = await fetch(`${BASE_URL}/module-agent/${section}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(typeof err?.error === 'string' ? err.error : err?.error?.message ?? `The assistant could not be reached (${res.status}).`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events are separated by a blank line; a comment line (": keep-alive") carries no data.
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { onEvent(JSON.parse(data) as SectionAgentEvent); } catch { /* a malformed event is skipped, not fatal */ }
    }
  }
}

/** Starter questions per section, in the mix of Hinglish and English the team writes in. */
export const SECTION_SUGGESTIONS: Record<SectionKey, string[]> = {
  hrms: ['Aaj kaun late aaya aur kaun abhi tak nahi aaya?', 'Kitni leave requests pending hain? Kiski?', 'Is mahine sabse zyada late kaun hua?', 'Is month ka payroll kitna hai?'],
  tasks: ['Kaun se tasks overdue hain? Sabse purane pehle', 'What is blocked right now and who owns it?', 'Kiske paas sabse zyada open tasks hain?', 'Is hafte kya due hai?'],
  'real-estate': ['Kaun se plots abhi available hain, project wise?', 'Which holds expire in the next 24 hours?', 'Pending bookings ki list do', 'Sabse zyada paisa kis plot par baaki hai?'],
  finance: ['Is mahine kitna collection hua, mode wise?', 'Kya kya approval ke liye pending hai?', 'Kitne payouts pending hain aur kiske?', 'Kitna paisa abhi collect karna baaki hai?'],
  'construction-legal': ['Kaun si site schedule se peeche hai aur kyun?', 'Open site issues ki list do', 'Which vendor bills need approval?', 'Kaun se approvals expire ho rahe hain?'],
  people: ['Top 5 partners kaun hain booking value se?', 'Kitne partners ka KYC pending hai?', 'Inactive partners ki list do', 'Koi partner dispute open hai?'],
  support: ['Kaun se tickets open hain? Sabse purane pehle', 'Last notifications kitne logon ne padhe?', 'Koi WhatsApp message fail hua?', 'Kis type ki problem sabse zyada aa rahi hai?'],
  reports: ['Is mahine ka business summary do', 'Compare this month\'s bookings with last month', 'Sabse zyada sales kis partner se aayi?', 'Aaj attendance kaisi hai?'],
  settings: ['Kaun se operations rules on hain aur kya karte hain?', 'Is hafte settings mein kisne kya badla?', 'Kis role ke paas kya access hai?', 'Kiska client access jaldi khatam ho raha hai?'],
};
