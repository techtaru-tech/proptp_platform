import type {
  AiSdrAgent, AiSdrAgentInput, AiSdrEnrollment, AiSdrMessage, SdrCapabilities,
} from '../types';
import { api } from './apiClient';

// ---------------------------------------------------------------------------
// AI SDR agents (server/src/routes/aiSdrAgents.ts + services/aiSdrEngine.ts).
// ---------------------------------------------------------------------------

/** Whether an LLM / messaging provider is wired up — drives the "not configured" notices. */
export async function getSdrCapabilities(): Promise<SdrCapabilities> {
  return api.get<SdrCapabilities>('/sdr-agents/capabilities');
}

export async function listSdrAgents(): Promise<AiSdrAgent[]> {
  return api.get<AiSdrAgent[]>('/sdr-agents');
}

export async function getSdrAgent(id: string): Promise<AiSdrAgent | undefined> {
  return api.get<AiSdrAgent>(`/sdr-agents/${id}`).catch(() => undefined);
}

export async function createSdrAgent(input: AiSdrAgentInput): Promise<AiSdrAgent> {
  return api.post<AiSdrAgent>('/sdr-agents', input);
}

export async function updateSdrAgent(id: string, input: AiSdrAgentInput): Promise<AiSdrAgent> {
  return api.patch<AiSdrAgent>(`/sdr-agents/${id}`, input);
}

export async function toggleSdrAgent(id: string): Promise<AiSdrAgent | undefined> {
  return api.post<AiSdrAgent>(`/sdr-agents/${id}/toggle`).catch(() => undefined);
}

export async function deleteSdrAgent(id: string): Promise<void> {
  await api.delete(`/sdr-agents/${id}`);
}

export interface EnrollResult {
  enrolled: number;
  skipped: number;
  results: { leadId: string; ok: boolean; message: string }[];
}

export async function enrollLeadsInSdrAgent(agentId: string, leadIds: string[]): Promise<EnrollResult> {
  return api.post<EnrollResult>(`/sdr-agents/${agentId}/enroll`, { leadIds });
}

export async function listSdrEnrollments(agentId: string): Promise<AiSdrEnrollment[]> {
  return api.get<AiSdrEnrollment[]>(`/sdr-agents/${agentId}/enrollments`);
}

export async function listSdrMessages(enrollmentId: string): Promise<AiSdrMessage[]> {
  return api.get<AiSdrMessage[]>(`/sdr-agents/enrollments/${enrollmentId}/messages`);
}

/** Records a message that was actually sent/received outside this app. */
export async function logSdrMessage(
  enrollmentId: string,
  input: { direction: 'outbound' | 'inbound'; body: string }
): Promise<{ ok: boolean; message: string }> {
  return api.post(`/sdr-agents/enrollments/${enrollmentId}/messages`, input);
}

export async function handOffSdrEnrollment(
  enrollmentId: string,
  outcome: 'qualified' | 'exhausted' = 'qualified'
): Promise<{ ok: boolean; message: string }> {
  return api.post(`/sdr-agents/enrollments/${enrollmentId}/handoff`, { outcome });
}

export async function stopSdrEnrollment(enrollmentId: string, reason?: string): Promise<{ ok: boolean; message: string }> {
  return api.post(`/sdr-agents/enrollments/${enrollmentId}/stop`, { reason });
}

export const SDR_GOAL_OPTIONS = [
  { value: 'qualify_lead', label: 'Qualify the lead' },
  { value: 'book_meeting', label: 'Book a meeting' },
];

export const SDR_CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

export const SDR_STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral' | 'shell'> = {
  active: 'info',
  qualified: 'success',
  handed_off: 'shell',
  exhausted: 'warning',
  stopped: 'neutral',
};
