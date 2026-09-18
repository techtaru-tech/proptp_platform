import { api } from './apiClient';

/**
 * The eight operational reports under /reports. Each endpoint returns a flat row array,
 * which the screens render as a table and export to CSV from exactly that shape — so adding
 * a column server-side needs no frontend change.
 *
 * The CRM's own report centre is separate and lives in reportCenterService.ts.
 */

async function rows<T>(path: string): Promise<T[]> {
  const { rows: result } = await api.get<{ rows: T[] }>(`/ops-reports/${path}`);
  return result;
}

export interface PropertyReportRow {
  id: string; name: string; location: string; status: string;
  totalUnits: number; available: number; booked: number; sold: number;
  bookingsCount: number; startingPrice: number;
}
export const getPropertyReport = () => rows<PropertyReportRow>('properties');

export interface BookingReportRow {
  id: string; date: string; project: string; plot: string; customer: string;
  partner: string; status: string; amount: number; commission: number;
}
export const getBookingReport = () => rows<BookingReportRow>('bookings');

export interface PaymentReportRow {
  id: string; date: string; project: string; plot: string; paymentMode: string; amount: number; status: string;
}
export const getPaymentReport = () => rows<PaymentReportRow>('payments');

export interface PartnerReportRow {
  id: string; name: string; role: string; partnerCode: string; status: string;
  team: string; bookings: number; walletBalance: number;
}
export const getPartnerReport = () => rows<PartnerReportRow>('partners');

export interface TeamReportRow { id: string; name: string; leader: string; members: number }
export const getTeamReport = () => rows<TeamReportRow>('teams');

export interface AttendanceReportRow {
  id: string; user: string; date: string; status: string; hours: number; late: boolean; geoResult: string;
}
export const getAttendanceReport = () => rows<AttendanceReportRow>('attendance');

export interface SupportReportRow {
  id: string; subject: string; user: string; status: string; createdAt: string; messageCount: number;
}
export const getSupportReport = () => rows<SupportReportRow>('support');

export interface PayoutReportRow { id: string; user: string; requestDate: string; amount: number; status: string }
export const getPayoutReport = () => rows<PayoutReportRow>('payouts');

/** Client-side CSV export of whatever rows are on screen. */
export function exportToCsv<T extends object>(filename: string, data: T[]) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map((row) => headers.map((h) => JSON.stringify((row as Record<string, unknown>)[h] ?? '')).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
