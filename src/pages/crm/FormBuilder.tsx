import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Copy, GripVertical, Lock, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { PublicFormRenderer } from '../../components/forms/PublicFormRenderer';
import { useAsync } from '../../hooks/useAsync';
import { useDisclosure } from '../../hooks/useDisclosure';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';
import { useToast } from '../../context/ToastContext';
import {
  createForm, embedSnippet, FIELD_TYPE_OPTIONS, getForm, LEAD_FIELD_KEYS, publicFormUrl, slugify, updateForm,
} from '../../services/formService';
import { listAssignableUsers } from '../../services/leadService';
import { cn } from '../../utils/cn';
import type { LeadForm, LeadFormField, LeadFormInput, PublicLeadForm } from '../../types';

/** The consent row the server always appends — shown here so the builder isn't lying about the form. */
const GDPR_PREVIEW: LeadFormField = {
  type: 'gdpr_consent',
  label: 'I consent to being contacted about this enquiry.',
  fieldKey: 'consent',
  step: 1,
  required: true,
};

type FormValues = Omit<LeadFormInput, 'fields' | 'recaptchaSecretKey'>;

function initialValues(existing?: LeadForm): FormValues {
  return {
    name: existing?.name ?? '',
    slug: existing?.slug ?? '',
    displayTitle: existing?.displayTitle ?? '',
    description: existing?.description ?? '',
    submitLabel: existing?.submitLabel ?? 'Submit',
    thankYouMessage: existing?.thankYouMessage ?? '',
    redirectUrl: existing?.redirectUrl ?? '',
    isMultiStep: existing?.isMultiStep ?? false,
    isActive: existing?.isActive ?? true,
    pipelineId: existing?.pipelineId ?? '',
    pipelineStageId: existing?.pipelineStageId ?? '',
    assignedUserId: existing?.assignedUserId ?? '',
    accentColor: existing?.accentColor ?? '#C34245',
    layout: existing?.layout ?? 'card',
    recaptchaEnabled: existing?.recaptchaEnabled ?? false,
    recaptchaSiteKey: existing?.recaptchaSiteKey ?? '',
  };
}

function initialFields(existing?: LeadForm): LeadFormField[] {
  // The consent field is generated server-side, so it is never one of the editable rows.
  const rows = (existing?.fields ?? []).filter((f) => f.type !== 'gdpr_consent');
  if (rows.length > 0) return rows.map((f) => ({ ...f, options: f.options ?? [] }));
  return [{ type: 'short_text', label: '', placeholder: '', fieldKey: '', step: 1, required: true, options: [] }];
}

export function FormBuilder() {
  const { id } = useParams<{ id: string }>();
  const [resetKey, setResetKey] = useState(0);
  const { data, isLoading, error } = useAsync(() => (id ? getForm(id) : Promise.resolve(undefined)), [id]);

  if (id && isLoading) return <CardSkeleton />;
  if (id && (error || !data)) {
    return <ErrorState title="Form not found" description={error?.message ?? 'This form may have been deleted.'} />;
  }

  // Keyed so the editor mounts with its values already set — no reset effects, and
  // "Create & create another" simply bumps the key to get a clean form.
  return <FormEditor key={`${id ?? 'new'}-${resetKey}`} existing={data} onCreatedAnother={() => setResetKey((k) => k + 1)} />;
}

