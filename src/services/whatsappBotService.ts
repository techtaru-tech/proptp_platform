import type { WhatsAppBot, WhatsAppBotInput, WhatsAppDripStatus } from '../types';
import { api } from './apiClient';

// server/src/routes/whatsappBots.ts + services/whatsappBot.ts

export const listBots = (): Promise<WhatsAppBot[]> => api.get('/whatsapp-bots');
export const getBot = (id: string): Promise<WhatsAppBot | undefined> => api.get<WhatsAppBot>(`/whatsapp-bots/${id}`).catch(() => undefined);
export const createBot = (input: WhatsAppBotInput): Promise<{ id: string }> => api.post('/whatsapp-bots', input);
export const updateBot = (id: string, input: WhatsAppBotInput): Promise<{ id: string }> => api.patch(`/whatsapp-bots/${id}`, input);
export const setBotStatus = (id: string, status: WhatsAppDripStatus): Promise<unknown> => api.patch(`/whatsapp-bots/${id}/status`, { status });
export const deleteBot = async (id: string): Promise<void> => void (await api.delete(`/whatsapp-bots/${id}`));
