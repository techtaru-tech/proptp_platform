import type { PlotHoldRow } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface PlotHoldListParams extends ListParams {
  projectId?: string | 'all';
  status?: 1 | 0 | 'all';
}

export function unitLabelForHold(hold: PlotHoldRow): string {
  return hold.unitLabel ?? hold.unitId;
}

export function projectNameForHold(hold: PlotHoldRow): string {
  return hold.projectName ?? '—';
}

export async function listPlotHolds(params: PlotHoldListParams = {}): Promise<ListResult<PlotHoldRow>> {
  return api.get<ListResult<PlotHoldRow>>(`/plot-holds${toQueryString(params)}`);
}

export async function getActiveHoldForUnit(unitId: string): Promise<PlotHoldRow | undefined> {
  return (await api.get<PlotHoldRow | null>(`/plot-holds/unit/${unitId}/active`)) ?? undefined;
}

/**
 * Mirrors the real `propertyholdsave()` — the admin, not the customer, places the hold.
 * The server rejects a hold on an already-booked plot, or a second concurrent hold.
 */
export async function createPlotHold(
  unitId: string,
  input: { userId: string; holdStart: string; holdEnd: string }
): Promise<PlotHoldRow> {
  return api.post<PlotHoldRow>('/plot-holds', { unitId, ...input });
}

/** Mirrors the real `propertyholdrelease()` — releases a hold early. */
export async function releasePlotHold(id: string): Promise<PlotHoldRow | undefined> {
  return api.post<PlotHoldRow>(`/plot-holds/${id}/release`).catch(() => undefined);
}
