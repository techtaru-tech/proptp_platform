import { useState } from 'react';
import { ArrowRight, Check, Info, Plus } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  createCustomField, getMetaFormQuestions, listMappingTargets, listMetaForms, saveMetaFormMapping,
  CUSTOM_FIELD_TYPES,
} from '../../services/leadFieldService';
import type { MetaFormMapping } from '../../types';

/**
 * Maps a Meta form's questions onto CRM fields.
 *
 * Mapping is per form, not per connection — two forms on the same Page ask different things.
 * A question with no target still works: the automatic name matching that was there before
 * runs as a fallback, and anything it cannot place is kept as a note on the lead.
 */
export function MetaFieldMapping({ connectionId }: { connectionId: string }) {
  const { toast } = useToast();
  const [formId, setFormId] = useState('');
  const [targetsKey, setTargetsKey] = useState(0);
  const [formsKey, setFormsKey] = useState(0);
  // Bumped after a save so the saved mapping is read back — without it the screen kept
  // showing what it had loaded before the save and looked like nothing had happened.
  const [formKey, setFormKey] = useState(0);

  const { data: forms, isLoading: formsLoading, error: formsError } = useAsync(
    () => listMetaForms(connectionId),
    [connectionId, formsKey]
  );
  const { data: targets } = useAsync(() => listMappingTargets(), [targetsKey]);
  const { data: form, isLoading: formLoading } = useAsync(
    () => (formId ? getMetaFormQuestions(connectionId, formId) : Promise.resolve(undefined)),
    [connectionId, formId, formKey]
  );

  const [draft, setDraft] = useState<MetaFormMapping | null>(null);
  const [saving, setSaving] = useState(false);
  const [newFieldFor, setNewFieldFor] = useState<string | null>(null);

  // The saved mapping is the starting point; `draft` only exists once something is changed.
  const mapping = draft ?? form?.mapping ?? {};

  const setTarget = (question: string, value: string) =>
    setDraft({ ...(draft ?? form?.mapping ?? {}), [question]: value });

  const options = [
    { value: '', label: 'Auto-detect' },
    { value: 'ignore', label: "Don't import" },
    ...(targets?.builtIn ?? []).map((t) => ({ value: t.value, label: t.label })),
    ...(targets?.custom ?? []).map((c) => ({ value: `custom:${c.key}`, label: `${c.label} (custom)` })),
  ];

  /** Turns `custom:budget` / `firstName` into the label shown in the dropdown. */
  const labelForTarget = (value: string): string =>
    options.find((o) => o.value === value)?.label ?? value;

  const handleSave = async () => {
    if (!formId) return;
    setSaving(true);
    try {
      await saveMetaFormMapping(connectionId, formId, mapping);
      toast({ title: 'Mapping saved', description: 'It applies to new leads and to any future import.', variant: 'success' });
      setDraft(null);
      setFormKey((k) => k + 1);
      setFormsKey((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (formsError) {
    return (
      <Card>
        <p className="text-sm text-danger-600">{formsError.message}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          Pick a form, then say where each question should land. A question left on{' '}
          <strong>Auto-detect</strong> is matched by name (full name, phone, email, city and so on);
          anything that still has nowhere to go is kept as a note on the lead, so no answer is lost.
        </p>
      </div>

      <Select
        label="Form"
        value={formId}
        onChange={(e) => {
          setFormId(e.target.value);
          setDraft(null);
        }}
        options={[
          { value: '', label: formsLoading ? 'Loading forms...' : 'Select a form' },
          ...(forms ?? []).map((f) => ({
            value: f.id,
            label: `${f.name}${f.mappedCount > 0 ? `  ·  ${f.mappedCount} mapped` : ''}`,
          })),
        ]}
      />

      {formId && formLoading && <p className="text-sm text-ink-faint">Reading the form's questions...</p>}

      {form && (
        <Card padded={false}>
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-medium text-ink">{form.formName}</p>
            <p className="text-xs text-ink-faint">{form.questions.length} question(s) on this form</p>
          </div>

          <div className="divide-y divide-line">
            {form.questions.map((q) => {
              const value = mapping[q.name] ?? '';
              return (
                <div key={q.name} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink" title={q.label}>{q.label}</p>
                    <p className="truncate text-xs text-ink-faint" title={q.name}>
                      {q.name}
                      {q.options.length > 0 && ` · ${q.options.length} options`}
                    </p>
                    {/* The select truncates a long Hindi field name, so the resolved target
                        is spelled out here where it has the full width to itself. */}
                    <p className="mt-0.5 text-xs">
                      {value === 'ignore' ? (
                        <span className="text-ink-faint">Not imported</span>
                      ) : value ? (
                        <span className="text-success-700">→ {labelForTarget(value)}</span>
                      ) : (
                        <span className="text-ink-faint">→ auto-detect</span>
                      )}
                    </p>
                  </div>
                  <ArrowRight size={14} className="hidden shrink-0 text-ink-faint sm:block" />
                  <div className="flex shrink-0 items-center gap-1.5 sm:w-72">
                    <Select
                      aria-label={`Map ${q.label}`}
                      title={labelForTarget(value)}
                      value={value}
                      onChange={(e) => setTarget(q.name, e.target.value)}
                      options={options}
                      wrapperClassName="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Create a field for this question"
                      title="Create a new CRM field for this question"
                      onClick={() => setNewFieldFor(q.name)}
                    >
                      <Plus size={15} />
                    </Button>
                    {value && value !== 'ignore' && <Check size={14} className="shrink-0 text-success-600" />}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-xs">
              <span className="text-ink-faint">
                {Object.values(mapping).filter((v) => v && v !== 'ignore').length} of {form.questions.length} mapped
              </span>
              {draft ? (
                <span className="ml-2 font-medium text-warning-700">Unsaved changes</span>
              ) : (
                <span className="ml-2 text-success-700">Saved</span>
              )}
            </span>
            <div className="flex gap-2">
              {draft && (
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  Reset
                </Button>
              )}
              <Button variant="primary" size="sm" isLoading={saving} onClick={handleSave}>
                Save Mapping
              </Button>
            </div>
          </div>
        </Card>
      )}

      <CreateFieldModal
        questionName={newFieldFor}
        questionLabel={form?.questions.find((q) => q.name === newFieldFor)?.label}
        questionOptions={form?.questions.find((q) => q.name === newFieldFor)?.options ?? []}
        onClose={() => setNewFieldFor(null)}
        onCreated={(key) => {
          if (newFieldFor) setTarget(newFieldFor, `custom:${key}`);
          setNewFieldFor(null);
          setTargetsKey((k) => k + 1);
        }}
      />
    </div>
  );
}

function CreateFieldModal({
  questionName, questionLabel, questionOptions, onClose, onCreated,
}: {
  questionName: string | null;
  questionLabel?: string;
  questionOptions: string[];
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [saving, setSaving] = useState(false);

  // Seeded from the question so the common case is one click, and cleared on close.
  const open = !!questionName;
  const effectiveLabel = label || questionLabel || '';
  const effectiveType = type === 'text' && questionOptions.length > 0 ? 'dropdown' : type;

  const handleCreate = async () => {
    if (!effectiveLabel.trim()) return;
    setSaving(true);
    try {
      const created = await createCustomField({
        label: effectiveLabel.trim(),
        type: effectiveType,
        options: effectiveType === 'dropdown' ? questionOptions : undefined,
      });
      toast({ title: `Field "${created.label}" created`, variant: 'success' });
      setLabel('');
      setType('text');
      onCreated(created.key);
    } catch (err) {
      toast({ title: 'Could not create the field', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Create a field"
      description="A new field on every lead, available to map from any form."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" isLoading={saving} onClick={handleCreate} disabled={!effectiveLabel.trim()}>
            Create &amp; Map
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Field name"
          required
          value={effectiveLabel}
          onChange={(e) => setLabel(e.target.value)}
          hint="Shown on the lead. The internal key is derived from this and never changes."
        />
        <Select
          label="Type"
          value={effectiveType}
          onChange={(e) => setType(e.target.value)}
          options={CUSTOM_FIELD_TYPES}
        />
        {effectiveType === 'dropdown' && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Options</p>
            {questionOptions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {questionOptions.map((o) => (
                  <Badge key={o} tone="neutral">{o}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-faint">
                This question has no fixed choices, so the answer is stored as text.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
