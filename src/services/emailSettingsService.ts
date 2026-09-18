import type { EmailSettings, EmailSettingsPatch, EmailSuppression } from '../types';
import { api } from './apiClient';

// ---------------------------------------------------------------------------
// Email delivery settings (server/src/routes/emailSettings.ts + services/email.ts).
// ---------------------------------------------------------------------------

export async function getEmailSettings(): Promise<EmailSettings> {
  return api.get<EmailSettings>('/email-settings');
}

export async function updateEmailSettings(patch: EmailSettingsPatch): Promise<EmailSettings> {
  return api.patch<EmailSettings>('/email-settings', patch);
}

export async function rotateInboundEmailUrl(): Promise<EmailSettings> {
  return api.post<EmailSettings>('/email-settings/rotate-inbound');
}

export async function sendTestEmail(to: string): Promise<{ ok: boolean; message: string }> {
  return api.post('/email-settings/test', { to });
}

export async function listSuppressions(): Promise<EmailSuppression[]> {
  return api.get<EmailSuppression[]>('/email-settings/suppressions');
}

export async function addSuppression(email: string): Promise<void> {
  await api.post('/email-settings/suppressions', { email });
}

export async function removeSuppression(id: string): Promise<void> {
  await api.delete(`/email-settings/suppressions/${id}`);
}
