import type { AppNotification, NotificationAudience, NotificationType } from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export async function listNotifications(params: ListParams = {}): Promise<ListResult<AppNotification>> {
  return api.get<ListResult<AppNotification>>(`/notifications${toQueryString(params)}`);
}

export async function getNotification(id: string): Promise<AppNotification | undefined> {
  return api.get<AppNotification>(`/notifications/${id}`).catch(() => undefined);
}

/**
 * Sending a broadcast fans it out to one row per partner in the audience, which is what
 * gives the partner app per-user read state instead of a single global "seen" flag.
 * `type` decides the icon and colour the app renders, so it is chosen here, not guessed.
 */
export async function createNotification(data: {
  title: string;
  body: string;
  audience: NotificationAudience;
  type?: NotificationType;
  /** Required when the audience is `custom`. */
  userIds?: string[];
  /** ISO timestamp. Omitted or in the past means send it now. */
  scheduledFor?: string;
}): Promise<AppNotification> {
  return api.post<AppNotification>('/notifications', { type: 'system', ...data });
}

/** Who a broadcast would reach, asked while it is still being composed. */
export interface AudiencePreview {
  count: number;
  /** Of those, how many have the app installed — the rest only see it in the feed. */
  withDevice: number;
  byRole: Record<string, number>;
  sample: { id: string; name: string; role: string; hasDevice: boolean }[];
}

export async function previewAudience(input: {
  audience: NotificationAudience;
  userIds?: string[];
}): Promise<AudiencePreview> {
  return api.post<AudiencePreview>('/notifications/audience', input);
}

export interface NotificationRecipientOption {
  id: string;
  name: string;
  phone: string;
  role: string;
  hasDevice: boolean;
}

export async function searchRecipients(search: string): Promise<NotificationRecipientOption[]> {
  const { users } = await api.get<{ users: NotificationRecipientOption[] }>(
    `/notifications/recipients${search ? `?search=${encodeURIComponent(search)}` : ''}`
  );
  return users;
}

export const AUDIENCE_LABEL: Record<NotificationAudience, string> = {
  all: 'All Partners',
  agents: 'Channel partners',
  employees: 'Employees',
  leaders: 'Leaders',
  custom: 'Selected people',
};

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  booking: 'Booking',
  payout: 'Payout',
  team: 'Team',
  system: 'System',
};

/** Whether pushes can actually leave the server, and how many phones are reachable. */
export interface PushStatus {
  configured: boolean;
  projectId: string | null;
  devicesRegistered: number;
  partnersActive: number;
}

export async function getPushStatus(): Promise<PushStatus> {
  return api.get<PushStatus>('/notifications/push-status');
}
