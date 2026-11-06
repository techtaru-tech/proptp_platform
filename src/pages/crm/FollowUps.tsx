import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Calendar, CalendarDays, Check, Clock3, RotateCcw, X as XIcon } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { Panel, PanelHeader } from '../dashboard/widgets';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { listFollowUps, updateFollowUpStatus, rescheduleFollowUp, type FollowUpListParams, type FollowUpWithLeadName } from '../../services/followUpService';
import { listAssignableUsers } from '../../services/leadService';
import { formatTime } from '../../utils/format';
import { DueCell, OverdueAge, OwnerBars, daysOverdue, overdueByOwner } from './followUpsParts';
import type { FollowUpStatus, LeadPriority } from '../../types';

const BUCKET_OPTIONS: { value: FollowUpListParams['bucket']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due Today' },
  { value: 'upcoming', label: 'Upcoming' },
];

const STATUS_OPTIONS: { value: FollowUpStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'missed', label: 'Missed' },
  { value: 'rescheduled', label: 'Rescheduled' },
];

/**
 * The breakdowns read every open follow-up in a bucket, not a page of them. The list endpoint has
 * no cap of its own; these are generous ceilings, and the panels say so if one is ever reached.
 */
const OVERDUE_SAMPLE = 1000;
const BUCKET_SAMPLE = 500;

