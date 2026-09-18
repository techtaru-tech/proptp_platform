import type { Automation, AutomationRunEntry } from '../types';
import { refTeams } from '../data/referenceData';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

// ---------------------------------------------------------------------------
// Real backend-backed automation service (server/src/routes/automations.ts +
// server/src/services/automationEngine.ts). An automation is a trigger plus an ordered list
// of steps (condition / action / delay) that the engine runs top-to-bottom for whichever lead
// fired the trigger — see the engine file for exactly how each step type executes.
// ---------------------------------------------------------------------------

export async function listAutomations(): Promise<Automation[]> {
  return api.get<Automation[]>('/automations');
}

export async function getAutomation(id: string): Promise<Automation | undefined> {
  return api.get<Automation>(`/automations/${id}`).catch(() => undefined);
}

export async function toggleAutomationEnabled(id: string): Promise<Automation | undefined> {
  return api.post<Automation>(`/automations/${id}/toggle`).catch(() => undefined);
}

export type AutomationInput = Omit<Automation, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>;

export async function createAutomation(data: AutomationInput): Promise<Automation> {
  return api.post<Automation>('/automations', data);
}

export async function updateAutomation(id: string, data: Partial<AutomationInput>): Promise<Automation | undefined> {
  return api.patch<Automation>(`/automations/${id}`, data).catch(() => undefined);
}

export async function deleteAutomation(id: string): Promise<void> {
  await api.delete(`/automations/${id}`);
}

export interface RunListParams extends ListParams {
  automationId?: string | 'all';
}

export async function listAutomationRuns(params: RunListParams = {}): Promise<ListResult<AutomationRunEntry>> {
  return api.get(`/automations/runs/list${toQueryString(params)}`);
}

/** Only `triggerType: 'manual'` + enabled automations can be run this way — matches the real bulk `run_automation` action's Select options exactly. */
export async function listManualAutomations(): Promise<Automation[]> {
  return api.get<Automation[]>('/automations/manual');
}

/**
 * Runs the automation's full step chain for each selected lead. `teamMemberIds` is only
 * consulted by an `assign_lead` step with `assignMode: 'team'` — Teams are still mock/frontend-only
 * data, so membership is resolved here and sent along rather than the backend needing its own copy.
 */
export async function runAutomationOnLeads(automationId: string, leadIds: string[]): Promise<{ queued: number; skipped: number }> {
  const automation = await getAutomation(automationId);
  const teamMemberIds = automation?.steps
    .filter((s) => s.type === 'action' && s.config.action === 'assign_lead' && s.config.assignMode === 'team')
    .map((s) => refTeams.find((t) => t.id === s.config.assignTeamId)?.memberIds)
    .find((ids): ids is string[] => !!ids);

  return api.post<{ queued: number; skipped: number }>(`/automations/${automationId}/run`, { leadIds, teamMemberIds });
}
