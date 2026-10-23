import type {
  BroadcastAudience, BroadcastLeadFilter, ManagedWhatsAppTemplate, NewWhatsAppTemplate, WhatsAppBroadcastSource, WhatsAppSendResult,
  WhatsAppTemplateSendRow,
} from '../types';
import { api } from './apiClient';

// ---------------------------------------------------------------------------
// server/src/routes/admin/whatsappTemplates.ts — broadcasts through the linked
// Cloud API number. Templates are read live from Meta and never mirrored here,
// because an approval can be revoked at any time.
// ---------------------------------------------------------------------------

export async function getBroadcastSource(): Promise<WhatsAppBroadcastSource> {
  return api.get('/whatsapp-templates');
}

export interface AudienceInput {
  numbers?: string;
  useLeadFilter?: boolean;
  leadFilter?: BroadcastLeadFilter;
}

export async function previewAudience(input: AudienceInput): Promise<BroadcastAudience> {
  return api.post('/whatsapp-templates/audience', input);
}

export async function sendBroadcast(
  input: AudienceInput & { templateName: string; language: string; params: string[]; headerMediaUrl?: string }
): Promise<WhatsAppSendResult> {
  return api.post('/whatsapp-templates/send', input);
}

export async function listWhatsAppSends(limit = 50): Promise<WhatsAppTemplateSendRow[]> {
  const { sends } = await api.get<{ sends: WhatsAppTemplateSendRow[] }>(`/whatsapp-templates/sends?limit=${limit}`);
  return sends;
}

export async function listManagedTemplates(): Promise<ManagedWhatsAppTemplate[]> {
  const { templates } = await api.get<{ templates: ManagedWhatsAppTemplate[] }>('/whatsapp-templates/manage');
  return templates;
}

export async function submitTemplate(input: NewWhatsAppTemplate): Promise<{ name: string; status: string }> {
  return api.post('/whatsapp-templates/manage', input);
}

export async function removeTemplate(name: string): Promise<void> {
  await api.delete(`/whatsapp-templates/manage/${encodeURIComponent(name)}`);
}
