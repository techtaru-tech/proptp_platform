import { api } from './apiClient';

/** Channel partners: the staff side (/api/channel-partners) and the partner's own portal (/api/partner-portal). */

export interface BrokerageLine {
  id: string; title: string; reference: string | null; buyerName: string | null; unit: string | null; projectName: string | null;
  gross: number; tds: number; net: number; percent: number; state: 'payable' | 'waiting' | 'paid' | 'cancelled'; creditedOn: string;
}
export interface Brokerage {
  lines: BrokerageLine[]; eligibleAt: 'booking' | 'agreement' | 'registry'; tdsPercent: number;
  totals: { payableNet: number; waitingNet: number; paidNet: number; tdsDeducted: number };
}
export interface PartnerLead { id: string; name: string; phone: string; status: string; stage: string | null; projectName: string | null; registeredAt: string; protectedUntil: string; protected: boolean }
export interface PartnerBooking { id: string; reference: string; buyerName: string; amount: number; status: string; unit: string; projectName: string; bookedAt?: string }
export interface PartnerDispute { id: string; title: string; details: string; status: 'open' | 'resolved'; resolution: string | null; raisedByName: string; resolvedByName: string | null; createdAt: string; resolvedAt: string | null; bookingId: string | null }

export interface PartnerRow {
  id: string; name: string; phone: string; email: string | null; partnerCode: string; status: string; kycStatus: number; authorisedProjectIds: string[];
  createdAt: string; hasLogin: boolean; leads: number; bookings: number; openDisputes: number;
}
export interface PartnerDetail extends Omit<PartnerRow, 'leads' | 'bookings' | 'openDisputes'> {
  city: string | null; aadhaarNumber: string | null; panNumber: string | null; projects: { id: string; projectName: string }[];
  leads: PartnerLead[]; bookings: PartnerBooking[]; disputes: PartnerDispute[]; brokerage: Brokerage;
}
export const KYC_LABEL: Record<number, string> = { 0: 'Pending', 1: 'Verified', 2: 'Rejected' };

export const listPartners = () => api.get<PartnerRow[]>('/channel-partners');
export const getPartner = (id: string) => api.get<PartnerDetail>(`/channel-partners/${id}`);
export const setPartnerProjects = (id: string, projectIds: string[]) => api.patch(`/channel-partners/${id}/projects`, { projectIds });
export const setPartnerLogin = (id: string, input: { email: string; password: string }) => api.put(`/channel-partners/${id}/login`, input);
export const removePartnerLogin = (id: string) => api.delete(`/channel-partners/${id}/login`);
export const logDispute = (id: string, input: { title: string; details?: string }) => api.post(`/channel-partners/${id}/disputes`, input);
export const resolveDispute = (disputeId: string, resolution: string) => api.patch(`/channel-partners/disputes/${disputeId}`, { resolution });

export interface PortalMe {
  name: string; partnerCode: string; kycStatus: number; restricted: boolean; projects: { id: string; projectName: string }[];
  leadProtectionDays: number; leads: number; bookings: number; totals: Brokerage['totals'];
}
export const portal = {
  me: () => api.get<PortalMe>('/partner-portal/me'),
  leads: () => api.get<PartnerLead[]>('/partner-portal/leads'),
  registerLead: (input: { name: string; phone: string; projectId?: string; note?: string }) => api.post<{ id: string; protectedUntil: string }>('/partner-portal/leads', input),
  bookings: () => api.get<PartnerBooking[]>('/partner-portal/bookings'),
  brokerage: () => api.get<Brokerage>('/partner-portal/brokerage'),
  disputes: () => api.get<PartnerDispute[]>('/partner-portal/disputes'),
  raiseDispute: (input: { title: string; details?: string; bookingId?: string }) => api.post('/partner-portal/disputes', input),
};

export interface ManagementView {
  pipeline?: { stageId: string; name: string; isWon: boolean; isLost: boolean; leads: number; value: number; to: string }[];
  expectedBusiness?: { leads: number; value: number; to: string };
  sources?: { source: string; leads: number; to: string }[];
  bookings?: { pending: { count: number; amount: number; to: string }; confirmed: { count: number; amount: number; to: string } };
  collections?: { outstanding: number; overdue: number; overdueCount: number; to: string };
  postSales?: {
    openFiles: number; loansAwaitingBank: number;
    agreementNotStarted: { count: number; to: string }; registryInProgress: { count: number; to: string };
    possessionPending: { count: number; to: string }; possessed: { count: number; to: string };
  };
  partners?: { id: string; name: string; bookings: number; value: number; to: string }[];
}
export const getManagementView = () => api.get<ManagementView>('/dashboard/management');
