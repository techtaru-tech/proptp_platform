import type {
  WaBoard, WaCampaign, WaCampaignInput, WaContactRow, WaDashboard, WaImportResult, WaImportRow, WaOptOutRow, WaReviewQueue,
  WhatsAppDripStatus,
} from '../types';
import { api } from './apiClient';

// server/src/routes/waCampaigns.ts + services/waCampaign.ts

export const listCampaigns = (): Promise<WaCampaign[]> => api.get('/wa-campaigns');
export const getCampaign = (id: string): Promise<WaCampaign | undefined> => api.get<WaCampaign>(`/wa-campaigns/${id}`).catch(() => undefined);
export const createCampaign = (input: WaCampaignInput): Promise<WaCampaign> => api.post('/wa-campaigns', input);
export const updateCampaign = (id: string, input: WaCampaignInput): Promise<WaCampaign> => api.patch(`/wa-campaigns/${id}`, input);
export const setCampaignStatus = (id: string, status: WhatsAppDripStatus): Promise<WaCampaign> => api.patch(`/wa-campaigns/${id}/status`, { status });
export const deleteCampaign = async (id: string): Promise<void> => void (await api.delete(`/wa-campaigns/${id}`));
export const getDefaultCopy = async (): Promise<Record<string, string>> => (await api.get<{ copy: Record<string, string> }>('/wa-campaigns/defaults')).copy;

export const importContacts = (id: string, rows: WaImportRow[], optInSource: string): Promise<WaImportResult> =>
  api.post(`/wa-campaigns/${id}/import`, { rows, optInSource, confirmConsent: true });

export const getDashboard = (id: string): Promise<WaDashboard> => api.get(`/wa-campaigns/${id}/dashboard`);
export const getBoard = (id: string): Promise<WaBoard> => api.get(`/wa-campaigns/${id}/board`);
export const listContacts = (id: string, search = ''): Promise<WaContactRow[]> => api.get(`/wa-campaigns/${id}/contacts?search=${encodeURIComponent(search)}`);
export const getReviewQueue = (id: string, status: 'pending' | 'verified' | 'rejected'): Promise<WaReviewQueue> => api.get(`/wa-campaigns/${id}/review?status=${status}`);

export interface ReviewInput {
  decision: 'approve' | 'reject';
  b2c?: boolean;
  labAgeYears?: number;
  professionalType?: string;
  labName?: string;
  city?: string;
  note?: string;
}
export const reviewContact = (contactId: string, input: ReviewInput): Promise<unknown> => api.post(`/wa-campaigns/contacts/${contactId}/review`, input);

export const connectCalendly = (id: string, token: string): Promise<{ connected: boolean }> => api.post(`/wa-campaigns/${id}/calendly`, { token });
export const runCampaignsNow = async (): Promise<void> => void (await api.post('/wa-campaigns/run-due'));

export const listOptOuts = (): Promise<WaOptOutRow[]> => api.get('/wa-campaigns/opt-outs');
export const addOptOut = (phone: string, reason: string): Promise<unknown> => api.post('/wa-campaigns/opt-outs', { phone, reason });
export const removeOptOut = async (phone: string): Promise<void> => void (await api.delete(`/wa-campaigns/opt-outs/${phone}`));
