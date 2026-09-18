import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { RichTextEditor } from '../../components/ui/RichTextEditor';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  createEmailSequence, getEmailSequence, listEmailTemplates, updateEmailSequence,
  SEQUENCE_STATUS_OPTIONS,
} from '../../services/emailSequenceService';
import type { EmailSequence, EmailSequenceInput, EmailSequenceStep, EmailTemplate } from '../../types';

const PLACEHOLDER_HINT = 'Placeholders: {first_name}, {last_name}, {company}, {email}';

function emptyStep(): EmailSequenceStep {
  return { delayDays: 0, delayHours: 0, subject: '', body: '' };
}

function initialValues(existing?: EmailSequence): EmailSequenceInput {
  return {
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    status: existing?.status ?? 'draft',
    stopOnReply: existing?.stopOnReply ?? true,
    stopOnWon: existing?.stopOnWon ?? true,
    steps: existing?.steps?.length ? existing.steps.map((s) => ({ ...s })) : [emptyStep()],
  };
}

export function EmailSequenceBuilder() {
  const { id } = useParams<{ id: string }>();
  const [resetKey, setResetKey] = useState(0);
  const { data, isLoading, error } = useAsync(() => (id ? getEmailSequence(id) : Promise.resolve(undefined)), [id]);

  if (id && isLoading) return <CardSkeleton />;
  if (id && (error || !data)) {
    return <ErrorState title="Sequence not found" description={error?.message ?? 'This sequence may have been deleted.'} />;
  }

  return <SequenceEditor key={`${id ?? 'new'}-${resetKey}`} existing={data} onCreatedAnother={() => setResetKey((k) => k + 1)} />;
}

