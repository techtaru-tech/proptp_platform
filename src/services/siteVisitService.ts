import { api } from './apiClient';
import type { LeadTemperature } from '../types';

/** Site visits (server/src/routes/siteVisits.ts). Moving the lead's stage and raising reminders happen server-side. */

export type VisitStatus = 'scheduled' | 'confirmed' | 'done' | 'cancelled' | 'no_show';
export type VisitOutcome = 'ready_to_book' | 'interested' | 'thinking' | 'not_interested';
export interface SiteVisit {
  id: string; leadId: string; leadName: string; leadPhone: string; leadStatus: string; projectId: string; projectName: string;
  hostId: string | null; hostName: string | null; scheduledAt: string; status: VisitStatus; visitorCount: number;
  confirmedAt: string | null; completedAt: string | null; outcome: VisitOutcome | null; interest: LeadTemperature | null;
  feedback: string | null; nextAction: string | null; cancelReason: string | null; needsOutcome: boolean;
}
export interface VisitSummary { today: number; upcoming: number; needsOutcome: number; doneThisMonth: number }

export const OUTCOME_LABEL: Record<VisitOutcome, string> = {
  ready_to_book: 'Ready to book', interested: 'Interested', thinking: 'Wants to think', not_interested: 'Not interested',
};

export const listSiteVisits = (q: { view?: string; leadId?: string; hostId?: string; projectId?: string } = {}) =>
  api.get<SiteVisit[]>(`/site-visits?view=${q.view ?? 'upcoming'}${q.leadId ? `&leadId=${q.leadId}` : ''}${q.hostId ? `&hostId=${q.hostId}` : ''}${q.projectId ? `&projectId=${q.projectId}` : ''}`);
export const getVisitSummary = () => api.get<VisitSummary>('/site-visits/summary');
export const scheduleVisit = (input: { leadId: string; projectId: string; scheduledAt: string; visitorCount: number; hostId?: string }) => api.post<SiteVisit>('/site-visits', input);
export const confirmVisit = (id: string) => api.post<SiteVisit>(`/site-visits/${id}/confirm`);
export const rescheduleVisit = (id: string, scheduledAt: string) => api.post<SiteVisit>(`/site-visits/${id}/reschedule`, { scheduledAt });
export const cancelVisit = (id: string, reason: string) => api.post<SiteVisit>(`/site-visits/${id}/cancel`, { reason });
export const markNoShow = (id: string) => api.post<SiteVisit>(`/site-visits/${id}/no-show`);
export const completeVisit = (id: string, input: { outcome: VisitOutcome; interest?: LeadTemperature; feedback?: string; nextAction?: string; visitorCount?: number }) =>
  api.post<SiteVisit>(`/site-visits/${id}/complete`, input);

// Reports
export interface VisitGroupRow { name: string; scheduled: number; done: number; noShow: number; cancelled: number; booked: number; conversionRate: number }
export interface VisitReport { total: VisitGroupRow; byProject: VisitGroupRow[]; byExecutive: VisitGroupRow[]; bySource: VisitGroupRow[] }
export const getVisitReport = (from?: string, to?: string) => api.get<VisitReport>(`/reports/site-visits?${from ? `from=${from}&` : ''}${to ? `to=${to}` : ''}`);

export interface TelecallerRow {
  userId: string; name: string; role: string; onLeave: boolean; calls: number; connected: number; connectedRate: number; talkMinutes: number;
  newLeads: number; followUpsDone: number; followUpsOverdue: number; visitsScheduled: number; visitsDone: number; bookings: number; zeroActivity: boolean;
}
export interface TelecallerReport {
  from: string; to: string;
  totals: { calls: number; connected: number; followUpsDone: number; visitsScheduled: number; bookings: number; newLeads: number };
  rows: TelecallerRow[]; zeroActivity: { userId: string; name: string }[]; onLeave: { userId: string; name: string }[];
}
export const getTelecallerReport = (from?: string, to?: string) => api.get<TelecallerReport>(`/reports/telecallers?${from ? `from=${from}&` : ''}${to ? `to=${to}` : ''}`);
