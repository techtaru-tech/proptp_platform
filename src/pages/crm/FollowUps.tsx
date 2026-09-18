import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Calendar, Check, Clock3, RotateCcw, X as XIcon } from 'lucide-react';
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
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { listFollowUps, updateFollowUpStatus, rescheduleFollowUp, type FollowUpListParams, type FollowUpWithLeadName } from '../../services/followUpService';
import { listAssignableUsers } from '../../services/leadService';
import { formatDateTime } from '../../utils/format';
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

  const assignableUsers = listAssignableUsers();

  const params: FollowUpListParams = { page, pageSize: 10, bucket, status, assignedUserId, sortBy: 'dueAt' };
  const { data, isLoading, error } = useAsync(() => listFollowUps(params), [JSON.stringify(params), reloadKey]);

  const { data: overdueCount } = useAsync(() => listFollowUps({ bucket: 'overdue', pageSize: 500 }), [reloadKey]);
  const { data: todayCount } = useAsync(() => listFollowUps({ bucket: 'today', pageSize: 500 }), [reloadKey]);
  const { data: upcomingCount } = useAsync(() => listFollowUps({ bucket: 'upcoming', pageSize: 500 }), [reloadKey]);

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

  const columns: DataTableColumn<FollowUpWithLeadName>[] = [
    {
      key: 'title',
      header: 'Follow-up',
      render: (t) => (
        <div>
          <p className="font-medium text-ink">{t.title}</p>
          {t.leadName && <p className="text-xs text-ink-faint">{t.leadName}</p>}
        </div>
      ),
    },
    { key: 'dueAt', header: 'Due', sortable: true, render: (t) => formatDateTime(t.dueAt) },
    { key: 'priority', header: 'Priority', render: (t) => <StatusBadge kind="leadPriority" status={t.priority as LeadPriority} dot={false} /> },
    {
      key: 'assignee',
      header: 'Assigned To',
      render: (t) => {
        const user = assignableUsers.find((u) => u.id === t.assignedUserId);
        return user ? (
          <span className="flex items-center gap-2">
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
          <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
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

  return (
    <div>
      <PageHeader title="Follow-ups" description="Scheduled tasks across all leads, grouped by due date." breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Follow-ups' }]} />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard label="Overdue" value={overdueCount?.total ?? 0} icon={AlertTriangle} tone="danger" onClick={() => { setBucket('overdue'); setPage(1); }} />
        <StatCard label="Due Today" value={todayCount?.total ?? 0} icon={Clock3} tone="warning" onClick={() => { setBucket('today'); setPage(1); }} />
        <StatCard label="Upcoming" value={upcomingCount?.total ?? 0} icon={Calendar} tone="info" onClick={() => { setBucket('upcoming'); setPage(1); }} />
      </div>

      <Card padded={false}>
        <FilterBar>
          <Select value={bucket} onChange={(e) => { setBucket(e.target.value as FollowUpListParams['bucket']); setPage(1); }} options={BUCKET_OPTIONS as { value: string; label: string }[]} wrapperClassName="w-40" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value as FollowUpStatus | 'all'); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-40" />
          <Select
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
