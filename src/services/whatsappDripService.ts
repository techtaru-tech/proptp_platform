import type {
  BroadcastLeadFilter, WhatsAppDrip, WhatsAppDripEnrollment, WhatsAppDripInput, WhatsAppDripSend, WhatsAppDripStatus,
} from '../types';
import { api } from './apiClient';

// ---------------------------------------------------------------------------
// server/src/routes/whatsappDrips.ts + services/whatsappDripEngine.ts
// ---------------------------------------------------------------------------

export const DRIP_STATUS_OPTIONS: { value: WhatsAppDripStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
];

export const DRIP_STATUS_TONE: Record<WhatsAppDripStatus, 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral',
  active: 'success',
  paused: 'warning',
};

export const DRIP_ENROLLMENT_TONE: Record<WhatsAppDripEnrollment['status'], 'info' | 'success' | 'neutral'> = {
  active: 'info',
  completed: 'success',
  stopped: 'neutral',
};

export const listDrips = (): Promise<WhatsAppDrip[]> => api.get('/whatsapp-drips');
export const getDrip = (id: string): Promise<WhatsAppDrip | undefined> => api.get<WhatsAppDrip>(`/whatsapp-drips/${id}`).catch(() => undefined);
export const createDrip = (input: WhatsAppDripInput): Promise<{ id: string }> => api.post('/whatsapp-drips', input);
export const updateDrip = (id: string, input: WhatsAppDripInput): Promise<{ id: string }> => api.patch(`/whatsapp-drips/${id}`, input);
export const setDripStatus = (id: string, status: WhatsAppDripStatus): Promise<unknown> => api.patch(`/whatsapp-drips/${id}/status`, { status });
export const deleteDrip = async (id: string): Promise<void> => void (await api.delete(`/whatsapp-drips/${id}`));

export interface DripEnrollResult {
  enrolled: number;
  skipped: number;
  message: string;
}

export const enrollByFilter = (id: string, leadFilter: BroadcastLeadFilter): Promise<DripEnrollResult> =>
  api.post(`/whatsapp-drips/${id}/enroll`, { leadFilter });

export const countAudience = (leadFilter: BroadcastLeadFilter): Promise<{ count: number; overLimit: boolean; limit: number }> =>
  api.post('/whatsapp-drips/audience', { leadFilter });

export const listDripEnrollments = (id: string): Promise<WhatsAppDripEnrollment[]> => api.get(`/whatsapp-drips/${id}/enrollments`);
export const listDripSends = (enrollmentId: string): Promise<WhatsAppDripSend[]> => api.get(`/whatsapp-drips/enrollments/${enrollmentId}/sends`);
export const stopDripEnrollment = async (enrollmentId: string): Promise<void> => void (await api.post(`/whatsapp-drips/enrollments/${enrollmentId}/stop`));
export const runDueDripSteps = async (): Promise<void> => void (await api.post('/whatsapp-drips/run-due'));
