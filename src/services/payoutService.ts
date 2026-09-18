import type { CommissionStatementEntry, PayoutRequest, PayoutStatus } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface PayoutListParams extends ListParams {
  status?: PayoutStatus | 'all';
}

export async function listPayouts(params: PayoutListParams = {}): Promise<ListResult<PayoutRequest>> {
  return api.get<ListResult<PayoutRequest>>(`/payouts${toQueryString(params)}`);
}

export async function getPayout(id: string): Promise<PayoutRequest | undefined> {
  return api.get<PayoutRequest>(`/payouts/${id}`).catch(() => undefined);
}

/** Mirrors the real `payoutConfirm()` — valid only from `pending`. */
export async function confirmPayout(id: string): Promise<PayoutRequest | undefined> {
  return api.post<PayoutRequest>(`/payouts/${id}/confirm`).catch(() => undefined);
}

/**
 * Mirrors the real `payoutRelease()` — valid only from `confirmed`, and BLOCKED when the
 * partner's wallet balance is insufficient. The balance check, the debit and the status
 * change all happen server-side in one transaction, so the error comes back as a message
 * rather than being decided in the browser.
 */
export async function releasePayout(id: string): Promise<{ payout?: PayoutRequest; error?: string }> {
  try {
    return { payout: await api.post<PayoutRequest>(`/payouts/${id}/release`) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not release this payout.' };
  }
}

/** Mirrors the real `payoutCancel()` — only from `pending`, and feedback is required. */
export async function rejectPayout(id: string, note: string): Promise<PayoutRequest | undefined> {
  return api.post<PayoutRequest>(`/payouts/${id}/reject`, { note }).catch(() => undefined);
}

/** An automatic-gateway payout failure — refunds the wallet if it was already debited. */
export async function markPayoutFailed(id: string, error: string): Promise<PayoutRequest | undefined> {
  return api.post<PayoutRequest>(`/payouts/${id}/fail`, { error }).catch(() => undefined);
}

/** Mirrors the real `PayoutRecordController::store()` — a manual payout on a partner's behalf. */
export async function createManualPayout(input: {
  userId: string;
  amount: number;
  status: Extract<PayoutStatus, 'confirmed' | 'released'>;
}): Promise<PayoutRequest> {
  return api.post<PayoutRequest>('/payouts', input);
}

export async function listCommissionStatements(
  params: ListParams & { dateFrom?: string; dateTo?: string } = {}
): Promise<ListResult<CommissionStatementEntry>> {
  return api.get<ListResult<CommissionStatementEntry>>(`/payouts/statements${toQueryString(params)}`);
}
