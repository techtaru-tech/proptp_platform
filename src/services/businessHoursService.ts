import { api } from './apiClient';

export interface DaySchedule {
  day: number; // 0 = Sunday .. 6 = Saturday
  isOpen: boolean;
  openTime: string; // "HH:mm"
  closeTime: string; // "HH:mm"
}

export interface BusinessHoursSettings {
  id: string;
  enabled: boolean;
  timezone: string;
  schedule: DaySchedule[];
  closedMessage?: string | null;
  updatedAt: string;
}

export interface BusinessHoursInput {
  enabled: boolean;
  timezone: string;
  schedule: DaySchedule[];
  closedMessage?: string;
}

export async function getBusinessHours(): Promise<BusinessHoursSettings> {
  return api.get<BusinessHoursSettings>('/settings/business-hours');
}

export async function updateBusinessHours(input: BusinessHoursInput): Promise<BusinessHoursSettings> {
  return api.put<BusinessHoursSettings>('/settings/business-hours', input);
}

export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A handful of relevant zones — this app has no real timezone-conversion behind the field (see server notes), so it's a label, not a picker of everything IANA has. */
export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Kolkata', label: 'India Standard Time (IST)' },
  { value: 'Asia/Dubai', label: 'Gulf Standard Time (GST)' },
  { value: 'Asia/Singapore', label: 'Singapore Standard Time (SGT)' },
  { value: 'Europe/London', label: 'UK Time (GMT/BST)' },
  { value: 'America/New_York', label: 'US Eastern Time (ET)' },
  { value: 'UTC', label: 'UTC' },
];
