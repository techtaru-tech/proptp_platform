import type {
  LeadStatus, WhatsAppAccount, WhatsAppAccountInput, WhatsAppConversation, WhatsAppMessage,
} from '../types';
import { api, toQueryString } from './apiClient';

// ---------------------------------------------------------------------------
// WhatsApp (server/src/routes/whatsapp.ts + services/whatsapp.ts).
// ---------------------------------------------------------------------------

export const CONVERSATION_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'intervened', label: 'Intervened' },
] as const;

export type ConversationTab = (typeof CONVERSATION_TABS)[number]['key'];

export async function listWhatsAppAccounts(): Promise<WhatsAppAccount[]> {
  return api.get<WhatsAppAccount[]>('/whatsapp/accounts');
}

export async function createWhatsAppAccount(input: WhatsAppAccountInput): Promise<WhatsAppAccount> {
  return api.post<WhatsAppAccount>('/whatsapp/accounts', input);
}

export async function updateWhatsAppAccount(id: string, input: Partial<WhatsAppAccountInput>): Promise<WhatsAppAccount> {
  return api.patch<WhatsAppAccount>(`/whatsapp/accounts/${id}`, input);
}

export async function deleteWhatsAppAccount(id: string): Promise<void> {
  await api.delete(`/whatsapp/accounts/${id}`);
}

export interface ConversationListParams extends Record<string, unknown> {
  accountId?: string;
  tab?: ConversationTab;
  search?: string;
  assignedUserId?: string;
  leadStatus?: LeadStatus | 'all';
}

export async function listConversations(params: ConversationListParams = {}): Promise<WhatsAppConversation[]> {
  return api.get<WhatsAppConversation[]>(`/whatsapp/conversations${toQueryString(params)}`);
}

export async function getConversation(id: string): Promise<WhatsAppConversation | undefined> {
  return api.get<WhatsAppConversation>(`/whatsapp/conversations/${id}`).catch(() => undefined);
}

export async function listMessages(conversationId: string): Promise<WhatsAppMessage[]> {
  return api.get<WhatsAppMessage[]>(`/whatsapp/conversations/${conversationId}/messages`);
}

export async function sendWhatsAppMessage(
  conversationId: string,
  input: { body?: string; templateName?: string; languageCode?: string }
): Promise<{ messageId: string }> {
  return api.post(`/whatsapp/conversations/${conversationId}/messages`, input);
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await api.post(`/whatsapp/conversations/${conversationId}/read`);
}

export async function updateConversation(
  id: string,
  patch: { assignedUserId?: string; archived?: boolean }
): Promise<WhatsAppConversation> {
  return api.patch<WhatsAppConversation>(`/whatsapp/conversations/${id}`, patch);
}

/** "22hr" style, matching what an agent needs to know at a glance. */
export function formatWindowLeft(minutes: number): string {
  if (minutes <= 0) return 'Closed';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}hr`;
}
