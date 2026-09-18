import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, GripVertical, History, Info, Plus, Settings2, Trash2, X } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';
import {
  getAutomation, createAutomation, updateAutomation, listAutomationRuns, type AutomationInput,
} from '../../services/leadAutomationService';
import { listAdSources, listAssignableUsers, listSourceOptions } from '../../services/leadService';
import { listForms } from '../../services/formService';
import { listSdrAgents } from '../../services/aiSdrService';
import { listEmailSequences } from '../../services/emailSequenceService';
import { refTeams } from '../../data/referenceData';
import { formatDateTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import {
  ACTION_OPTIONS, ASSIGN_MODE_OPTIONS, CONDITION_FIELD_SUGGESTIONS, CONDITION_OPTIONS, DELAY_UNIT_OPTIONS,
  STEP_TYPE_OPTIONS, TRIGGER_OPTIONS, UPDATE_FIELD_OPTIONS, conditionNeedsField, conditionNeedsValue,
  conditionNeedsValueList,
} from './automationOptions';
import type {
  AssignSequenceEntry, Automation, AutomationConditionType, AutomationRunEntry, AutomationStep,
  AutomationStepType, AutomationTriggerType,
} from '../../types';

function initialValues(existing?: Automation): AutomationInput {
  return {
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    enabled: existing?.enabled ?? true,
    respectBusinessHours: existing?.respectBusinessHours ?? false,
    triggerType: existing?.triggerType ?? 'lead_created',
    triggerConfig: existing?.triggerConfig ?? {},
    steps: existing?.steps ?? [],
  };
}

export function AutomationBuilder() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useAsync(() => (id ? getAutomation(id) : Promise.resolve(undefined)), [id]);

  if (id && isLoading) return <CardSkeleton />;
  if (id && (error || !data)) {
    return <ErrorState title="Automation not found" description={error?.message ?? 'This automation may have been deleted.'} />;
  }

  return <AutomationEditor existing={data} />;
}

