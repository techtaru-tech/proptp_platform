import type { InvestmentBucket, InvestmentRow } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface InvestmentListParams extends ListParams {
  bucket?: InvestmentBucket | 'all';
  projectId?: string | 'all';
  userId?: string | 'all';
}

/**
 * The four buckets come from the real `InvestmentController::investments()` query logic —
 * `isActive` plus the linked plot's `bookingStatus`/`isVerified` plus `returnDate`. None of
 * them is a stored field, so the server computes the bucket and returns it on the row.
 */
export function investmentBucket(investment: InvestmentRow): InvestmentBucket {
  return investment.bucket;
}

export function projectNameForInvestment(investment: InvestmentRow): string {
  return investment.projectName ?? '—';
}

export function unitLabelForInvestment(investment: InvestmentRow): string {
  return investment.unitLabel ?? investment.propertyId;
}

export async function listInvestments(params: InvestmentListParams = {}): Promise<ListResult<InvestmentRow>> {
  return api.get<ListResult<InvestmentRow>>(`/investments${toQueryString(params)}`);
}

export async function getInvestment(id: string): Promise<InvestmentRow | undefined> {
  return api.get<InvestmentRow>(`/investments/${id}`).catch(() => undefined);
}

export async function getInvestmentsForProperty(propertyId: string): Promise<InvestmentRow[]> {
  const { investments } = await api.get<{ investments: InvestmentRow[] }>(`/investments/property/${propertyId}`);
  return investments;
}

/** Mirrors the real `investDeactive`/`activeMultiple` — deactivation always needs a reason. */
export async function setInvestmentActive(id: string, isActive: 1 | 0, reason?: string): Promise<InvestmentRow | undefined> {
  return api.post<InvestmentRow>(`/investments/${id}/active`, { isActive, reason }).catch(() => undefined);
}

/** Mirrors the real `investPaymentSingleUser` — records that a profit return was disbursed. */
export async function triggerProfitReturn(id: string): Promise<InvestmentRow | undefined> {
  return api.post<InvestmentRow>(`/investments/${id}/return`).catch(() => undefined);
}

/** Mirrors the real `investPaymentAllUser` — every running investment on one plot. */
export async function triggerProfitReturnForProperty(propertyId: string): Promise<number> {
  const { updated } = await api.post<{ updated: number }>(`/investments/property/${propertyId}/return`);
  return updated;
}
