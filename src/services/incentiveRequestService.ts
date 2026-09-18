import type { IncentiveRequestRow } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface IncentiveRequestListParams extends ListParams {
  status?: 0 | 1 | 2 | 'all';
}

export function unitLabelForIncentiveRequest(request: IncentiveRequestRow): string {
  return request.unitLabel ?? request.propertyId;
}

export function projectNameForIncentiveRequest(request: IncentiveRequestRow): string {
  return request.projectName ?? '—';
}

export async function listIncentiveRequests(
  params: IncentiveRequestListParams = {}
): Promise<ListResult<IncentiveRequestRow>> {
  return api.get<ListResult<IncentiveRequestRow>>(`/incentive-requests${toQueryString(params)}`);
}

export async function getIncentiveRequest(id: string): Promise<IncentiveRequestRow | undefined> {
  const page = await listIncentiveRequests({ pageSize: 200 });
  return page.items.find((r) => r.id === id);
}

/**
 * Mirrors the real `incentivereqchange()` exactly — a thin status flip. The real handler
 * has no balance or transaction side effect of its own, so neither does this.
 */
export async function changeIncentiveRequestStatus(id: string, status: 1 | 2): Promise<IncentiveRequestRow | undefined> {
  return api.post<IncentiveRequestRow>(`/incentive-requests/${id}/status`, { status }).catch(() => undefined);
}
