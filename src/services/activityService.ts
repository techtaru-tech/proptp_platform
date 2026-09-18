import type { LeadActivity, LeadActivityType, LeadNote } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface ActivityListParams extends ListParams {
  type?: LeadActivityType | 'all';
  dateFrom?: string;
  dateTo?: string;
}

export type ActivityWithLeadName = LeadActivity & { leadName?: string };

/** Global cross-lead activity feed — mirrors the real system's LiveLeadFeed dashboard widget.
 * Each row is enriched server-side with the lead's name (see server/src/routes/leads.ts). */
export async function listActivities(params: ActivityListParams = {}): Promise<ListResult<ActivityWithLeadName>> {
  return api.get<ListResult<ActivityWithLeadName>>(`/leads/activities${toQueryString(params)}`);
}

export async function getLeadActivities(leadId: string): Promise<LeadActivity[]> {
  return api.get<LeadActivity[]>(`/leads/${leadId}/activities`);
}

export async function logManualActivity(leadId: string, type: LeadActivityType, description: string): Promise<LeadActivity> {
  return api.post<LeadActivity>(`/leads/${leadId}/activities`, { type, description });
}

export async function getLeadNotes(leadId: string): Promise<LeadNote[]> {
  return api.get<LeadNote[]>(`/leads/${leadId}/notes`);
}

export async function addLeadNote(leadId: string, body: string): Promise<LeadNote> {
  return api.post<LeadNote>(`/leads/${leadId}/notes`, { body });
}
