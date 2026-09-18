import type {
  EmailSequence, EmailSequenceEnrollment, EmailSequenceInput, EmailSequenceSend, EmailTemplate,
} from '../types';
import { api } from './apiClient';

// ---------------------------------------------------------------------------
// Email sequences (server/src/routes/emailSequences.ts + services/emailSequenceEngine.ts).
// ---------------------------------------------------------------------------

export const SEQUENCE_STATUS_OPTIONS: { value: EmailSequence['status']; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
];

export const SEQUENCE_STATUS_TONE: Record<EmailSequence['status'], 'neutral' | 'success' | 'warning'> = {
  draft: 'neutral',
  active: 'success',
  paused: 'warning',
};

export const ENROLLMENT_STATUS_TONE: Record<EmailSequenceEnrollment['status'], 'info' | 'success' | 'neutral'> = {
  active: 'info',
  completed: 'success',
  stopped: 'neutral',
};

/** Whether a real email provider is wired up — drives the "not delivered" notice. */
export async function getEmailCapabilities(): Promise<{ emailProviderConfigured: boolean }> {
  return api.get('/email-sequences/capabilities');
}

export async function listEmailSequences(): Promise<EmailSequence[]> {
  return api.get<EmailSequence[]>('/email-sequences');
}

export async function getEmailSequence(id: string): Promise<EmailSequence | undefined> {
  return api.get<EmailSequence>(`/email-sequences/${id}`).catch(() => undefined);
}

export async function createEmailSequence(input: EmailSequenceInput): Promise<{ id: string }> {
  return api.post<{ id: string }>('/email-sequences', input);
}

export async function updateEmailSequence(id: string, input: EmailSequenceInput): Promise<{ id: string }> {
  return api.patch<{ id: string }>(`/email-sequences/${id}`, input);
}

export async function deleteEmailSequence(id: string): Promise<void> {
  await api.delete(`/email-sequences/${id}`);
}

export interface SequenceEnrollResult {
  enrolled: number;
  skipped: number;
  message: string;
}

export async function enrollLeadsInSequence(id: string, leadIds: string[]): Promise<SequenceEnrollResult> {
  return api.post<SequenceEnrollResult>(`/email-sequences/${id}/enroll`, { leadIds });
}

export async function listSequenceEnrollments(id: string): Promise<EmailSequenceEnrollment[]> {
  return api.get<EmailSequenceEnrollment[]>(`/email-sequences/${id}/enrollments`);
}

export async function listSequenceSends(enrollmentId: string): Promise<EmailSequenceSend[]> {
  return api.get<EmailSequenceSend[]>(`/email-sequences/enrollments/${enrollmentId}/sends`);
}

export async function stopSequenceEnrollment(enrollmentId: string): Promise<void> {
  await api.post(`/email-sequences/enrollments/${enrollmentId}/stop`);
}

/** Forces a poller tick instead of waiting up to a minute for the next one. */
export async function runDueSequenceSteps(): Promise<void> {
  await api.post('/email-sequences/run-due');
}

export async function listEmailTemplates(): Promise<EmailTemplate[]> {
  return api.get<EmailTemplate[]>('/email-templates');
}
