import { api } from './apiClient';

/** Construction & progress (server/src/routes/admin/construction.ts). All figures are derived server-side. */

export interface Rollup {
  planned: number;
  actual: number;
  daysBehind: number;
  activities: number;
}

/** Derived by the server: pending (nothing signed off), in progress, completed, or blocked (an approved blocker). */
export type ActivityStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface ConstructionProjectSummary extends Rollup {
  blockedActivities: number;
  pendingBlockers: number;
  id: string;
  projectName: string;
  projectLocation: string;
  thumbnail?: string | null;
  pendingReviews: number;
  openIssues: number;
}

export interface ConstructionActivity {
  id: string;
  phase: string;
  block: string;
  name: string;
  plannedStart: string;
  plannedEnd: string;
  weight: number;
  assigneeId: string | null;
  assigneeName: string | null;
  planned: number;
  actual: number;
  daysBehind: number;
  lastApprovedAt: string | null;
  pendingUpdates: number;
  status: ActivityStatus;
  /** Blockers raised from site and not yet decided. */
  pendingBlockers: number;
}

export interface ConstructionProjectBundle {
  project: { id: string; projectName: string; projectLocation: string };
  summary: Rollup;
  blocks: (Rollup & { name: string })[];
  phases: (Rollup & { name: string })[];
  activities: ConstructionActivity[];
}

export interface ProgressPhoto {
  id: string;
  url: string;
  takenAt: string;
  latitude: number;
  longitude: number;
}

export interface ProgressUpdateRow {
  id: string;
  activityId: string;
  activityName: string;
  block: string;
  projectId: string;
  projectName: string;
  authorName: string;
  workDone: string;
  manpower: number;
  percentComplete: number;
  remarks: string | null;
  capturedAt: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  photos: ProgressPhoto[];
}

export type IssueStatus = 'open' | 'in_progress' | 'closed';

export interface SiteIssueRow {
  id: string;
  projectId: string;
  projectName: string;
  activityName: string | null;
  title: string;
  description: string | null;
  photos: string[];
  ownerId: string | null;
  ownerName: string | null;
  raisedByName: string;
  dueDate: string | null;
  status: IssueStatus;
  overdue: boolean;
  closedAt: string | null;
  closeNote: string | null;
  createdAt: string;
}

export interface ActivityInput {
  name: string;
  phase?: string;
  block?: string;
  plannedStart: string;
  plannedEnd: string;
  weight?: number;
  assigneeId?: string | null;
}

export const listConstructionProjects = () => api.get<ConstructionProjectSummary[]>('/construction/projects');
export const getConstructionProject = (id: string) => api.get<ConstructionProjectBundle>(`/construction/projects/${id}`);
export const addActivity = (projectId: string, input: ActivityInput) => api.post(`/construction/projects/${projectId}/activities`, input);
export const updateActivity = (id: string, input: Partial<ActivityInput>) => api.patch(`/construction/activities/${id}`, input);
export const deleteActivity = (id: string) => api.delete(`/construction/activities/${id}`);
export const listProgressUpdates = (status: string, projectId?: string) =>
  api.get<ProgressUpdateRow[]>(`/construction/updates?status=${status}${projectId ? `&projectId=${projectId}` : ''}`);
export const reviewProgressUpdate = (id: string, decision: 'approve' | 'reject', reason?: string) =>
  api.post(`/construction/updates/${id}/review`, { decision, reason });
export const listSiteIssues = (status: string, projectId?: string) =>
  api.get<SiteIssueRow[]>(`/construction/issues?status=${status}${projectId ? `&projectId=${projectId}` : ''}`);
export const createSiteIssue = (input: { projectId: string; title: string; description?: string; ownerId?: string; dueDate?: string; activityId?: string }) =>
  api.post('/construction/issues', input);
export const updateSiteIssue = (id: string, input: { status?: IssueStatus; ownerId?: string | null; dueDate?: string | null; closeNote?: string }) =>
  api.patch(`/construction/issues/${id}`, input);
export const listConstructionPeople = () => api.get<{ id: string; name: string; role: string }[]>('/construction/people');

export interface BuyerConstructionStatus {
  bookingId: string;
  buyerName: string;
  unit: string;
  projectId: string;
  projectName: string;
  summary: Rollup;
  message: string;
  history: { id: string; message: string; createdAt: string }[];
}
export const getBuyerStatus = (bookingId: string) => api.get<BuyerConstructionStatus>(`/construction/bookings/${bookingId}`);
export const sendBuyerStatus = (bookingId: string, message: string) =>
  api.post<{ whatsappUrl: string }>(`/construction/bookings/${bookingId}/send`, { message });

export type BlockerStatus = 'pending' | 'approved' | 'rejected' | 'resolved';

export interface BlockerRow {
  id: string;
  activityId: string;
  activityName: string;
  block: string;
  phase: string;
  projectId: string;
  projectName: string;
  raisedByName: string;
  description: string;
  photos: { url: string; takenAt: string; latitude: number; longitude: number }[];
  status: BlockerStatus;
  rejectionReason: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  createdAt: string;
}

export const listBlockers = (status: string, projectId?: string) =>
  api.get<BlockerRow[]>(`/construction/blockers?status=${status}${projectId ? `&projectId=${projectId}` : ''}`);
export const reviewBlocker = (id: string, decision: 'approve' | 'reject', reason?: string) =>
  api.post(`/construction/blockers/${id}/review`, { decision, reason });
export const resolveBlocker = (id: string, note?: string) => api.post(`/construction/blockers/${id}/resolve`, { note });