export function FollowUps() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bucket, setBucket] = useState<FollowUpListParams['bucket']>('overdue');
  const [status, setStatus] = useState<FollowUpStatus | 'all'>('all');
  const [assignedUserId, setAssignedUserId] = useState('all');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [rescheduleTarget, setRescheduleTarget] = useState<FollowUpWithLeadName | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  /** The clock "overdue" and "today" are judged by: held in state, ticked once a minute. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const assignableUsers = listAssignableUsers();

  const params: FollowUpListParams = { page, pageSize: 10, bucket, status, assignedUserId, sortBy: 'dueAt' };
  const { data, isLoading, error } = useAsync(() => listFollowUps(params), [JSON.stringify(params), reloadKey]);

  // Each bucket in full (oldest due first), for the cards' counts and captions and the panels below.
  const { data: overdue } = useAsync(() => listFollowUps({ bucket: 'overdue', pageSize: OVERDUE_SAMPLE }), [reloadKey]);
  const { data: today } = useAsync(() => listFollowUps({ bucket: 'today', pageSize: BUCKET_SAMPLE }), [reloadKey]);
  const { data: upcoming } = useAsync(() => listFollowUps({ bucket: 'upcoming', pageSize: BUCKET_SAMPLE }), [reloadKey]);

  const overdueTotal = overdue?.total ?? 0;
  const overdueItems = useMemo(() => overdue?.items ?? [], [overdue]);
  const owners = useMemo(
    () => overdueByOwner(overdueItems, (id) => assignableUsers.find((u) => u.id === id)?.name, now),
    // `assignableUsers` is a module-level list filled once at sign-in, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overdueItems, now]
  );
  const oldestOverdue = overdueItems.length ? daysOverdue(overdueItems[0].dueAt, now) : 0;

  const todayItems = today?.items ?? [];
  const todayPast = todayItems.filter((t) => new Date(t.dueAt).getTime() < now).length;
  const todayNext = todayItems.find((t) => new Date(t.dueAt).getTime() >= now);

  const weekAhead = (() => {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() + 7);
    const items = upcoming?.items ?? [];
    const n = items.filter((t) => new Date(t.dueAt).getTime() <= end.getTime()).length;
    // Oldest-first, so a full page that is all inside the week means there may be more.
    return n === items.length && (upcoming?.total ?? 0) > items.length ? `${n}+` : String(n);
  })();

  const handleComplete = async (id: string) => {
    await updateFollowUpStatus(id, 'completed');
    toast({ title: 'Follow-up completed', variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const handleMissed = async (id: string) => {
    await updateFollowUpStatus(id, 'missed');
    toast({ title: 'Follow-up marked as missed', variant: 'info' });
    setReloadKey((k) => k + 1);
  };

  const handleReschedule = async () => {
    if (!rescheduleTarget || !rescheduleDate) return;
    await rescheduleFollowUp(rescheduleTarget.id, new Date(rescheduleDate).toISOString());
    toast({ title: 'Follow-up rescheduled', variant: 'success' });
    setRescheduleTarget(null);
    setRescheduleDate('');
    setReloadKey((k) => k + 1);
  };

  const pickBucket = (next: FollowUpListParams['bucket']) => {
    setBucket(next);
    setPage(1);
  };

  /** From the owner panel: that person's overdue follow-ups, or everyone's again. */
  const pickOwner = (userId: string | null) => {
    setBucket('overdue');
    setAssignedUserId(userId ?? 'all');
    setPage(1);
  };

  const hasActiveFilters = status !== 'all' || assignedUserId !== 'all';
  const resetFilters = () => {
    setStatus('all');
    setAssignedUserId('all');
    setPage(1);
  };

  const columns: DataTableColumn<FollowUpWithLeadName>[] = [
    {
      key: 'title',
      header: 'Follow-up',
      render: (t) => (
        <div className="min-w-[13rem]">
          <p className="font-medium text-ink">{t.title}</p>
          {t.leadName && <p className="text-xs text-ink-subtle">{t.leadName}</p>}
        </div>
      ),
    },
    // Open and from an earlier day: a red "Nd overdue" chip. The exact moment is on hover.
    { key: 'dueAt', header: 'Due', sortable: true, render: (t) => <DueCell task={t} now={now} /> },
    { key: 'priority', header: 'Priority', render: (t) => <StatusBadge kind="leadPriority" status={t.priority as LeadPriority} dot={false} /> },
    {
      key: 'assignee',
      header: 'Assigned To',
      render: (t) => {
        const user = assignableUsers.find((u) => u.id === t.assignedUserId);
        return user ? (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Avatar name={user.name} size="xs" />
            {user.name}
          </span>
        ) : (
          <span className="text-ink-faint">Unassigned</span>
        );
      },
    },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge kind="followUpStatus" status={t.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (t) =>
        t.status === 'pending' || t.status === 'rescheduled' ? (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" leftIcon={<Check size={12} />} onClick={() => handleComplete(t.id)}>
              Complete
            </Button>
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw size={12} />} onClick={() => { setRescheduleTarget(t); setRescheduleDate(''); }}>
              Reschedule
            </Button>
            <Button variant="ghost" size="sm" leftIcon={<XIcon size={12} />} className="text-danger-600" onClick={() => handleMissed(t.id)}>
              Cancel
            </Button>
          </div>
        ) : (
          <span className="text-xs text-ink-faint">—</span>
        ),
    },
  ];

  const selectedOwnerName = assignedUserId !== 'all' ? assignableUsers.find((u) => u.id === assignedUserId)?.name : undefined;

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        description="Everything promised to a lead, by urgency and owner."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Follow-ups' }]}
        actions={
          <Button variant="outline" leftIcon={<CalendarDays size={14} />} onClick={() => navigate('/crm/calendar')}>
            Calendar view
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Overdue"
          value={overdueTotal}
          icon={AlertTriangle}
          tone="danger"
          active={bucket === 'overdue'}
          onClick={() => pickBucket('overdue')}
          footer={
            !overdue ? undefined : overdueTotal > 0 ? (
              <>
                <span className="font-medium text-danger-700">needs action</span>
                <span className="tabular-nums"> · oldest {oldestOverdue}d</span>
              </>
            ) : (
              <span className="font-medium text-success-700">all clear</span>
            )
          }
        />
        <StatCard
          label="Due today"
          value={today?.total ?? 0}
          icon={Clock3}
          tone="warning"
          active={bucket === 'today'}
          onClick={() => pickBucket('today')}
          footer={
            !today ? undefined : today.total === 0 ? (
              <span className="font-medium text-success-700">all clear</span>
            ) : todayPast > 0 ? (
              <>
                <span className="font-medium text-warning-700">{todayPast} past due time</span>
                {todayNext && <span className="tabular-nums"> · next {formatTime(todayNext.dueAt)}</span>}
              </>
            ) : todayNext ? (
              <span className="tabular-nums">next at {formatTime(todayNext.dueAt)}</span>
            ) : undefined
          }
        />
        <StatCard
          label="Upcoming"
          value={upcoming?.total ?? 0}
          icon={Calendar}
          tone="info"
          active={bucket === 'upcoming'}
          onClick={() => pickBucket('upcoming')}
          footer={
            !upcoming ? undefined : upcoming.total === 0 ? (
              'nothing scheduled'
            ) : (
              <span className="tabular-nums">
                <span className="font-medium text-info-700">{weekAhead}</span> in the next 7 days
              </span>
            )
          }
        />
      </div>

      {/* Only while there is a backlog: with nothing overdue the card above already says "all clear". */}
      {overdueTotal > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Panel className="lg:col-span-2">
            <PanelHeader
              title="Overdue by owner"
              meta={`${overdueTotal} open from earlier days, across ${owners.length} ${owners.length === 1 ? 'owner' : 'owners'}${overdueItems.length < overdueTotal ? ` · oldest ${overdueItems.length} shown` : ''}`}
              action={
                selectedOwnerName && bucket === 'overdue' ? (
                  <button
                    type="button"
                    onClick={() => pickOwner(null)}
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-ink-subtle hover:text-ink focus-ring"
                  >
                    <XIcon size={11} /> Show everyone
                  </button>
                ) : (
                  <span className="hidden text-xs text-ink-faint sm:inline">Click a name to filter</span>
                )
              }
            />
            <OwnerBars rows={owners} selectedId={bucket === 'overdue' ? assignedUserId : ''} onSelect={pickOwner} />
          </Panel>
          <Panel>
            <PanelHeader title="Overdue by age" meta="days past due" />
            <OverdueAge items={overdueItems} now={now} />
          </Panel>
        </div>
      )}

      <Card padded={false}>
        <FilterBar onReset={resetFilters} hasActiveFilters={hasActiveFilters}>
          <Select aria-label="Due" value={bucket} onChange={(e) => pickBucket(e.target.value as FollowUpListParams['bucket'])} options={BUCKET_OPTIONS as { value: string; label: string }[]} wrapperClassName="w-40" />
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as FollowUpStatus | 'all'); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-40" />
          <Select
            aria-label="Assigned to"
            value={assignedUserId}
            onChange={(e) => { setAssignedUserId(e.target.value); setPage(1); }}
            options={[{ value: 'all', label: 'Anyone' }, ...assignableUsers.map((u) => ({ value: u.id, label: u.name }))]}
            wrapperClassName="w-48"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(t) => t.id}
          isLoading={isLoading}
          error={error}
          onRetry={() => setReloadKey((k) => k + 1)}
          onRowClick={(t) => navigate(`/crm/leads/${t.leadId}`)}
          rowHref={(t) => `/crm/leads/${t.leadId}`}
          emptyTitle="No follow-ups found"
          emptyDescription="Nothing matches these filters."
        />

        {data && data.total > 0 && <Pagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        isOpen={!!rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        title="Reschedule Follow-up"
        footer={
          <>
            <Button variant="outline" onClick={() => setRescheduleTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleReschedule} disabled={!rescheduleDate}>
              Save
            </Button>
          </>
        }
      >
        <Input label="New due date & time" type="datetime-local" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
      </Modal>
    </div>
  );
}
