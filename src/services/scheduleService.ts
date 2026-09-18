import type { ManageTime, ManageTimeType } from '../types';
import { api } from './apiClient';

/** Real `manage_times` — master data for investment return/maturity duration options. */

export async function listSchedules(): Promise<ManageTime[]> {
  const { schedules } = await api.get<{ schedules: ManageTime[] }>('/platform-settings/schedules');
  return schedules;
}

export async function createSchedule(input: { time: number; timeType: ManageTimeType }): Promise<ManageTime> {
  return api.post<ManageTime>('/platform-settings/schedules', input);
}

export async function updateSchedule(
  id: string,
  patch: Partial<Pick<ManageTime, 'time' | 'timeType' | 'status'>>
): Promise<ManageTime | undefined> {
  return api.patch<ManageTime>(`/platform-settings/schedules/${id}`, patch).catch(() => undefined);
}
