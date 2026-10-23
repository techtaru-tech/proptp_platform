import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useToast } from '../../context/ToastContext';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { getBroadcastSource } from '../../services/whatsappTemplateService';
import { createDrip, DRIP_STATUS_OPTIONS, getDrip, updateDrip } from '../../services/whatsappDripService';
import type { ApprovedWhatsAppTemplate, WhatsAppDripInput, WhatsAppDripStep } from '../../types';

function blankStep(): WhatsAppDripStep {
  return { delayDays: 0, delayHours: 0, templateName: '', language: 'en', params: [] };
}

/** Builds or edits a campaign: an ordered list of approved templates, each with the wait before it. */
export function WhatsAppDripBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<WhatsAppDripInput>({
    name: '', description: '', status: 'draft', stopOnReply: true, stopOnWon: true, steps: [{ ...blankStep() }],
  });
  const [templates, setTemplates] = useState<ApprovedWhatsAppTemplate[]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const source = await getBroadcastSource();
        if (!cancelled) setTemplates(source.templates);
      } catch (err) {
        if (!cancelled) setTemplateError(err instanceof Error ? err.message : 'Could not read the approved templates.');
      }
      if (id) {
        const drip = await getDrip(id);
        if (!cancelled && drip) {
          setForm({
            name: drip.name, description: drip.description ?? '', status: drip.status,
            stopOnReply: drip.stopOnReply, stopOnWon: drip.stopOnWon, steps: drip.steps ?? [],
          });
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <CardSkeleton />;

  const patchStep = (index: number, patch: Partial<WhatsAppDripStep>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));

  const pickTemplate = (index: number, name: string) => {
    const t = templates.find((x) => x.name === name);
    // The first variable is nearly always the person's name, so it starts as the token.
    patchStep(index, {
      templateName: name,
      language: t?.language ?? 'en',
      params: t ? Array.from({ length: t.variableCount }, (_, i) => (i === 0 ? '{first_name}' : '')) : [],
      headerMediaUrl: undefined,
    });
  };

  const move = (index: number, by: -1 | 1) =>
    setForm((f) => {
      const steps = [...f.steps];
      const target = index + by;
      if (target < 0 || target >= steps.length) return f;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...f, steps };
    });

  const uploadHeader = async (index: number, file: File | undefined) => {
    if (!file) return;
    setUploadingIndex(index);
    try {
      const [url] = await uploadFiles([file]);
      const link = fileUrl(url) ?? url;
      patchStep(index, { headerMediaUrl: /^https?:/i.test(link) ? link : `${window.location.origin}${link}` });
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setUploadingIndex(null);
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast({ title: 'Give the campaign a name', variant: 'error' });
    for (const [i, step] of form.steps.entries()) {
      const t = templates.find((x) => x.name === step.templateName);
      if (!step.templateName) return toast({ title: `Step ${i + 1} needs a template`, variant: 'error' });
      if (t?.unsupported) return toast({ title: `Step ${i + 1} cannot be sent from here`, description: t.unsupported, variant: 'error' });
      if (t && step.params.some((p) => !p.trim())) return toast({ title: `Fill every variable in step ${i + 1}`, variant: 'error' });
      if (t?.headerFormat && !/^https:\/\/\S+$/i.test(step.headerMediaUrl ?? '')) {
        return toast({ title: `Add the ${t.headerFormat.toLowerCase()} for step ${i + 1}`, description: 'Upload a file or paste a public https link.', variant: 'error' });
      }
    }
    setSaving(true);
    try {
      const result = id ? await updateDrip(id, form) : await createDrip(form);
      toast({ title: id ? 'Campaign saved' : 'Campaign created', variant: 'success' });
      navigate(`/crm/whatsapp-drips/${result.id}`);
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={id ? 'Edit drip campaign' : 'New drip campaign'}
        description="Pick an approved template for each step and how long to wait before it goes out."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Drips', to: '/crm/whatsapp-drips' }, { label: id ? 'Edit' : 'New' }]}
      />

      {templateError && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            Could not read your approved templates: {templateError}. Check <a className="underline" href="/settings/whatsapp">Settings → WhatsApp</a>, then reload.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Campaign" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Diwali lab offer" required />
            <Select label="Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as WhatsAppDripInput['status'] }))} options={DRIP_STATUS_OPTIONS} />
            <Input label="Description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} wrapperClassName="sm:col-span-2" />
            <Toggle label="Stop when the lead replies" description="Any WhatsApp message from the lead ends their run, so a person can answer." checked={form.stopOnReply} onChange={(v) => setForm((f) => ({ ...f, stopOnReply: v }))} />
            <Toggle label="Stop when the lead is won" description="Nobody should get a sales nudge after they have bought." checked={form.stopOnWon} onChange={(v) => setForm((f) => ({ ...f, stopOnWon: v }))} />
          </div>
        </Card>

        {form.steps.map((step, index) => {
          const template = templates.find((t) => t.name === step.templateName);
          const preview = step.params.reduce(
            (text, value, i) => text.replace(new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, 'g'), value || `{{${i + 1}}}`),
            template?.body ?? ''
          );
          return (
            <Card key={index}>
              <CardHeader
                title={`Step ${index + 1}`}
                subtitle={index === 0 ? 'Goes out this long after the lead is enrolled' : 'Goes out this long after the previous step'}
                action={
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></Button>
                    <Button variant="ghost" size="icon" aria-label="Move down" disabled={index === form.steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></Button>
                    <Button variant="ghost" size="icon" aria-label="Remove step" className="text-danger-600" disabled={form.steps.length === 1} onClick={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== index) }))}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                }
              />
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
                  <Input label="Days" type="number" min={0} value={String(step.delayDays)} onChange={(e) => patchStep(index, { delayDays: Math.max(0, Number(e.target.value) || 0) })} />
                  <Input label="Hours" type="number" min={0} value={String(step.delayHours)} onChange={(e) => patchStep(index, { delayHours: Math.max(0, Number(e.target.value) || 0) })} />
                </div>

                <Select
                  label="Template"
                  value={step.templateName}
                  onChange={(e) => pickTemplate(index, e.target.value)}
                  options={[
                    { value: '', label: templates.length ? 'Choose an approved template…' : 'No approved templates available' },
                    // A saved step whose template has since been deleted or revoked stays visible rather than vanishing.
                    ...(step.templateName && !template ? [{ value: step.templateName, label: `${step.templateName} (not approved any more)` }] : []),
                    ...templates.map((t) => ({ value: t.name, label: `${t.name} · ${t.language}` })),
                  ]}
                />

                {template?.unsupported && <p className="text-sm text-warning-700">{template.unsupported}</p>}

                {template && template.variableCount > 0 && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {Array.from({ length: template.variableCount }).map((_, i) => (
                      <Input
                        key={i}
                        label={`Variable ${i + 1}`}
                        value={step.params[i] ?? ''}
                        onChange={(e) => patchStep(index, { params: Array.from({ length: template.variableCount }, (_, j) => (j === i ? e.target.value : step.params[j] ?? '')) })}
                        hint={i === 0 ? 'Tokens: {first_name}, {last_name}, {full_name} — each lead gets their own.' : undefined}
                      />
                    ))}
                  </div>
                )}

                {template?.headerFormat && (
                  <div className="space-y-2">
                    <Input
                      label={`${template.headerFormat.charAt(0)}${template.headerFormat.slice(1).toLowerCase()} for this step`}
                      value={step.headerMediaUrl ?? ''}
                      onChange={(e) => patchStep(index, { headerMediaUrl: e.target.value })}
                      placeholder="https://…  or upload a file"
                      hint="Public https link. WhatsApp downloads it when the message is sent."
                    />
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-subtle">
                      <Upload size={14} />
                      {uploadingIndex === index ? 'Uploading…' : 'Upload from this computer'}
                      <input
                        type="file"
                        className="hidden"
                        accept={template.headerFormat === 'IMAGE' ? 'image/jpeg,image/png' : template.headerFormat === 'VIDEO' ? 'video/mp4' : 'application/pdf'}
                        onChange={(e) => void uploadHeader(index, e.target.files?.[0])}
                      />
                    </label>
                  </div>
                )}

                {template && <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-subtle p-3 text-sm text-ink">{preview}</p>}
              </div>
            </Card>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" leftIcon={<Plus size={14} />} onClick={() => setForm((f) => ({ ...f, steps: [...f.steps, blankStep()] }))}>
            Add step
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/crm/whatsapp-drips')}>Cancel</Button>
            <Button variant="primary" isLoading={saving} onClick={save}>{id ? 'Save campaign' : 'Create campaign'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
