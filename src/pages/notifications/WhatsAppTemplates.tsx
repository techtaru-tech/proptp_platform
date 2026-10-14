import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Info, Send, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useToast } from '../../context/ToastContext';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';
import {
  LEAD_PRIORITY_OPTIONS, LEAD_STATUS_OPTIONS, listAssignableUsers,
} from '../../services/leadService';
import {
  getBroadcastSource, listWhatsAppSends, previewAudience, sendBroadcast,
} from '../../services/whatsappTemplateService';
import { formatDateTime } from '../../utils/format';
import type {
  BroadcastAudience, BroadcastLeadFilter, WhatsAppBroadcastSource, WhatsAppTemplateSendRow,
} from '../../types';

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All Sources' },
  { value: 'meta', label: 'Meta Lead Ads' },
  { value: 'web_form', label: 'Web Form' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'manual', label: 'Manual' },
  { value: 'referral', label: 'Referral' },
];

export function WhatsAppTemplates() {
  const [source, setSource] = useState<WhatsAppBroadcastSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sends, setSends] = useState<WhatsAppTemplateSendRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setSource(await getBroadcastSource());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read the approved templates.');
    }
    setSends(await listWhatsAppSends(50).catch(() => []));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <CardSkeleton />;

  return (
    <div>
      <PageHeader
        title="WhatsApp Broadcast"
        description="Send an approved template to a filtered set of leads, or to numbers you paste in."
        breadcrumb={[{ label: 'Notifications', to: '/notifications' }, { label: 'WhatsApp Broadcast' }]}
      />

      {loadError ? (
        <Card>
          <div className="flex items-start gap-2.5 text-sm text-danger-600">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{loadError}</p>
              <p className="mt-1 text-ink-muted">
                Templates are read live from Meta, so this needs a linked number with a working access token —
                see <a className="underline" href="/settings/whatsapp">Settings → WhatsApp</a>.
              </p>
            </div>
          </div>
        </Card>
      ) : source ? (
        <>
          <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
            <Info size={16} className="mt-0.5 shrink-0" />
            <p>
              Sending from <strong>{source.account.label} · {source.account.displayPhone}</strong>. Templates come straight
              from Meta, so this list is exactly what is approved right now. Replies land in{' '}
              <a className="underline" href="/crm/conversations">CRM → Conversations</a>.
            </p>
          </div>

          <BroadcastForm source={source} onSent={load} />
        </>
      ) : null}

      <Card>
        <CardHeader title="Recent sends" subtitle="The last 50 recipients, whether they went through or not" />
        {sends.length === 0 ? (
          <p className="text-sm text-ink-faint">Nothing has been sent yet.</p>
        ) : (
          <div className="space-y-1.5">
            {sends.map((s) => (
              <div key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-1.5 text-sm last:border-0">
                <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <Badge tone={s.status === 'sent' ? 'success' : 'danger'}>{s.status}</Badge>
                  <span className="font-medium text-ink">{s.destination}</span>
                  <span className="text-ink-muted">{s.templateName}</span>
                  {s.errorMessage && <span className="text-danger-600">{s.errorMessage}</span>}
                </span>
                <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(s.sentAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function BroadcastForm({ source, onSent }: { source: WhatsAppBroadcastSource; onSent: () => Promise<void> }) {
  const { toast } = useToast();
  const { pipelines, stagesForPipeline } = usePipelineReferenceData();
  const assignableUsers = listAssignableUsers();

  const [templateName, setTemplateName] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [numbers, setNumbers] = useState('');
  const [useLeadFilter, setUseLeadFilter] = useState(false);
  const [leadFilter, setLeadFilter] = useState<BroadcastLeadFilter>({});
  const [audience, setAudience] = useState<BroadcastAudience | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const template = source.templates.find((t) => t.name === templateName);

  useEffect(() => {
    // A template's first variable is nearly always the person's name, so it starts as the token.
    setParams(template ? template.variableCount > 0 ? ['{first_name}', ...Array(template.variableCount - 1).fill('')] : [] : []);
  }, [templateName, template]);

  const audienceInput = useMemo(
    () => ({ numbers, useLeadFilter, leadFilter }),
    [numbers, useLeadFilter, leadFilter]
  );

  // Recount whenever the audience changes, so Send always states a number that is current.
  useEffect(() => {
    let cancelled = false;
    if (!numbers.trim() && !useLeadFilter) {
      setAudience(null);
      return;
    }
    setChecking(true);
    const timer = setTimeout(() => {
      previewAudience(audienceInput)
        .then((result) => {
          if (!cancelled) setAudience(result);
        })
        .catch(() => {
          if (!cancelled) setAudience(null);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audienceInput, numbers, useLeadFilter]);

  const patchFilter = (next: Partial<BroadcastLeadFilter>) => setLeadFilter((prev) => ({ ...prev, ...next }));

  const send = async () => {
    if (!template) return;
    setConfirmOpen(false);
    setSending(true);
    try {
      const result = await sendBroadcast({ ...audienceInput, templateName: template.name, language: template.language, params, headerMediaUrl: template.headerFormat ? headerMediaUrl.trim() : undefined });
      toast({
        title: `${result.sent} sent${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
        description: result.failed > 0 ? result.results.find((r) => !r.ok)?.message : undefined,
        variant: result.failed > 0 ? 'warning' : 'success',
      });
      if (result.failed === 0) setNumbers('');
      await onSent();
    } catch (err) {
      toast({ title: 'Could not send', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSending(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!template) return toast({ title: 'Pick a template first', variant: 'error' });
    if (template.unsupported) return toast({ title: 'This template cannot be sent from here', description: template.unsupported, variant: 'error' });
    if (template.headerFormat && !/^https:\/\/\S+$/i.test(headerMediaUrl.trim())) {
      return toast({ title: `Add the ${template.headerFormat.toLowerCase()} link`, description: 'This template has a file header — paste a public https link to it.', variant: 'error' });
    }
    if (!audience || audience.count === 0) return toast({ title: 'Nobody matches yet', description: 'Paste some numbers or switch on the lead filter.', variant: 'error' });
    if (audience.overLimit) return toast({ title: `That reaches ${audience.count} people`, description: `Narrow it to ${audience.limit} or fewer.`, variant: 'error' });
    setConfirmOpen(true);
  };

  const preview = params.reduce(
    (text, value, index) => text.replace(new RegExp(`\\{\\{\\s*${index + 1}\\s*\\}\\}`, 'g'), value || `{{${index + 1}}}`),
    template?.body ?? ''
  );

  return (
    <form onSubmit={submit} className="mb-5 flex flex-col gap-5">
      <Card>
        <CardHeader title="The message" subtitle={`${source.templates.length} approved templates on this number`} />
        <div className="space-y-4">
          <Select
            label="Template"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            options={[
              { value: '', label: source.templates.length ? 'Choose a template…' : 'No approved templates on this number' },
              ...source.templates.map((t) => ({
                value: t.name,
                label: `${t.name} · ${t.language}${t.variableCount ? ` · ${t.variableCount} variable${t.variableCount === 1 ? '' : 's'}` : ''}`,
              })),
            ]}
          />

          {template?.unsupported && (
            <p className="flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {template.unsupported}
            </p>
          )}

          {template?.headerFormat && (
            <Input
              label={`${template.headerFormat.charAt(0)}${template.headerFormat.slice(1).toLowerCase()} link`}
              value={headerMediaUrl}
              onChange={(e) => setHeaderMediaUrl(e.target.value)}
              placeholder="https://…"
              hint="Public https link. WhatsApp downloads the file from here when the message is sent."
            />
          )}

          {template && template.variableCount > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: template.variableCount }).map((_, index) => (
                <Input
                  key={index}
                  label={`Variable ${index + 1}`}
                  value={params[index] ?? ''}
                  onChange={(e) => setParams((prev) => prev.map((p, i) => (i === index ? e.target.value : p)))}
                  hint={index === 0 ? `Tokens: ${source.tokens.map((t) => `{${t}}`).join(', ')}` : undefined}
                />
              ))}
            </div>
          )}

          {template && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Preview</p>
              <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-subtle p-3 text-sm text-ink">
                {preview || template.body}
              </p>
              {params.some((p) => /\{[a-z_]+\}/i.test(p)) && (
                <p className="mt-1.5 text-xs text-ink-faint">
                  Tokens are filled in per person — each lead gets their own name.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Who gets it" subtitle="Paste numbers, filter your leads, or both" />
        <div className="space-y-4">
          <Textarea
            label="Phone numbers"
            rows={3}
            value={numbers}
            onChange={setNumbers}
            placeholder={'9876543210\n9123456789'}
            hint="One per line, or separated by commas. Leave blank to send only to the filtered leads."
          />

          <div className="rounded-lg border border-line">
            <div className="border-b border-line px-3.5 py-3">
              <Toggle
                label="Send to leads matching a filter"
                description="The same filters as the Leads table. Numbers you pasted above are included as well."
                checked={useLeadFilter}
                onChange={setUseLeadFilter}
              />
            </div>

            {useLeadFilter && (
              <div className="grid grid-cols-1 gap-4 p-3.5 sm:grid-cols-2 lg:grid-cols-3">
                <Select
                  label="Status"
                  value={leadFilter.status ?? 'all'}
                  onChange={(e) => patchFilter({ status: e.target.value })}
                  options={LEAD_STATUS_OPTIONS}
                />
                <Select
                  label="Priority"
                  value={leadFilter.priority ?? 'all'}
                  onChange={(e) => patchFilter({ priority: e.target.value })}
                  options={LEAD_PRIORITY_OPTIONS}
                />
                <Select
                  label="Source"
                  value={leadFilter.source ?? 'all'}
                  onChange={(e) => patchFilter({ source: e.target.value })}
                  options={SOURCE_OPTIONS}
                />
                <Select
                  label="Pipeline"
                  value={leadFilter.pipelineId ?? 'all'}
                  onChange={(e) => patchFilter({ pipelineId: e.target.value, stageId: 'all' })}
                  options={[{ value: 'all', label: 'All Pipelines' }, ...pipelines.map((p) => ({ value: p.id, label: p.name }))]}
                />
                <Select
                  label="Stage"
                  value={leadFilter.stageId ?? 'all'}
                  onChange={(e) => patchFilter({ stageId: e.target.value })}
                  options={[
                    { value: 'all', label: 'All Stages' },
                    { value: 'none', label: 'Not on a pipeline' },
                    ...(leadFilter.pipelineId && leadFilter.pipelineId !== 'all'
                      ? stagesForPipeline(leadFilter.pipelineId).map((s) => ({ value: s.id, label: s.name }))
                      : []),
                  ]}
                />
                <Select
                  label="Assigned to"
                  value={leadFilter.assignedUserId ?? 'all'}
                  onChange={(e) => patchFilter({ assignedUserId: e.target.value })}
                  options={[
                    { value: 'all', label: 'Anyone' },
                    { value: 'none', label: 'Unassigned' },
                    ...assignableUsers.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                />
                <Input
                  label="Created from"
                  type="date"
                  value={leadFilter.dateFrom ?? ''}
                  onChange={(e) => patchFilter({ dateFrom: e.target.value })}
                />
                <Input
                  label="Created to"
                  type="date"
                  value={leadFilter.dateTo ?? ''}
                  onChange={(e) => patchFilter({ dateTo: e.target.value })}
                />
                <Input
                  label="Search"
                  value={leadFilter.search ?? ''}
                  onChange={(e) => patchFilter({ search: e.target.value })}
                  placeholder="Name, phone or email"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-subtle px-3.5 py-3">
            <span className="flex items-center gap-2 text-sm">
              {audience?.overLimit ? <AlertTriangle size={15} className="text-warning-600" /> : <Users size={15} className="text-ink-faint" />}
              {checking ? (
                <span className="text-ink-muted">Counting…</span>
              ) : audience ? (
                <span className={audience.overLimit ? 'text-warning-700' : 'text-ink'}>
                  <strong>{audience.count}</strong> {audience.count === 1 ? 'person' : 'people'}
                  {audience.overLimit && ` — over the limit of ${audience.limit}`}
                  {audience.sample.length > 0 && (
                    <span className="text-ink-muted">
                      {' · '}
                      {audience.sample.map((s) => s.name || s.phone).join(', ')}
                      {audience.count > audience.sample.length && ' …'}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-ink-faint">Nobody yet — paste numbers or switch on the filter.</span>
              )}
            </span>
            <Button
              type="submit"
              variant="primary"
              leftIcon={<Send size={14} />}
              isLoading={sending}
              disabled={!template || !audience || audience.count === 0 || audience.overLimit}
            >
              Send to {audience?.count ?? 0}
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmationDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={send}
        title={`Send "${template?.name}" to ${audience?.count ?? 0} ${audience?.count === 1 ? 'person' : 'people'}?`}
        description="These are real WhatsApp messages and cannot be recalled. Each one starts a thread in Conversations."
        confirmLabel="Send them"
      />
    </form>
  );
}
