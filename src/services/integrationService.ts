import type { IntegrationActivityEntry, LeadSource, LeadSourceConnection } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

// ---------------------------------------------------------------------------
// Real backend-backed integration service. `source: 'meta'` connections are backed by a
// genuine Graph API Page subscription (server/src/services/metaService.ts) — credentials
// are stored encrypted server-side and never returned here.
// ---------------------------------------------------------------------------

export async function listConnections(): Promise<LeadSourceConnection[]> {
  return api.get<LeadSourceConnection[]>('/connections');
}

export async function getConnection(id: string): Promise<LeadSourceConnection | undefined> {
  return api.get<LeadSourceConnection>(`/connections/${id}`).catch(() => undefined);
}

export async function toggleConnectionActive(id: string): Promise<LeadSourceConnection | undefined> {
  return api.post<LeadSourceConnection>(`/connections/${id}/toggle-active`).catch(() => undefined);
}

export async function testConnection(id: string): Promise<{ success: boolean; message: string }> {
  return api.post<{ success: boolean; message: string }>(`/connections/${id}/test`);
}

export interface CreateConnectionInput {
  name: string;
  source: LeadSource;
  active: boolean;
  /** For `source: 'meta'`: app_id, app_secret, page_access_token, page_id. */
  credentials: Record<string, string>;
  fieldMapping?: Record<string, string>;
}

export async function createConnection(input: CreateConnectionInput): Promise<LeadSourceConnection> {
  return api.post<LeadSourceConnection>('/connections', input);
}

export interface UpdateConnectionInput {
  name?: string;
  active?: boolean;
  fieldMapping?: Record<string, string>;
  credentials?: Record<string, string>;
}

export async function updateConnection(id: string, input: UpdateConnectionInput): Promise<LeadSourceConnection | undefined> {
  return api.patch<LeadSourceConnection>(`/connections/${id}`, input).catch(() => undefined);
}

export async function deleteConnection(id: string): Promise<void> {
  await api.delete(`/connections/${id}`);
}

/** Starts the "Connect with Facebook" OAuth flow — requires META_APP_ID/SECRET to already be saved on the connection. */
export async function startMetaOAuth(id: string): Promise<{ url: string }> {
  return api.get<{ url: string }>(`/connections/${id}/oauth/start`);
}

export interface SimulateConnectionResult {
  success: boolean;
  message: string;
  payload: Record<string, unknown>;
  /** The Lead columns this payload would fill. */
  mappedFields: Record<string, string>;
  /** Keys neither the mapping nor the built-in aliases could place — these need a field mapping. */
  unmappedKeys: string[];
  extras: { label: string; value: string }[];
  wouldFlagDuplicate: boolean;
}

/** Dry run: maps a payload exactly as the receiver would, without creating anything. */
export async function simulateConnection(id: string, payload?: Record<string, unknown>): Promise<SimulateConnectionResult> {
  return api.post<SimulateConnectionResult>(`/connections/${id}/simulate`, { payload });
}

/** Issues a new webhook token — the old URL stops working immediately. */
export async function rotateWebhookToken(id: string): Promise<LeadSourceConnection> {
  return api.post<LeadSourceConnection>(`/connections/${id}/rotate-token`);
}

export interface ActivityListParams extends ListParams {
  connectionId?: string | 'all';
  status?: IntegrationActivityEntry['status'] | 'all';
}

export async function listIntegrationActivity(params: ActivityListParams = {}): Promise<ListResult<IntegrationActivityEntry>> {
  return api.get<ListResult<IntegrationActivityEntry>>(`/connections/activity${toQueryString(params)}`);
}

/**
 * Derives a permanent Page access token from a user access token.
 *
 * Call without `pageId` to get the list of Pages this login manages, then again with the
 * chosen id to store its token and subscribe it to `leadgen`. The tokens themselves never
 * reach the browser.
 */
export async function linkMetaPage(
  connectionId: string,
  input: { userAccessToken: string; pageId?: string }
): Promise<{ pages?: { id: string; name: string }[]; page?: { id: string; name: string }; connection?: LeadSourceConnection }> {
  return api.post(`/connections/${connectionId}/meta/link`, input);
}

/**
 * Imports the leads a Meta Page's forms already hold. Returns as soon as the import starts —
 * it can take minutes, and progress shows up in the Activity Log.
 */
export async function backfillMetaLeads(connectionId: string): Promise<{ started: boolean; message: string }> {
  return api.post(`/connections/${connectionId}/meta/backfill`);
}
