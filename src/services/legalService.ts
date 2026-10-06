import { api } from './apiClient';

/** Legal, compliance & registry (server/src/routes/admin/legal.ts). Statuses arrive already derived. */

export type AgreementStage = 'draft' | 'sent' | 'under_review' | 'signed' | 'executed' | 'stamped';
export const STAGES: AgreementStage[] = ['draft', 'sent', 'under_review', 'signed', 'executed', 'stamped'];
export type RegistryStatus = 'pending' | 'documents_in_preparation' | 'stamp_duty_paid' | 'appointment_booked' | 'registered';
export const REGISTRY_STEPS: RegistryStatus[] = ['pending', 'documents_in_preparation', 'stamp_duty_paid', 'appointment_booked', 'registered'];
/** The kinds of document a buyer's file can hold. */
export const DOC_KINDS = ['kyc', 'booking_form', 'allotment_letter', 'agreement', 'cost_sheet', 'receipt', 'demand_note', 'patta', 'no_dues', 'correspondence', 'other'];
export const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export interface LegalFileRow {
  id: string; bookingId: string; buyerName: string; phone: string; projectId: string; projectName: string; unitId: string; agreedValue: number;
  openedAt: string; closedAt: string | null; agreementStage: AgreementStage | null; registryStatus: RegistryStatus; outstanding: number; overdueMilestones: number; hasPlan: boolean;
}
export interface MilestoneRow {
  id: string; name: string; dueOn: string; amount: number; demandedAt: string | null; paid: number; outstanding: number;
  status: 'upcoming' | 'due' | 'partial' | 'paid' | 'overdue'; daysOverdue: number; penalty: number; totalDue: number;
  payments: { id: string; amount: number; paidOn: string; reference: string | null }[];
}
export interface LegalDoc {
  id: string; kind: string; title: string; url: string; generated: boolean; milestoneId: string | null; createdAt: string;
  version: number; supersededAt: string | null; status: 'pending' | 'verified' | 'rejected'; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string | null;
}
export interface ChecklistItem { kind: string; state: 'missing' | 'pending' | 'verified' | 'rejected'; docId: string | null }
export type LoanStage = 'applied' | 'sanctioned' | 'partly_disbursed' | 'disbursed' | 'rejected';
export interface Loan {
  id: string; bankName: string; status: 'applied' | 'sanctioned' | 'rejected'; stage: LoanStage; appliedOn: string; sanctionedOn: string | null;
  sanctionedAmount: number | null; note: string | null; disbursed: number; remaining: number;
  disbursements: { id: string; amount: number; paidOn: string; reference: string | null }[];
}
export interface LegalFileDetail extends LegalFileRow {
  reference: string; bookingAmount: number; unit: string; documents: LegalDoc[]; checklist: ChecklistItem[]; loan: Loan | null; nextStage: AgreementStage | null;
  stages: { id: string; stage: AgreementStage; at: string; responsible: string; note: string | null }[];
  milestones: MilestoneRow[];
  registry: { status: RegistryStatus; appointmentOn: string | null; registryDate: string | null; subRegistrar: string | null; deedNumber: string | null; deedUrl: string | null; possessionOn: string | null; possessionNote: string | null } | null;
  cases: { id: string; title: string; stage: string; nextHearing: string | null; closed: boolean }[];
}
export type ComplianceStatus = 'valid' | 'expires_90' | 'expires_60' | 'expires_30' | 'lapsed' | 'no_expiry';
export interface ComplianceItem { id: string; source: 'approval' | 'vendor_document'; label: string; subject: string; reference: string | null; validUntil: string | null; status: ComplianceStatus; daysLeft: number | null }
export interface Approval { id: string; projectId: string; projectName: string; kind: string; referenceNo: string; issuedOn: string; validUntil: string | null; documentUrl: string | null; status: ComplianceStatus; daysLeft: number | null }
export interface LandRecord { id: string; projectName: string; khasra: string; area: string | null; conversionOrder: string | null; mutation: 'pending' | 'applied' | 'completed'; titleDocUrl: string | null; notes: string | null }
export interface LegalCase { id: string; title: string; counterparty: string; stage: string; nextHearing: string | null; closed: boolean; notes: string | null; projectName: string | null; buyerName: string | null; hearingPassed: boolean; documents: string[] }
export interface OverdueItem { penalty: number; milestoneId: string; fileId: string; buyerName: string; phone: string; projectName: string; milestone: string; dueOn: string; amount: number; outstanding: number; daysOverdue: number; demandedAt: string | null }
export interface Template { kind: string; title: string; body: string }

