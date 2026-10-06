import { useEffect } from 'react';
import { Input } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Select } from '../../components/ui/Select';
import { listSourceOptions, listAssignableUsers, listProjectOptions } from '../../services/leadService';
import { useAsync } from '../../hooks/useAsync';
import { mayAssignLeads, mayUnassignLeads } from '../../data/referenceData';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';
import {
  asOptions, BUDGET_RANGE_OPTIONS, PREFERRED_LOCATION_OPTIONS, PROPERTY_TYPE_OPTIONS, PURPOSE_OPTIONS,
} from './leadRequirementOptions';
import type { Lead, LeadPriority, LeadSource } from '../../types';

export interface LeadFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  jobTitle: string;
  purpose: string;
  propertyType: string;
  budgetRange: string;
  preferredLocations: string[];
  source: LeadSource;
  priority: LeadPriority;
  temperature: string;
  interestedProjectId: string;
  assignedUserId: string;
  pipelineId: string;
  pipelineStageId: string;
  dealValue: string;
  expectedCloseDate: string;
  notes: string;
}

/** Pipeline/stage start out unset — `LeadDetailsFields` fills in the default pipeline
 * itself once it has loaded (see its `useEffect` below), since that data is now fetched
 * from the backend rather than a static import a plain sync function could read. */
export function defaultLeadFormValues(): LeadFormValues {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    city: '',
    jobTitle: '',
    purpose: '',
    propertyType: '',
    budgetRange: '',
    preferredLocations: [],
    source: 'manual',
    priority: 'normal',
    temperature: '',
    interestedProjectId: '',
    assignedUserId: '',
    pipelineId: '',
    pipelineStageId: '',
    dealValue: '',
    expectedCloseDate: '',
    notes: '',
  };
}

export function leadToFormValues(lead: Lead): LeadFormValues {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email ?? '',
    phone: lead.phone,
    city: lead.city ?? '',
    jobTitle: lead.jobTitle ?? '',
    purpose: lead.purpose ?? '',
    propertyType: lead.propertyType ?? '',
    budgetRange: lead.budgetRange ?? '',
    preferredLocations: lead.preferredLocations ?? [],
    source: lead.source,
    priority: lead.priority,
    temperature: lead.temperature ?? '',
    interestedProjectId: lead.interestedProjectId ?? '',
    assignedUserId: lead.assignedUserId ?? '',
    pipelineId: lead.pipelineId ?? '',
    pipelineStageId: lead.pipelineStageId ?? '',
    dealValue: lead.dealValue ? String(lead.dealValue) : '',
    expectedCloseDate: lead.expectedCloseDate ?? '',
    notes: lead.notes ?? '',
  };
}

export function validateLeadForm(values: LeadFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.firstName.trim()) errors.firstName = 'First name is required.';
  if (!values.lastName.trim()) errors.lastName = 'Last name is required.';
  if (!values.phone.trim()) errors.phone = 'Phone number is required.';
  if (values.email && !/^\S+@\S+\.\S+$/.test(values.email)) errors.email = 'Enter a valid email address.';
  if (values.dealValue && Number.isNaN(Number(values.dealValue))) errors.dealValue = 'Deal value must be a number.';
  return errors;
}

interface FieldsProps {
  values: LeadFormValues;
  errors: Record<string, string>;
  onChange: (patch: Partial<LeadFormValues>) => void;
}

/**
 * Several answers to one question. A `<select multiple>` is the obvious control and the wrong
 * one: half the team does not know it needs ctrl-click, and the other half loses their picks
 * to a stray click. Ticks are unambiguous, and the list is short enough to show whole.
 */
function CheckboxGroup({
  label, hint, options, selected, onChange,
}: {
  label: string;
  hint?: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-line-strong p-2.5">
        {options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => toggle(option)}
              className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring"
            />
            {option}
          </label>
        ))}
      </div>
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </div>
  );
}

export function LeadContactFields({ values, errors, onChange }: FieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Input label="First name" required value={values.firstName} onChange={(e) => onChange({ firstName: e.target.value })} error={errors.firstName} />
      <Input label="Last name" required value={values.lastName} onChange={(e) => onChange({ lastName: e.target.value })} error={errors.lastName} />
      <Input label="Phone" required value={values.phone} onChange={(e) => onChange({ phone: e.target.value })} error={errors.phone} placeholder="98XXXXXXXX" />
      <Input label="Email" type="email" value={values.email} onChange={(e) => onChange({ email: e.target.value })} error={errors.email} />
      <Input label="City" value={values.city} onChange={(e) => onChange({ city: e.target.value })} />
      <Input label="Job title" value={values.jobTitle} onChange={(e) => onChange({ jobTitle: e.target.value })} />
    </div>
  );
}

/**
 * What the buyer is actually looking for. Separate from the contact block because this is what
 * the sales team asks on the first call, and it is what every later filter is built on.
 */
export function LeadRequirementFields({ values, onChange }: FieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Select
        label="Purpose"
        value={values.purpose}
        onChange={(e) => onChange({ purpose: e.target.value })}
        options={asOptions(PURPOSE_OPTIONS, 'Not asked yet')}
      />
      <Select
        label="Property type"
        value={values.propertyType}
        onChange={(e) => onChange({ propertyType: e.target.value })}
        options={asOptions(PROPERTY_TYPE_OPTIONS, 'Not asked yet')}
      />
      <Select
        label="Budget range"
        value={values.budgetRange}
        onChange={(e) => onChange({ budgetRange: e.target.value })}
        options={asOptions(BUDGET_RANGE_OPTIONS, 'Not asked yet')}
      />
      <CheckboxGroup
        label="Preferred location"
        hint="Tick every area they are open to."
        options={PREFERRED_LOCATION_OPTIONS}
        selected={values.preferredLocations}
        onChange={(preferredLocations) => onChange({ preferredLocations })}
      />
    </div>
  );
}

