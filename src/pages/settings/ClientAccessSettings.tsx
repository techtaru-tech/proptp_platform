import { useMemo, useState } from 'react';
import { Copy, KeyRound, Plus, Trash2, CalendarPlus, Ban } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { listPanelRoles } from '../../services/panelAccessService';
import {
  createClientLogin, deleteClientLogin, extendClientLogin, listClientLogins, resetClientPassword, revokeClientLogin,
  type ClientLogin, type IssuedLogin,
} from '../../services/clientAccessService';
import { formatRelativeTime } from '../../utils/format';

const DAY_PRESETS = [1, 3, 7, 14, 30];
const DEMO_ROLE = '__demo__';

function endsAt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "6 days left", "5 h left", "Expired 2 days ago". */
function remaining(row: ClientLogin) {
  const ms = new Date(row.accessExpiresAt).getTime() - Date.now();
  if (ms <= 0) return `Ended ${formatRelativeTime(row.accessExpiresAt)}`;
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.ceil(ms / 86_400_000);
  return hours >= 24 ? `${days} day${days === 1 ? '' : 's'} left` : `${Math.max(1, hours)} h left`;
}

function credentialsText(issued: IssuedLogin) {
  return [
    'Propto CRM — demo login',
    `Link: ${window.location.origin}/login`,
    `Email: ${issued.user.email}`,
    `Password: ${issued.password}`,
    `Valid till: ${endsAt(issued.user.accessExpiresAt)}`,
  ].join('\n');
}

