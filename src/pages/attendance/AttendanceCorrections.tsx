import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { ErrorState } from '../../components/ui/ErrorState';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { listCorrections, resolveCorrection } from '../../services/attendanceService';
import { roleLabel } from '../../services/userService';
import { formatDate } from '../../utils/format';
import type { AttendanceRecord } from '../../types';

export function AttendanceCorrections() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState<{ record: AttendanceRecord; decision: 'approved' | 'rejected' } | null>(null);

  const { data: records, isLoading, error } = useAsync(() => listCorrections(), [reloadKey]);

  const handleConfirm = async () => {
    if (!pending) return;
    await resolveCorrection(pending.record.id, pending.decision);
    toast({
      title: `Correction ${pending.decision}`,
      description: `${pending.record.userName}'s correction request for ${formatDate(pending.record.date)} was ${pending.decision}.`,
      variant: pending.decision === 'approved' ? 'success' : 'info',
    });
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<AttendanceRecord>[] = [
    {
      key: 'user',
      header: 'Employee / Leader',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.userName} size="xs" />
          <div>
            <p className="font-medium text-ink">{r.userName}</p>
            <p className="text-xs text-ink-faint">{roleLabel(r.role)}</p>
          </div>
        </div>
      ),
    },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'reason', header: 'Reason', render: (r) => <span className="line-clamp-2 max-w-sm text-ink-muted">{r.correctionReason}</span> },
    { key: 'status', header: 'Status', render: (r) => (r.correctionStatus ? <StatusBadge kind="correction" status={r.correctionStatus} /> : '—') },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) =>
        r.correctionStatus === 'pending' ? (
          <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" leftIcon={<Check size={13} />} onClick={() => setPending({ record: r, decision: 'approved' })}>
              Approve
            </Button>
            <Button variant="danger" size="sm" leftIcon={<X size={13} />} onClick={() => setPending({ record: r, decision: 'rejected' })}>
              Reject
            </Button>
          </div>
        ) : (
          <span className="text-xs text-ink-faint">Decided</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Attendance Corrections"
        description="Review correction requests submitted for Employee and Leader attendance records."
      />

      <Card padded={false}>
        {error ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
          <DataTable
            columns={columns}
            rows={records ?? []}
            rowKey={(r) => r.id}
            isLoading={isLoading}
            onRowClick={(r) => navigate(`/attendance/${r.id}`)}
            emptyTitle="No correction requests"
            emptyDescription="There are currently no attendance correction requests to review."
          />
        )}
      </Card>

      <ConfirmationDialog
        isOpen={!!pending}
        onClose={() => setPending(null)}
        onConfirm={handleConfirm}
        title={pending?.decision === 'approved' ? 'Approve correction request' : 'Reject correction request'}
        description={
          pending
            ? `This will mark ${pending.record.userName}'s correction request for ${formatDate(pending.record.date)} as ${pending.decision}.`
            : undefined
        }
        confirmLabel={pending?.decision === 'approved' ? 'Approve' : 'Reject'}
        variant={pending?.decision === 'approved' ? 'primary' : 'danger'}
        audited
      />
    </div>
  );
}
