import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Layers, MessageCircle, Pause, Pencil, Play, PlayCircle, Plus, Trash2, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatCard } from '../../components/ui/StatCard';
import { FilterChips } from '../../components/ui/FilterChips';
import { EmptyState } from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { deleteDrip, DRIP_STATUS_OPTIONS, DRIP_STATUS_TONE, listDrips, runDueDripSteps, setDripStatus } from '../../services/whatsappDripService';
import { formatDate } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { WhatsAppDrip, WhatsAppDripStatus } from '../../types';

/** A count in a table cell; zero recedes so the rows with activity stand out. */
function Count({ value }: { value: number }) {
  return <span className={cn('tabular-nums', value === 0 ? 'text-ink-faint' : 'text-ink')}>{value}</span>;
}

export function WhatsAppDrips() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | WhatsAppDripStatus>('all');
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppDrip | null>(null);
  const [running, setRunning] = useState(false);

  const { data: drips, isLoading } = useAsync(() => listDrips(), [reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  const all = drips ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter(
    (d) =>
      (status === 'all' || d.status === status) &&
      (!term || d.name.toLowerCase().includes(term) || (d.description ?? '').toLowerCase().includes(term))
  );

  const countBy = (st: WhatsAppDripStatus) => all.filter((d) => d.status === st).length;
  const sum = (pick: (d: WhatsAppDrip) => number) => all.reduce((n, d) => n + pick(d), 0);
  const live = countBy('active');
  const inProgress = sum((d) => d.activeEnrollments);
  const completed = sum((d) => d.completedEnrollments);
  const stopped = sum((d) => d.stoppedEnrollments);

  const toggle = async (drip: WhatsAppDrip) => {
    const next = drip.status === 'active' ? 'paused' : 'active';
    try {
      await setDripStatus(drip.id, next);
      toast({ title: next === 'active' ? 'Campaign is live' : 'Campaign paused', description: next === 'active' ? 'Enrolled leads get their steps on schedule.' : 'Nothing more is sent until you resume it.', variant: 'success' });
      reload();
    } catch (err) {
      toast({ title: 'Could not change status', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const columns: DataTableColumn<WhatsAppDrip>[] = [
    {
      key: 'name',
      header: 'Campaign',
      render: (d) => (
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{d.name}</p>
          {d.description && <p className="max-w-md truncate text-xs text-ink-subtle">{d.description}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => (
        <Badge tone={DRIP_STATUS_TONE[d.status]} dot>
          {DRIP_STATUS_OPTIONS.find((o) => o.value === d.status)?.label}
        </Badge>
      ),
    },
    {
      key: 'steps',
      header: 'Steps',
      align: 'right',
      render: (d) => (
        <span className="tabular-nums text-ink-muted">
          {d.stepCount} <span className="text-ink-faint">{d.stepCount === 1 ? 'template' : 'templates'}</span>
        </span>
      ),
    },
    { key: 'active', header: 'In progress', align: 'right', render: (d) => <Count value={d.activeEnrollments} /> },
    { key: 'completed', header: 'Completed', align: 'right', render: (d) => <Count value={d.completedEnrollments} /> },
    { key: 'stopped', header: 'Stopped', align: 'right', render: (d) => <Count value={d.stoppedEnrollments} /> },
    { key: 'createdAt', header: 'Created', render: (d) => <span className="tabular-nums text-ink-muted">{formatDate(d.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (d) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={d.status === 'active' ? <Pause size={13} /> : <Play size={13} />} onClick={() => toggle(d)}>
            {d.status === 'active' ? 'Pause' : 'Start'}
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Users size={13} />} onClick={() => navigate(`/crm/whatsapp-drips/${d.id}`)}>
            Leads
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/whatsapp-drips/${d.id}/edit`)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-600 hover:text-danger-700" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(d)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="WhatsApp Drip Campaigns"
        description="A timed series of approved WhatsApp templates. Leads are enrolled once, steps go out on schedule, and a campaign stops for a lead who replies or is won."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'WhatsApp Drips' }]}
        actions={
          <>
            <Button
              variant="outline"
              leftIcon={<Play size={14} />}
              isLoading={running}
              onClick={async () => {
                setRunning(true);
                try {
                  await runDueDripSteps();
                  toast({ title: 'Due steps processed', variant: 'success' });
                  reload();
                } finally {
                  setRunning(false);
                }
              }}
            >
              Run Due Steps
            </Button>
            <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/whatsapp-drips/new')}>
              New Drip Campaign
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Drip campaigns"
          value={isLoading ? '…' : all.length}
          icon={Layers}
          tone="shell"
          footer={`${countBy('paused')} paused · ${countBy('draft')} draft`}
        />
        <StatCard label="Live" value={isLoading ? '…' : live} icon={PlayCircle} tone={live > 0 ? 'success' : 'neutral'} footer="Only Active campaigns send" />
        <StatCard label="Leads in progress" value={isLoading ? '…' : inProgress} icon={Users} tone="info" footer="Enrolled, steps still to go" />
        <StatCard label="Completed" value={isLoading ? '…' : completed} icon={CheckCircle2} tone="brand" footer={`${stopped} stopped early`} />
      </div>

      {!isLoading && all.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={MessageCircle}
            title="No drip campaigns yet"
            description="Build a campaign from your approved templates — for example a brochure on day 0, a site-visit invite on day 2 — then enrol leads into it."
            action={
              <Button variant="primary" size="sm" leftIcon={<Plus size={13} />} onClick={() => navigate('/crm/whatsapp-drips/new')}>
                Create first drip
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <FilterChips
              label="Status"
              value={status}
              onChange={(v) => setStatus(v as typeof status)}
              items={[
                { key: 'all', label: 'All', count: all.length },
                ...(['active', 'paused', 'draft'] as const).map((v) => ({
                  key: v,
                  label: DRIP_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v,
                  count: countBy(v),
                })),
              ]}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Search campaigns..." className="sm:w-64" />
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(d) => d.id}
            isLoading={isLoading}
            onRowClick={(d) => navigate(`/crm/whatsapp-drips/${d.id}`)}
            rowHref={(d) => `/crm/whatsapp-drips/${d.id}`}
            emptyTitle="No campaigns match"
            emptyDescription="Try another status or search term."
          />
        </Card>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-2xs text-ink-faint">
        <MessageCircle size={11} className="mt-[3px] shrink-0" />
        Due steps are picked up automatically once a minute. Every step is a template approved on your WhatsApp number — create them under Notifications → WhatsApp Templates.
      </p>

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteDrip(deleteTarget.id);
          toast({ title: 'Campaign deleted', variant: 'success' });
          setDeleteTarget(null);
          reload();
        }}
        title="Delete this campaign?"
        description={deleteTarget ? `"${deleteTarget.name}", its ${deleteTarget.stepCount} step(s) and every enrollment are removed. Messages already sent stay in each lead's WhatsApp thread.` : undefined}
        confirmLabel="Delete campaign"
        variant="danger"
      />
    </div>
  );
}
