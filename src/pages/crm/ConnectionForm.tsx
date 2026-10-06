import { useState } from 'react';
import { Eye, EyeOff, Info, Plus, Trash2 } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { CONNECTOR_FIELDS, requiresNoCredentials } from '../../data/connectorFieldSchema';
import { LEAD_SOURCE_META } from '../../constants/leadSources';
import { OAUTH_CAPABLE_SOURCES, type LeadSource } from '../../types';

/** The real `LeadSource` enum has exactly these 19 values available when creating a connection — no free-text/custom source. */
export const CONNECTOR_SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  'meta', 'instagram', 'tiktok', 'linkedin', 'whatsapp', 'viber', 'telegram', 'twitter', 'snapchat', 'pinterest',
  'google_ads', 'youtube', 'microsoft_ads', 'email', 'typeform', 'jotform', 'calendly', 'web_form', 'portal', 'manual',
].map((value) => ({ value: value as LeadSource, label: LEAD_SOURCE_META[value]?.label ?? value }));

export interface ConnectionFormValues {
  name: string;
  source: LeadSource;
  active: boolean;
  credentials: Record<string, string>;
  fieldMapping: { key: string; value: string }[];
}

export function defaultConnectionFormValues(): ConnectionFormValues {
  return { name: '', source: 'meta', active: true, credentials: {}, fieldMapping: [] };
}

export function validateConnectionForm(values: ConnectionFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.name.trim()) errors.name = 'Name is required.';
  else if (values.name.trim().length > 100) errors.name = 'Name must be 100 characters or fewer.';
  if (!values.source) errors.source = 'Source is required.';

  const fields = CONNECTOR_FIELDS[values.source] ?? [];
  fields.forEach((field) => {
    if (field.required && !values.credentials[field.name]?.trim()) {
      errors[`credentials.${field.name}`] = `${field.label} is required.`;
    }
  });
  return errors;
}

interface BasicFieldsProps {
  values: ConnectionFormValues;
  errors: Record<string, string>;
  onChange: (patch: Partial<ConnectionFormValues>) => void;
  isEditing?: boolean;
}

export function ConnectionBasicFields({ values, errors, onChange, isEditing }: BasicFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input label="Name" required maxLength={100} value={values.name} onChange={(e) => onChange({ name: e.target.value })} error={errors.name} placeholder="e.g. Meta Lead Ads" />
      <Select
        label="Source"
        required
        value={values.source}
        onChange={(e) => onChange({ source: e.target.value as LeadSource, credentials: {} })}
        options={CONNECTOR_SOURCE_OPTIONS}
        disabled={isEditing}
        hint={isEditing ? 'Source cannot be changed after a connection is created.' : undefined}
      />
    </div>
  );
}

export function ConnectionOAuthSection({ source }: { source: LeadSource }) {
  if (!OAUTH_CAPABLE_SOURCES.includes(source)) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
      <Info size={16} className="mt-0.5 shrink-0" />
      <p>
        This source supports connecting via OAuth. Save this connection first, then use the <strong>Reconnect</strong> action on
        the Integrations list to authorize it — the credential fields below are filled in automatically once authorized, or you
        may enter them manually.
      </p>
    </div>
  );
}

export function ConnectionCredentialFields({ values, errors, onChange, storedKeys = [] }: BasicFieldsProps & { storedKeys?: string[] }) {
  const fields = CONNECTOR_FIELDS[values.source] ?? [];
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  if (requiresNoCredentials(values.source)) {
    return <p className="text-sm text-ink-muted">This source does not require any API credentials.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <Input
          key={field.name}
          label={field.label}
          required={field.required}
          type={field.masked && !revealed[field.name] ? 'password' : 'text'}
          secret
          name={`connector-${field.name}`}
          value={values.credentials[field.name] ?? ''}
          onChange={(e) => onChange({ credentials: { ...values.credentials, [field.name]: e.target.value } })}
          error={errors[`credentials.${field.name}`]}
          hint={storedKeys.includes(field.name) ? 'Stored — type to replace' : undefined}
          placeholder={storedKeys.includes(field.name) ? '••••••••' : undefined}
          rightIcon={
            field.masked ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setRevealed((prev) => ({ ...prev, [field.name]: !prev[field.name] }))}
                aria-label={revealed[field.name] ? 'Hide value' : 'Reveal value'}
                className="pointer-events-auto text-ink-faint hover:text-ink-muted"
              >
                {revealed[field.name] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}

/** Hint describing what the left-hand key looks like for this platform. */
const MAPPING_HINTS: Partial<Record<LeadSource, string>> = {
  typeform: 'field_ref → lead field',
  jotform: 'field_name → lead field',
  google_ads: 'column_id (FULL_NAME, PHONE_NUMBER, …) → lead field',
  web_form: 'form input name (your-name, mobile, …) → lead field',
};

/** Lead fields a mapping can target — matches what the receiver accepts. */
const MAPPABLE_LEAD_FIELDS = ['name', 'firstName', 'lastName', 'email', 'phone', 'city', 'company', 'jobTitle', 'country', 'notes'];

/**
 * Meta's answers are mapped from the Graph API's own field names, and 'manual' has no webhook —
 * every other source ingests through the generic receiver, where a mapping is meaningful.
 * Exported so callers can skip rendering an empty card around the section.
 */
export function supportsFieldMapping(source: LeadSource): boolean {
  return source !== 'meta' && source !== 'manual';
}

export function ConnectionFieldMappingSection({ values, onChange }: Omit<BasicFieldsProps, 'errors'>) {
  if (!supportsFieldMapping(values.source)) return null;

  const add = () => onChange({ fieldMapping: [...values.fieldMapping, { key: '', value: '' }] });
  const update = (i: number, patch: Partial<{ key: string; value: string }>) =>
    onChange({ fieldMapping: values.fieldMapping.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) });
  const remove = (i: number) => onChange({ fieldMapping: values.fieldMapping.filter((_, idx) => idx !== i) });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-ink">Field Mapping</span>
          <p className="text-xs text-ink-faint">
            {MAPPING_HINTS[values.source] ?? 'incoming key → lead field'} — optional, common names like name/email/phone/mobile
            are detected automatically. Anything unmapped is saved as a note on the lead.
          </p>
        </div>
        <Button variant="outline" size="sm" leftIcon={<Plus size={12} />} onClick={add}>
          Add mapping
        </Button>
      </div>
      {values.fieldMapping.length === 0 ? (
        <p className="text-xs text-ink-faint">No field mappings configured yet.</p>
      ) : (
        <div className="space-y-2">
          {values.fieldMapping.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={m.key} onChange={(e) => update(i, { key: e.target.value })} placeholder={values.source === 'typeform' ? 'Source field ref' : 'Source field name'} wrapperClassName="flex-1" />
              <span className="text-ink-faint">→</span>
              <Input
                value={m.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder="Lead field"
                list="mappable-lead-fields"
                wrapperClassName="flex-1"
              />
              <Button variant="ghost" size="icon" aria-label="Remove mapping" onClick={() => remove(i)} className="text-danger-600">
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
      <datalist id="mappable-lead-fields">
        {MAPPABLE_LEAD_FIELDS.map((field) => (
          <option key={field} value={field} />
        ))}
      </datalist>
    </div>
  );
}