function SequenceEditor({ existing, onCreatedAnother }: { existing?: EmailSequence; onCreatedAnother: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: templates } = useAsync(() => listEmailTemplates(), []);

  const [values, setValues] = useState<EmailSequenceInput>(() => initialValues(existing));
  const [isSaving, setIsSaving] = useState(false);

  const patch = (next: Partial<EmailSequenceInput>) => setValues((prev) => ({ ...prev, ...next }));

  const patchStep = (index: number, next: Partial<EmailSequenceStep>) =>
    setValues((prev) => ({
      ...prev,
      steps: prev.steps.map((step, i) => (i === index ? { ...step, ...next } : step)),
    }));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= values.steps.length) return;
    const steps = [...values.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    patch({ steps });
  };

  const removeStep = (index: number) => patch({ steps: values.steps.filter((_, i) => i !== index) });

  const validate = (): string | null => {
    if (!values.name.trim()) return 'Sequence name is required.';
    if (values.steps.length === 0) return 'A sequence needs at least one step.';
    if (values.steps.some((s) => !s.subject.trim())) return 'Every step needs a subject.';
    if (values.steps.some((s) => !stripHtml(s.body))) return 'Every step needs a body.';
    return null;
  };

  const handleSave = async (createAnother = false) => {
    const problem = validate();
    if (problem) {
      toast({ title: 'Check the form', description: problem, variant: 'error' });
      return;
    }
    setIsSaving(true);
    try {
      if (existing) {
        await updateEmailSequence(existing.id, values);
        toast({ title: 'Sequence updated', description: `${values.name} has been saved.`, variant: 'success' });
        navigate('/crm/email-sequences');
      } else {
        await createEmailSequence(values);
        toast({ title: 'Sequence created', description: `${values.name} has been added.`, variant: 'success' });
        if (createAnother) onCreatedAnother();
        else navigate('/crm/email-sequences');
      }
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : 'Please try again.', variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={existing ? 'Edit Email Sequence' : 'Create Email Sequence'}
        breadcrumb={[
          { label: 'Email Sequences', to: '/crm/email-sequences' },
          { label: existing ? 'Edit' : 'Create' },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sequence Info" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Sequence Name" required value={values.name} onChange={(e) => patch({ name: e.target.value })} />
            <Select
              label="Status"
              required
              value={values.status}
              onChange={(e) => patch({ status: e.target.value as EmailSequenceInput['status'] })}
              options={SEQUENCE_STATUS_OPTIONS}
              hint={values.status === 'active' ? 'Due steps will start going out.' : 'Held — enrollments stay put and nothing sends.'}
            />
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="sequence-description" className="text-sm font-medium text-ink">Description</label>
              <textarea
                id="sequence-description"
                rows={3}
                value={values.description}
                onChange={(e) => patch({ description: e.target.value })}
                className="w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Behavior" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Toggle
              label="Stop when lead replies"
              description="Unenroll automatically when an inbound email from the lead is recorded."
              checked={values.stopOnReply}
              onChange={(stopOnReply) => patch({ stopOnReply })}
            />
            <Toggle
              label="Stop when lead is won"
              description='Unenroll automatically when the lead&apos;s status becomes "won".'
              checked={values.stopOnWon}
              onChange={(stopOnWon) => patch({ stopOnWon })}
            />
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Steps"
          subtitle="Emails are sent top-to-bottom. Delay is measured from the previous step (or from enrollment for the first step)."
        />
        <div className="space-y-4">
          {values.steps.map((step, index) => (
            <StepEditor
              key={index}
              index={index}
              step={step}
              templates={templates ?? []}
              isFirst={index === 0}
              isLast={index === values.steps.length - 1}
              onChange={(next) => patchStep(index, next)}
              onMove={(direction) => move(index, direction)}
              onRemove={() => removeStep(index)}
            />
          ))}
          <div className="flex justify-center">
            <Button type="button" variant="outline" leftIcon={<Plus size={14} />} onClick={() => patch({ steps: [...values.steps, emptyStep()] })}>
              Add Step
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <Button variant="primary" isLoading={isSaving} onClick={() => handleSave(false)}>
          {existing ? 'Save Changes' : 'Create'}
        </Button>
        {!existing && (
          <Button variant="outline" isLoading={isSaving} onClick={() => handleSave(true)}>
            Create &amp; create another
          </Button>
        )}
        <Button variant="ghost" onClick={() => navigate('/crm/email-sequences')}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Body is HTML from the editor — "empty" means no text once the markup is taken out. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

interface StepEditorProps {
  index: number;
  step: EmailSequenceStep;
  templates: EmailTemplate[];
  isFirst: boolean;
  isLast: boolean;
  onChange: (next: Partial<EmailSequenceStep>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function StepEditor({ index, step, templates, isFirst, isLast, onChange, onMove, onRemove }: StepEditorProps) {
  const [templateId, setTemplateId] = useState('');

  const loadTemplate = (id: string) => {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    // Prefill only — the step keeps its own copy, so editing the template later leaves it alone.
    if (template) onChange({ subject: template.subject, body: template.body.replace(/\n/g, '<br>') });
  };

  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-subtle px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button type="button" variant="ghost" size="icon" aria-label="Move step up" disabled={isFirst} onClick={() => onMove(-1)}>
            <ArrowUp size={14} />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Move step down" disabled={isLast} onClick={() => onMove(1)}>
            <ArrowDown size={14} />
          </Button>
          <span className="truncate text-sm text-ink">
            Step {index + 1} — {step.delayDays}d {step.delayHours}h — {step.subject || <span className="text-ink-faint">no subject yet</span>}
          </span>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Remove step" className="text-danger-600 hover:bg-danger-50" onClick={onRemove}>
          <Trash2 size={15} />
        </Button>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Delay (days)"
            required
            type="number"
            min={0}
            value={step.delayDays}
            onChange={(e) => onChange({ delayDays: Math.max(0, Number(e.target.value) || 0) })}
          />
          <Input
            label="Delay (hours)"
            required
            type="number"
            min={0}
            value={step.delayHours}
            onChange={(e) => onChange({ delayHours: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>

        <Select
          label="Load from template"
          value={templateId}
          onChange={(e) => loadTemplate(e.target.value)}
          options={[{ value: '', label: 'Select a template' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]}
          hint="Pick a saved email template to fill the subject and body below. You can still edit them after loading."
        />

        <Input
          label="Subject"
          required
          value={step.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          hint={PLACEHOLDER_HINT}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">
            Body<span className="text-accent-600"> *</span>
          </span>
          <RichTextEditor
            ariaLabel={`Step ${index + 1} body`}
            value={step.body}
            onChange={(body) => onChange({ body })}
            placeholder="Write the email..."
          />
          <p className="text-xs text-ink-faint">{PLACEHOLDER_HINT}</p>
        </div>
      </div>
    </div>
  );
}
