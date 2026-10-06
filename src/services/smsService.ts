import { api } from './apiClient';

/** Settings > SMS (DLT) (server/src/routes/sms.ts). */
export interface SmsSettings { provider: string; enabled: boolean; hasAuthKey: boolean; senderId: string; dltEntityId: string; providers: string[] }
export interface SmsTemplate { id: string; name: string; dltTemplateId: string; body: string; active: boolean; slots: number }
export interface SmsLogRow { id: string; to: string; templateName: string; text: string; status: 'sent' | 'failed'; detail: string; leadId: string | null; createdAt: string }

export const getSmsSettings = () => api.get<SmsSettings>('/sms/settings');
export const saveSmsSettings = (input: Record<string, unknown>) => api.patch<SmsSettings>('/sms/settings', input);
export const listSmsTemplates = () => api.get<SmsTemplate[]>('/sms/templates');
export const createSmsTemplate = (input: Partial<SmsTemplate>) => api.post<SmsTemplate>('/sms/templates', input);
export const updateSmsTemplate = (id: string, input: Partial<SmsTemplate>) => api.patch<SmsTemplate>(`/sms/templates/${id}`, input);
export const deleteSmsTemplate = (id: string) => api.delete(`/sms/templates/${id}`);
export const sendSms = (input: { templateName: string; params: string[]; to?: string; leadId?: string }) => api.post('/sms/send', input);
export const previewSms = (templateName: string, params: string[]) => api.post<{ text: string; slots: number }>('/sms/preview', { templateName, params });
export const listSmsLog = () => api.get<SmsLogRow[]>('/sms/log');