/** `isNewLead` (true only from AddLead's blank form) auto-selects the default pipeline's
 * first stage once pipeline data has loaded — mirroring the old static defaultLeadFormValues()
 * behavior, without requiring pipeline data inside a plain (non-hook) sync function. */
export function LeadDetailsFields({ values, onChange, isNewLead }: Omit<FieldsProps, 'errors'> & { isNewLead?: boolean }) {
  const { data: projectOptions } = useAsync(() => listProjectOptions().catch(() => []), []);
  const { pipelines, stagesForPipeline, defaultPipeline, isLoading } = usePipelineReferenceData();
  const pipelineStages = values.pipelineId ? stagesForPipeline(values.pipelineId) : [];

  useEffect(() => {
    if (!isNewLead || isLoading || values.pipelineId) return;
    const def = defaultPipeline();
    if (!def) return;
    const firstStage = stagesForPipeline(def.id)[0];
    onChange({ pipelineId: def.id, pipelineStageId: firstStage?.id ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewLead, isLoading]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Select
        label="Source"
        value={values.source}
        onChange={(e) => onChange({ source: e.target.value as LeadSource })}
        options={listSourceOptions()}
      />
      <Select
        label="Priority"
        value={values.priority}
        onChange={(e) => onChange({ priority: e.target.value as LeadPriority })}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
          { value: 'urgent', label: 'Urgent' },
        ]}
      />
      <Select
        label="Temperature"
        name="temperature"
        value={values.temperature}
        onChange={(e) => onChange({ temperature: e.target.value })}
        options={[{ value: '', label: 'Not rated' }, { value: 'hot', label: 'Hot' }, { value: 'warm', label: 'Warm' }, { value: 'cold', label: 'Cold' }]}
      />
      <Select
        label="Interested project"
        name="interestedProjectId"
        value={values.interestedProjectId}
        onChange={(e) => onChange({ interestedProjectId: e.target.value })}
        options={[{ value: '', label: 'Not decided' }, ...(projectOptions ?? []).map((p) => ({ value: p.id, label: p.projectName }))]}
      />
      {mayAssignLeads() ? (
        <Select
          label="Assigned to"
          value={values.assignedUserId}
          onChange={(e) => onChange({ assignedUserId: e.target.value })}
          options={[
            ...(mayUnassignLeads() ? [{ value: '', label: 'Unassigned' }] : [{ value: '', label: 'Me' }]),
            ...listAssignableUsers().map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      ) : (
        // An Employee's leads are their own; there is nobody they may hand one to.
        <div />
      )}
      <div />
      <Select
        label="Pipeline"
        value={values.pipelineId}
        onChange={(e) => onChange({ pipelineId: e.target.value, pipelineStageId: '' })}
        options={[{ value: '', label: 'No pipeline' }, ...pipelines.map((p) => ({ value: p.id, label: p.name }))]}
      />
      <Select
        label="Stage"
        value={values.pipelineStageId}
        onChange={(e) => onChange({ pipelineStageId: e.target.value })}
        disabled={!values.pipelineId}
        hint={!values.pipelineId ? 'Choose a pipeline first to pick a stage.' : undefined}
        options={
          values.pipelineId
            ? [{ value: '', label: 'Select a stage' }, ...pipelineStages.map((s) => ({ value: s.id, label: s.name }))]
            : [{ value: '', label: '—' }]
        }
      />
    </div>
  );
}

export function LeadDealFields({ values, errors, onChange }: FieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MoneyInput
        label="Deal value (₹)"
        type="number"
        min={0}
        value={values.dealValue}
        onChange={(e) => onChange({ dealValue: e.target.value })}
        error={errors.dealValue}
      />
      <Input
        label="Expected close date"
        type="date"
        value={values.expectedCloseDate}
        onChange={(e) => onChange({ expectedCloseDate: e.target.value })}
        wrapperClassName="sm:col-span-2"
      />
      <div className="flex flex-col gap-1.5 sm:col-span-3">
        <label htmlFor="lead-notes" className="text-sm font-medium text-ink">
          Notes
        </label>
        <textarea
          id="lead-notes"
          rows={3}
          value={values.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Requirement, budget, preferences..."
          className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
        />
      </div>
    </div>
  );
}

export function leadFormValuesToPayload(values: LeadFormValues): Partial<Lead> {
  return {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    email: values.email.trim() || undefined,
    phone: values.phone.trim(),
    city: values.city.trim() || undefined,
    jobTitle: values.jobTitle.trim() || undefined,
    purpose: values.purpose || undefined,
    propertyType: values.propertyType || undefined,
    budgetRange: values.budgetRange || undefined,
    preferredLocations: values.preferredLocations,
    source: values.source,
    priority: values.priority,
    temperature: (values.temperature || null) as Lead['temperature'],
    interestedProjectId: values.interestedProjectId || undefined,
    assignedUserId: values.assignedUserId || undefined,
    pipelineId: values.pipelineId || undefined,
    pipelineStageId: values.pipelineStageId || undefined,
    dealValue: values.dealValue ? Number(values.dealValue) : undefined,
    expectedCloseDate: values.expectedCloseDate || undefined,
    notes: values.notes.trim() || undefined,
  };
}