function FormEditor({ existing, onCreatedAnother }: { existing?: LeadForm; onCreatedAnother: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { pipelines, stagesForPipeline } = usePipelineReferenceData();
  const assignableUsers = listAssignableUsers();

  const [values, setValues] = useState<FormValues>(() => initialValues(existing));
  const [fields, setFields] = useState<LeadFormField[]>(() => initialFields(existing));
  /** In create mode the slug tracks the name until the user types their own. */
  const [slugEdited, setSlugEdited] = useState(!!existing);
  const [secretKey, setSecretKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const patch = (next: Partial<FormValues>) => setValues((prev) => ({ ...prev, ...next }));

  const updateField = (index: number, next: Partial<LeadFormField>) =>
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...next } : f)));

  const removeField = (index: number) => setFields((prev) => prev.filter((_, i) => i !== index));

  const moveField = (from: number, to: number) =>
    setFields((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });

  const addField = () =>
    setFields((prev) => [
      ...prev,
      { type: 'short_text', label: '', placeholder: '', fieldKey: '', step: values.isMultiStep ? 1 : 1, required: false, options: [] },
    ]);

  const previewForm: PublicLeadForm = useMemo(
    () => ({
      slug: values.slug || 'preview',
      displayTitle: values.displayTitle || values.name || 'Untitled form',
      description: values.description,
      submitLabel: values.submitLabel || 'Submit',
      thankYouMessage: values.thankYouMessage,
      isMultiStep: values.isMultiStep,
      accentColor: values.accentColor,
      layout: values.layout,
      recaptchaEnabled: false,
      recaptchaSiteKey: null,
      fields: [
        ...fields.filter((f) => f.label.trim()).map((f, i) => ({ ...f, id: `preview-${i}` })),
        { ...GDPR_PREVIEW, id: 'preview-consent', step: values.isMultiStep ? Math.max(...fields.map((f) => f.step || 1), 1) : 1 },
      ],
    }),
    [values, fields]
  );

  /** Mirrors the server's checks so problems surface before a round trip. */
  const validate = (): string | null => {
    if (!values.name.trim()) return 'Form name is required.';
    if (!slugify(values.slug)) return 'Slug is required and must contain a letter or number.';
    if (!values.submitLabel.trim()) return 'Submit button label is required.';
    if (fields.length === 0) return 'Add at least one field.';
    for (const field of fields) {
      if (!field.label.trim()) return 'Every field needs a label.';
      if (!field.fieldKey.trim()) return `Field "${field.label}" needs a field key.`;
      if (field.type === 'dropdown' && (field.options ?? []).filter((o) => o.trim()).length === 0) {
        return `Dropdown "${field.label}" needs at least one option.`;
      }
    }
    const keys = fields.map((f) => f.fieldKey.trim().toLowerCase());
    const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
    if (duplicate) return `Duplicate field key "${duplicate}" — each key must be unique.`;
    return null;
  };

  const handleSave = async (createAnother = false) => {
    const problem = validate();
    if (problem) {
      toast({ title: 'Check the form', description: problem, variant: 'error' });
      return;
    }

    const payload: LeadFormInput = {
      ...values,
      slug: slugify(values.slug),
      displayTitle: values.displayTitle || undefined,
      description: values.description || undefined,
      thankYouMessage: values.thankYouMessage || undefined,
      redirectUrl: values.redirectUrl || undefined,
      pipelineId: values.pipelineId || undefined,
      pipelineStageId: values.pipelineStageId || undefined,
      assignedUserId: values.assignedUserId || undefined,
      recaptchaSiteKey: values.recaptchaSiteKey || undefined,
      recaptchaSecretKey: secretKey.trim() || undefined,
      fields: fields.map((f, index) => ({
        type: f.type,
        label: f.label.trim(),
        placeholder: f.placeholder?.trim() || null,
        fieldKey: f.fieldKey.trim(),
        step: values.isMultiStep ? Math.max(1, f.step || 1) : 1,
        required: f.required,
        options: f.type === 'dropdown' ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : null,
        sortOrder: index,
      })),
    };

    setIsSaving(true);
    try {
      if (existing) {
        await updateForm(existing.id, payload);
        toast({ title: 'Form saved', description: `"${payload.name}" is live at /f/${payload.slug}`, variant: 'success' });
        navigate(`/crm/forms/${existing.id}`);
      } else {
        const created = await createForm(payload);
        toast({ title: 'Form created', description: `Public link: /f/${created.slug}`, variant: 'success' });
        if (createAnother) onCreatedAnother();
        else navigate(`/crm/forms/${created.id}`);
      }
    } catch (err) {
      toast({ title: 'Could not save the form', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const stageOptions = values.pipelineId
    ? stagesForPipeline(values.pipelineId).map((s) => ({ value: s.id, label: s.name }))
    : [];

  return (
    <div>
      <PageHeader
        title={existing ? 'Edit Form' : 'Create Form'}
        description={
          existing
            ? 'Changes go live immediately on the public link and every embed of it.'
            : 'Build a public form — every submission becomes a lead in this CRM.'
        }
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Forms', to: '/crm/forms' }, { label: existing ? 'Edit' : 'Create' }]}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <CardHeader title="Basic Details" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Form Name"
                name="name"
                required
                value={values.name}
                onChange={(e) => {
                  const name = e.target.value;
                  patch(slugEdited ? { name } : { name, slug: slugify(name) });
                }}
                placeholder="e.g. Property Interest Form"
              />
              <Input
                label="Slug"
                name="slug"
                required
                value={values.slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  patch({ slug: e.target.value });
                }}
                hint="Used in the public URL."
                placeholder="property-interest"
              />
              <Input
                label="Display Title"
                name="displayTitle"
                value={values.displayTitle ?? ''}
                onChange={(e) => patch({ displayTitle: e.target.value })}
                placeholder="Tell us about your dream home"
                hint="Shown as the heading on the form itself."
              />
              <Textarea
                label="Description"
                value={values.description ?? ''}
                onChange={(value) => patch({ description: value })}
                placeholder="A short form to match you with the right properties."
              />
              <Input
                label="Submit Button Label"
                name="submitLabel"
                required
                value={values.submitLabel}
                onChange={(e) => patch({ submitLabel: e.target.value })}
                placeholder="Find My Home"
              />
              <Textarea
                label="Thank-You Message"
                value={values.thankYouMessage ?? ''}
                onChange={(value) => patch({ thankYouMessage: value })}
                placeholder="Thanks! An agent will reach out within one business day."
              />
              <Input
                label="Redirect URL after submission"
                name="redirectUrl"
                value={values.redirectUrl ?? ''}
                onChange={(e) => patch({ redirectUrl: e.target.value })}
                placeholder="https://example.com/thank-you"
                hint="Leave empty to show the thank-you message instead."
              />
              <Toggle
                label="Multi-Step Form"
                description="Group fields into numbered steps."
                checked={values.isMultiStep}
                onChange={(checked) => patch({ isMultiStep: checked })}
                className="sm:mt-6"
              />
              <Toggle
                label="Active"
                description="An inactive form keeps its link but stops accepting submissions."
                checked={values.isActive}
                onChange={(checked) => patch({ isActive: checked })}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Pipeline Connection" subtitle="Where a lead from this form lands, and who owns it." />
            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label="Pipeline"
                name="pipelineId"
                value={values.pipelineId ?? ''}
                onChange={(e) => patch({ pipelineId: e.target.value, pipelineStageId: '' })}
                options={[{ value: '', label: 'Select an option' }, ...pipelines.map((p) => ({ value: p.id, label: p.name }))]}
              />
              <Select
                label="Stage"
                name="pipelineStageId"
                value={values.pipelineStageId ?? ''}
                onChange={(e) => patch({ pipelineStageId: e.target.value })}
                options={[{ value: '', label: values.pipelineId ? 'Select an option' : 'Pick a pipeline first' }, ...stageOptions]}
                disabled={!values.pipelineId}
              />
              <Select
                label="Assign leads to"
                name="assignedUserId"
                value={values.assignedUserId ?? ''}
                onChange={(e) => patch({ assignedUserId: e.target.value })}
                options={[{ value: '', label: 'Unassigned' }, ...assignableUsers.map((u) => ({ value: u.id, label: u.name }))]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Form Fields"
              subtitle="Drag to reorder. The GDPR consent field is always added last and cannot be removed or edited."
            />

            <div className="flex flex-col gap-3">
              {fields.map((field, index) => (
                <div
                  key={index}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null && dragIndex !== index) moveField(dragIndex, index);
                    setDragIndex(null);
                  }}
                  className={cn(
                    'rounded-lg border border-line bg-surface-subtle',
                    dragIndex === index && 'opacity-60 ring-2 ring-brand-600'
                  )}
                >
                  <div className="flex items-center justify-between border-b border-line px-3 py-2">
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDragIndex(index)}
                      onDragEnd={() => setDragIndex(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          moveField(index, index - 1);
                        }
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          moveField(index, index + 1);
                        }
                      }}
                      aria-label={`Reorder field ${index + 1}. Use arrow up and arrow down keys.`}
                      className="cursor-grab rounded p-1 text-ink-faint hover:bg-surface-muted hover:text-ink focus-ring active:cursor-grabbing"
                    >
                      <GripVertical size={15} />
                    </button>
                    <span className="text-xs font-medium text-ink-faint">Field {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeField(index)}
                      aria-label={`Remove field ${index + 1}`}
                      className="rounded p-1 text-danger-600 hover:bg-danger-50 focus-ring"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div className="grid gap-4 p-3 sm:grid-cols-3">
                    <Select
                      label="Field Type"
                      name={`field-${index}-type`}
                      required
                      value={field.type}
                      onChange={(e) => updateField(index, { type: e.target.value as LeadFormField['type'] })}
                      options={FIELD_TYPE_OPTIONS.filter((o) => o.value !== 'gdpr_consent')}
                    />
                    <Input
                      label="Label"
                      name={`field-${index}-label`}
                      required
                      value={field.label}
                      onChange={(e) => updateField(index, { label: e.target.value })}
                      placeholder="Full Name"
                    />
                    <Input
                      label="Placeholder / Helper"
                      name={`field-${index}-placeholder`}
                      value={field.placeholder ?? ''}
                      onChange={(e) => updateField(index, { placeholder: e.target.value })}
                    />
                    <Input
                      label="Field Key"
                      name={`field-${index}-key`}
                      required
                      value={field.fieldKey}
                      onChange={(e) => updateField(index, { fieldKey: e.target.value })}
                      placeholder="e.g. email, firstName"
                      hint="Maps field to lead property."
                      list="lead-field-keys"
                    />
                    <Input
                      label="Step #"
                      name={`field-${index}-step`}
                      type="number"
                      min={1}
                      value={field.step}
                      onChange={(e) => updateField(index, { step: Math.max(1, Number(e.target.value) || 1) })}
                      disabled={!values.isMultiStep}
                      hint={values.isMultiStep ? undefined : 'Enable Multi-Step above to use steps.'}
                    />
                    <Toggle
                      label="Required"
                      checked={field.required}
                      onChange={(checked) => updateField(index, { required: checked })}
                      className="sm:mt-6"
                    />

                    {field.type === 'dropdown' && (
                      <div className="sm:col-span-3">
                        <Textarea
                          label="Options (one per line)"
                          value={(field.options ?? []).join('\n')}
                          onChange={(value) => updateField(index, { options: value.split('\n') })}
                          placeholder={'Under ₹50L\n₹50L - ₹1Cr\nAbove ₹1Cr'}
                          hint="Enter each option on a new line."
                          rows={3}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <datalist id="lead-field-keys">
                {LEAD_FIELD_KEYS.map((key) => (
                  <option key={key} value={key} />
                ))}
              </datalist>

              {/* The consent field, shown locked so the builder matches what visitors will see. */}
              <div className="flex items-start justify-between gap-3 rounded-lg border border-dashed border-line-strong bg-white px-3 py-3">
                <div className="flex items-start gap-2.5">
                  <Lock size={14} className="mt-0.5 shrink-0 text-ink-faint" />
                  <div>
                    <p className="text-sm font-medium text-ink">{GDPR_PREVIEW.label}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      GDPR consent · key <code className="text-ink">consent</code> · always last, always required.
                    </p>
                  </div>
                </div>
                <Badge tone="neutral">Locked</Badge>
              </div>

              <div className="flex justify-center pt-1">
                <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={addField}>
                  Add Field
                </Button>
              </div>
            </div>
          </Card>

          <CollapsibleCard title="Live Preview" subtitle="A live preview of how the form will appear to visitors." defaultOpen>
            <div className={values.layout === 'card' ? 'rounded-xl border border-line bg-white p-5' : ''}>
              <PublicFormRenderer form={previewForm} mode="preview" />
            </div>
          </CollapsibleCard>
        </div>

        <div className="flex flex-col gap-5">
          <CollapsibleCard title="Appearance">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="accent-color" className="text-sm font-medium text-ink">
                  Accent colour
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="accent-color"
                    type="color"
                    value={values.accentColor}
                    onChange={(e) => patch({ accentColor: e.target.value })}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-line-strong bg-white p-1"
                  />
                  <Input
                    aria-label="Accent colour hex"
                    value={values.accentColor}
                    onChange={(e) => patch({ accentColor: e.target.value })}
                    wrapperClassName="flex-1"
                  />
                </div>
                <p className="text-xs text-ink-faint">Used for the submit button and required markers.</p>
              </div>
              <Select
                label="Layout"
                name="layout"
                value={values.layout}
                onChange={(e) => patch({ layout: e.target.value as 'card' | 'plain' })}
                options={[
                  { value: 'card', label: 'Card — white panel with a border' },
                  { value: 'plain', label: 'Plain — no panel, inherits the page' },
                ]}
              />
            </div>
          </CollapsibleCard>

          <CollapsibleCard title="Spam Protection">
            <div className="flex flex-col gap-4">
              <Toggle
                label="Enable reCAPTCHA v3"
                description="Verified server-side on every submission once a secret key is saved."
                checked={values.recaptchaEnabled}
                onChange={(checked) => patch({ recaptchaEnabled: checked })}
              />
              {values.recaptchaEnabled && (
                <>
                  <Input
                    label="Site key"
                    name="recaptchaSiteKey"
                    value={values.recaptchaSiteKey ?? ''}
                    onChange={(e) => patch({ recaptchaSiteKey: e.target.value })}
                    placeholder="6Lc..."
                  />
                  <Input
                    label="Secret key"
                    name="recaptchaSecretKey"
                    type="password"
            secret
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    placeholder={existing?.hasRecaptchaSecret ? '•••••••• (stored — type to replace)' : '6Lc...'}
                    hint="Encrypted at rest and never sent back to the browser."
                  />
                </>
              )}
              <p className="rounded-lg bg-surface-subtle px-3 py-2 text-xs text-ink-muted">
                A hidden honeypot field is always active, with or without reCAPTCHA — bot submissions are dropped silently.
              </p>
            </div>
          </CollapsibleCard>

          {existing && (
            <CollapsibleCard title="Embed Snippet" subtitle="Paste this into any webpage to show the form there.">
              <EmbedBox slug={existing.slug} title={existing.displayTitle || existing.name} />
            </CollapsibleCard>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => handleSave(false)} isLoading={isSaving}>
          {existing ? 'Save changes' : 'Create'}
        </Button>
        {!existing && (
          <Button variant="secondary" onClick={() => handleSave(true)} disabled={isSaving}>
            Create &amp; create another
          </Button>
        )}
        <Button variant="ghost" onClick={() => navigate('/crm/forms')} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local building blocks
// ---------------------------------------------------------------------------

interface TextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
}

function Textarea({ label, value, onChange, placeholder, hint, rows = 2 }: TextareaProps) {
  const id = `ta-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
      />
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

function CollapsibleCard({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const { isOpen, toggle } = useDisclosure(defaultOpen);
  return (
    <Card padded={false}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left focus-ring"
      >
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
        </div>
        <ChevronDown size={16} className={cn('mt-0.5 shrink-0 text-ink-faint transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && <div className="border-t border-line px-5 py-4">{children}</div>}
    </Card>
  );
}

export function EmbedBox({ slug, title }: { slug: string; title: string }) {
  const { toast } = useToast();
  const snippet = embedSnippet(slug, title);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} copied`, variant: 'success' });
    } catch {
      toast({ title: `Could not copy the ${what.toLowerCase()}`, description: 'Select the text and copy it manually.', variant: 'error' });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Public link</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-subtle px-3 py-2 text-xs text-ink">{publicFormUrl(slug)}</code>
          <Button variant="outline" size="sm" leftIcon={<Copy size={12} />} onClick={() => copy(publicFormUrl(slug), 'Link')}>
            Copy
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Embed snippet</span>
        <textarea
          readOnly
          rows={4}
          value={snippet}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-line bg-surface-subtle px-3 py-2 font-mono text-[11px] leading-relaxed text-ink"
        />
        <Button variant="outline" size="sm" leftIcon={<Copy size={12} />} onClick={() => copy(snippet, 'Snippet')}>
          Copy snippet
        </Button>
      </div>
    </div>
  );
}
