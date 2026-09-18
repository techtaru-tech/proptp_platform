import { useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Check, Plus, X } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Textarea';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { listAssignableUsers } from '../../services/leadService';
import {
  applyForLeave, cancelLeave, decideLeave, listLeaveRequests, listLeaveTypes,
} from '../../services/hrService';
import { formatDate } from '../../utils/format';
import type { LeaveRequest, LeaveStatus } from '../../types';

const STATUS_TONE: Record<LeaveStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function LeaveRequests() {
  const { toast } = useToast();
  const [status, setStatus] = useState('pending');
  const [reloadKey, setReloadKey] = useState(0);
  const [applyOpen, setApplyOpen] = useState(false);
  const [deciding, setDeciding] = useState<{ request: LeaveRequest; decision: 'approved' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');

  const { data: requests, isLoading } = useAsync(() => listLeaveRequests({ status }), [status, reloadKey]);
  const { data: types } = useAsync(() => listLeaveTypes(), [reloadKey]);

  const pendingCount = useMemo(() => (requests ?? []).filter((r) => r.status === 'pending').length, [requests]);

  const decide = async () => {
    if (!deciding) return;
    try {
      await decideLeave(deciding.request.id, deciding.decision, note.trim() || undefined);
      toast({
        title: deciding.decision === 'approved' ? 'Leave approved' : 'Leave rejected',
        description: `${deciding.request.userName} has been notified.`,
        variant: 'success',
      });
      setDeciding(null);
      setNote('');
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not save the decision', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    }
  };

  const columns: DataTableColumn<LeaveRequest>[] = [
    { key: 'user', header: 'Employee', render: (r) => <span className="font-medium text-ink">{r.userName}</span> },
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <span className="flex items-center gap-1.5">
          {r.typeName}
          {!r.isPaid && <Badge tone="neutral">unpaid</Badge>}
        </span>
      ),
    },
    {
      key: 'dates',
      header: 'Dates',
      render: (r) => (
        <span className="text-ink-muted">
          {formatDate(r.startDate)}
          {r.startDate !== r.endDate && ` → ${formatDate(r.endDate)}`}
        </span>
      ),
    },
    { key: 'days', header: 'Days', align: 'right', render: (r) => r.days },
    { key: 'reason', header: 'Reason', render: (r) => <span className="text-ink-muted">{r.reason}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        r.status === 'pending' ? (
          <span className="flex justify-end gap-1.5">
            <Button variant="outline" size="sm" leftIcon={<Check size={13} />} onClick={() => setDeciding({ request: r, decision: 'approved' })}>
              Approve
            </Button>
            <Button variant="outline" size="sm" leftIcon={<X size={13} />} onClick={() => setDeciding({ request: r, decision: 'rejected' })}>
              Reject
            </Button>
          </span>
        ) : r.status === 'approved' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await cancelLeave(r.id);
              toast({ title: 'Leave cancelled', variant: 'info' });
              setReloadKey((k) => k + 1);
            }}
          >
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Leave Requests"
        description="Who is off, who is asking to be, and what it costs the month's payroll."
        breadcrumb={[{ label: 'Attendance', to: '/attendance/today' }, { label: 'Leave Requests' }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => setApplyOpen(true)}>
            Apply for Leave
          </Button>
        }
      />

      {pendingCount > 0 && status !== 'pending' && (
        <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <CalendarDays size={16} className="shrink-0" />
          <p>
            {pendingCount} request{pendingCount === 1 ? '' : 's'} still waiting on a decision.
          </p>
        </div>
      )}

      <Card padded={false}>
        <div className="border-b border-line p-3">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} wrapperClassName="w-52" />
        </div>
        <DataTable
          columns={columns}
          rows={requests ?? []}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyTitle="Nothing here"
          emptyDescription={status === 'pending' ? 'No requests are waiting on a decision.' : 'No leave matches this filter.'}
        />
      </Card>

      {applyOpen && (
        <ApplyDialog
          types={(types ?? []).filter((t) => t.active)}
          onClose={() => setApplyOpen(false)}
          onSaved={() => {
            setApplyOpen(false);
            setStatus('pending');
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      {deciding && (
        <Modal
          isOpen
          onClose={() => setDeciding(null)}
          title={deciding.decision === 'approved' ? 'Approve this leave?' : 'Reject this leave?'}
          description={`${deciding.request.userName} · ${deciding.request.typeName} · ${deciding.request.days} day(s)`}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button variant={deciding.decision === 'approved' ? 'primary' : 'danger'} onClick={decide}>
                {deciding.decision === 'approved' ? 'Approve' : 'Reject'}
              </Button>
            </>
          }
        >
          <Textarea
            label="Note for the employee"
            rows={3}
            value={note}
            onChange={setNote}
            placeholder={deciding.decision === 'approved' ? 'Optional' : 'Why it was turned down'}
            hint="Goes out with the notification they receive."
          />
        </Modal>
      )}
    </div>
  );
}

function ApplyDialog({
  types, onClose, onSaved,
}: { types: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const staff = listAssignableUsers();
  const today = new Date().toISOString().slice(0, 10);

  const [userId, setUserId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? '');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId) return toast({ title: 'Pick the employee', variant: 'error' });
    if (!leaveTypeId) return toast({ title: 'Pick a leave type', variant: 'error' });
    if (!reason.trim()) return toast({ title: 'A reason is required', variant: 'error' });

    setSaving(true);
    try {
      await applyForLeave({ userId, leaveTypeId, startDate, endDate, halfDay, reason: reason.trim() });
      toast({ title: 'Leave applied', description: 'It is waiting for a decision.', variant: 'success' });
      onSaved();
    } catch (err) {
      toast({ title: 'Could not apply', description: err instanceof Error ? err.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Apply for Leave"
      description="Raised on behalf of an employee. It still needs approving."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} isLoading={saving}>
            Apply
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Select
          label="Employee"
          required
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          options={[{ value: '', label: 'Choose…' }, ...staff.map((u) => ({ value: u.id, label: u.name }))]}
        />
        <Select
          label="Leave type"
          required
          value={leaveTypeId}
          onChange={(e) => setLeaveTypeId(e.target.value)}
          options={types.map((t) => ({ value: t.id, label: t.name }))}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="From"
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value > endDate) setEndDate(e.target.value);
            }}
          />
          <Input label="To" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        {startDate === endDate && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} className="h-4 w-4 rounded border-line-strong" />
            Half day
          </label>
        )}
        <Textarea label="Reason" rows={3} value={reason} onChange={setReason} placeholder="Why they need the time off" />
        <p className="text-xs text-ink-faint">
          Sundays are not counted. A clash with leave already approved or pending is refused.
        </p>
      </form>
    </Modal>
  );
}
