import { api } from './apiClient';

/** Settings > Sales policy (server/src/routes/admin/salesPolicy.ts). */
export interface SalesPolicy {
  penaltyType: 'percent' | 'fixed';
  penaltyRate: number;
  penaltyPeriod: 'day' | 'month';
  penaltyGraceDays: number;
  penaltyCapPercent: number;
  refundDeductionPercent: number;
  refundApprover: 'admin' | 'leader' | 'accounts';
  showTokenStage: boolean;
  updatedAt: string;
}
export const getSalesPolicy = () => api.get<SalesPolicy>('/sales-policy');
export const saveSalesPolicy = (input: Partial<SalesPolicy>) => api.patch<SalesPolicy>('/sales-policy', input);

export interface Cancellation {
  id: string; bookingId: string; reference: string; buyerName: string; phone: string; unit: string; projectName: string; reason: string;
  amountPaid: number; deductionPercent: number; deductionAmount: number; refundAmount: number; status: 'pending' | 'approved' | 'rejected';
  requestedByName: string; requestedAt: string; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  refundedAt: string | null; refundReference: string | null;
}
export interface CancellationState {
  cancelled: boolean; request: Cancellation | null; canDecide: boolean; approver: string;
  preview: { amountPaid: number; deductionPercent: number; deductionAmount: number; refundAmount: number };
}
export const getCancellationForBooking = (bookingId: string) => api.get<CancellationState>(`/booking-cancellations/booking/${bookingId}`);
export const requestCancellation = (bookingId: string, reason: string) => api.post<Cancellation>(`/booking-cancellations/booking/${bookingId}`, { reason });
export const listCancellations = (status: string) => api.get<{ canDecide: boolean; approver: string; items: Cancellation[] }>(`/booking-cancellations?status=${status}`);
export const decideCancellation = (id: string, decision: 'approve' | 'reject', note?: string) => api.post<Cancellation>(`/booking-cancellations/${id}/decide`, { decision, note });
export const markRefunded = (id: string, reference?: string) => api.post<Cancellation>(`/booking-cancellations/${id}/refunded`, { reference });
export const APPROVER_LABEL: Record<string, string> = { admin: 'a full-access administrator', leader: 'a Leader', accounts: 'someone with Payments access' };
