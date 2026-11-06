import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Megaphone, Pause, Play, PlayCircle, Plus, Trash2, Users, UserX } from 'lucide-react';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { Input } from '../../../components/ui/Input';
import { StatCard } from '../../../components/ui/StatCard';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { useAsync } from '../../../hooks/useAsync';
import { useToast } from '../../../context/ToastContext';
import { DRIP_STATUS_OPTIONS, DRIP_STATUS_TONE } from '../../../services/whatsappDripService';
import {
  addOptOut, deleteCampaign, listCampaigns, listOptOuts, removeOptOut, setCampaignStatus,
} from '../../../services/waCampaignService';
import { formatDate, formatDateTime } from '../../../utils/format';
import { cn } from '../../../utils/cn';
import type { WaCampaign } from '../../../types';

export function WaCampaigns() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [optOutReload, setOptOutReload] = useState(0);
  const [toDelete, setToDelete] = useState<WaCampaign | null>(null);
  const optOutRef = useRef<HTMLDivElement>(null);
  const { data: campaigns, isLoading } = useAsync(() => listCampaigns(), [reload]);
  const { data: optOuts } = useAsync(() => listOptOuts(), [optOutReload]);
  const refresh = () => setReload((k) => k + 1);

  const all = campaigns ?? [];
  const running = all.filter((c) => c.status === 'active').length;
  const needsAttention = all.filter((c) => c.lastError || c.warnings.length > 0).length;
  const people = all.reduce((n, c) => n + (c.contactCount ?? 0), 0);
  const journeys = all.filter((c) => c.kind === 'flow').length;

  const toggle = async (c: WaCampaign) => {
    try {
      await setCampaignStatus(c.id, c.status === 'active' ? 'paused' : 'active');
      refresh();
    } catch (err) {
      toast({ title: 'Could not change status', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const columns: DataTableColumn<WaCampaign>[] = [
    {
      key: 'name',
      header: 'Campaign',
      render: (c) => (
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{c.name}</p>
          <p className="text-xs text-ink-subtle">{c.kind === 'flow' ? 'Demo journey' : 'One template to a list'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <Badge tone={DRIP_STATUS_TONE[c.status]} dot>
          {DRIP_STATUS_OPTIONS.find((o) => o.value === c.status)?.label}
        </Badge>
      ),
    },
    {
      key: 'contacts',
      header: 'People',
      align: 'right',
      render: (c) => <span className={cn('tabular-nums', c.contactCount ? 'text-ink' : 'text-ink-faint')}>{c.contactCount ?? 0}</span>,
    },
    {
      key: 'ends',
      header: 'Ends',
      render: (c) =>
        c.endsAt ? <span className="tabular-nums text-ink-muted">{formatDate(c.endsAt)}</span> : <span className="text-xs text-warning-700">Not set</span>,
    },
    {
      key: 'issues',
      header: 'Setup',
      render: (c) =>
        c.lastError ? (
          <Badge tone="danger">Stopped: needs attention</Badge>
        ) : c.warnings.length > 0 ? (
          <Badge tone="warning">{c.warnings.length} to set up</Badge>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={c.status === 'active' ? <Pause size={13} /> : <Play size={13} />} onClick={() => toggle(c)}>
            {c.status === 'active' ? 'Pause' : 'Start'}
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-600 hover:text-danger-700" leftIcon={<Trash2 size={13} />} onClick={() => setToDelete(c)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="WhatsApp Campaigns"
        description="Import a list from Excel and send it an approved template — or run the full demo journey: video, language, interest, eligibility, and a booked consultation."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Campaigns' }]}
        actions={<Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/wa-campaigns/new')}>New Campaign</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Campaigns"
          value={isLoading ? '…' : all.length}
          icon={Megaphone}
          tone="shell"
          footer={`${journeys} demo journey${journeys === 1 ? '' : 's'} · ${all.length - journeys} list send${all.length - journeys === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Running"
          value={isLoading ? '…' : running}
          icon={PlayCircle}
          tone={running > 0 ? 'success' : 'neutral'}
          footer={
            needsAttention > 0 ? (
              <span className="text-warning-700">{needsAttention} need{needsAttention === 1 ? 's' : ''} attention</span>
            ) : (
              `${all.filter((c) => c.status === 'paused').length} paused · ${all.filter((c) => c.status === 'draft').length} draft`
            )
          }
        />
        <StatCard label="People on lists" value={isLoading ? '…' : people} icon={Users} tone="info" footer="Across every campaign" />
        <StatCard
          label="Opted out"
          value={optOuts ? optOuts.length : '…'}
          icon={UserX}
          tone={optOuts && optOuts.length > 0 ? 'danger' : 'neutral'}
          footer="Never messaged again"
          onClick={() => optOutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      </div>

      {!isLoading && all.length === 0 ? (
        <Card padded={false} className="mb-4">
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="Create one, import your list from Excel, and start it once the template is approved."
            action={
              <Button variant="primary" size="sm" leftIcon={<Plus size={13} />} onClick={() => navigate('/crm/wa-campaigns/new')}>
                Create first campaign
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padded={false} className="mb-4">
          <DataTable
            columns={columns}
            rows={all}
            rowKey={(c) => c.id}
            isLoading={isLoading}
            onRowClick={(c) => navigate(`/crm/wa-campaigns/${c.id}`)}
            rowHref={(c) => `/crm/wa-campaigns/${c.id}`}
            emptyTitle="No campaigns yet"
            emptyDescription="Create one, import your list, and start it when the template is approved."
          />
        </Card>
      )}

      <div ref={optOutRef} className="scroll-mt-4">
        <OptOutCard rows={optOuts} onChanged={() => setOptOutReload((k) => k + 1)} />
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-2xs text-ink-faint">
        <Megaphone size={11} className="shrink-0" />
        Messages go out between 9 am and 8 pm IST, never to anyone who has said STOP, and never faster than the daily limit you set.
      </p>

      <ConfirmationDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteCampaign(toDelete.id);
          setToDelete(null);
          refresh();
        }}
        title="Delete this campaign?"
        description={toDelete ? `"${toDelete.name}", its list and every record of who was sent what are removed. The leads themselves stay.` : undefined}
        confirmLabel="Delete campaign"
        variant="danger"
      />
    </div>
  );
}

/** Everyone who has said STOP — one list for every campaign, drip and broadcast. */
function OptOutCard({ rows, onChanged }: { rows: Awaited<ReturnType<typeof listOptOuts>> | undefined; onChanged: () => void }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const list = rows ?? [];

  const add = async () => {
    if (!phone.trim()) return;
    setAdding(true);
    try {
      await addOptOut(phone.trim(), 'Added by the team');
      setPhone('');
      onChanged();
    } catch (err) {
      toast({ title: 'Could not add', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            Opted out
            <span className="rounded-sm bg-surface-muted px-1.5 text-2xs font-semibold tabular-nums text-ink-muted">{list.length}</span>
          </h3>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Anyone who replies STOP is added here automatically and is never messaged again, by any campaign, drip or broadcast.
          </p>
        </div>
        <form
          className="flex shrink-0 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            aria-label="Add a number by hand"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Add a number, e.g. 9876543210"
            wrapperClassName="w-full md:w-60"
          />
          <Button type="submit" variant="outline" leftIcon={<UserX size={14} />} disabled={!phone.trim()} isLoading={adding}>
            Add
          </Button>
        </form>
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-ink-faint">{rows ? 'Nobody has opted out.' : 'Loading…'}</p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-subtle">
              <tr className="border-b border-line text-left text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                <th scope="col" className="px-4 py-1.5">Number</th>
                <th scope="col" className="px-3 py-1.5">Why</th>
                <th scope="col" className="hidden px-3 py-1.5 sm:table-cell">Since</th>
                <th scope="col" className="px-4 py-1.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((r) => (
                <tr key={r.phone}>
                  <td className="whitespace-nowrap px-4 py-1.5 font-medium tabular-nums text-ink">{r.phone}</td>
                  <td className="px-3 py-1.5 text-ink-muted">{r.reason || r.source}</td>
                  <td className="hidden whitespace-nowrap px-3 py-1.5 tabular-nums text-ink-subtle sm:table-cell">{formatDateTime(r.createdAt)}</td>
                  <td className="px-4 py-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await removeOptOut(r.phone);
                        onChanged();
                      }}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-center gap-1.5 border-t border-line bg-surface-subtle px-4 py-2 text-2xs text-ink-subtle">
        <AlertTriangle size={11} className="shrink-0 text-warning-600" />
        Only remove a number if the person has asked, in writing, to be messaged again.
      </p>
    </Card>
  );
}
