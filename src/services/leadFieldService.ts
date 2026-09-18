import type {
  LeadCustomField, MappingTargets, MetaForm, MetaFormMapping, MetaFormQuestion,
} from '../types';
import { api } from './apiClient';

// ---------------------------------------------------------------------------
// Custom lead fields and Meta form mapping
// (server/src/routes/leadFields.ts + connections.ts + services/leadFieldMapping.ts).
// ---------------------------------------------------------------------------

export const CUSTOM_FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Yes / No' },
];

export async function listMappingTargets(): Promise<MappingTargets> {
  return api.get<MappingTargets>('/lead-fields/targets');
}

export async function listCustomFields(): Promise<LeadCustomField[]> {
  return api.get<LeadCustomField[]>('/lead-fields');
}

export async function createCustomField(input: {
  label: string;
  type: string;
  options?: string[];
}): Promise<LeadCustomField> {
  return api.post<LeadCustomField>('/lead-fields', input);
}

export async function deleteCustomField(id: string): Promise<void> {
  await api.delete(`/lead-fields/${id}`);
}

export async function listMetaForms(connectionId: string): Promise<MetaForm[]> {
  const { forms } = await api.get<{ forms: MetaForm[] }>(`/connections/${connectionId}/meta/forms`);
  return forms;
}

export async function getMetaFormQuestions(
  connectionId: string,
  formId: string
): Promise<{ formName: string; questions: MetaFormQuestion[]; mapping: MetaFormMapping }> {
  return api.get(`/connections/${connectionId}/meta/forms/${formId}/questions`);
}

export async function saveMetaFormMapping(
  connectionId: string,
  formId: string,
  mapping: MetaFormMapping
): Promise<void> {
  await api.put(`/connections/${connectionId}/meta/forms/${formId}/mapping`, { mapping });
}
