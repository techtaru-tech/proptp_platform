import { useEffect, useState } from 'react';
import { Activity, Copy, Headphones, Info, KeyRound, PlugZap, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  getAgentExtensions, getTelephonySettings, listTelephonyEvents, rotateTelephonyWebhook,
  setAgentExtension, testTelephonyConnection, updateTelephonySettings,
} from '../../services/callService';
import { formatDateTime } from '../../utils/format';
import type {
  AgentExtensionRow, TelephonyConnectionTest, TelephonyEvent, TelephonySettings, UnmappedExtension,
} from '../../types';

/** What DeepCall's webhook template should send. The names are what the server reads. */
const TEMPLATE_FIELDS: [string, string][] = [
  ['callId', '{{%%callId%%}}'],
  ['businessNumber', '{{%%businessNum%%}}'],
  ['callType', '{{%%cType%%}}'],
  ['callStatus', '{{%%callStatus%%}}'],
  ['customerNumber', '{{%%cNumber10%%}}'],
  ['agentName', '{{%%masterAgent%%}}'],
  ['agentNumber', '{{%%masterAgentNumber%%}}'],
  ['talkDuration', '{{%%talkDuration%%}}'],
  ['callTime', '{{%%callTime%%}}'],
  ['hangupTime', '{{%%lastHangupTime%%}}'],
  ['keyInput', '{{%%keyInput%%}}'],
  ['recordings', '{{%%recordings%%}}'],
  ['disposition', '{{%%callDisposition%%}}'],
];

export function TelephonySettingsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const { data, isLoading } = useAsync(() => getTelephonySettings(), [reloadKey]);

  if (isLoading || !data) return <CardSkeleton />;
  // Remounted on every reload so the form state starts from what the server returned,
  // instead of being copied in by an effect.
  return <Editor key={reloadKey} settings={data} onSaved={() => setReloadKey((k) => k + 1)} />;
}

