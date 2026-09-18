import type { AuditEntry } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface AuditListParams extends ListParams {
  module?: string | 'all';
  userName?: string | 'all';
  recordId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function listAuditLog(params: AuditListParams = {}): Promise<ListResult<AuditEntry>> {
  const [result] = await Promise.all([
    api.get<ListResult<AuditEntry>>(`/audit${toQueryString(params)}`),
    // Warm the filter options alongside the first page; a failure here must not fail the list.
    facets.modules.length === 0 ? getAuditFacets().catch(() => facets) : Promise.resolve(facets),
  ]);
  return result;
}

/**
 * The filter dropdown options, taken from what the log actually contains rather than a
 * hardcoded list — so a new module starts appearing in the filter as soon as it writes a row.
 *
 * Cached because the filter bar reads them on every render; `listAuditLog` warms the cache
 * on its first call so the dropdowns are populated by the time the table is.
 */
let facets: { modules: string[]; users: string[] } = { modules: [], users: [] };

export async function getAuditFacets(): Promise<{ modules: string[]; users: string[] }> {
  facets = await api.get<{ modules: string[]; users: string[] }>('/audit/facets');
  return facets;
}

export function auditModules(): string[] {
  return facets.modules;
}

export function auditUsers(): string[] {
  return facets.users;
}

/** The audit trail for one record, shown on the project and booking detail pages. */
export async function auditForRecord(recordId: string): Promise<AuditEntry[]> {
  const { items } = await listAuditLog({ recordId, pageSize: 20 });
  return items;
}
