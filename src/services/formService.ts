import type {
  LeadForm, LeadFormAnalytics, LeadFormFieldType, LeadFormInput, LeadFormSubmission, PublicLeadForm,
} from '../types';
import { api, toQueryString } from './apiClient';
import type { ListParams, ListResult } from './mockClient';

export interface FormListParams extends ListParams {
  search?: string;
}

export const FIELD_TYPE_OPTIONS: { value: LeadFormFieldType; label: string }[] = [
  { value: 'short_text', label: 'Short Text' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'gdpr_consent', label: 'GDPR Consent' },
];

/**
 * Field keys the backend maps straight onto a Lead column. Anything else still gets captured —
 * it lands in the submission record and as a note on the lead — so this is guidance, not a limit.
 */
export const LEAD_FIELD_KEYS = [
  'name', 'firstName', 'lastName', 'email', 'phone', 'city', 'company', 'jobTitle', 'country', 'notes',
] as const;

/** The public URL a visitor opens, and what the embed snippet points at. */
export function publicFormUrl(slug: string): string {
  return `${window.location.origin}/f/${slug}`;
}

export function embedSnippet(slug: string, title: string): string {
  return `<iframe src="${publicFormUrl(slug)}?embed=1" title="${title.replace(/"/g, '&quot;')}" style="width:100%;max-width:560px;height:680px;border:0;overflow:hidden" loading="lazy"></iframe>`;
}

/** Turns a form name into a usable slug as the user types it. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function listForms(params: FormListParams = {}): Promise<ListResult<LeadForm>> {
  return api.get<ListResult<LeadForm>>(`/forms${toQueryString(params)}`);
}

export async function getForm(id: string): Promise<LeadForm> {
  return api.get<LeadForm>(`/forms/${id}`);
}

export async function createForm(input: LeadFormInput): Promise<LeadForm> {
  return api.post<LeadForm>('/forms', input);
}

export async function updateForm(id: string, input: LeadFormInput): Promise<LeadForm> {
  return api.patch<LeadForm>(`/forms/${id}`, input);
}

export async function deleteForm(id: string): Promise<void> {
  return api.delete<void>(`/forms/${id}`);
}

export async function listFormSubmissions(id: string, params: ListParams = {}): Promise<ListResult<LeadFormSubmission>> {
  return api.get<ListResult<LeadFormSubmission>>(`/forms/${id}/submissions${toQueryString(params)}`);
}

export async function getFormAnalytics(id: string, days = 30): Promise<LeadFormAnalytics> {
  return api.get<LeadFormAnalytics>(`/forms/${id}/analytics?days=${days}`);
}

// --- Public (unauthenticated) endpoints used by the /f/<slug> page ---

export async function getPublicForm(slug: string): Promise<PublicLeadForm> {
  return api.get<PublicLeadForm>(`/forms/public/${slug}`);
}

export interface PublicFormSubmitPayload {
  data: Record<string, string | boolean>;
  /** Left empty by humans; a bot that fills every input trips it and the submission is dropped. */
  honeypot?: string;
  recaptchaToken?: string;
  pageUrl?: string;
  referrer?: string;
}

export async function submitPublicForm(slug: string, payload: PublicFormSubmitPayload): Promise<{ ok: boolean; leadId?: string }> {
  return api.post<{ ok: boolean; leadId?: string }>(`/forms/public/${slug}/submit`, payload);
}
