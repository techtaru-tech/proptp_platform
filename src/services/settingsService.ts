import { api } from './apiClient';

export interface OrganizationSettings {
  companyName: string;
  logoUrl: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
}

export interface NotificationSettings {
  emailAlerts: boolean;
  pushAlerts: boolean;
  dailySummary: boolean;
  ticketAlerts: boolean;
}

export interface AdminProfile {
  name: string;
  email: string;
  phone: string;
  avatarUrl?: string;
}

export async function getOrganizationSettings(): Promise<OrganizationSettings> {
  return api.get<OrganizationSettings>('/platform-settings/organization');
}

export async function updateOrganizationSettings(next: Partial<OrganizationSettings>): Promise<OrganizationSettings> {
  return api.patch<OrganizationSettings>('/platform-settings/organization', next);
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  return api.get<NotificationSettings>('/platform-settings/notifications');
}

export async function updateNotificationSettings(next: Partial<NotificationSettings>): Promise<NotificationSettings> {
  return api.patch<NotificationSettings>('/platform-settings/notifications', next);
}

/** The signed-in admin's own profile row — the same User record they authenticate against. */
export async function getAdminProfile(): Promise<AdminProfile> {
  return api.get<AdminProfile>('/platform-settings/profile');
}

/**
 * `phone` is the login identity for partners and is unique across the table, so a clash is
 * rejected server-side rather than silently accepted.
 */
export async function updateAdminProfile(next: Partial<AdminProfile> & { password?: string }): Promise<AdminProfile> {
  return api.patch<AdminProfile>('/platform-settings/profile', next);
}
