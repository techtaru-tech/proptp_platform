import { useMemo } from 'react';
import { useAsync } from './useAsync';
import { listPipelines, listAllStages, listTags } from '../services/pipelineService';
import type { Pipeline, PipelineStage, LeadTag } from '../types';

export interface PipelineReferenceData {
  pipelines: Pipeline[];
  stages: PipelineStage[];
  tags: LeadTag[];
  isLoading: boolean;
  stageById: (id?: string) => PipelineStage | undefined;
  pipelineById: (id?: string) => Pipeline | undefined;
  stagesForPipeline: (pipelineId: string) => PipelineStage[];
  tagsByIds: (ids: string[]) => LeadTag[];
  defaultPipeline: () => Pipeline | undefined;
}

/**
 * Real, backend-backed replacement for the old static `src/data/mockPipelines.ts` reference
 * lookups (stageById/pipelineById/stagesForPipeline/tagsByIds/defaultPipeline). Pipelines and
 * stages are user-editable now (CRM -> Pipeline), so every page that displays or picks a
 * pipeline/stage/tag needs to read the same live data those edits are saved to — a static
 * frontend array would silently drift out of sync with what's actually in the database.
 */
export function usePipelineReferenceData(): PipelineReferenceData {
  const { data: pipelines, isLoading: pipelinesLoading } = useAsync(() => listPipelines(), []);
  const { data: stages, isLoading: stagesLoading } = useAsync(() => listAllStages(), []);
  const { data: tags, isLoading: tagsLoading } = useAsync(() => listTags(), []);

  const pipelinesSafe = pipelines ?? [];
  const stagesSafe = stages ?? [];
  const tagsSafe = tags ?? [];

  return useMemo<PipelineReferenceData>(
    () => ({
      pipelines: pipelinesSafe,
      stages: stagesSafe,
      tags: tagsSafe,
      isLoading: pipelinesLoading || stagesLoading || tagsLoading,
      stageById: (id) => (id ? stagesSafe.find((s) => s.id === id) : undefined),
      pipelineById: (id) => (id ? pipelinesSafe.find((p) => p.id === id) : undefined),
      stagesForPipeline: (pipelineId) =>
        stagesSafe.filter((s) => s.pipelineId === pipelineId).sort((a, b) => a.sortOrder - b.sortOrder),
      tagsByIds: (ids) => ids.map((id) => tagsSafe.find((t) => t.id === id)).filter((t): t is LeadTag => !!t),
      defaultPipeline: () => pipelinesSafe.find((p) => p.isDefault) ?? pipelinesSafe[0],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pipelinesSafe, stagesSafe, tagsSafe, pipelinesLoading, stagesLoading, tagsLoading]
  );
}
