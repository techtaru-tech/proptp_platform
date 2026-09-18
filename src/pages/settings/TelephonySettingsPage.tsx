import { useEffect, useState } from 'react';
import { AlertTriangle, Activity, Copy, Headphones, Info, KeyRound, PlugZap, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Toggle } from '../../components/ui/Toggle';
import { Select } from '../../components/ui/Select';
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
        virtualNumber: values.virtualNumber,
        fallbackNumber: values.fallbackNumber,
        stickyRouting: values.stickyRouting,
        outboundMode: values.outboundMode,
        testRouteNumber: values.testRouteNumber,
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
      title: 'Webhook URLs rotated',
      description: 'Give the new URLs to the provider — the previous ones no longer work.',
      variant: 'success',
    });
    setRotateOpen(false);
    onSaved();
  };

  return (
    <div>
      <PageHeader
        title="Telephony"
        description="Airphone call routing, call logging and click-to-call."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Telephony' }]}
      />

      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          Two of these URLs belong to <strong>us</strong> — give them to Airphone. The API token is used the other way
          round, for the calls we make to them. Nothing is routed or logged until <strong>Enabled</strong> is on.
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
              label="API token"
              type="password"
            secret
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              leftIcon={<KeyRound size={14} />}
              placeholder={values.hasApiToken ? '•••••••• stored — type to replace' : 'Paste the portal auth key'}
              hint="Stored encrypted and never sent back to this screen."
            />
            <Input
              label="Virtual number (VNM)"
              value={values.virtualNumber}
              onChange={(e) => patch({ virtualNumber: e.target.value })}
              hint="The number customers dial, and the one outbound calls originate from."
            />
            <Input
              label="Fallback number"
              value={values.fallbackNumber}
              onChange={(e) => patch({ fallbackNumber: e.target.value })}
              hint="Used when no agent can be resolved. Blank means the call is not routed."
            />
          </div>
          <Select
            label="Outbound call method"
            value={values.outboundMode}
            onChange={(e) => patch({ outboundMode: e.target.value as TelephonySettings['outboundMode'] })}
            options={[
              { value: 'c2c', label: 'Click-to-call — the provider rings the agent, then the customer' },
              { value: 'dial-call', label: "Mobile app — the call is placed from the agent's Airphone app" },
            ]}
            hint="Which one an account may use is the provider's decision. Click-to-call answering &quot;C2C is disabled&quot; means the other one is the way in."
          />
          <Input
            label="Test: force every incoming call to this number"
            value={values.testRouteNumber}
            onChange={(e) => patch({ testRouteNumber: e.target.value })}
            hint="For a live test call. Incoming calls are answered with this number and click-to-call rings it as the agent leg, so both directions reach one real handset. No agent is credited with the call. Clear it before going live."
          />
          <Toggle
            label="Route to the lead's owner first"
            description="A caller we already know reaches the person assigned to them. Otherwise the call goes to whoever has taken the fewest."
            checked={values.stickyRouting}
            onChange={(stickyRouting) => patch({ stickyRouting })}
          />
        </div>
      </Card>

      {values.testRouteNumber ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            <strong>Test routing is on.</strong> Every incoming call is being sent to{' '}
            <strong>{values.testRouteNumber}</strong> — lead ownership and round-robin are both
            ignored. Clear the field and save to go back to normal routing.
          </p>
        </div>
      ) : null}

      <Card className="mb-5">
        <CardHeader title="Webhook URLs" subtitle="Register these two with Airphone" />
        <div className="space-y-4">
          <WebhookRow
            label="Get Agent Number (GET)"
            hint="Called while the customer is still on hold. Answers with the agent number and a requestId."
            url={values.agentNumberWebhookUrl}
            onCopy={copy}
          />
          <WebhookRow
            label="Call Log (POST)"
            hint="Called after hangup with the full call record, including the recording URL."
            url={values.callLogWebhookUrl}
            onCopy={copy}
          />
          <div className="flex justify-end border-t border-line pt-4">
            <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => setRotateOpen(true)}>
              Rotate URLs
            </Button>
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader
          title="Connection test"
          subtitle="Reaches the provider without placing a call — safe to run on a live account"
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
            {testResult.providerResponse !== undefined && (
              <div>
                <p className="mb-1 mt-3 text-xs font-medium text-ink-muted">The provider's raw reply</p>
                <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-surface-subtle p-3 text-xs text-ink-muted">
                  {JSON.stringify(testResult.providerResponse, null, 2)}
                </pre>
              </div>
            )}
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
        title="Rotate the webhook URLs?"
        description="Both URLs change immediately. Until the new ones are registered with Airphone, incoming calls will not be routed and call logs will be rejected."
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
        subtitle="Airphone names the person who took a call by extension, so the Agent column stays empty until these are filled in"
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
        subtitle="Every request Airphone made to us, kept for 14 days"
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
            ? 'Nothing has arrived yet. Register the two URLs above with Airphone, then dial the virtual number — a request should appear here within seconds.'
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
                    {event.kind === 'routing' ? 'Who takes this call?' : 'Call log'}
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
                    <p className="mb-1 text-xs font-medium text-ink-muted">We answered</p>
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
