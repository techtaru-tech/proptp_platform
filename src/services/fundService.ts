import type { FundRequestRow, FundStatus } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface FundListParams extends ListParams {
  status?: FundStatus | 'all';
}

export async function listFunds(params: FundListParams = {}): Promise<ListResult<FundRequestRow>> {
  return api.get<ListResult<FundRequestRow>>(`/funds${toQueryString(params)}`);
}

export async function getFund(id: string): Promise<FundRequestRow | undefined> {
  return api.get<FundRequestRow>(`/funds/${id}`).catch(() => undefined);
}

/**
 * Mirrors the real `PaymentLogController::action()` approve path — credits the partner's
 * wallet balance. The status change and the balance change are one server-side
 * transaction, so an approved deposit can never exist without the matching credit.
 */
export async function approveFund(id: string, feedback?: string): Promise<FundRequestRow | undefined> {
  return api.post<FundRequestRow>(`/funds/${id}/approve`, { feedback }).catch(() => undefined);
}

/** Mirrors the real reject path — no balance change, and feedback is mandatory. */
export async function rejectFund(id: string, feedback: string): Promise<FundRequestRow | undefined> {
  return api.post<FundRequestRow>(`/funds/${id}/reject`, { feedback }).catch(() => undefined);
}
