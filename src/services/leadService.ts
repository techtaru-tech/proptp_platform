import type { Lead, LeadPriority, LeadSource, LeadStatus } from '../types';
import { refAssignees } from '../data/referenceData';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

// ---------------------------------------------------------------------------
// Real backend-backed lead service (server/ — Express + Prisma + PostgreSQL).
// Leads shown here include everything ingested automatically via the Meta Lead
// Ads webhook (see server/src/routes/webhooks.ts) alongside manually created ones.
// Assignable users / source options are still the existing static reference data —
// partners/employees/teams haven't been migrated off the mock layer yet.
// ---------------------------------------------------------------------------

export interface LeadListParams extends ListParams {
  status?: LeadStatus | 'all';
  priority?: LeadPriority | 'all';
  source?: LeadSource | 'all';
  pipelineId?: string | 'all';
  stageId?: string | 'all';
  assignedUserId?: string | 'all';
  tagId?: string | 'all';
  starred?: boolean;
  /** Created on or after / on or before these days, inclusive. YYYY-MM-DD, read as IST. */
  dateFrom?: string;
  dateTo?: string;
  /** The lead's newest activity falls in this window. */
  lastActivityFrom?: string;
  lastActivityTo?: string;
  /** Meta attribution, so leads can be read one ad at a time. */
  campaignName?: string;
  adName?: string;
  formName?: string;
}

