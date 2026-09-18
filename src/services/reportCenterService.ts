import { userDisplayName } from '../data/referenceData';
import { LEAD_SOURCE_META } from '../constants/leadSources';
import { api, toQueryString } from './apiClient';

// ---------------------------------------------------------------------------
// CRM > Report Center — a dedicated multi-report section (server/src/routes/reports.ts,
// appended below the existing dashboard endpoints). Every report here shares one filter
// bar (date range + optional source text), so every function takes the same param shape.
// ---------------------------------------------------------------------------

export interface ReportFilterParams {
  from?: string;
  to?: string;
  source?: string;
  /** Same index signature `ListParams` carries, so `toQueryString` accepts this shape directly. */
  [key: string]: unknown;
}

export type LeadVolumeGroupBy = 'day' | 'week' | 'month';

export interface LeadVolumePoint {
  period: string;
  count: number;
}

export async function getLeadVolume(
  params: ReportFilterParams & { groupBy: LeadVolumeGroupBy }
): Promise<{ total: number; points: LeadVolumePoint[] }> {
  return api.get(`/reports/lead-volume${toQueryString(params)}`);
}

export interface SourcePerformanceRow {
  source: string;
  label: string;
  total: number;
  won: number;
  lost: number;
  conversionRate: number;
  wonValue: number;
}

export async function getSourcePerformanceReport(params: ReportFilterParams): Promise<SourcePerformanceRow[]> {
  const rows = await api.get<Omit<SourcePerformanceRow, 'label'>[]>(`/reports/source-performance-report${toQueryString(params)}`);
  return rows.map((r) => ({ ...r, label: LEAD_SOURCE_META[r.source]?.label ?? r.source }));
}

export interface SourceAttributionResult {
  total: number;
  bySource: { utmSource: string; label: string; total: number }[];
  byCampaign: { campaign: string; total: number }[];
}

export async function getSourceAttribution(params: Pick<ReportFilterParams, 'from' | 'to'>): Promise<SourceAttributionResult> {
  const result = await api.get<Omit<SourceAttributionResult, 'bySource'> & { bySource: { utmSource: string; total: number }[] }>(
    `/reports/source-attribution${toQueryString(params)}`
  );
  return {
    ...result,
    bySource: result.bySource.map((r) => ({ ...r, label: LEAD_SOURCE_META[r.utmSource]?.label ?? r.utmSource })),
  };
}

export interface FunnelStage {
  stageId: string;
  stage: string;
  color: string;
  count: number;
  reached: number;
  conversionFromPrevious: number;
}

export async function getPipelineFunnel(
  params: Pick<ReportFilterParams, 'from' | 'to'> & { pipelineId?: string }
): Promise<{ pipelineId: string | null; pipelineName?: string; stages: FunnelStage[] }> {
  return api.get(`/reports/pipeline-funnel${toQueryString(params)}`);
}

export interface BottleneckStage {
  stageId: string;
  stage: string;
  color: string;
  leadsInStage: number;
  avgDaysInStage: number;
}

export async function getPipelineBottlenecks(params: {
  pipelineId?: string;
}): Promise<{ pipelineId: string | null; pipelineName?: string; stages: BottleneckStage[] }> {
  return api.get(`/reports/pipeline-bottlenecks${toQueryString(params)}`);
}

export interface AgentPerformanceRow {
  userId: string;
  name: string;
  total: number;
  won: number;
  lost: number;
  conversionRate: number;
  wonValue: number;
}

/** One lead behind an agent's row on the performance report. */
export interface AgentLeadRow {
  id: string;
  name: string;
  phone: string;
  status: string;
  priority: string;
  source: string;
  stageName: string | null;
  pipelineName: string | null;
  dealValue: number | null;
  wonValue: number | null;
  createdAt: string;
}

export interface AgentLeadBreakdown {
  total: number;
  /** Count per lead status, for the summary strip above the list. */
  byStatus: Record<string, number>;
  leads: AgentLeadRow[];
}

/** The leads behind one row. Same date window as the report, so the counts agree. */
export async function getAgentLeads(
  userId: string,
  params: Pick<ReportFilterParams, 'from' | 'to'>
): Promise<AgentLeadBreakdown> {
  return api.get<AgentLeadBreakdown>(`/reports/agent-performance-report/${userId}/leads${toQueryString(params)}`);
}

export async function getAgentPerformanceReport(params: Pick<ReportFilterParams, 'from' | 'to'>): Promise<AgentPerformanceRow[]> {
  const rows = await api.get<Omit<AgentPerformanceRow, 'name'>[]>(`/reports/agent-performance-report${toQueryString(params)}`);
  return rows.map((r) => ({ ...r, name: userDisplayName(r.userId) }));
}

export interface RevenueByRepRow {
  userId: string | null;
  name: string;
  deals: number;
  revenue: number;
}

export async function getRevenueByRep(params: Pick<ReportFilterParams, 'from' | 'to'>): Promise<RevenueByRepRow[]> {
  const rows = await api.get<Omit<RevenueByRepRow, 'name'>[]>(`/reports/revenue-by-rep${toQueryString(params)}`);
  return rows.map((r) => ({ ...r, name: r.userId ? userDisplayName(r.userId) : 'Unassigned' }));
}

export interface AutomationStatsRow {
  automationId: string;
  name: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  successRate: number;
}

export async function getAutomationStats(params: Pick<ReportFilterParams, 'from' | 'to'>): Promise<AutomationStatsRow[]> {
  return api.get(`/reports/automation-stats${toQueryString(params)}`);
}

export interface ResponseTimeResult {
  totalLeads: number;
  contactedCount: number;
  notContactedCount: number;
  avgResponseMinutes: number;
  bySource: { source: string; label: string; count: number; avgResponseMinutes: number }[];
}

export async function getResponseTimeReport(params: ReportFilterParams): Promise<ResponseTimeResult> {
  const result = await api.get<Omit<ResponseTimeResult, 'bySource'> & { bySource: { source: string; count: number; avgResponseMinutes: number }[] }>(
    `/reports/response-time${toQueryString(params)}`
  );
  return { ...result, bySource: result.bySource.map((r) => ({ ...r, label: LEAD_SOURCE_META[r.source]?.label ?? r.source })) };
}

export interface FormAnalyticsSummary {
  totalForms: number;
  activeForms: number;
  totalSubmissionsInRange: number;
  totalLeadsInRange: number;
  forms: { id: string; name: string; slug: string; isActive: boolean; allTimeSubmissions: number; submissionsInRange: number; leadsInRange: number }[];
}

export async function getFormAnalyticsSummary(params: Pick<ReportFilterParams, 'from' | 'to'>): Promise<FormAnalyticsSummary> {
  return api.get(`/reports/form-analytics-summary${toQueryString(params)}`);
}

/** Formats minutes as e.g. "2h 15m" or "45m" — every response-time number goes through this. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
