import type { AuditEntry, Booking, BookingRow, BookingStatus, PaymentMode, PropertyUnit } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface BookingListParams extends ListParams {
  status?: BookingStatus | 'all';
  projectId?: string | 'all';
  partnerId?: string | 'all';
  paymentMode?: PaymentMode | 'all';
  dateFrom?: string;
  dateTo?: string;
}

/**
 * The real `bookings` table has no `project_id` — it is reachable only through the plot.
 * List rows now arrive with the project already joined on, so this reads the resolved value
 * instead of walking a client-side catalogue.
 */
export function projectIdForBooking(booking: BookingRow): string | undefined {
  return booking.projectId;
}

export function projectNameForBooking(booking: BookingRow): string {
  return booking.projectName ?? '—';
}

/**
 * The admin Bookings list is unit-centric, as in the real system: one row per initial
 * booking (`isDeposit=0`). Later installment rows appear on the booking detail page.
 */
export async function listBookings(params: BookingListParams = {}): Promise<ListResult<BookingRow>> {
  return api.get<ListResult<BookingRow>>(`/bookings${toQueryString(params)}`);
}

export async function getBooking(id: string): Promise<BookingRow | undefined> {
  return api.get<BookingRow>(`/bookings/${id}`).catch(() => undefined);
}

export interface BookingDetailBundle {
  booking: BookingRow;
  unit: PropertyUnit | null;
  projectName: string;
  partnerName: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  /** Every booking row against the same plot — the initial one plus its installments. */
  unitBookings: BookingRow[];
  audit: AuditEntry[];
}

/** Everything the Booking Detail page renders, in one request. */
export async function getBookingDetail(id: string): Promise<BookingDetailBundle | undefined> {
  return api.get<BookingDetailBundle>(`/bookings/${id}/detail`).catch(() => undefined);
}

export async function getBookingHistoryForUnit(unitId: string): Promise<BookingRow[]> {
  const { bookings } = await api.get<{ bookings: BookingRow[] }>(`/bookings/units/${unitId}/history`);
  return bookings;
}

export interface RemainingPaymentRow {
  booking: Booking;
  projectName: string;
  unitLabel: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
}

/** "Remaining" is derived: the plot's total minus the sum of its booking rows. */
export async function listRemainingPayments(params: ListParams = {}): Promise<ListResult<RemainingPaymentRow>> {
  return api.get<ListResult<RemainingPaymentRow>>(`/units/reports/remaining-payments${toQueryString(params)}`);
}

/**
 * The real system only ever moves a booking pending -> confirmed. Part-Paid and Cancelled
 * exist for app-created bookings but are not admin transitions, so they are not offered here.
 */
export function allowedNextStatuses(current: BookingStatus): BookingStatus[] {
  return current === 0 ? [1] : [];
}

export async function updateBookingStatus(id: string, next: BookingStatus, note?: string): Promise<BookingRow> {
  return api.post<BookingRow>(`/bookings/${id}/status`, { status: next, note });
}

/** Mirrors the real `propertyverify` flow — verification lives on the PLOT, not the booking row. */
export async function verifyUnitBooking(unitId: string): Promise<void> {
  await api.post(`/bookings/units/${unitId}/verify`);
}

/** Mirrors the real `free_property` action — releases a booked/sold plot back to Available. */
export async function freeUnit(unitId: string): Promise<void> {
  await api.post(`/bookings/units/${unitId}/free`);
}

export interface AddRemainingPaymentInput {
  amount: number;
  paymentMode: PaymentMode;
  chequeImage?: string;
  note?: string;
}

/**
 * Mirrors the real `depositremaninig()` — an admin keys in an installment against an
 * already-booked plot. There is no customer-facing approval step: the admin entering the
 * payment IS the approval. KYC details are copied from the plot's original booking, and the
 * server creates the sibling Investment and commission rows through the same booking engine
 * the partner app uses.
 */
export async function addRemainingPayment(unitId: string, input: AddRemainingPaymentInput): Promise<BookingRow> {
  return api.post<BookingRow>(`/bookings/units/${unitId}/deposit`, input);
}

export interface BookingKycPatch {
  bookingName?: string;
  phone?: string;
  aadhaarNumber?: string;
  aadhaarImage?: string;
  aadhaarBack?: string;
}

/** Mirrors the real `propertyDepositEdit()` — KYC details can be amended after the fact. */
export async function updateBookingKyc(bookingId: string, patch: BookingKycPatch): Promise<BookingRow | undefined> {
  return api.patch<BookingRow>(`/bookings/${bookingId}/kyc`, patch).catch(() => undefined);
}

/**
 * Mirrors the real `propertyDepositdelete()`. The real system has no soft "reject" for a
 * deposit row — deletion plus balance reversal IS the reject mechanism.
 */
export async function deleteBookingWithReversal(bookingId: string): Promise<void> {
  await api.delete(`/bookings/${bookingId}`);
}