function Editor({ settings, onSaved }: { settings: TelephonySettings; onSaved: () => void }) {
  const { toast } = useToast();
  const [values, setValues] = useState<TelephonySettings>(settings);
  const [apiToken, setApiToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  const patch = (next: Partial<TelephonySettings>) => setValues((prev) => ({ ...prev, ...next }));

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'URL copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy', description: 'Copy it manually.', variant: 'error' });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateTelephonySettings({
        enabled: values.enabled,
        baseUrl: values.baseUrl,
        accountId: values.accountId,
        clickToCallFlowId: values.clickToCallFlowId,
        virtualNumber: values.virtualNumber,
        // Blank means "keep the stored one" — the browser never receives it to send back.
        ...(apiToken.trim() ? { apiToken: apiToken.trim() } : {}),
      });
      setApiToken('');
      toast({ title: 'Telephony settings saved', variant: 'success' });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TelephonyConnectionTest | null>(null);

  const handleTest = async () => {
    setTesting(true);
    try {
      setTestResult(await testTelephonyConnection());
    } catch (err) {
      toast({ title: 'Could not reach the provider', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleRotate = async () => {
    await rotateTelephonyWebhook();
    toast({
      title: 'Webhook URL rotated',
      description: 'Give the new URL to DeepCall — the previous one no longer works.',
      variant: 'success',
    });
    setRotateOpen(false);
    onSaved();
  };

  return (
    <div>
      <PageHeader
        title="Telephony"
        description="DeepCall click-to-call and call logging."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Telephony' }]}
      />

      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          The account ID and API token are used for the calls we make to DeepCall (click-to-call). The webhook URL below
          belongs to <strong>us</strong> — DeepCall pushes every call's report to it. Who answers an incoming call is set in
          DeepCall, in the call flow on the business number. Nothing is placed or logged until <strong>Enabled</strong> is on.
        </p>
      </div>

      <Card className="mb-5">
        <CardHeader title="Connection" subtitle="Credentials and numbers" />
        <div className="space-y-5">
          <Toggle
            label="Enabled"
            description="Off means the webhooks reject every request and no calls can be placed."
            checked={values.enabled}
            onChange={(enabled) => patch({ enabled })}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="API base URL" value={values.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} />
            <Input
              label="Account ID (user_id)"
              value={values.accountId}
              onChange={(e) => patch({ accountId: e.target.value })}
              hint="Shown with the token on DeepCall's Click To Call page."
            />
            <Input
              label="Click-to-call flow ID"
              value={values.clickToCallFlowId}
              onChange={(e) => patch({ clickToCallFlowId: e.target.value })}
              hint="The DeepCall call flow with a Click To Call module (Manage → Call Flow). Click-to-call does not work without one."
            />
            <Input
              label="API token"
              type="password"
              secret
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              leftIcon={<KeyRound size={14} />}
              placeholder={values.hasApiToken ? '•••••••• stored — type to replace' : 'Paste the DeepCall API token'}
              hint="Stored encrypted and never sent back to this screen."
            />
            <Input
              label="Business number"
              value={values.virtualNumber}
              onChange={(e) => patch({ virtualNumber: e.target.value })}
              hint="The number customers dial. For reference; DeepCall's call flow decides who answers."
            />
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader title="Call report webhook" subtitle="Register this with DeepCall" />
        <div className="space-y-4">
          <WebhookRow
            label="Call report (POST)"
            hint="DeepCall calls this after every call with the call record: customer, agent, duration, status and the recording."
            url={values.callLogWebhookUrl}
            onCopy={copy}
          />
          <div className="rounded-lg border border-line bg-surface-subtle p-3 text-xs text-ink-muted">
            <p className="mb-1 font-medium text-ink">Set it up in DeepCall (Manage → Webhook Template, then Push-Report Webhook)</p>
            <ol className="mb-2 list-decimal space-y-0.5 pl-4">
              <li>Create a <strong>Post</strong> template and add these fields to its <strong>Body</strong>.</li>
              <li>Under <strong>Push-Report Webhook</strong>, add the URL above, set the data source to <strong>Report</strong> and link that template.</li>
            </ol>
            <pre className="overflow-auto rounded bg-white p-2 text-[11px] leading-relaxed">{TEMPLATE_FIELDS.map(([k, v]) => `${k}  →  ${v}`).join('\n')}</pre>
          </div>
          <div className="flex justify-end border-t border-line pt-4">
            <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => setRotateOpen(true)}>
              Rotate URL
            </Button>
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader
          title="Connection test"
          subtitle="Checks what is saved and that DeepCall answers — no call is placed. The token itself is proven by the first click-to-call"
        />
        <Button variant="outline" leftIcon={<PlugZap size={14} />} isLoading={testing} onClick={handleTest}>
          Test Connection
        </Button>
        {testResult && (
          <div className="mt-4 space-y-2">
            {testResult.checks.map((check) => (
              <div key={check.label} className="flex items-start justify-between gap-3 border-b border-line pb-2 text-sm last:border-0">
                <span className="text-ink-muted">{check.label}</span>
                <span className="flex items-center gap-2 text-right">
                  <span className="text-ink">{check.detail}</span>
                  <Badge tone={check.ok ? 'success' : 'danger'}>{check.ok ? 'OK' : 'Fix'}</Badge>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <AgentExtensions />

      <WebhookActivity />

      <div className="flex justify-end">
        <Button variant="primary" isLoading={saving} onClick={handleSave}>
          Save Changes
        </Button>
      </div>

      <ConfirmationDialog
        isOpen={rotateOpen}
        onClose={() => setRotateOpen(false)}
        onConfirm={handleRotate}
        title="Rotate the webhook URL?"
        description="The URL changes immediately. Until the new one is registered in DeepCall, call reports will be rejected."
        confirmLabel="Rotate"
        variant="danger"
      />
    </div>
  );
}

/**
 * Who answers on which extension. The provider names the person who took a call by extension
 * and nothing else, so until this is filled in the Agent column of the call history is empty —
 * which is why saving one also goes back and claims the calls already logged against it.
 */
function AgentExtensions() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AgentExtensionRow[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedExtension[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await getAgentExtensions();
      setRows(data.users);
      setUnmapped(data.unmapped);
      setDraft(Object.fromEntries(data.users.map((u) => [u.userId, u.extension])));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (row: AgentExtensionRow) => {
    const extension = (draft[row.userId] ?? '').trim();
    if (extension === row.extension) return;
    setSavingId(row.userId);
    try {
      const result = await setAgentExtension(row.userId, extension);
      toast({
        title: extension ? `Extension ${extension} mapped to ${row.name}` : `Extension cleared for ${row.name}`,
        description:
          result.callsLinked > 0
            ? `${result.callsLinked} existing call${result.callsLinked === 1 ? '' : 's'} now show ${row.name} as the agent.`
            : undefined,
        variant: 'success',
      });
      await load();
    } catch (err) {
      toast({ title: 'Could not save the extension', description: err instanceof Error ? err.message : undefined, variant: 'error' });
      setDraft((prev) => ({ ...prev, [row.userId]: row.extension }));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card className="mb-5">
      <CardHeader
        title="Agent extensions"
        subtitle="DeepCall names the person who took a call by the number they answered on. It matches a staff member's mobile by itself; fill this in only where their DeepCall number is different"
        action={
          <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={load}>
            Refresh
          </Button>
        }
      />

      {unmapped.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Headphones size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>Calls logged against extensions nobody owns:</strong>{' '}
            {unmapped.map((u) => `${u.agentNumber} (${u.callCount})`).join(', ')}. Map each one below and
            those calls will be credited straight away.
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading...</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.userId} className="flex flex-wrap items-center gap-3 border-b border-line pb-2 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{row.name}</p>
                <p className="text-xs text-ink-faint">
                  {row.phone} · {row.role}
                  {row.callCount > 0 && ` · ${row.callCount} calls`}
                </p>
              </div>
              <Input
                aria-label={`Extension for ${row.name}`}
                className="w-32"
                placeholder="Extension"
                value={draft[row.userId] ?? ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, [row.userId]: e.target.value }))}
                onBlur={() => save(row)}
                onKeyDown={(e) => e.key === 'Enter' && save(row)}
              />
              {savingId === row.userId && <span className="text-xs text-ink-faint">Saving...</span>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * What the provider actually sent us, newest first. Polls while it is switched on, because
 * the moment this matters is the ten seconds after a test call is dialled.
 */
function WebhookActivity() {
  const [events, setEvents] = useState<TelephonyEvent[]>([]);
  const [live, setLive] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await listTelephonyEvents(25);
        if (!cancelled) {
          setEvents(rows);
          setLoadedOnce(true);
        }
      } catch {
        // A failed poll is not worth a toast every four seconds.
      }
    };
    load();
    if (!live) return () => { cancelled = true; };
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live]);

  const tone = (outcome: TelephonyEvent['outcome']) =>
    outcome === 'ok' ? 'success' : outcome === 'rejected' ? 'warning' : 'danger';

  return (
    <Card className="mb-5">
      <CardHeader
        title="Provider activity"
        subtitle="DeepCall's call reports to us, and DeepCall's replies to our click-to-call requests, kept for 14 days"
        action={
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Activity size={14} />}
            onClick={() => setLive((v) => !v)}
          >
            {live ? 'Pause' : 'Resume'} live view
          </Button>
        }
      />
      {events.length === 0 ? (
        <p className="text-sm text-ink-faint">
          {loadedOnce
            ? 'Nothing yet. Register the webhook URL above in DeepCall, then make a call — its report should appear here within seconds.'
            : 'Loading...'}
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="rounded-lg border border-line">
              <button
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left focus-ring"
                onClick={() => setExpanded((id) => (id === event.id ? null : event.id))}
              >
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={tone(event.outcome)}>{event.outcome}</Badge>
                  <span className="font-medium text-ink">
                    {event.kind === 'click_to_call' ? 'Click-to-call' : 'Call report'}
                  </span>
                  <span className="text-ink-faint">{event.request?.method}</span>
                  {event.errorMessage && <span className="text-danger-600">{event.errorMessage}</span>}
                </span>
                <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(event.receivedAt)}</span>
              </button>
              {expanded === event.id && (
                <div className="grid grid-cols-1 gap-3 border-t border-line p-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-ink-muted">They sent</p>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-surface-subtle p-2 text-xs text-ink-muted">
                      {JSON.stringify(event.request, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-ink-muted">We answered / they answered</p>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-surface-subtle p-2 text-xs text-ink-muted">
                      {JSON.stringify(event.response ?? { note: 'No response recorded.' }, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function WebhookRow({
  label, hint, url, onCopy,
}: { label: string; hint: string; url: string; onCopy: (url: string) => void }) {
  return (
    <div>
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="mb-1.5 text-xs text-ink-faint">{hint}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg border border-line bg-surface-subtle px-3 py-2 text-xs text-ink-muted">{url}</code>
        <Button variant="outline" size="icon" aria-label={`Copy ${label}`} onClick={() => onCopy(url)}>
          <Copy size={14} />
        </Button>
      </div>
    </div>
  );
}
