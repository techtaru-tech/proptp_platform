import { findUserById } from '../data/referenceData';
import { LEAD_SOURCE_META } from '../constants/leadSources';
import { api, toQueryString } from './apiClient';

// ---------------------------------------------------------------------------
// Real backend-backed report/dashboard service (server/src/routes/reports.ts) — every
// number here is a live aggregate over the real Lead/LeadFollowUp tables, so it reflects
// Meta-sourced leads alongside manually created ones. Partner/user *names* are still
// resolved from the mock partner layer (see findUserById) since Users/Teams haven't been
// migrated off it — only the id itself comes from the backend.
// ---------------------------------------------------------------------------

export interface LeadDashboardStats {
  totalLeads: number;
  newToday: number;
  newThisWeek: number;
  newThisMonth: number;
  conversionRate: number;
  activeInPipeline: number;
  wonDeals: number;
  wonValue: number;
}

export async function getDashboardStats(): Promise<LeadDashboardStats> {
  return api.get<LeadDashboardStats>('/reports/dashboard-stats');
}

export async function getLeadCreationTrend(days = 14): Promise<{ date: string; leads: number }[]> {
  return api.get(`/reports/lead-trend${toQueryString({ days })}`);
}

export async function getStatusBreakdown(): Promise<{ name: string; value: number }[]> {
  return api.get('/reports/status-breakdown');
}

export async function getSourcePerformance() {
  const rows = await api.get<{ source: string; total: number; won: number; conversionRate: number }[]>('/reports/source-performance');
  return rows.map((r) => ({ ...r, label: LEAD_SOURCE_META[r.source]?.label ?? r.source }));
}

export async function getStageDistribution(pipelineId?: string): Promise<{ name: string; value: number; color: string }[]> {
  return api.get(`/reports/stage-distribution${toQueryString({ pipelineId })}`);
}

export async function getAssigneePerformance() {
  const rows = await api.get<{ userId: string; total: number; won: number; lost: number; conversionRate: number }[]>(
    '/reports/assignee-performance'
  );
  return rows.map((r) => ({ ...r, name: findUserById(r.userId)?.name ?? 'Unknown' }));
}

export async function getFollowUpPerformance() {
  return api.get<{ total: number; completed: number; missed: number; pending: number; rescheduled: number; completionRate: number }>(
    '/reports/followup-performance'
  );
}

export async function getLeadReportRows(dateFrom?: string, dateTo?: string) {
  const rows = await api.get<
    { id: string; name: string; source: string; status: string; priority: string; assignedUserId?: string; assignedTo?: string; dealValue: number; createdAt: string }[]
  >(`/reports/lead-rows${toQueryString({ dateFrom, dateTo })}`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    source: LEAD_SOURCE_META[r.source]?.label ?? r.source,
    status: r.status,
    priority: r.priority,
    assignedTo: r.assignedUserId ? (findUserById(r.assignedUserId)?.name ?? '—') : (r.assignedTo ?? 'Unassigned'),
    dealValue: r.dealValue,
    createdAt: r.createdAt,
  }));
}
