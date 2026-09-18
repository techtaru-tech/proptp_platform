import type { BookingRow, PaymentMode } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface PaymentListParams extends ListParams {
  paymentMode?: PaymentMode | 'all';
  projectId?: string | 'all';
  partnerId?: string | 'all';
  dateFrom?: string;
  dateTo?: string;
}

/**
 * The Transactions screen — EVERY booking row including installments, which is what makes
 * it a payment ledger rather than a booking list.
 */
export async function listPayments(params: PaymentListParams = {}): Promise<ListResult<BookingRow>> {
  return api.get<ListResult<BookingRow>>(`/bookings/payments${toQueryString(params)}`);
}

export async function getPayment(id: string): Promise<BookingRow | undefined> {
  return api.get<BookingRow>(`/bookings/${id}`).catch(() => undefined);
}

export function unitLabelForPayment(booking: BookingRow): string {
  return booking.unitLabel ?? booking.propertyId;
}

export function projectNameForPayment(booking: BookingRow): string {
  return booking.projectName ?? '—';
}
