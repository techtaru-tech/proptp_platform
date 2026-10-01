import { RoleId, ROLE_NAME_BY_ID, type AccountRole, type AccountStatus, type Agent, type Employee, type Leader, type PartnerUser, type TeamLeader } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';
import type { AttendanceRecord, BookingRow, PayoutRequest } from '../types';
import { loadReferenceData } from '../data/referenceData';

export interface UserListParams extends ListParams {
  status?: AccountStatus | 'all';
}

export async function listAgents(params: UserListParams = {}): Promise<ListResult<Agent>> {
  return api.get<ListResult<Agent>>(`/users/agents${toQueryString(params)}`);
}

export async function listEmployees(params: UserListParams = {}): Promise<ListResult<Employee>> {
  return api.get<ListResult<Employee>>(`/users/employees${toQueryString(params)}`);
}

export async function listTeamLeaders(params: UserListParams = {}): Promise<ListResult<TeamLeader>> {
  return api.get<ListResult<TeamLeader>>(`/users/team-leaders${toQueryString(params)}`);
}

/**
 * Moves somebody in the reporting tree — a new manager, a new role, or both. Checked server-side
 * as one placement, so a promotion cannot leave somebody under the wrong kind of manager.
 */
export async function updateUserHierarchy(id: string, input: { role?: AccountRole; managerId?: string | null }): Promise<PartnerUser> {
  const updated = await api.patch<PartnerUser>(`/users/${id}/hierarchy`, input);
  await loadReferenceData(true).catch(() => {});
  return updated;
}

export async function listLeaders(params: UserListParams = {}): Promise<ListResult<Leader>> {
  return api.get<ListResult<Leader>>(`/users/leaders${toQueryString(params)}`);
}

export async function getUser(id: string): Promise<PartnerUser | undefined> {
  return api.get<PartnerUser>(`/users/${id}`).catch(() => undefined);
}

/** One downline entry as returned alongside the user detail bundle. */
export interface DownlineEntry {
  userId: string;
  name: string;
  role: string;
  level: number;
  bookings: number;
  activity: 'active' | 'idle';
}

export interface UserDetailBundle {
  user: PartnerUser;
  bookings: BookingRow[];
  payouts: PayoutRequest[];
  attendance: AttendanceRecord[];
  downline: DownlineEntry[];
  summary: {
    totalEarnings: number;
    totalDeposits: number;
    payoutReleased: number;
    netPayable: number;
    bookings: number;
  };
}

/**
 * Everything the User Detail page renders, in one request. Replaces the mock layer's
 * synchronous cross-collection reads (`bookingsByPartner`, `payoutsByUser`,
 * `attendanceByUser`) with the eager-load they were standing in for.
 */
export async function getUserDetail(id: string): Promise<UserDetailBundle | undefined> {
  return api.get<UserDetailBundle>(`/users/${id}/detail`).catch(() => undefined);
}

export async function updateUserStatus(id: string, status: AccountStatus): Promise<PartnerUser | undefined> {
  const updated = await api.patch<PartnerUser>(`/users/${id}/status`, { status }).catch(() => undefined);
  // The partner directory cache feeds name lookups all over the panel, so a status change
  // has to invalidate it or stale rows keep rendering.
  if (updated) await loadReferenceData(true).catch(() => {});
  return updated;
}

export function roleLabel(role: RoleId): string {
  return ROLE_NAME_BY_ID[role];
}
