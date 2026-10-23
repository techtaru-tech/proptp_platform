import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { DRIP_STATUS_OPTIONS, DRIP_STATUS_TONE } from '../../services/whatsappDripService';
import { deleteBot, listBots, setBotStatus } from '../../services/whatsappBotService';
import { formatDate } from '../../utils/format';
import type { WhatsAppBot } from '../../types';

export function WhatsAppBots() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppBot | null>(null);
  const { data: bots, isLoading } = useAsync(() => listBots(), [reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  const toggle = async (bot: WhatsAppBot) => {
    const next = bot.status === 'active' ? 'paused' : 'active';
    try {
      await setBotStatus(bot.id, next);
      toast({ title: next === 'active' ? 'Auto-reply is live' : 'Auto-reply paused', description: next === 'active' ? 'New chats are answered automatically.' : 'The bot no longer answers.', variant: 'success' });
      reload();
    } catch (err) {
      toast({ title: 'Could not change status', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const columns: DataTableColumn<WhatsAppBot>[] = [
    { key: 'name', header: 'Name', render: (b) => <span className="font-medium text-ink">{b.name}</span> },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={DRIP_STATUS_TONE[b.status]}>{DRIP_STATUS_OPTIONS.find((o) => o.value === b.status)?.label}</Badge> },
    {
      key: 'trigger',
      header: 'Answers',
      render: (b) => (b.triggerType === 'any' ? <span className="text-sm text-ink-muted">Every first message</span> : <span className="text-sm text-ink-muted">When it contains: {b.keywords.join(', ')}</span>),
    },
    { key: 'nodes', header: 'Messages', align: 'center', render: (b) => b.nodeCount },
    { key: 'createdAt', header: 'Created', render: (b) => formatDate(b.createdAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (b) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={b.status === 'active' ? <Pause size={13} /> : <Play size={13} />} onClick={() => toggle(b)}>
            {b.status === 'active' ? 'Pause' : 'Start'}
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/whatsapp-bots/${b.id}`)}>Edit</Button>
          <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(b)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="WhatsApp Auto-Reply"
        description="Answer people who message your WhatsApp number automatically — with options to tap, and links to your booking page or app."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Auto-Reply' }]}
        actions={<Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/whatsapp-bots/new')}>New Auto-Reply</Button>}
      />

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={bots ?? []}
          rowKey={(b) => b.id}
          isLoading={isLoading}
          onRowClick={(b) => navigate(`/crm/whatsapp-bots/${b.id}`)}
          emptyTitle="No auto-replies yet"
          emptyDescription="Create one: a welcome message with options such as Book a Test or Download the App."
        />
      </Card>

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteBot(deleteTarget.id);
          toast({ title: 'Auto-reply deleted', variant: 'success' });
          setDeleteTarget(null);
          reload();
        }}
        title="Delete this auto-reply?"
        description={deleteTarget ? `"${deleteTarget.name}" and its ${deleteTarget.nodeCount} message(s) are removed. Chats already answered are not affected.` : undefined}
        confirmLabel="Delete"
        variant="danger"
      />

      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-faint">
        <Bot size={12} />
        The bot answers only plain text messages, never a chat a person has already replied to, and stays quiet for the cooldown you set after it answers.
      </p>
    </div>
  );
}
