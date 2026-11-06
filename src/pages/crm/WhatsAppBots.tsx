import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Hash, Pause, Pencil, Play, PlayCircle, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatCard } from '../../components/ui/StatCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { DRIP_STATUS_OPTIONS, DRIP_STATUS_TONE } from '../../services/whatsappDripService';
import { deleteBot, listBots, setBotStatus } from '../../services/whatsappBotService';
import { formatDate } from '../../utils/format';
import type { WhatsAppBot } from '../../types';

const KEYWORDS_SHOWN = 4;

export function WhatsAppBots() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppBot | null>(null);
  const { data: bots, isLoading } = useAsync(() => listBots(), [reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  const all = bots ?? [];
  const live = all.filter((b) => b.status === 'active');
  const liveKeywords = new Set(live.filter((b) => b.triggerType === 'keywords').flatMap((b) => b.keywords.map((k) => k.toLowerCase()))).size;

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
    { key: 'name', header: 'Auto-reply', render: (b) => <span className="text-[13px] font-medium text-ink">{b.name}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (b) => (
        <Badge tone={DRIP_STATUS_TONE[b.status]} dot>
          {DRIP_STATUS_OPTIONS.find((o) => o.value === b.status)?.label}
        </Badge>
      ),
    },
    {
      key: 'trigger',
      header: 'Answers',
      render: (b) =>
        b.triggerType === 'any' ? (
          <span className="text-xs text-ink-muted">Every first message</span>
        ) : (
          <div className="flex max-w-sm flex-wrap items-center gap-1">
            <span className="mr-0.5 text-xs text-ink-subtle">Contains</span>
            {b.keywords.slice(0, KEYWORDS_SHOWN).map((k) => (
              <span key={k} className="rounded-sm border border-line bg-surface-subtle px-1.5 text-2xs font-medium text-ink-muted">
                {k}
              </span>
            ))}
            {b.keywords.length > KEYWORDS_SHOWN && (
              <span className="text-2xs text-ink-faint" title={b.keywords.slice(KEYWORDS_SHOWN).join(', ')}>
                +{b.keywords.length - KEYWORDS_SHOWN} more
              </span>
            )}
          </div>
        ),
    },
    {
      key: 'nodes',
      header: 'Messages',
      align: 'right',
      render: (b) => <span className="tabular-nums text-ink-muted">{b.nodeCount}</span>,
    },
    {
      key: 'cooldown',
      header: 'Quiet after',
      align: 'right',
      render: (b) => <span className="tabular-nums text-ink-muted">{b.cooldownHours}h</span>,
    },
    { key: 'createdAt', header: 'Created', render: (b) => <span className="tabular-nums text-ink-muted">{formatDate(b.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (b) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={b.status === 'active' ? <Pause size={13} /> : <Play size={13} />} onClick={() => toggle(b)}>
            {b.status === 'active' ? 'Pause' : 'Start'}
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/whatsapp-bots/${b.id}`)}>Edit</Button>
          <Button variant="ghost" size="sm" className="text-danger-600 hover:text-danger-700" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(b)}>Delete</Button>
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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Auto-replies"
          value={isLoading ? '…' : all.length}
          icon={Bot}
          tone="shell"
          footer={`${all.filter((b) => b.status === 'paused').length} paused · ${all.filter((b) => b.status === 'draft').length} draft`}
        />
        <StatCard
          label="Live"
          value={isLoading ? '…' : live.length}
          icon={PlayCircle}
          tone={live.length > 0 ? 'success' : 'neutral'}
          footer="Only Active auto-replies answer"
        />
        <StatCard label="Keywords watched" value={isLoading ? '…' : liveKeywords} icon={Hash} tone="info" footer="Across live keyword auto-replies" />
      </div>

      {!isLoading && all.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={Bot}
            title="No auto-replies yet"
            description="Start with a welcome message and options people can tap, such as Book a Site Visit or Get the Price List."
            action={
              <Button variant="primary" size="sm" leftIcon={<Plus size={13} />} onClick={() => navigate('/crm/whatsapp-bots/new')}>
                Create first auto-reply
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <DataTable
            columns={columns}
            rows={all}
            rowKey={(b) => b.id}
            isLoading={isLoading}
            onRowClick={(b) => navigate(`/crm/whatsapp-bots/${b.id}`)}
            rowHref={(b) => `/crm/whatsapp-bots/${b.id}`}
            emptyTitle="No auto-replies yet"
            emptyDescription="Create one: a welcome message with options such as Book a Test or Download the App."
          />
        </Card>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-2xs text-ink-faint">
        <Bot size={11} className="mt-[3px] shrink-0" />
        The bot answers only plain text messages, never a chat a person has already replied to, and stays quiet for the cooldown you set after it answers.
      </p>

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
    </div>
  );
}
