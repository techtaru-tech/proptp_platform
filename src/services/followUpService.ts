import type { FollowUpStatus, LeadFollowUp, LeadPriority } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface FollowUpListParams extends ListParams {
  status?: FollowUpStatus | 'all';
  priority?: LeadPriority | 'all';
  assignedUserId?: string | 'all';
  bucket?: 'overdue' | 'today' | 'upcoming' | 'all';
}

/** The global (cross-lead) list endpoint enriches each row with the lead's name server-side,
 * since a bare `leadId` alone isn't enough to render "Follow-up — for <name>" here. */
export type FollowUpWithLeadName = LeadFollowUp & { leadName?: string };

export async function listFollowUps(params: FollowUpListParams = {}): Promise<ListResult<FollowUpWithLeadName>> {
  return api.get<ListResult<FollowUpWithLeadName>>(`/followups${toQueryString(params)}`);
}

export async function getFollowUpsForLead(leadId: string): Promise<LeadFollowUp[]> {
  return api.get<LeadFollowUp[]>(`/leads/${leadId}/followups`);
}

export async function getFollowUp(id: string): Promise<LeadFollowUp | undefined> {
  return api.get<LeadFollowUp>(`/followups/${id}`).catch(() => undefined);
}

export async function createFollowUp(
  data: Omit<LeadFollowUp, 'id' | 'createdAt' | 'completed' | 'status'> & {
    status?: FollowUpStatus;
    /** Minutes before the due time to send the reminder. 0 means at the due time itself. */
    remindBeforeMinutes?: number;
  }
): Promise<LeadFollowUp> {
  return api.post<LeadFollowUp>('/followups', data);
}

export async function updateFollowUpStatus(id: string, status: FollowUpStatus): Promise<LeadFollowUp | undefined> {
  return api.post<LeadFollowUp>(`/followups/${id}/status`, { status }).catch(() => undefined);
}

export async function rescheduleFollowUp(id: string, newDueAt: string): Promise<LeadFollowUp | undefined> {
  return api.post<LeadFollowUp>(`/followups/${id}/reschedule`, { dueAt: newDueAt }).catch(() => undefined);
}

export interface FollowUpCalendarParams {
  /** Inclusive ISO bounds of the visible grid — not just the month, so leading/trailing days fill in too. */
  from: string;
  to: string;
  status?: FollowUpStatus | 'all';
  priority?: LeadPriority | 'all';
  assignedUserId?: string | 'all';
  /** Same index signature `ListParams` carries, so `toQueryString` accepts this shape. */
  [key: string]: unknown;
}

/** Un-paginated: the calendar renders a whole window at once, so a page of rows would leave days blank. */
export async function listFollowUpsInRange(params: FollowUpCalendarParams): Promise<FollowUpWithLeadName[]> {
  return api.get<FollowUpWithLeadName[]>(`/followups/calendar${toQueryString(params)}`);
}
