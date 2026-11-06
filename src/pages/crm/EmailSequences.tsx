import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Info, Layers, Mail, Pencil, Play, Plus, Send, Trash2, Users } from 'lucide-react';
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
import {
  deleteEmailSequence, getEmailCapabilities, listEmailSequences, runDueSequenceSteps,
  SEQUENCE_STATUS_OPTIONS, SEQUENCE_STATUS_TONE,
} from '../../services/emailSequenceService';
import { formatDate } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { EmailSequence } from '../../types';

/** A count in a table cell; zero recedes so the rows with activity stand out. */
function Count({ value }: { value: number }) {
  return <span className={cn('tabular-nums', value === 0 ? 'text-ink-faint' : 'text-ink')}>{value}</span>;
}

export function EmailSequences() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | EmailSequence['status']>('all');
  const [deleteTarget, setDeleteTarget] = useState<EmailSequence | null>(null);
  const [running, setRunning] = useState(false);

  const { data: sequences, isLoading } = useAsync(() => listEmailSequences(), [reloadKey]);
  const { data: capabilities } = useAsync(() => getEmailCapabilities(), []);

  const all = sequences ?? [];
  const term = search.trim().toLowerCase();
  const rows = all.filter(
    (s) =>
      (status === 'all' || s.status === status) &&
      (!term || s.name.toLowerCase().includes(term) || (s.description ?? '').toLowerCase().includes(term))
  );

  const countBy = (st: EmailSequence['status']) => all.filter((s) => s.status === st).length;
  const sum = (pick: (s: EmailSequence) => number) => all.reduce((n, s) => n + pick(s), 0);
  const totals = {
    active: countBy('active'),
    inProgress: sum((s) => s.activeEnrollments),
    completed: sum((s) => s.completedEnrollments),
    stopped: sum((s) => s.stoppedEnrollments),
  };
  const showStats = !isLoading && all.length > 0;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteEmailSequence(deleteTarget.id);
    toast({ title: 'Sequence deleted', description: 'Its steps and enrollments were removed too.', variant: 'success' });
    setDeleteTarget(null);
    setReloadKey((k) => k + 1);
  };

  const handleRunDue = async () => {
    setRunning(true);
    try {
      await runDueSequenceSteps();
      toast({ title: 'Due steps processed', description: 'Anything scheduled for now or earlier has been sent.', variant: 'success' });
      setReloadKey((k) => k + 1);
    } finally {
      setRunning(false);
    }
  };

  const columns: DataTableColumn<EmailSequence>[] = [
    {
      key: 'name',
      header: 'Sequence',
      render: (s) => (
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{s.name}</p>
          {s.description && <p className="max-w-md truncate text-xs text-ink-subtle">{s.description}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => (
        <Badge tone={SEQUENCE_STATUS_TONE[s.status]} dot>
          {SEQUENCE_STATUS_OPTIONS.find((o) => o.value === s.status)?.label ?? s.status}
        </Badge>
      ),
    },
    {
      key: 'steps',
      header: 'Steps',
      align: 'right',
      render: (s) => (
        <span className="tabular-nums text-ink-muted">
          {s.stepCount} <span className="text-ink-faint">{s.stepCount === 1 ? 'email' : 'emails'}</span>
        </span>
      ),
    },
    { key: 'active', header: 'In progress', align: 'right', render: (s) => <Count value={s.activeEnrollments} /> },
    { key: 'completed', header: 'Completed', align: 'right', render: (s) => <Count value={s.completedEnrollments} /> },
    { key: 'stopped', header: 'Stopped', align: 'right', render: (s) => <Count value={s.stoppedEnrollments} /> },
    { key: 'createdAt', header: 'Created', render: (s) => <span className="tabular-nums text-ink-muted">{formatDate(s.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" leftIcon={<Users size={13} />} onClick={() => navigate(`/crm/email-sequences/${s.id}`)}>
            Leads
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={13} />} onClick={() => navigate(`/crm/email-sequences/${s.id}/edit`)}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-danger-600 hover:text-danger-700" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteTarget(s)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Email Sequences"
        description="A timed series of emails a lead is enrolled into. Steps go out top-to-bottom, and the sequence stops itself when the lead replies or is won."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Email Sequences' }]}
        actions={
          <>
            <Button variant="outline" leftIcon={<Play size={14} />} isLoading={running} onClick={handleRunDue}>
              Run Due Steps
            </Button>
            <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/email-sequences/new')}>
              New Email Sequence
            </Button>
          </>
        }
      />

      {capabilities && !capabilities.emailProviderConfigured && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-700">
          <Info size={14} className="mt-px shrink-0" />
          <p>
            <strong className="font-semibold">No email provider is configured.</strong> Sequences still run for real —
            leads enrol, delays are honoured and the stop rules fire — but no email leaves the building. Each step is
            recorded on the lead's timeline with its full subject and body instead.
          </p>
        </div>
      )}

      {showStats && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Sequences"
            value={all.length}
            icon={Layers}
            tone="shell"
            footer={`${countBy('paused')} paused · ${countBy('draft')} draft`}
          />
          <StatCard label="Sending now" value={totals.active} icon={Send} tone={totals.active > 0 ? 'success' : 'neutral'} footer="Only Active sequences send" />
          <StatCard label="Leads in progress" value={totals.inProgress} icon={Users} tone="info" footer="Enrolled, steps still to go" />
          <StatCard
            label="Completed"
            value={totals.completed}
            icon={CheckCircle2}
            tone="brand"
            footer={`${totals.stopped} stopped early`}
          />
        </div>
      )}

      {!isLoading && all.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={Mail}
            title="No email sequences yet"
            description="Create a sequence, then enrol leads into it from the leads list or with an automation action."
            action={
              <Button variant="primary" size="sm" leftIcon={<Plus size={13} />} onClick={() => navigate('/crm/email-sequences/new')}>
                Create first sequence
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
                  label: SEQUENCE_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v,
                  count: countBy(v),
                })),
              ]}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="Search sequences..." className="sm:w-64" />
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(s) => s.id}
            isLoading={isLoading}
            onRowClick={(s) => navigate(`/crm/email-sequences/${s.id}`)}
            rowHref={(s) => `/crm/email-sequences/${s.id}`}
            emptyTitle="No sequences match"
            emptyDescription="Try another status or search term."
          />
        </Card>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-2xs text-ink-faint">
        <Mail size={11} className="shrink-0" />
        Due steps are picked up automatically once a minute. "Run Due Steps" just does it now instead of waiting.
      </p>

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete this sequence?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}", its ${deleteTarget.stepCount} step(s) and every enrollment will be permanently removed. Leads themselves are not affected, and emails already recorded on their timelines stay.`
            : undefined
        }
        confirmLabel="Delete sequence"
        variant="danger"
      />
    </div>
  );
}
