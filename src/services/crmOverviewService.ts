import { api } from './apiClient';

/** GET /reports/crm-overview — every CRM section summarised for the CRM Overview page. */
export interface CrmOverviewFilters {
  from?: string;
  to?: string;
  pipelineId?: string;
  formName?: string;
  /** A user id, or "unassigned". */
  assignedUserId?: string;
  stageId?: string;
}

export interface CrmOverview {
  window: { from: string; to: string; defaulted: boolean };
  kpis: { total: number; newToday: number; newThisWeek: number; open: number; unassigned: number; won: number; wonValue: number; lost: number; conversionRate: number; winRateOfAll: number };
  pipeline: { id: string; name: string; stages: { id: string; name: string; color: string; isWon: boolean; isLost: boolean; leads: number; value: number }[] } | null;
  statuses: { status: string; leads: number }[];
  sources: { source: string; leads: number; won: number }[];
  temperature: { temperature: string; leads: number }[];
  lostReasons: { reason: string; leads: number }[];
  trend: { date: string; leads: number; won: number; calls: number; connected: number }[];
  pending: { under24: number; from24to48: number; over48: number; overdueFollowUps: number; unassigned: number };
  followUps: { overdue: number; dueToday: number; next7Days: number; completed: number; missed: number; overdueList: { id: string; title: string; dueAt: string; leadId: string; leadName: string }[] };
  siteVisits: {
    byStatus: { status: string; visits: number }[];
    total: number;
    today: number;
    upcoming: { id: string; scheduledAt: string; status: string; leadId: string; leadName: string; project: string; host: string | null; visitors: number }[];
  };
  calls: { total: number; outgoing: number; incoming: number; connected: number; missed: number; talkSeconds: number };
  team: { userId: string; name: string; leads: number; open: number; untouched: number; won: number; lost: number; dialled: number; connected: number; talkSeconds: number; visitsDone: number; overdueFollowUps: number }[];
  stageMoves: { stage: string; moves: number }[];
  forms: { meta: { name: string; leads: number; won: number }[]; web: { id: string; name: string; submissions: number }[]; activeWebForms: number };
  engagement: {
    automations: { total: number; enabled: number; runs: Record<string, number> };
    emailSequences: { active: number; enrollments: Record<string, number> };
    whatsapp: { conversations: number; activeInWindow: number; campaigns: Record<string, number>; drips: Record<string, number> };
    sdrAgents: { active: number; total: number };
  };
  period: { from: string; to: string; prevFrom: string; newLeads: number; newLeadsPrev: number; won: number; wonPrev: number; wonValue: number; wonValuePrev: number; callsConnectedPrev: number };
  responseTime: { medianMinutes: number | null; averageMinutes: number | null; within5: number; within60: number; contacted: number; buckets: { label: string; leads: number }[] };
  /** [weekday Mon..Sun][hour 0..23] — leads that arrived then. */
  heatmap: number[][];
  sourceQuality: { source: string; leads: number; contacted: number; qualified: number; won: number; lost: number; wonValue: number; medianResponseMinutes: number | null }[];
  aging: { label: string; leads: number }[];
  value: { openDeals: number; openValue: number; closing30: number; closing30Value: number };
  demand: {
    budgets: { name: string; leads: number }[];
    propertyTypes: { name: string; leads: number }[];
    cities: { name: string; leads: number }[];
    projects: { id: string; name: string; leads: number }[];
    locations: { name: string; leads: number }[];
  };
  followUpOnTime: { completed: number; onTime: number };
  visitToBooking: { visitsDone: number; booked: number };
  recentLeads: { id: string; name: string; source: string; status: string; temperature: string | null; stage: string | null; owner: string | null; createdAt: string }[];
}

export function getCrmOverview(filters: CrmOverviewFilters): Promise<CrmOverview> {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => !!v) as [string, string][]).toString();
  return api.get<CrmOverview>(`/reports/crm-overview${q ? `?${q}` : ''}`);
}
