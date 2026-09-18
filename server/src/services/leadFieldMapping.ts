import axios from 'axios';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { mapFieldDataToLead, type MetaFieldDatum } from './metaService';

/**
 * Turns a Meta form's answers into a lead, using the mapping an admin configured per form.
 *
 * Mappings live on `LeadSourceConnection.fieldMapping`, keyed by form id because two forms on
 * the same Page ask different questions:
 *
 *   { "<formId>": { "full_name": "firstName", "budget_": "custom:budget" } }
 *
 * A target is either a built-in Lead column or `custom:<key>` for a `LeadCustomField`.
 * Questions with no mapping fall back to the automatic name matching that was there before,
 * so an unconfigured form still produces a usable lead.
 */

// ---------------------------------------------------------------------------
// Option labels
//
// `field_data` carries the option *key* a respondent chose (`below_40_lakhs_`), not the label
// the form showed them ("Below 40 Lakhs"). Storing the key would put slugs in front of a
// salesperson and would not match the options on a dropdown field, so the form definition is
// read once per form and cached to translate them back.
// ---------------------------------------------------------------------------

type OptionLabels = Record<string, Record<string, string>>;

const optionCache = new Map<string, { at: number; labels: OptionLabels }>();
const OPTION_CACHE_TTL_MS = 30 * 60 * 1000;

export async function fetchOptionLabels(formId: string, accessToken: string): Promise<OptionLabels> {
  const cached = optionCache.get(formId);
  if (cached && Date.now() - cached.at < OPTION_CACHE_TTL_MS) return cached.labels;

  const labels: OptionLabels = {};
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v21.0/${formId}?fields=questions{key,options}&access_token=${accessToken}`,
      { timeout: 20_000 }
    );
    const questions: any[] = Array.isArray(data?.questions) ? data.questions : (data?.questions?.data ?? []);
    for (const q of questions) {
      if (!q?.key || !Array.isArray(q.options)) continue;
      const byKey: Record<string, string> = {};
      for (const o of q.options) if (o?.key && o?.value) byKey[o.key] = o.value;
      if (Object.keys(byKey).length > 0) labels[q.key] = byKey;
    }
  } catch {
    // A form we cannot read just keeps the raw keys — worth less, but never a failed import.
  }

  optionCache.set(formId, { at: Date.now(), labels });
  return labels;
}

/** Lead columns a form answer is allowed to write to. */
export const MAPPABLE_LEAD_FIELDS = [
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'fullName', label: 'Full name (splits into first + last)' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'city', label: 'City' },
  { value: 'company', label: 'Company' },
  { value: 'jobTitle', label: 'Job title' },
  { value: 'country', label: 'Country' },
  { value: 'notes', label: 'Notes' },
] as const;

const BUILT_IN: ReadonlySet<string> = new Set<string>(MAPPABLE_LEAD_FIELDS.map((f) => f.value));

export type FormMapping = Record<string, string>;

export function mappingForForm(fieldMapping: unknown, formId?: string | null): FormMapping {
  if (!fieldMapping || typeof fieldMapping !== 'object' || Array.isArray(fieldMapping)) return {};
  const all = fieldMapping as Record<string, unknown>;
  const forForm = formId ? all[formId] : undefined;
  if (forForm && typeof forForm === 'object' && !Array.isArray(forForm)) return forForm as FormMapping;
  return {};
}

export interface MappedAnswers {
  lead: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    city?: string;
    company?: string;
    jobTitle?: string;
    country?: string;
    notes?: string;
  };
  /** `custom:<key>` targets, resolved to field keys. */
  custom: Record<string, string>;
  /** Answers that had no mapping and no automatic match — kept so nothing is silently dropped. */
  unmapped: Record<string, string>;
}

/**
 * The question names `mapFieldDataToLead` matches on its own. Kept in step with it by hand —
 * it is a short list, and the alternative is having that function report what it consumed.
 */
const AUTO_KEYS = new Set([
  'fullname', 'name', 'firstname', 'lastname', 'email',
  'phonenumber', 'phone', 'city', 'companyname', 'company', 'jobtitle',
]);

function autoRecognises(questionName: string): boolean {
  return AUTO_KEYS.has(questionName.toLowerCase().replace(/[^a-z]/g, ''));
}

export function applyFormMapping(
  fieldData: MetaFieldDatum[],
  mapping: FormMapping,
  optionLabels: OptionLabels = {}
): MappedAnswers {
  // The automatic matcher still runs: it is what makes an unconfigured form work at all.
  const auto = mapFieldDataToLead(fieldData);
  const lead: MappedAnswers['lead'] = {
    firstName: auto.firstName,
    lastName: auto.lastName,
    email: auto.email,
    phone: auto.phone,
    city: auto.city,
    company: auto.company,
    jobTitle: auto.jobTitle,
  };
  const custom: Record<string, string> = {};
  const unmapped: Record<string, string> = {};

  for (const answer of fieldData) {
    const byKey = optionLabels[answer.name];
    const value = (answer.values ?? [])
      .filter(Boolean)
      .map((v) => byKey?.[v] ?? v)
      .join(', ')
      .trim();
    if (!value) continue;
    const target = mapping[answer.name];

    if (!target) {
      // No explicit mapping. If the automatic matcher already recognised this question,
      // it is on the lead — repeating it in the leftovers note would just be noise.
      if (!autoRecognises(answer.name)) unmapped[answer.name] = value;
      continue;
    }
    if (target === 'ignore') continue;

    if (target.startsWith('custom:')) {
      custom[target.slice('custom:'.length)] = value;
      continue;
    }
    if (target === 'fullName') {
      const parts = value.split(/\s+/);
      lead.firstName = parts[0] || lead.firstName;
      lead.lastName = parts.slice(1).join(' ');
      continue;
    }
    if (BUILT_IN.has(target)) {
      (lead as Record<string, unknown>)[target] = value;
    }
  }

  // An explicit mapping wins over the automatic guess, so drop anything it claimed.
  for (const name of Object.keys(mapping)) delete unmapped[name];

  return { lead, custom, unmapped };
}

/**
 * Writes the `custom:` answers against a lead. Unknown keys are skipped rather than created
 * on the fly — a field should exist deliberately, not appear because a form was renamed.
 */
export async function saveCustomValues(
  leadId: string,
  values: Record<string, string>,
  tx: Prisma.TransactionClient = prisma
): Promise<number> {
  const keys = Object.keys(values);
  if (keys.length === 0) return 0;
  const fields = await tx.leadCustomField.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });

  let written = 0;
  for (const field of fields) {
    await tx.leadCustomValue.upsert({
      where: { leadId_fieldId: { leadId, fieldId: field.id } },
      create: { leadId, fieldId: field.id, value: values[field.key] },
      update: { value: values[field.key] },
    });
    written += 1;
  }
  return written;
}

/** Anything with no home at all, kept on the lead as a note so an answer is never lost. */
export function unmappedNote(unmapped: Record<string, string>): string | null {
  const entries = Object.entries(unmapped);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n');
}