export const listLegalFiles = (q: { stage?: string; overdue?: boolean; registry?: string; search?: string }) =>
  api.get<LegalFileRow[]>(`/legal/files?stage=${q.stage ?? 'all'}&search=${encodeURIComponent(q.search ?? '')}${q.overdue ? '&overdue=1' : ''}${q.registry && q.registry !== 'all' ? `&registry=${q.registry}` : ''}`);
export const getLegalFile = (id: string) => api.get<LegalFileDetail>(`/legal/files/${id}`);
export const legalFileForBooking = (bookingId: string) => api.get<{ id: string }>(`/legal/bookings/${bookingId}`).catch(() => undefined);
export const recordStage = (id: string, input: { stage: AgreementStage; at: string; responsible: string; note?: string }) => api.post(`/legal/files/${id}/agreement`, input);
export const setPlan = (id: string, milestones: { name: string; dueOn: string; amount: number }[]) => api.put(`/legal/files/${id}/milestones`, { milestones });
export const recordPayment = (milestoneId: string, input: { amount: number; paidOn: string; reference?: string }) => api.post(`/legal/milestones/${milestoneId}/payments`, input);
export const raiseDemand = (milestoneId: string) => api.post<LegalDoc>(`/legal/milestones/${milestoneId}/demand`, {});
export const generateDoc = (id: string, input: { kind: string; milestoneId?: string; paymentId?: string }) => api.post<LegalDoc>(`/legal/files/${id}/generate`, input);
export const addLegalDoc = (id: string, input: { kind: string; title: string; url: string }) => api.post(`/legal/files/${id}/documents`, input);
export const reviewLegalDoc = (docId: string, input: { decision: 'verify' | 'reject'; note?: string }) => api.post(`/legal/documents/${docId}/review`, input);
export const replaceLegalDoc = (docId: string, input: { url: string; title?: string }) => api.post(`/legal/documents/${docId}/replace`, input);
export const saveLoan = (fileId: string, input: Record<string, unknown>) => api.put<Loan>(`/legal/files/${fileId}/loan`, input);
export const removeLoan = (fileId: string) => api.delete(`/legal/files/${fileId}/loan`);
export const addDisbursement = (fileId: string, input: { amount: number; paidOn: string; reference?: string }) => api.post<Loan>(`/legal/files/${fileId}/loan/disbursements`, input);
export const removeDisbursement = (id: string) => api.delete(`/legal/loan/disbursements/${id}`);
export const deleteLegalDoc = (docId: string) => api.delete(`/legal/documents/${docId}`);
export const updateRegistry = (id: string, input: Record<string, unknown>) => api.patch(`/legal/files/${id}/registry`, input);
export const getCompliance = () => api.get<{ counts: Record<string, number>; items: ComplianceItem[] }>('/legal/compliance');
export const listApprovals = () => api.get<Approval[]>('/legal/approvals');
export const createApproval = (input: Record<string, unknown>) => api.post('/legal/approvals', input);
export const deleteApproval = (id: string) => api.delete(`/legal/approvals/${id}`);
export const listLand = () => api.get<LandRecord[]>('/legal/land');
export const createLand = (input: Record<string, unknown>) => api.post('/legal/land', input);
export const updateLand = (id: string, input: Record<string, unknown>) => api.patch(`/legal/land/${id}`, input);
export const listCases = (status: string) => api.get<LegalCase[]>(`/legal/cases?status=${status}`);
export const createCase = (input: Record<string, unknown>) => api.post('/legal/cases', input);
export const updateCase = (id: string, input: Record<string, unknown>) => api.patch(`/legal/cases/${id}`, input);
export const getOverdue = () => api.get<{ total: number; items: OverdueItem[] }>('/legal/overdue');
export const getTemplates = () => api.get<{ placeholders: string[]; templates: Template[] }>('/legal/templates');
export const saveTemplate = (kind: string, input: { title: string; body: string }) => api.put(`/legal/templates/${kind}`, input);
