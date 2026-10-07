import { api } from './apiClient';

/** The panel's chat assistant (server/src/routes/assistant.ts). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /** What the assistant looked up or did for this answer. */
  tools?: { label: string; failed?: boolean }[];
}
export interface PendingChange { id: string; name: string; summary: string }
export interface Chat { id: string; title: string; messages: ChatMessage[]; pending: PendingChange[] | null }
export interface ChatSummary { id: string; title: string; updatedAt: string }

export const getAssistantStatus = () => api.get<{ configured: boolean; model: string }>('/assistant/status');
export const listChats = () => api.get<ChatSummary[]>('/assistant/conversations');
export const getChat = (id: string) => api.get<Chat>(`/assistant/conversations/${id}`);
export const sendChat = (message: string, conversationId?: string) => api.post<Chat>('/assistant/chat', { message, conversationId });
export const decideChange = (id: string, approve: boolean) => api.post<Chat>(`/assistant/conversations/${id}/decide`, { approve });
export const deleteChat = (id: string) => api.delete(`/assistant/conversations/${id}`);
