import type {
  WhatsAppAiReplyRow, WhatsAppAiSettings, WhatsAppAiSettingsInput, WhatsAppAiTestResult, WhatsAppKnowledgeEntry,
} from '../types';
import { api } from './apiClient';

// server/src/routes/whatsappAi.ts + services/whatsappAi.ts

export const getAiSettings = (): Promise<WhatsAppAiSettings> => api.get('/whatsapp-ai/settings');
export const saveAiSettings = (input: WhatsAppAiSettingsInput): Promise<WhatsAppAiSettings> => api.patch('/whatsapp-ai/settings', input);

export const listKnowledge = (): Promise<WhatsAppKnowledgeEntry[]> => api.get('/whatsapp-ai/knowledge');
export const addKnowledge = (e: { title: string; content: string; active: boolean }): Promise<WhatsAppKnowledgeEntry> => api.post('/whatsapp-ai/knowledge', e);
export const updateKnowledge = (id: string, e: { title: string; content: string; active: boolean }): Promise<WhatsAppKnowledgeEntry> => api.patch(`/whatsapp-ai/knowledge/${id}`, e);
export const deleteKnowledge = async (id: string): Promise<void> => void (await api.delete(`/whatsapp-ai/knowledge/${id}`));

export const tryAssistant = (message: string, phone?: string): Promise<WhatsAppAiTestResult> => api.post('/whatsapp-ai/test', { message, phone });
export const listAiReplies = (): Promise<WhatsAppAiReplyRow[]> => api.get('/whatsapp-ai/replies');
