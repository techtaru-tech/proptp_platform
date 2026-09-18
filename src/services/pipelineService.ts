import type { Pipeline, PipelineStage, LeadTag } from '../types';
import { api } from './apiClient';

// ---------------------------------------------------------------------------
// Real backend-backed pipeline/stage service (server/src/routes/pipelines.ts).
// Pipelines and their stages are now user-manageable from CRM -> Pipeline -> "Pipelines"
// tab (create/edit/delete), with the drag-drop board moved to the "Kanban" tab alongside it.
// ---------------------------------------------------------------------------

export interface PipelineWithCounts extends Pipeline {
  _count?: { stages: number; leads: number };
}

export async function listPipelines(): Promise<PipelineWithCounts[]> {
  return api.get<PipelineWithCounts[]>('/pipelines');
}

export async function getPipeline(id: string): Promise<Pipeline | undefined> {
  return api.get<Pipeline>(`/pipelines/${id}`).catch(() => undefined);
}

export async function getDefaultPipeline(): Promise<Pipeline | undefined> {
  const all = await listPipelines();
  return all.find((p) => p.isDefault) ?? all[0];
}

export async function listStages(pipelineId: string): Promise<PipelineStage[]> {
  return api.get<PipelineStage[]>(`/pipelines/${pipelineId}/stages`);
}

/** Every stage across every pipeline, flat — powers usePipelineReferenceData's stageById()/tagsByIds() lookups. */
export async function listAllStages(): Promise<PipelineStage[]> {
  return api.get<PipelineStage[]>('/pipelines/stages/all');
}

export async function listTags(): Promise<LeadTag[]> {
  return api.get<LeadTag[]>('/tags');
}

export interface PipelineInput {
  name: string;
  description?: string;
  isDefault?: boolean;
}

export async function createPipeline(input: PipelineInput): Promise<Pipeline> {
  return api.post<Pipeline>('/pipelines', input);
}

export async function updatePipeline(id: string, input: Partial<PipelineInput>): Promise<Pipeline | undefined> {
  return api.patch<Pipeline>(`/pipelines/${id}`, input).catch(() => undefined);
}

export async function deletePipeline(id: string): Promise<{ error?: string }> {
  try {
    await api.delete(`/pipelines/${id}`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unable to delete this pipeline.' };
  }
}

export interface StageInput {
  name: string;
  color?: string;
}

export async function createStage(pipelineId: string, input: StageInput): Promise<PipelineStage> {
  return api.post<PipelineStage>(`/pipelines/${pipelineId}/stages`, input);
}

export async function updateStage(
  stageId: string,
  patch: Partial<Pick<PipelineStage, 'name' | 'color' | 'isWon' | 'isLost' | 'winProbability' | 'sortOrder'>>
): Promise<PipelineStage | undefined> {
  return api.patch<PipelineStage>(`/pipelines/stages/${stageId}`, patch).catch(() => undefined);
}

export async function deleteStage(stageId: string): Promise<{ error?: string }> {
  try {
    await api.delete(`/pipelines/stages/${stageId}`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unable to delete this stage.' };
  }
}

export async function reorderStages(pipelineId: string, orderedIds: string[]): Promise<void> {
  await api.post(`/pipelines/${pipelineId}/stages/reorder`, { orderedIds });
}