function AutomationEditor({ existing }: { existing?: Automation }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { stages, pipelines } = usePipelineReferenceData();
  const assignableUsers = listAssignableUsers();
  const sourceOptions = listSourceOptions();
  const { data: tags } = useAsync(() => import('../../services/pipelineService').then((m) => m.listTags()), []);
  const { data: forms } = useAsync(() => listForms({ pageSize: 100 }), []);
  // The ad forms leads have actually arrived through — an ad that never produced one is noise.
  const { data: adSources } = useAsync(() => listAdSources().catch(() => undefined), []);
  const { data: sdrAgents } = useAsync(() => listSdrAgents(), []);
  const { data: emailSequences } = useAsync(() => listEmailSequences(), []);

  const [values, setValues] = useState<AutomationInput>(() => initialValues(existing));
  const [isSaving, setIsSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [tab, setTab] = useState('details');

  const runParams = existing ? { automationId: existing.id, page: 1, pageSize: 20, sortBy: 'ranAt', sortDir: 'desc' as const } : undefined;
  const { data: runs, isLoading: runsLoading } = useAsync(
    () => (runParams ? listAutomationRuns(runParams) : Promise.resolve(undefined)),
    [JSON.stringify(runParams)]
  );

  const patch = (next: Partial<AutomationInput>) => setValues((prev) => ({ ...prev, ...next }));

  const updateStep = (index: number, next: Partial<AutomationStep>) =>
    setValues((prev) => ({ ...prev, steps: prev.steps.map((s, i) => (i === index ? { ...s, ...next } : s)) }));

  const updateStepConfig = (index: number, patchConfig: Record<string, unknown>) =>
    setValues((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? { ...s, config: { ...s.config, ...patchConfig } } : s)),
    }));

  const removeStep = (index: number) => setValues((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));

  const moveStep = (from: number, to: number) =>
    setValues((prev) => {
      if (to < 0 || to >= prev.steps.length) return prev;
      const next = [...prev.steps];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return { ...prev, steps: next };
    });

  const addStep = (type: AutomationStepType) => {
    const config: Record<string, unknown> =
      type === 'condition'
        ? { conditionType: 'source_is', fieldName: '', value: '' }
        : type === 'action'
        ? { action: 'assign_lead', assignMode: 'round_robin', assignUserIds: [], overwrite: false }
        : { amount: 1, unit: 'hours' };
    setValues((prev) => ({ ...prev, steps: [...prev.steps, { type, config }] }));
  };

  const trigger = TRIGGER_OPTIONS.find((o) => o.value === values.triggerType);
  const stagesForConfig = stages;

  const validate = (): string | null => {
    if (!values.name.trim()) return 'Automation name is required.';
    for (const step of values.steps) {
      if (step.type === 'action' && step.config.action === 'assign_lead') {
        const mode = step.config.assignMode;
        if (mode === 'specific' && !(step.config.assignUserIds as string[])?.[0]) return 'An "Assign Lead" (Specific User) step needs a user.';
        if (mode === 'round_robin' && !(step.config.assignUserIds as string[])?.length) return 'An "Assign Lead" (Round Robin) step needs at least one user.';
        if (mode === 'sequence') {
          const rota = ((step.config.assignSequence as AssignSequenceEntry[]) ?? []).filter((e) => e.userId && e.count > 0);
          if (rota.length === 0) return 'A "Distribution Order" step needs at least one person with a lead count.';
        }
        if (mode === 'team' && !step.config.assignTeamId) return 'An "Assign Lead" (Team) step needs a team.';
      }
      if (step.type === 'condition') {
        const conditionType = step.config.conditionType as AutomationConditionType;
        const label = CONDITION_OPTIONS.find((o) => o.value === conditionType)?.label ?? conditionType;

        if (conditionNeedsValueList(conditionType) && !((step.config.values as string[]) ?? []).length) {
          return 'A "Meta Ad Form" condition needs at least one form ticked.';
        }
        if (conditionNeedsField(conditionType) && !String(step.config.fieldName ?? '').trim()) {
          return `The "${label}" condition needs a field name.`;
        }
        // An empty value is not "match anything" — it is compared literally, so the condition
        // can never pass and the automation stops dead on it, silently, for every lead.
        if (
          !conditionNeedsValueList(conditionType) &&
          conditionNeedsValue(conditionType) &&
          !String(step.config.value ?? '').trim()
        ) {
          return `The "${label}" condition has nothing to compare against — pick a value, or remove the step.`;
        }
      }
      if (step.type === 'action' && step.config.action === 'change_stage' && !step.config.stageId) {
        return 'A "Move To Pipeline Stage" step needs a stage.';
      }
      if (step.type === 'action' && (step.config.action === 'add_tag' || step.config.action === 'remove_tag') && !step.config.tagId) {
        return 'A tag step needs a tag selected.';
      }
      if (step.type === 'action' && step.config.action === 'enroll_in_sequence' && !step.config.sequenceId) {
        return 'An "Enroll in Email Sequence" step needs a sequence selected.';
      }
      if (step.type === 'action' && step.config.action === 'enroll_in_sdr_agent' && !step.config.agentId) {
        return 'An "Enroll in AI SDR Agent" step needs an agent selected.';
      }
    }
    return null;
  };

  const handleSave = async () => {
    const problem = validate();
    if (problem) {
      toast({ title: 'Check the automation', description: problem, variant: 'error' });
      return;
    }
    setIsSaving(true);
    try {
      if (existing) {
        await updateAutomation(existing.id, values);
        toast({ title: 'Automation saved', variant: 'success' });
        navigate('/crm/automation');
      } else {
        await createAutomation(values);
        toast({ title: 'Automation created', variant: 'success' });
        navigate('/crm/automation');
      }
    } catch (err) {
      toast({ title: 'Could not save the automation', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const runColumns: DataTableColumn<AutomationRunEntry>[] = [
    { key: 'ranAt', header: 'When', render: (r) => formatDateTime(r.ranAt) },
    { key: 'lead', header: 'Lead', render: (r) => r.leadName || r.leadId },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={r.status === 'success' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'waiting' ? 'info' : 'neutral'}>
          {r.status}
        </Badge>
      ),
    },
    { key: 'message', header: 'Detail', render: (r) => <span className="text-xs text-ink-muted">{r.message}</span> },
  ];

  return (
    <div>
      <PageHeader
        title={existing ? 'Edit Automation' : 'Create Automation'}
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Automations', to: '/crm/automation' }, { label: existing ? 'Edit' : 'Create' }]}
      />

      <Tabs
        items={[
          { key: 'details', label: 'Automation', icon: <Settings2 size={14} /> },
          ...(existing ? [{ key: 'runs', label: 'Run History', icon: <History size={14} />, badge: existing.runCount || undefined }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'runs' && existing ? (
        <div className="pt-4">
          <Card padded={false}>
            <DataTable
              columns={runColumns}
              rows={runs?.items ?? []}
              rowKey={(r) => r.id}
              isLoading={runsLoading}
              emptyTitle="No runs yet"
              emptyDescription="Every time this automation's trigger fires — or an admin runs it manually — the outcome lands here."
            />
          </Card>
        </div>
      ) : (
        <div className="grid gap-5 pt-4 lg:grid-cols-3">
          <div className="flex flex-col gap-5 lg:col-span-2">
            <Card>
              <CardHeader title="Basic Details" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Automation Name" required value={values.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Send new-listing alert" />
                <Textarea label="Description" value={values.description ?? ''} onChange={(v) => patch({ description: v })} placeholder="What this automation does, for your own reference." />
                <Toggle label="Active" checked={values.enabled} onChange={(v) => patch({ enabled: v })} />
                <Toggle
                  label="Respect business hours"
                  description="Skip triggers outside the configured business-hours window."
                  checked={values.respectBusinessHours}
                  onChange={(v) => patch({ respectBusinessHours: v })}
                />
              </div>
            </Card>

            <Card padded={false}>
              <div className="p-5 pb-0">
                <CardHeader title="Steps" subtitle="Add Conditions (filters), Actions, and Delays. Steps execute top-to-bottom. Drag to reorder." />
              </div>

              <div className="flex flex-col gap-3 px-5 pb-5">
                {values.steps.map((step, index) => (
                  <StepCard
                    key={index}
                    step={step}
                    index={index}
                    dragIndex={dragIndex}
                    onDragStart={() => setDragIndex(index)}
                    onDragEnd={() => setDragIndex(null)}
                    onDrop={() => {
                      if (dragIndex !== null && dragIndex !== index) moveStep(dragIndex, index);
                      setDragIndex(null);
                    }}
                    onRemove={() => removeStep(index)}
                    onTypeChange={(type) => updateStep(index, { type, config: {} })}
                    onConfigChange={(patchConfig) => updateStepConfig(index, patchConfig)}
                    sourceOptions={sourceOptions}
                    assignableUsers={assignableUsers}
                    tags={tags ?? []}
                    adForms={adSources?.forms ?? []}
                    stagesForConfig={stagesForConfig}
                    sdrAgents={(sdrAgents ?? []).map((a) => ({ id: a.id, name: a.name }))}
                    emailSequences={(emailSequences ?? []).map((q) => ({ id: q.id, name: q.name }))}
                  />
                ))}

                {values.steps.length === 0 && (
                  <p className="rounded-lg border border-dashed border-line-strong bg-surface-subtle px-4 py-6 text-center text-sm text-ink-faint">
                    No steps yet — add a condition, action, or delay below.
                  </p>
                )}

                <div className="flex justify-center gap-2 pt-1">
                  <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => addStep('condition')}>
                    Add Condition
                  </Button>
                  <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => addStep('action')}>
                    Add Action
                  </Button>
                  <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => addStep('delay')}>
                    Add Delay
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Trigger" subtitle="Define when this automation fires." />
              <div className="flex flex-col gap-4">
                <Select
                  label="Trigger Event"
                  required
                  value={values.triggerType}
                  onChange={(e) => patch({ triggerType: e.target.value as AutomationTriggerType, triggerConfig: {} })}
                  options={TRIGGER_OPTIONS}
                />

                {trigger?.hasConfig && (
                  <div className="rounded-lg border border-line bg-surface-subtle p-3.5">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">Trigger Configuration</p>
                    <TriggerConfigFields
                      triggerType={values.triggerType}
                      config={values.triggerConfig ?? {}}
                      onChange={(patchConfig) => patch({ triggerConfig: { ...values.triggerConfig, ...patchConfig } })}
                      stages={stagesForConfig}
                      pipelines={pipelines}
                      tags={tags ?? []}
                      forms={forms?.items ?? []}
                    />
                  </div>
                )}

                {values.triggerType === 'manual' && (
                  <p className="flex items-start gap-2 rounded-lg bg-surface-subtle px-3 py-2.5 text-xs text-ink-muted">
                    <Info size={13} className="mt-0.5 shrink-0 text-ink-faint" />
                    Manual automations only run when triggered from the leads list's "Run automation" bulk action — never automatically.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'details' && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={handleSave} isLoading={isSaving}>
            Save changes
          </Button>
          <Button variant="outline" onClick={() => navigate('/crm/automation')} disabled={isSaving}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trigger configuration — fields depend on the selected trigger type.
// ---------------------------------------------------------------------------

interface TriggerConfigFieldsProps {
  triggerType: AutomationTriggerType;
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  stages: { id: string; name: string; pipelineId: string }[];
  pipelines: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  forms: { id: string; name: string }[];
}

function TriggerConfigFields({ triggerType, config, onChange, stages, tags, forms }: TriggerConfigFieldsProps) {
  if (triggerType === 'lead_stage_changed') {
    return (
      <div className="flex flex-col gap-3">
        <Select
          label="From Stage"
          value={(config.fromStageId as string) ?? ''}
          onChange={(e) => onChange({ fromStageId: e.target.value || undefined })}
          options={[{ value: '', label: 'Any stage' }, ...stages.map((s) => ({ value: s.id, label: s.name }))]}
        />
        <Select
          label="To Stage"
          value={(config.toStageId as string) ?? ''}
          onChange={(e) => onChange({ toStageId: e.target.value || undefined })}
          options={[{ value: '', label: 'Any stage' }, ...stages.map((s) => ({ value: s.id, label: s.name }))]}
        />
      </div>
    );
  }
  if (triggerType === 'lead_score_threshold') {
    return (
      <Input
        label="Score greater than"
        type="number"
        value={(config.scoreGt as number) ?? ''}
        onChange={(e) => onChange({ scoreGt: Number(e.target.value) })}
      />
    );
  }
  if (triggerType === 'tag_added') {
    return (
      <Select
        label="Tag"
        value={(config.tagId as string) ?? ''}
        onChange={(e) => onChange({ tagId: e.target.value || undefined })}
        options={[{ value: '', label: 'Any tag' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]}
      />
    );
  }
  if (triggerType === 'form_submitted') {
    return (
      <Select
        label="Form"
        value={(config.formId as string) ?? ''}
        onChange={(e) => onChange({ formId: e.target.value || undefined })}
        options={[{ value: '', label: 'Any form' }, ...forms.map((f) => ({ value: f.id, label: f.name }))]}
      />
    );
  }
  if (triggerType === 'no_activity') {
    return (
      <Input
        label="Days with no activity"
        type="number"
        min={1}
        value={(config.days as number) ?? 3}
        onChange={(e) => onChange({ days: Math.max(1, Number(e.target.value) || 1) })}
        hint="Checked every minute in the background; fires at most once per lead."
      />
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// One step card — renders the config form for whichever type/action is selected.
// ---------------------------------------------------------------------------

interface StepCardProps {
  step: AutomationStep;
  index: number;
  dragIndex: number | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onRemove: () => void;
  onTypeChange: (type: AutomationStepType) => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
  sourceOptions: { value: string; label: string }[];
  assignableUsers: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  adForms: { name: string; count: number }[];
  stagesForConfig: { id: string; name: string; pipelineId: string }[];
  sdrAgents: { id: string; name: string }[];
  emailSequences: { id: string; name: string }[];
}

function StepCard({
  step, index, dragIndex, onDragStart, onDragEnd, onDrop, onRemove, onTypeChange, onConfigChange,
  sourceOptions, assignableUsers, tags, adForms, stagesForConfig, sdrAgents, emailSequences,
}: StepCardProps) {
  const label =
    step.type === 'condition'
      ? `Condition: ${step.config.conditionType ?? '—'}`
      : step.type === 'action'
      ? `Action: ${step.config.action ?? '—'}`
      : `Wait ${step.config.amount ?? 1} ${step.config.unit ?? 'hours'}`;

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={cn('rounded-lg border border-line bg-surface-subtle', dragIndex === index && 'opacity-60 ring-2 ring-brand-600')}
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            aria-label={`Reorder step ${index + 1}`}
            className="cursor-grab rounded p-1 text-ink-faint hover:bg-surface-muted hover:text-ink focus-ring active:cursor-grabbing"
          >
            <GripVertical size={15} />
          </button>
          <span className="text-xs font-medium text-ink-muted">{label}</span>
        </div>
        <button type="button" onClick={onRemove} aria-label={`Remove step ${index + 1}`} className="rounded p-1 text-danger-600 hover:bg-danger-50 focus-ring">
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <Select label="Step Type" required value={step.type} onChange={(e) => onTypeChange(e.target.value as AutomationStepType)} options={STEP_TYPE_OPTIONS} />

        <div className="rounded-lg border border-line bg-white p-3">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {step.type === 'condition' ? 'Condition Config' : step.type === 'action' ? 'Action Config' : 'Delay Config'}
          </p>

          {step.type === 'condition' && (
            <ConditionConfigFields config={step.config} onChange={onConfigChange} sourceOptions={sourceOptions} assignableUsers={assignableUsers} tags={tags} adForms={adForms} />
          )}
          {step.type === 'action' && (
            <ActionConfigFields config={step.config} onChange={onConfigChange} assignableUsers={assignableUsers} tags={tags} stagesForConfig={stagesForConfig} sdrAgents={sdrAgents} emailSequences={emailSequences} />
          )}
          {step.type === 'delay' && <DelayConfigFields config={step.config} onChange={onConfigChange} />}
        </div>
      </div>
    </div>
  );
}

/** The blank first entry that makes "nothing chosen yet" visible in a select. */
const UNSET = { value: '', label: 'Choose…' };

function ConditionConfigFields({
  config, onChange, sourceOptions, assignableUsers, tags, adForms,
}: {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  sourceOptions: { value: string; label: string }[];
  assignableUsers: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  adForms: { name: string; count: number }[];
}) {
  const conditionType = (config.conditionType as AutomationConditionType) ?? 'source_is';
  const chosenForms = (config.values as string[]) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Select label="Condition Type" required value={conditionType} onChange={(e) => onChange({ conditionType: e.target.value, value: '', fieldName: '', values: [] })} options={CONDITION_OPTIONS} />

      {conditionNeedsValueList(conditionType) && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">
            {conditionType === 'ad_form_is' ? 'Run only for leads from these ad forms' : 'Skip leads from these ad forms'}
          </span>
          {adForms.length === 0 ? (
            <p className="rounded-lg border border-line px-3 py-2 text-sm text-ink-faint">
              No Meta ad forms have produced a lead yet, so there is nothing to choose.
            </p>
          ) : (
            <>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-line-strong p-2">
                {adForms.map((f) => (
                  <label key={f.name} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-ink hover:bg-surface-subtle">
                    <input
                      type="checkbox"
                      checked={chosenForms.includes(f.name)}
                      onChange={() =>
                        onChange({
                          values: chosenForms.includes(f.name)
                            ? chosenForms.filter((v) => v !== f.name)
                            : [...chosenForms, f.name],
                        })
                      }
                      className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring"
                    />
                    <span className="flex-1">{f.name}</span>
                    <span className="text-xs text-ink-faint">{f.count}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-ink-faint">
                Same list as the Ad Form filter on the Leads page. A lead that did not come from a
                Meta ad has no form, so it fails "is one of" and passes "is none of".
              </p>
            </>
          )}
        </div>
      )}

      {/* Every one of these carries a "choose…" first option on purpose. Without it the select
          shows its first real entry while the step has saved nothing, so a condition nobody
          filled in looks filled in — and then quietly fails for every lead. */}
      {(conditionType === 'source_is' || conditionType === 'source_is_not') && (
        <Select label="Source" required value={(config.value as string) ?? ''} onChange={(e) => onChange({ value: e.target.value })} options={[UNSET, ...sourceOptions]} />
      )}
      {(conditionType === 'has_tag' || conditionType === 'not_has_tag') && (
        <Select label="Tag" required value={(config.value as string) ?? ''} onChange={(e) => onChange({ value: e.target.value })} options={[UNSET, ...tags.map((t) => ({ value: t.id, label: t.name }))]} />
      )}
      {conditionType === 'assigned_to' && (
        <Select label="User" required value={(config.value as string) ?? ''} onChange={(e) => onChange({ value: e.target.value })} options={[UNSET, ...assignableUsers.map((u) => ({ value: u.id, label: u.name }))]} />
      )}
      {(conditionType === 'score_gt' || conditionType === 'score_lt') && (
        <Input label="Score" required type="number" value={(config.value as string) ?? ''} onChange={(e) => onChange({ value: e.target.value })} />
      )}
      {conditionNeedsField(conditionType) && (
        <Input
          label="Field Name"
          required
          list="condition-field-suggestions"
          value={(config.fieldName as string) ?? ''}
          onChange={(e) => onChange({ fieldName: e.target.value })}
          placeholder="e.g. pipeline_stage.name"
        />
      )}
      {conditionNeedsField(conditionType) && conditionNeedsValue(conditionType) && (
        <Input label="Value" value={(config.value as string) ?? ''} onChange={(e) => onChange({ value: e.target.value })} />
      )}
      <datalist id="condition-field-suggestions">
        {CONDITION_FIELD_SUGGESTIONS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </div>
  );
}

function ActionConfigFields({
  config, onChange, assignableUsers, tags, stagesForConfig, sdrAgents, emailSequences,
}: {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  assignableUsers: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  stagesForConfig: { id: string; name: string; pipelineId: string }[];
  sdrAgents: { id: string; name: string }[];
  emailSequences: { id: string; name: string }[];
}) {
  const action = (config.action as string) ?? 'assign_lead';

  return (
    <div className="flex flex-col gap-3">
      <Select label="Action" required value={action} onChange={(e) => onChange({ action: e.target.value })} options={ACTION_OPTIONS} />

      {action === 'assign_lead' && (
        <>
          <Select label="Assign Mode" value={(config.assignMode as string) ?? 'round_robin'} onChange={(e) => onChange({ assignMode: e.target.value })} options={ASSIGN_MODE_OPTIONS} />
          {config.assignMode === 'team' ? (
            <Select
              label="Team"
              required
              value={(config.assignTeamId as string) ?? ''}
              onChange={(e) => onChange({ assignTeamId: e.target.value })}
              options={refTeams.map((t) => ({ value: t.id, label: t.name }))}
            />
          ) : config.assignMode === 'sequence' ? (
            <DistributionOrder
              entries={(config.assignSequence as AssignSequenceEntry[]) ?? []}
              onChange={(assignSequence) => onChange({ assignSequence })}
              users={assignableUsers}
            />
          ) : (
            <MultiUserSelect
              label={config.assignMode === 'specific' ? 'User' : 'Users (round robin between these)'}
              selected={(config.assignUserIds as string[]) ?? []}
              onChange={(ids) => onChange({ assignUserIds: config.assignMode === 'specific' ? ids.slice(-1) : ids })}
              users={assignableUsers}
            />
          )}
          <Toggle label="Overwrite existing owner" checked={!!config.overwrite} onChange={(v) => onChange({ overwrite: v })} />
        </>
      )}

      {(action === 'add_tag' || action === 'remove_tag') && (
        <Select label="Tag" required value={(config.tagId as string) ?? ''} onChange={(e) => onChange({ tagId: e.target.value })} options={[UNSET, ...tags.map((t) => ({ value: t.id, label: t.name }))]} />
      )}

      {action === 'change_stage' && (
        <Select label="Stage" required value={(config.stageId as string) ?? ''} onChange={(e) => onChange({ stageId: e.target.value })} options={[UNSET, ...stagesForConfig.map((s) => ({ value: s.id, label: s.name }))]} />
      )}

      {action === 'update_field' && (
        <>
          <Select label="Field" required value={(config.field as string) ?? 'priority'} onChange={(e) => onChange({ field: e.target.value })} options={UPDATE_FIELD_OPTIONS} />
          <Input label="Value" required value={(config.value as string) ?? ''} onChange={(e) => onChange({ value: e.target.value })} />
        </>
      )}

      {action === 'create_followup' && (
        <>
          <Input label="Title" required value={(config.title as string) ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder="Follow up with the lead" />
          <Textarea label="Description" value={(config.description as string) ?? ''} onChange={(v) => onChange({ description: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Due in" type="number" min={1} value={(config.dueInAmount as number) ?? 1} onChange={(e) => onChange({ dueInAmount: Number(e.target.value) })} />
            <Select label="Unit" value={(config.dueInUnit as string) ?? 'hours'} onChange={(e) => onChange({ dueInUnit: e.target.value })} options={DELAY_UNIT_OPTIONS} />
          </div>
        </>
      )}

      {action === 'enroll_in_sequence' && (
        <>
          <Select
            label="Email sequence"
            required
            value={(config.sequenceId as string) ?? ''}
            onChange={(e) => onChange({ sequenceId: e.target.value })}
            options={[{ value: '', label: 'Select a sequence' }, ...emailSequences.map((q) => ({ value: q.id, label: q.name }))]}
          />
          <p className="text-xs text-ink-faint">
            The lead is enrolled and the first step is scheduled from its own delay. A lead already active in the
            sequence, or one with no email address, is left alone.
          </p>
        </>
      )}

      {action === 'enroll_in_sdr_agent' && (
        <>
          <Select
            label="AI SDR Agent"
            required
            value={(config.agentId as string) ?? ''}
            onChange={(e) => onChange({ agentId: e.target.value })}
            options={[{ value: '', label: 'Select an agent' }, ...sdrAgents.map((a) => ({ value: a.id, label: a.name }))]}
          />
          <p className="text-xs text-ink-faint">
            The lead is enrolled with this agent, subject to the agent's own guardrails. A lead already enrolled is left alone.
          </p>
        </>
      )}

      {action === 'send_email' && (
        <>
          <Input label="Subject" required value={(config.subject as string) ?? ''} onChange={(e) => onChange({ subject: e.target.value })} />
          <Textarea label="Body" value={(config.body as string) ?? ''} onChange={(v) => onChange({ body: v })} rows={3} />
          <p className="flex items-start gap-2 rounded-md bg-warning-50 px-2.5 py-2 text-xs text-warning-700">
            <Info size={13} className="mt-0.5 shrink-0" />
            No email provider is configured — this logs what would be sent as an activity and a note on the lead, but nothing
            is actually delivered.
          </p>
        </>
      )}
    </div>
  );
}

function DelayConfigFields({ config, onChange }: { config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input label="Wait" required type="number" min={1} value={(config.amount as number) ?? 1} onChange={(e) => onChange({ amount: Math.max(1, Number(e.target.value) || 1) })} />
      <Select label="Unit" required value={(config.unit as string) ?? 'hours'} onChange={(e) => onChange({ unit: e.target.value })} options={DELAY_UNIT_OPTIONS} />
    </div>
  );
}

function MultiUserSelect({
  label, selected, onChange, users,
}: {
  label: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  users: { id: string; name: string }[];
}) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((u) => u !== id) : [...selected, id]);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-line-strong p-2">
        {users.map((u) => (
          <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-ink hover:bg-surface-subtle">
            <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4 rounded border-line-strong text-brand-600 focus-ring" />
            {u.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function Textarea({ label, value, onChange, placeholder, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  const id = `ta-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
      />
    </div>
  );
}

/**
 * A distribution rota: an ordered list of people, each taking a set number of leads before the
 * turn passes on, wrapping at the end.
 *
 * Order matters and so do duplicates — the same person may appear twice with different counts,
 * which is the whole point of letting the order be written by hand rather than derived.
 */
function DistributionOrder({
  entries, onChange, users,
}: {
  entries: AssignSequenceEntry[];
  onChange: (entries: AssignSequenceEntry[]) => void;
  users: { id: string; name: string }[];
}) {
  const patch = (index: number, next: Partial<AssignSequenceEntry>) =>
    onChange(entries.map((e, i) => (i === index ? { ...e, ...next } : e)));

  const move = (index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const total = entries.reduce((sum, e) => sum + (Number(e.count) || 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">Distribution order</span>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-faint">
          Nobody in the rota yet. Add the first person below.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right font-mono text-xs text-ink-faint">{index + 1}.</span>
              <Select
                aria-label={`Person ${index + 1}`}
                value={entry.userId}
                onChange={(e) => patch(index, { userId: e.target.value })}
                options={[{ value: '', label: 'Choose…' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
                wrapperClassName="flex-1"
              />
              <Input
                aria-label={`Leads for person ${index + 1}`}
                type="number"
                min={1}
                value={String(entry.count)}
                onChange={(e) => patch(index, { count: Math.max(1, Number(e.target.value) || 1) })}
                wrapperClassName="w-24"
              />
              <div className="flex shrink-0 gap-1">
                <Button variant="outline" size="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ChevronUp size={14} />
                </Button>
                <Button variant="outline" size="icon" aria-label="Move down" disabled={index === entries.length - 1} onClick={() => move(index, 1)}>
                  <ChevronDown size={14} />
                </Button>
                <Button variant="outline" size="icon" aria-label="Remove" onClick={() => onChange(entries.filter((_, i) => i !== index))}>
                  <X size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => onChange([...entries, { userId: '', count: 10 }])}>
          Add person
        </Button>
        {total > 0 && (
          <span className="text-xs text-ink-muted">
            {total} leads per full cycle, then it starts again from the top.
          </span>
        )}
      </div>

      <p className="text-xs text-ink-faint">
        Leads are dealt in this order — the first person takes their count, then the next, and round again. The same
        person can appear more than once if they should come up twice in a cycle.
      </p>
    </div>
  );
}
