import type { AttendancePolicy, AttendanceRecord, AttendanceStatus, GeoFenceResult, RoleId } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface AttendanceListParams extends ListParams {
  status?: AttendanceStatus | 'all';
  role?: RoleId | 'all';
  locationStatus?: GeoFenceResult | 'all';
  syncStatus?: 'synced' | 'pending' | 'failed' | 'all';
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
}

export async function listAttendanceToday(): Promise<AttendanceRecord[]> {
  const { records } = await api.get<{ records: AttendanceRecord[] }>('/attendance/today');
  return records;
}

export async function listAttendance(params: AttendanceListParams = {}): Promise<ListResult<AttendanceRecord>> {
  return api.get<ListResult<AttendanceRecord>>(`/attendance${toQueryString(params)}`);
}

export async function getAttendanceRecord(id: string): Promise<AttendanceRecord | undefined> {
  return api.get<AttendanceRecord>(`/attendance/${id}`).catch(() => undefined);
}

export async function listPendingSync(): Promise<AttendanceRecord[]> {
  const { records } = await api.get<{ records: AttendanceRecord[] }>('/attendance/pending-sync');
  return records;
}

export async function listFailedRecords(): Promise<AttendanceRecord[]> {
  const { records } = await api.get<{ records: AttendanceRecord[] }>('/attendance/failed');
  return records;
}

export async function listCorrections(): Promise<AttendanceRecord[]> {
  const { records } = await api.get<{ records: AttendanceRecord[] }>('/attendance/corrections');
  return records;
}

export async function resolveCorrection(id: string, decision: 'approved' | 'rejected'): Promise<AttendanceRecord | undefined> {
  return api.post<AttendanceRecord>(`/attendance/${id}/correction`, { decision }).catch(() => undefined);
}

/**
 * Enters or fixes a day's marks on a partner's behalf. Goes through the same lateness and
 * working-hours rules as a mark pushed from the app, and upserts on (user, day) — so it can
 * be called twice for the same day without creating a second row.
 */
export async function recordAttendanceManually(input: {
  userId: string;
  date: string;
  checkInAt?: string;
  checkOutAt?: string;
  checkInLocation?: string;
  checkOutLocation?: string;
}): Promise<AttendanceRecord> {
  return api.post<AttendanceRecord>('/attendance/manual', input);
}

export async function getAttendancePolicy(): Promise<AttendancePolicy> {
  return api.get<AttendancePolicy>('/attendance/policy');
}

/**
 * Saving the policy also moves the geofence the partner app reads from
 * /attendance/assigned-location — they are two views of the same office.
 */
export async function updateAttendancePolicy(next: Partial<AttendancePolicy>): Promise<AttendancePolicy> {
  return api.patch<AttendancePolicy>('/attendance/policy', next);
}
