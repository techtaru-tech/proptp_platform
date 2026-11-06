import { api, BASE_URL, storedAuthToken } from './apiClient';

/** The CRM analyst on CRM Overview (server/src/routes/crmAgent.ts). */
export interface CrmAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The lookups it made for this answer. */
  steps: { label: string; failed?: boolean }[];
  at: string;
}
export interface CrmAgentChat { id: string; title: string; messages: CrmAgentMessage[] }
export interface CrmAgentChatSummary { id: string; title: string; updatedAt: string }

export type CrmAgentEvent =
  | { type: 'conversation'; id: string; title: string }
  | { type: 'step'; id: string; label: string }
  | { type: 'step_done'; id: string; ok: boolean; note?: string }
  | { type: 'progress'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'notice'; text: string }
  | { type: 'done'; conversationId: string }
  | { type: 'error'; message: string };

export interface CrmAgentContext {
  page: string;
  filters: Record<string, string>;
  labels: Record<string, string>;
}

/** Starter questions, in the mix of Hinglish and English the sales team actually writes in. */
export const CRM_ANALYST_SUGGESTIONS = [
  'Is hafte ka pipeline summary do — kya better hua, kya bigda?',
  'Which source gives the best conversion, and which one is wasting leads?',
  'Kaun se leads 48 ghante se untouched hain, aur kisko assigned hain?',
  'Team mein first response sabse slow kiska hai? Numbers ke saath batao',
  'Overdue follow-ups ki list do — sabse zaroori pehle',
  'Site visit ke baad booking kyun nahi ho rahi? Funnel dekh ke batao',
  'Compare the last 30 days with the 30 days before',
  'Kaunsa budget, property type aur location sabse zyada demand mein hai?',
];

export const getCrmAgentStatus = () => api.get<{ configured: boolean; model: string }>('/crm-agent/status');
export const listCrmAgentChats = () => api.get<CrmAgentChatSummary[]>('/crm-agent/conversations');
export const getCrmAgentChat = (id: string) => api.get<CrmAgentChat>(`/crm-agent/conversations/${id}`);
export const deleteCrmAgentChat = (id: string) => api.delete(`/crm-agent/conversations/${id}`);

/**
 * Asks a question and calls `onEvent` for every server-sent event as it arrives. Resolves when the
 * stream ends; abort `signal` to stop the answer part-way.
 */
export async function askCrmAgent(
  body: { message: string; conversationId?: string; context?: CrmAgentContext },
  onEvent: (e: CrmAgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = storedAuthToken();
  const res = await fetch(`${BASE_URL}/crm-agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(typeof err?.error === 'string' ? err.error : err?.error?.message ?? `The analyst could not be reached (${res.status}).`);
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
      try { onEvent(JSON.parse(data) as CrmAgentEvent); } catch { /* a malformed event is skipped, not fatal */ }
    }
  }
}