/** Settings > Client Access: sign-ins handed to a prospect for a fixed number of days. */
export function ClientAccessSettings() {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const list = useAsync(() => listClientLogins(), [reload]);
  const roles = useAsync(() => listPanelRoles(), []);
  const refresh = () => setReload((r) => r + 1);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', days: '7', customDays: '', role: DEMO_ROLE });
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState<IssuedLogin | null>(null);
  const [extendRow, setExtendRow] = useState<ClientLogin | null>(null);
  const [extendDays, setExtendDays] = useState('7');
  const [confirm, setConfirm] = useState<{ kind: 'revoke' | 'reset' | 'delete'; row: ClientLogin } | null>(null);

  const days = form.days === 'custom' ? Number(form.customDays) : Number(form.days);
  const validDays = Number.isInteger(days) && days >= 1 && days <= 365;
  const preview = validDays ? endsAt(new Date(Date.now() + days * 86_400_000).toISOString()) : null;

  const roleOptions = useMemo(() => [
    { value: DEMO_ROLE, label: 'Client demo — everything except Settings' },
    ...(roles.data ?? []).filter((r) => !r.isFullAccess && r.name !== 'Client demo').map((r) => ({ value: r.id, label: r.name })),
  ], [roles.data]);

  const fail = (title: string) => (e: unknown) => toast({ title, description: (e as Error).message, variant: 'error' });

  const create = async () => {
    setSaving(true);
    try {
      const result = await createClientLogin({
        name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, days,
        panelRoleId: form.role === DEMO_ROLE ? (roles.data?.find((r) => r.name === 'Client demo')?.id) : form.role,
      });
      setCreateOpen(false);
      setForm({ name: '', email: '', phone: '', days: '7', customDays: '', role: DEMO_ROLE });
      setIssued(result);
      refresh();
    } catch (e) {
      fail('Could not create the login')(e);
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: 'Paste it into WhatsApp or email.', variant: 'success' });
    } catch {
      toast({ title: 'Copy blocked by the browser', description: 'Select the text and copy it by hand.', variant: 'warning' });
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const { kind, row } = confirm;
    try {
      if (kind === 'revoke') { await revokeClientLogin(row.id); toast({ title: `${row.name} can no longer sign in`, variant: 'success' }); }
      if (kind === 'reset') setIssued(await resetClientPassword(row.id));
      if (kind === 'delete') { await deleteClientLogin(row.id); toast({ title: 'Login deleted', variant: 'success' }); }
      refresh();
    } catch (e) {
      fail('That did not work')(e);
    } finally {
      setConfirm(null);
    }
  };

  const extend = async () => {
    if (!extendRow) return;
    try {
      const updated = await extendClientLogin(extendRow.id, Number(extendDays));
      toast({ title: `Extended to ${endsAt(updated.accessExpiresAt)}`, variant: 'success' });
      setExtendRow(null);
      refresh();
    } catch (e) {
      fail('Could not extend it')(e);
    }
  };

  const columns: DataTableColumn<ClientLogin>[] = [
    {
      key: 'name', header: 'Client', render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{r.name}</p>
          <p className="truncate text-xs text-ink-subtle">{r.email}{r.phone ? ` · ${r.phone}` : ''}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (r) => <span className="text-ink-muted">{r.roleName ?? '—'}</span> },
    {
      key: 'status', header: 'Access', render: (r) => (
        <div className="flex items-center gap-2">
          <Badge tone={r.state === 'active' ? 'success' : r.state === 'expired' ? 'neutral' : 'danger'} dot>
            {r.state === 'active' ? 'Active' : r.state === 'expired' ? 'Expired' : 'Disabled'}
          </Badge>
          <span className="whitespace-nowrap text-xs text-ink-subtle">{remaining(r)}</span>
        </div>
      ),
    },
    { key: 'ends', header: 'Ends', className: 'whitespace-nowrap', render: (r) => <span className="text-ink-muted">{endsAt(r.accessExpiresAt)}</span> },
    { key: 'seen', header: 'Last used', className: 'whitespace-nowrap', render: (r) => <span className="text-ink-subtle">{r.lastSeenAt ? formatRelativeTime(r.lastSeenAt) : 'Not yet'}</span> },
    {
      key: 'actions', header: '', align: 'right', render: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" leftIcon={<CalendarPlus size={13} />} onClick={() => { setExtendDays('7'); setExtendRow(r); }}>Extend</Button>
          <Button variant="ghost" size="sm" leftIcon={<KeyRound size={13} />} onClick={() => setConfirm({ kind: 'reset', row: r })}>New password</Button>
          {r.state === 'active' && <Button variant="ghost" size="sm" leftIcon={<Ban size={13} />} onClick={() => setConfirm({ kind: 'revoke', row: r })}>End now</Button>}
          <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} onClick={() => setConfirm({ kind: 'delete', row: r })}><Trash2 size={13} /></Button>
        </div>
      ),
    },
  ];

  const active = (list.data ?? []).filter((r) => r.state === 'active').length;

  return (
    <div>
      <PageHeader
        title="Client Access"
        description="Give a client a login for a set number of days. When the time is up they are signed out and cannot sign in again."
        actions={<Button leftIcon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>New client login</Button>}
      />

      <Card padded={false}>
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5 text-xs text-ink-subtle">
          <span>{list.data ? `${list.data.length} login${list.data.length === 1 ? '' : 's'} · ${active} active` : 'Loading…'}</span>
          <span>Times are in your local time</span>
        </div>
        <DataTable
          columns={columns}
          rows={list.data ?? []}
          rowKey={(r) => r.id}
          isLoading={list.isLoading && !list.data}
          error={list.error}
          onRetry={refresh}
          emptyTitle="No client logins yet"
          emptyDescription="Create one to let a prospect try the panel for a few days."
        />
      </Card>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New client login"
        description="The password is shown once, right after you create it."
        footer={<>
          <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button onClick={create} isLoading={saving} disabled={!form.name.trim() || !form.email.trim() || !validDays}>Create login</Button>
        </>}
      >
        <div className="space-y-3">
          <Input label="Client or company name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mehta Builders" />
          <Input label="Email — this is their login id" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
          <Input label="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10 digits" />
          <div>
            <p className="mb-1 text-xs font-medium text-ink-muted">Access for</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Access length">
              {[...DAY_PRESETS.map(String), 'custom'].map((d) => (
                <button
                  key={d} type="button" role="radio" aria-checked={form.days === d}
                  onClick={() => setForm({ ...form, days: d })}
                  className={`h-8 rounded-md border px-3 text-sm transition-colors duration-100 focus-ring ${form.days === d ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line-strong text-ink-muted hover:border-ink-faint'}`}
                >
                  {d === 'custom' ? 'Custom' : `${d} day${d === '1' ? '' : 's'}`}
                </button>
              ))}
            </div>
            {form.days === 'custom' && (
              <Input wrapperClassName="mt-2 w-40" type="number" min={1} max={365} value={form.customDays} onChange={(e) => setForm({ ...form, customDays: e.target.value })} placeholder="Days (1–365)" />
            )}
            <p className="mt-1.5 text-xs text-ink-subtle">{preview ? <>Ends <span className="font-medium text-ink">{preview}</span></> : 'Enter 1 to 365 days.'}</p>
          </div>
          <Select label="What they can open" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={roleOptions} />
        </div>
      </Modal>

      <Modal
        isOpen={!!issued}
        onClose={() => setIssued(null)}
        title="Login ready"
        description="Send this to the client now. The password will not be shown again."
        footer={<>
          <Button variant="outline" onClick={() => setIssued(null)}>Done</Button>
          {issued && <Button leftIcon={<Copy size={13} />} onClick={() => copy(credentialsText(issued))}>Copy details</Button>}
        </>}
      >
        {issued && (
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-subtle p-3 font-mono text-xs leading-relaxed text-ink select-all">
            {credentialsText(issued)}
          </pre>
        )}
      </Modal>

      <Modal
        isOpen={!!extendRow}
        onClose={() => setExtendRow(null)}
        title={`Extend ${extendRow?.name ?? ''}`}
        description={extendRow ? (extendRow.state === 'active' ? `Currently ends ${endsAt(extendRow.accessExpiresAt)}. Days are added on top.` : 'Access has ended. Days count from now.') : undefined}
        size="sm"
        footer={<>
          <Button variant="outline" onClick={() => setExtendRow(null)}>Cancel</Button>
          <Button onClick={extend}>Extend</Button>
        </>}
      >
        <Select label="Add" value={extendDays} onChange={(e) => setExtendDays(e.target.value)} options={[1, 3, 7, 14, 30, 60].map((d) => ({ value: String(d), label: `${d} day${d === 1 ? '' : 's'}` }))} />
      </Modal>

      <ConfirmationDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        variant={confirm?.kind === 'reset' ? 'primary' : 'danger'}
        title={confirm?.kind === 'revoke' ? `End ${confirm.row.name}'s access now?` : confirm?.kind === 'reset' ? `New password for ${confirm.row.name}?` : `Delete ${confirm?.row.name}'s login?`}
        description={
          confirm?.kind === 'revoke' ? 'They are signed out at once and cannot sign in until you extend it.'
          : confirm?.kind === 'reset' ? 'The old password stops working and any open session is signed out.'
          : 'The login is removed. Use "End now" instead if you may want to extend it later.'
        }
        confirmLabel={confirm?.kind === 'revoke' ? 'End access' : confirm?.kind === 'reset' ? 'Make new password' : 'Delete'}
      />
    </div>
  );
}