/** The filter choices, shared so the Leads table and a WhatsApp broadcast offer the same set. */
export const LEAD_STATUS_OPTIONS: { value: LeadStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export const LEAD_PRIORITY_OPTIONS: { value: LeadPriority | 'all'; label: string }[] = [
  { value: 'all', label: 'All Priorities' },
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export async function listLeads(params: LeadListParams = {}): Promise<ListResult<Lead>> {
  return api.get<ListResult<Lead>>(`/leads${toQueryString(params)}`);
}

/**
 * Every lead id the current filter matches, for "select all" across pages.
 *
 * Ids only: the page already has the rows it is showing, and all it needs from the rest is
 * something to hand to a bulk action.
 */
/** The campaigns and ads that have actually produced leads, for the filter dropdowns. */
export interface AdSourceOptions {
  campaigns: { name: string; count: number }[];
  ads: { name: string; count: number }[];
  forms: { name: string; count: number }[];
}

export async function listAdSources(): Promise<AdSourceOptions> {
  return api.get<AdSourceOptions>('/leads/ad-sources');
}

export async function listLeadIds(
  params: LeadListParams = {}
): Promise<{ ids: string[]; total: number; capped: boolean; limit: number }> {
  const { page, pageSize, sortBy, sortDir, ...filters } = params;
  return api.get(`/leads/ids${toQueryString(filters)}`);
}

export async function getLead(id: string): Promise<Lead | undefined> {
  return api.get<Lead>(`/leads/${id}`).catch(() => undefined);
}

export interface LeadStageHistoryEntry {
  id: string;
  leadId: string;
  fromStageName?: string;
  toStageName: string;
  actorId?: string;
  actorName?: string;
  createdAt: string;
}

export interface LeadAssignmentHistoryEntry {
  id: string;
  leadId: string;
  fromUserId?: string;
  toUserId?: string;
  actorId?: string;
  actorName?: string;
  createdAt: string;
}

/** Stage-move + reassignment history for the lead detail page's "History" tab. */
export async function getLeadHistory(id: string): Promise<{ stageHistory: LeadStageHistoryEntry[]; assignmentHistory: LeadAssignmentHistoryEntry[] }> {
  return api.get(`/leads/${id}/history`);
}

/** The people the signed-in user may assign a lead to: their hierarchy, or everybody for an admin. */
export function listAssignableUsers() {
  return refAssignees;
}

/** Enum sources merged with any free-text/custom sources already used, mirroring the real Filament Select. */
export function listSourceOptions(): { value: LeadSource; label: string }[] {
  return [
    { value: 'meta', label: 'Meta' },
    { value: 'google_ads', label: 'Google Ads' },
    { value: 'web_form', label: 'Website Form' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'youtube', label: 'YouTube' },
    { value: 'calendly', label: 'Calendly' },
    { value: 'typeform', label: 'Typeform' },
    { value: 'telegram', label: 'Telegram' },
    { value: 'manual', label: 'Manual' },
    { value: 'other', label: 'Other' },
  ];
}

export async function createLead(data: Partial<Lead>): Promise<Lead> {
  return api.post<Lead>('/leads', data);
}

export async function updateLead(id: string, data: Partial<Lead>): Promise<Lead | undefined> {
  return api.patch<Lead>(`/leads/${id}`, data).catch(() => undefined);
}

export async function updateLeadStatus(id: string, status: LeadStatus, lostReason?: string): Promise<Lead | undefined> {
  return api.post<Lead>(`/leads/${id}/status`, { status, lostReason }).catch(() => undefined);
}

export async function moveLeadStage(id: string, pipelineId: string, stageId: string): Promise<Lead | undefined> {
  return api.post<Lead>(`/leads/${id}/stage`, { pipelineId, stageId }).catch(() => undefined);
}

export async function assignLead(id: string, userId: string | undefined): Promise<Lead | undefined> {
  return api.post<Lead>(`/leads/${id}/assign`, { userId }).catch(() => undefined);
}

export async function toggleStar(id: string): Promise<Lead | undefined> {
  return api.post<Lead>(`/leads/${id}/star`).catch(() => undefined);
}

export async function addTag(id: string, tagId: string): Promise<Lead | undefined> {
  await api.post(`/leads/${id}/tags/${tagId}`);
  return getLead(id);
}

export async function removeTag(id: string, tagId: string): Promise<Lead | undefined> {
  await api.delete(`/leads/${id}/tags/${tagId}`);
  return getLead(id);
}

// ---------------------------------------------------------------------------
// Bulk actions (Leads list -> select rows -> Assign / Change Status / Add Tag)
// ---------------------------------------------------------------------------

/** How many were assigned and how many were skipped because they are outside the caller's team. */
export async function bulkAssign(ids: string[], userId: string): Promise<{ assigned: number; skipped: number }> {
  return api.post<{ assigned: number; skipped: number }>('/leads/bulk/assign', { ids, userId });
}

export async function bulkChangeStatus(ids: string[], status: LeadStatus): Promise<void> {
  await api.post('/leads/bulk/status', { ids, status });
}

export async function bulkChangePriority(ids: string[], priority: LeadPriority): Promise<void> {
  await api.post('/leads/bulk/priority', { ids, priority });
}

export async function bulkChangeSource(ids: string[], source: LeadSource, otherSource?: string): Promise<void> {
  await api.post('/leads/bulk/source', { ids, source, otherSource });
}

export async function bulkAddTag(ids: string[], tagId: string): Promise<void> {
  await api.post('/leads/bulk/tag', { ids, tagId });
}

export async function bulkRemoveTag(ids: string[], tagId: string): Promise<void> {
  await api.post('/leads/bulk/untag', { ids, tagId });
}

export async function bulkMoveStage(ids: string[], pipelineId: string, stageId: string): Promise<void> {
  await api.post('/leads/bulk/stage', { ids, pipelineId, stageId });
}

export async function bulkDelete(ids: string[]): Promise<void> {
  await api.post('/leads/bulk/delete', { ids });
}

export async function deleteLead(id: string): Promise<void> {
  await api.delete(`/leads/${id}`);
}

// ---------------------------------------------------------------------------
// CSV Import
// ---------------------------------------------------------------------------

export interface ImportRowResult {
  row: number;
  status: 'imported' | 'duplicate' | 'skipped';
  reason?: string;
  leadId?: string;
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  skipped: number;
  results: ImportRowResult[];
}

export async function importLeads(
  rows: Record<string, string>[],
  defaultPipelineId?: string,
  defaultStageId?: string
): Promise<ImportSummary> {
  return api.post<ImportSummary>('/leads/import', { rows, defaultPipelineId, defaultStageId });
}
