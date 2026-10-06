import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Toggle } from '../../components/ui/Toggle';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Textarea';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { SendSmsModal } from '../../components/leads/SendSmsModal';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/format';
import { createSmsTemplate, deleteSmsTemplate, getSmsSettings, listSmsLog, listSmsTemplates, saveSmsSettings, updateSmsTemplate, type SmsTemplate } from '../../services/smsService';

/** The SMS provider, the DLT-approved templates, and a log of everything sent. */
export function SmsSettingsPage() {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const settings = useAsync(() => getSmsSettings(), [reload]);
  const templates = useAsync(() => listSmsTemplates(), [reload]);
  const log = useAsync(() => listSmsLog(), [reload]);
  const [f, setF] = useState({ provider: 'msg91', senderId: '', dltEntityId: '', authKey: '', enabled: false });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<SmsTemplate | 'new' | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => { if (settings.data) setF({ provider: settings.data.provider, senderId: settings.data.senderId, dltEntityId: settings.data.dltEntityId, authKey: '', enabled: settings.data.enabled }); }, [settings.data]);
  if (settings.error) return <ErrorState title="Could not load SMS settings" description={settings.error.message} />;
  if (!settings.data) return <CardSkeleton />;
  const refresh = () => setReload((k) => k + 1);

  const save = async () => {
    setSaving(true);
    try { await saveSmsSettings({ ...f, authKey: f.authKey || undefined }); toast({ title: 'SMS settings saved', variant: 'success' }); refresh(); }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: 'success' }); refresh(); } catch (e) { toast({ title: 'That did not work', description: (e as Error).message, variant: 'error' }); }
  };

  return (
    <div>
      <PageHeader title="SMS (DLT)" description="Indian operators deliver only messages whose wording was pre-approved on DLT. Add the provider, then each approved template." breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'SMS' }]}
        actions={<Button variant="outline" onClick={() => setTesting(true)}>Send a test</Button>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Provider" subtitle="From your SMS provider and your DLT registration." action={<Button variant="primary" size="sm" onClick={save} isLoading={saving}>Save</Button>} />
          <div className="flex flex-col gap-4">
            <Select label="Provider" name="smsProvider" value={f.provider} onChange={(e) => setF((x) => ({ ...x, provider: e.target.value }))} options={settings.data.providers.map((p) => ({ value: p, label: p.toUpperCase() }))} />
            <Input label="API key" name="smsKey" type="password" value={f.authKey} onChange={(e) => setF((x) => ({ ...x, authKey: e.target.value }))} placeholder={settings.data.hasAuthKey ? 'Saved. Type to replace it.' : ''} hint="Stored encrypted; never shown again." />
            <Input label="Sender id" name="smsSender" maxLength={6} value={f.senderId} onChange={(e) => setF((x) => ({ ...x, senderId: e.target.value.toUpperCase() }))} hint="The six-letter header registered on DLT." />
            <Input label="DLT entity id" name="smsEntity" value={f.dltEntityId} onChange={(e) => setF((x) => ({ ...x, dltEntityId: e.target.value }))} />
            <Toggle label="Send SMS" checked={f.enabled} onChange={(v) => setF((x) => ({ ...x, enabled: v }))} description="Off: nothing is sent, and any attempt is logged as failed." />
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">“Sent” means the provider accepted the message. Use “Send a test” with your own number once the details are in, to confirm it is delivered.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Approved templates" subtitle="Only these can be sent. Use {#var#} where a value goes." action={<Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setEditing('new')}>Add template</Button>} />
          {!templates.data ? <CardSkeleton /> : templates.data.length === 0 ? <p className="text-sm text-ink-muted">No templates yet.</p> : (
            <ul className="divide-y divide-line text-sm">{templates.data.map((t) => (
              <li key={t.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{t.name} {!t.active && <Badge tone="neutral">Off</Badge>}</span>
                  <span className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil size={13} /></Button>
                    <Button variant="ghost" size="sm" className="text-danger-600" aria-label={`Delete ${t.name}`} onClick={() => run(() => deleteSmsTemplate(t.id), 'Template deleted')}><Trash2 size={13} /></Button>
                  </span>
                </div>
                <p className="text-ink-muted">{t.body}</p>
                <p className="text-xs text-ink-faint">DLT id {t.dltTemplateId} · {t.slots} value{t.slots === 1 ? '' : 's'}</p>
              </li>))}</ul>)}
        </Card>

        <Card className="lg:col-span-2" padded={false}>
          <div className="border-b border-line px-5 py-3"><CardHeader title="Sent messages" subtitle="The latest 100, with what the provider said." /></div>
          {!log.data || log.data.length === 0 ? <p className="px-5 py-5 text-sm text-ink-muted">Nothing sent yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint"><th className="px-5 py-2 font-medium">When</th><th className="px-3 font-medium">To</th><th className="px-3 font-medium">Message</th><th className="px-5 font-medium">Result</th></tr></thead>
              <tbody>{log.data.map((l) => (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="px-5 py-2 text-ink-muted">{formatDateTime(l.createdAt)}</td><td className="px-3">{l.to}</td>
                  <td className="px-3 text-ink-muted">{l.text || l.templateName}</td>
                  <td className="px-5"><Badge tone={l.status === 'sent' ? 'success' : 'danger'}>{l.status}</Badge>{l.status === 'failed' && <span className="block text-xs text-danger-700">{l.detail}</span>}</td>
                </tr>))}</tbody>
            </table></div>)}
        </Card>
      </div>
      {editing && <TemplateDialog template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {testing && <SendSmsModal onClose={() => setTesting(false)} onSent={refresh} />}
    </div>
  );
}

function TemplateDialog({ template, onClose, onSaved }: { template: SmsTemplate | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ name: template?.name ?? '', dltTemplateId: template?.dltTemplateId ?? '', body: template?.body ?? '', active: template?.active ?? true });
  const [saving, setSaving] = useState(false);
  const go = async () => {
    setSaving(true);
    try { template ? await updateSmsTemplate(template.id, f) : await createSmsTemplate(f); toast({ title: 'Template saved', variant: 'success' }); onSaved(); }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={template ? 'Edit template' : 'Add a template'} footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={go} isLoading={saving} disabled={!f.name || !f.dltTemplateId || !f.body}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Input label="Name" name="tplName" required value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} hint="Lowercase, e.g. payment_reminder. Rules refer to this." />
        <Input label="DLT template id" name="tplDlt" required value={f.dltTemplateId} onChange={(e) => setF((x) => ({ ...x, dltTemplateId: e.target.value }))} />
        <Textarea label="Approved wording" id="tplBody" rows={4} value={f.body} onChange={(v) => setF((x) => ({ ...x, body: v }))} />
        <Toggle label="Active" checked={f.active} onChange={(v) => setF((x) => ({ ...x, active: v }))} />
      </div>
    </Modal>
  );
}
