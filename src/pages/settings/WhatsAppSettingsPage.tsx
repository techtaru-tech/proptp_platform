import { useState } from 'react';
import { Copy, Info, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import {
  createWhatsAppAccount, deleteWhatsAppAccount, listWhatsAppAccounts, updateWhatsAppAccount,
} from '../../services/whatsappService';
import type { WhatsAppAccount, WhatsAppAccountInput } from '../../types';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  connected: 'success',
  disconnected: 'neutral',
  error: 'danger',
};

function emptyForm(): WhatsAppAccountInput {
  return { label: '', displayPhone: '', phoneNumberId: '', wabaId: '', provider: 'meta', accessToken: '', appSecret: '' };
}

export function WhatsAppSettingsPage() {
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const { data: accounts, isLoading } = useAsync(() => listWhatsAppAccounts(), [reloadKey]);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<WhatsAppAccountInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppAccount | null>(null);

  const refresh = () => setReloadKey((k) => k + 1);
  const patchForm = (next: Partial<WhatsAppAccountInput>) => setForm((prev) => ({ ...prev, ...next }));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy', description: 'Copy it manually.', variant: 'error' });
    }
  };

  const handleAdd = async () => {
    if (!form.label.trim() || !form.displayPhone.trim() || !form.phoneNumberId.trim()) {
      toast({ title: 'Label, number and Phone Number ID are all required', variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      await createWhatsAppAccount(form);
      toast({ title: 'Number linked', description: 'Now give Meta its webhook URL and verify token.', variant: 'success' });
      setAddOpen(false);
      setForm(emptyForm());
      refresh();
    } catch (err) {
      toast({ title: 'Could not link', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <CardSkeleton />;

  return (
    <div>
      <PageHeader
        title="WhatsApp"
        description="WhatsApp Business numbers linked to the CRM. Every message on them shows up under CRM → Conversations."
        breadcrumb={[{ label: 'Settings', to: '/settings/organization' }, { label: 'WhatsApp' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
            Link a Number
          </Button>
        }
      />

      <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          Uses Meta's WhatsApp Cloud API. Each number needs its <strong>Phone Number ID</strong> and a permanent access
          token from the Meta app dashboard. After linking, paste that number's webhook URL and verify token into
          Meta → WhatsApp → Configuration and subscribe to the <strong>messages</strong> field.
        </p>
      </div>

      {(accounts ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={MessageSquare}
            title="No numbers linked"
            description="Link your first WhatsApp Business number to start receiving conversations."
            action={
              <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
                Link a Number
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {(accounts ?? []).map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onCopy={copy}
              onChanged={refresh}
              onDelete={() => setDeleteTarget(account)}
            />
          ))}
        </div>
      )}

      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="Link a WhatsApp number"
        description="From Meta → WhatsApp → API Setup."
        footer={
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" isLoading={saving} onClick={handleAdd}>
              Link Number
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Label" required value={form.label} onChange={(e) => patchForm({ label: e.target.value })} placeholder="Rosium Sales" />
          <Select
            label="Provider"
            value={form.provider ?? 'meta'}
            onChange={(e) => patchForm({ provider: e.target.value as 'meta' | 'pinbot' })}
            options={[{ value: 'meta', label: 'Meta Cloud API' }, { value: 'pinbot', label: 'WABA Partners API (Pinbot)' }]}
            wrapperClassName="sm:col-span-2"
          />
          <Input
            label="Display number"
            required
            value={form.displayPhone}
            onChange={(e) => patchForm({ displayPhone: e.target.value })}
            placeholder="919829822983"
            hint="With country code, digits only."
          />
          <Input
            label="Phone Number ID"
            required
            value={form.phoneNumberId}
            onChange={(e) => patchForm({ phoneNumberId: e.target.value })}
            hint="Not the number — Meta's own id for it."
          />
          <Input label="WABA ID" value={form.wabaId ?? ''} onChange={(e) => patchForm({ wabaId: e.target.value })} hint="Optional." />
          <Input
            label={form.provider === 'pinbot' ? 'API key' : 'Access token'}
            type="password"
            secret
            value={form.accessToken ?? ''}
            onChange={(e) => patchForm({ accessToken: e.target.value })}
            hint="Stored encrypted, never shown again."
            wrapperClassName="sm:col-span-2"
          />
          {form.provider !== 'pinbot' && (
            <Input
              label="App secret"
              type="password"
              secret
              value={form.appSecret ?? ''}
              onChange={(e) => patchForm({ appSecret: e.target.value })}
              hint="Used to verify Meta's webhook signature. Strongly recommended."
              wrapperClassName="sm:col-span-2"
            />
          )}
        </div>
      </Modal>

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteWhatsAppAccount(deleteTarget.id);
          toast({ title: 'Number unlinked', variant: 'success' });
          setDeleteTarget(null);
          refresh();
        }}
        title="Unlink this number?"
        description={
          deleteTarget
            ? `${deleteTarget.label} (${deleteTarget.displayPhone}) and all ${deleteTarget.conversationCount} of its conversations and messages will be permanently removed. The leads themselves are not affected.`
            : undefined
        }
        confirmLabel="Unlink"
        variant="danger"
      />
    </div>
  );
}

function AccountCard({
  account, onCopy, onChanged, onDelete,
}: {
  account: WhatsAppAccount;
  onCopy: (text: string) => void;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const save = async (patch: Partial<WhatsAppAccountInput>) => {
    setSaving(true);
    try {
      await updateWhatsAppAccount(account.id, patch);
      setAccessToken('');
      setAppSecret('');
      toast({ title: 'Saved', variant: 'success' });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={`${account.label} · ${account.displayPhone}`}
        subtitle={`${account.conversationCount} conversation(s)${account.unreadCount > 0 ? ` · ${account.unreadCount} unread` : ''}`}
        action={<Badge tone={STATUS_TONE[account.status] ?? 'neutral'}>{account.status}</Badge>}
      />

      {account.lastError && <p className="mb-3 text-xs text-danger-600">{account.lastError}</p>}

      <div className="space-y-4">
        <div>
          <p className="mb-1 text-sm font-medium text-ink">Webhook URL</p>
          <p className="mb-1.5 text-xs text-ink-faint">
            {account.provider === 'pinbot'
              ? 'Give this address to the Partners API provider as the webhook for this number. It already carries the secret token.'
              : 'Meta → WhatsApp → Configuration → Callback URL. Subscribe to the "messages" field.'}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-line bg-surface-subtle px-3 py-2 text-xs text-ink-muted">
              {account.webhookUrl}
            </code>
            <Button variant="outline" size="icon" aria-label="Copy webhook URL" onClick={() => onCopy(account.webhookUrl)}>
              <Copy size={14} />
            </Button>
          </div>
        </div>

        {account.provider !== 'pinbot' && (
        <div>
          <p className="mb-1 text-sm font-medium text-ink">Verify token</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-line bg-surface-subtle px-3 py-2 text-xs text-ink-muted">
              {account.verifyToken}
            </code>
            <Button variant="outline" size="icon" aria-label="Copy verify token" onClick={() => onCopy(account.verifyToken)}>
              <Copy size={14} />
            </Button>
          </div>
        </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={account.provider === 'pinbot' ? 'API key' : 'Access token'}
            type="password"
            secret
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={account.hasAccessToken ? '•••••••• stored — type to replace' : 'Paste the permanent token'}
          />
          {account.provider !== 'pinbot' && (
            <Input
              label="App secret"
              type="password"
              secret
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={account.hasAppSecret ? '•••••••• stored — type to replace' : 'Paste the app secret'}
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Toggle
            label="Active"
            description="Off means the webhook rejects Meta and nothing can be sent."
            checked={account.active}
            onChange={(active) => save({ active })}
          />
          <Toggle
            label="Create a lead from an unknown number"
            description="A first message from someone we do not know becomes a lead, so the thread has a record behind it."
            checked={account.createLeadOnInbound}
            onChange={(createLeadOnInbound) => save({ createLeadOnInbound })}
          />
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4">
          <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={onDelete}>
            Unlink
          </Button>
          <Button
            variant="primary"
            size="sm"
            isLoading={saving}
            onClick={() => save({ ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}), ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}) })}
            disabled={!accessToken.trim() && !appSecret.trim()}
          >
            Save Credentials
          </Button>
        </div>
      </div>
    </Card>
  );
}
