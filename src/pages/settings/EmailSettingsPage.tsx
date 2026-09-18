import { useState } from 'react';
import { Copy, Info, KeyRound, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Toggle } from '../../components/ui/Toggle';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  addSuppression, getEmailSettings, listSuppressions, removeSuppression,
  rotateInboundEmailUrl, sendTestEmail, updateEmailSettings,
} from '../../services/emailSettingsService';
import { formatDate } from '../../utils/format';
import type { EmailSettings, EmailSuppression } from '../../types';

export function EmailSettingsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const { data, isLoading } = useAsync(() => getEmailSettings(), [reloadKey]);

  if (isLoading || !data) return <CardSkeleton />;
  return <Editor key={reloadKey} settings={data} onSaved={() => setReloadKey((k) => k + 1)} />;
}

function Editor({ settings, onSaved }: { settings: EmailSettings; onSaved: () => void }) {
  const { toast } = useToast();
  const [values, setValues] = useState<EmailSettings>(settings);
  const [apiKey, setApiKey] = useState('');
  const [testTo, setTestTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  const [suppressionKey, setSuppressionKey] = useState(0);
  const { data: suppressions, isLoading: suppressionsLoading } = useAsync(() => listSuppressions(), [suppressionKey]);
  const [newSuppression, setNewSuppression] = useState('');

  const patch = (next: Partial<EmailSettings>) => setValues((prev) => ({ ...prev, ...next }));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy', description: 'Copy it manually.', variant: 'error' });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateEmailSettings({
        enabled: values.enabled,
        fromName: values.fromName,
        fromEmail: values.fromEmail,
        replyToEmail: values.replyToEmail,
        footerText: values.footerText,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey('');
      toast({ title: 'Email settings saved', variant: 'success' });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testTo.includes('@')) {
      toast({ title: 'Enter an address to send the test to', variant: 'error' });
      return;
    }
    setTesting(true);
    try {
      const result = await sendTestEmail(testTo.trim());
      toast({ title: 'Test sent', description: result.message, variant: 'success' });
    } catch (err) {
      toast({ title: 'Test failed', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleRotate = async () => {
    await rotateInboundEmailUrl();
    toast({ title: 'Inbound URL rotated', description: 'Update it in the provider — the previous one no longer works.', variant: 'success' });
    setRotateOpen(false);
    onSaved();
  };

  const suppressionColumns: DataTableColumn<EmailSuppression>[] = [
    { key: 'email', header: 'Email', render: (s) => s.email },
    { key: 'reason', header: 'Reason', render: (s) => <Badge tone={s.reason === 'unsubscribed' ? 'warning' : 'neutral'}>{s.reason}</Badge> },
    { key: 'createdAt', header: 'Added', render: (s) => formatDate(s.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-danger-600"
          leftIcon={<Trash2 size={13} />}
          onClick={async () => {
            await removeSuppression(s.id);
            setSuppressionKey((k) => k + 1);
          }}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Email"
        description="Outbound sending for sequences and automations, inbound replies, and the unsubscribe list."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'Email' }]}
      />

      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          Until <strong>Enabled</strong> is on with a key and a From address, sequence and automation emails are recorded
          on the lead's timeline but not delivered. Verify your sending domain with the provider first — an unverified
          domain sends straight to spam.
        </p>
      </div>

      <Card className="mb-5">
        <CardHeader title="Sending" subtitle={`Provider: ${values.provider}`} />
        <div className="space-y-5">
          <Toggle
            label="Enabled"
            description="Off means nothing is delivered — content is still written to the lead's timeline."
            checked={values.enabled}
            onChange={(enabled) => patch({ enabled })}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="API key"
              type="password"
            secret
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              leftIcon={<KeyRound size={14} />}
              placeholder={values.hasApiKey ? '•••••••• stored — type to replace' : 'Paste the provider API key'}
              hint="Stored encrypted and never sent back to this screen."
              wrapperClassName="sm:col-span-2"
            />
            <Input label="From name" value={values.fromName} onChange={(e) => patch({ fromName: e.target.value })} placeholder="Shree Ram Group" />
            <Input
              label="From address"
              type="email"
              value={values.fromEmail}
              onChange={(e) => patch({ fromEmail: e.target.value })}
              placeholder="sales@shreeramgroup.in"
              hint="Must be on a domain verified with the provider."
            />
            <Input
              label="Reply-to address"
              type="email"
              value={values.replyToEmail}
              onChange={(e) => patch({ replyToEmail: e.target.value })}
              placeholder="reply@mail.shreeramgroup.in"
              hint="Point this at the inbound route so replies come back into the CRM."
            />
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader title="Inbound replies" subtitle="Register this URL as the provider's inbound route" />
        <p className="mb-3 text-xs text-ink-faint">
          A reply from a lead is written to their timeline and stops any sequence they are in.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg border border-line bg-surface-subtle px-3 py-2 text-xs text-ink-muted">
            {values.inboundWebhookUrl}
          </code>
          <Button variant="outline" size="icon" aria-label="Copy inbound URL" onClick={() => copy(values.inboundWebhookUrl)}>
            <Copy size={14} />
          </Button>
        </div>
        <div className="mt-4 flex justify-end border-t border-line pt-4">
          <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => setRotateOpen(true)}>
            Rotate URL
          </Button>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader title="Unsubscribe footer" subtitle="Appended below every sequence email" />
        <Input
          label="Footer text"
          value={values.footerText}
          onChange={(e) => patch({ footerText: e.target.value })}
          hint="An Unsubscribe link is added underneath automatically. Removing it is not an option — it is what keeps mail out of spam."
        />
      </Card>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <Input label="Send a test to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
          <Button variant="outline" leftIcon={<Send size={14} />} isLoading={testing} onClick={handleTest}>
            Send Test
          </Button>
        </div>
        <Button variant="primary" isLoading={saving} onClick={handleSave}>
          Save Changes
        </Button>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line p-4">
          <div>
            <p className="text-sm font-medium text-ink">Suppression list</p>
            <p className="text-xs text-ink-faint">Nobody here is ever emailed again, by any sequence or automation.</p>
          </div>
          <div className="flex items-end gap-2">
            <Input
              aria-label="Email to suppress"
              type="email"
              value={newSuppression}
              onChange={(e) => setNewSuppression(e.target.value)}
              placeholder="someone@example.com"
            />
            <Button
              variant="outline"
              leftIcon={<Plus size={14} />}
              onClick={async () => {
                if (!newSuppression.includes('@')) return;
                await addSuppression(newSuppression.trim());
                setNewSuppression('');
                setSuppressionKey((k) => k + 1);
              }}
            >
              Add
            </Button>
          </div>
        </div>
        <DataTable
          columns={suppressionColumns}
          rows={suppressions ?? []}
          rowKey={(s) => s.id}
          isLoading={suppressionsLoading}
          emptyTitle="Nobody has unsubscribed"
          emptyDescription="Addresses land here when someone clicks Unsubscribe, or when you add them by hand."
        />
      </Card>

      <ConfirmationDialog
        isOpen={rotateOpen}
        onClose={() => setRotateOpen(false)}
        onConfirm={handleRotate}
        title="Rotate the inbound URL?"
        description="The URL changes immediately. Until the new one is registered with the provider, replies from leads will not reach the CRM and sequences will not stop on reply."
        confirmLabel="Rotate"
        variant="danger"
      />
    </div>
  );
}
