import type { AttendanceRecord, BookingRow, SupportTicket } from '../types';
import { api } from './apiClient';

export type DashboardRange = 'today' | 'week' | 'month' | 'custom';

export interface DashboardSnapshot {
  properties: { total: number; active: number; inactive: number };
  units: { total: number; available: number; booked: number; soldOut: number };
  bookings: { today: number; pending: number; confirmed: number };
  payments: { collected: number; remaining: number; bankTransfer: number; cash: number; cheque: number; other: number; online: number };
  partners: { agents: number; employees: number; leaders: number; active: number; inactive: number };
  teams: { employeeNetwork: number; leaderNetwork: number; teamMembers: number };
  attendance: { present: number; checkedIn: number; checkedOut: number; late: number; absent: number; pendingSync: number };
  support: { open: number; pendingReplies: number; resolved: number };
  /** The last 24 org-calendar months, oldest first; `lastYear` is the same month a year earlier. */
  collectionTrend: { key: string; month: string; year: number; collection: number; bookings: number; lastYear: number }[];
  /** `…LastMonthToDate` covers the same days of last month as have passed in this one. */
  monthCompare: {
    collectedThisMonth: number; collectedLastMonth: number; collectedLastMonthToDate: number;
    confirmedThisMonth: number; confirmedLastMonth: number; confirmedLastMonthToDate: number;
  };
  bookingTrend: { date: string; bookings: number }[];
  paymentOverview: { name: string; value: number }[];
  inventoryBreakdown: { name: string; value: number }[];
  userDistribution: { name: string; value: number }[];
  attendanceOverview: { name: string; value: number }[];
  bookingStatusBreakdown: { name: string; value: number }[];
}

/**
 * Every tile and chart on the dashboard, computed server-side with SQL aggregates rather
 * than by pulling rows into the browser and counting them.
 */
export async function getDashboardSnapshot(_range: DashboardRange = 'month'): Promise<DashboardSnapshot> {
  return api.get<DashboardSnapshot>('/dashboard/snapshot');
}

interface RecentBundle {
  bookings: BookingRow[];
  payments: BookingRow[];
  attendance: AttendanceRecord[];
  tickets: SupportTicket[];
}

/**
 * The four "recent activity" panels share one request, so the dashboard makes two calls in
 * total instead of five. Each accessor below reads its slice from that single fetch.
 */
let recentCache: { limit: number; promise: Promise<RecentBundle> } | null = null;

function recent(limit: number): Promise<RecentBundle> {
  if (!recentCache || recentCache.limit !== limit) {
    recentCache = { limit, promise: api.get<RecentBundle>(`/dashboard/recent?limit=${limit}`) };
  }
  return recentCache.promise;
}

/** Drops the shared cache so a dashboard refresh re-fetches instead of replaying the last load. */
export function invalidateRecent(): void {
  recentCache = null;
}

export async function getRecentBookings(limit = 6): Promise<BookingRow[]> {
  return (await recent(limit)).bookings;
}

export async function getRecentPayments(limit = 6): Promise<BookingRow[]> {
  return (await recent(limit)).payments;
}

export async function getTodayAttendanceSample(limit = 6): Promise<AttendanceRecord[]> {
  return (await recent(limit)).attendance;
}

export async function getRecentTickets(limit = 6): Promise<SupportTicket[]> {
  return (await recent(limit)).tickets;
}
