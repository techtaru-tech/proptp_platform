import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCheck, LogIn, LogOut, Clock3, UserX, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { SearchInput } from '../../components/ui/SearchInput';
import { StatCard } from '../../components/ui/StatCard';
import { StatCardSkeleton } from '../../components/ui/LoadingSkeleton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { ErrorState } from '../../components/ui/ErrorState';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { useAsync } from '../../hooks/useAsync';
import { listAttendanceToday } from '../../services/attendanceService';
import { formatHours, formatTime } from '../../utils/format';
import { RoleId, type AttendanceRecord } from '../../types';

const ROLE_OPTIONS = [
  { value: 'all', label: 'All Roles' },
  { value: String(RoleId.Employee), label: 'Employee' },
  { value: String(RoleId.Leader), label: 'Leader' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'checked_in', label: 'Checked In' },
  { value: 'checked_out', label: 'Checked Out' },
  { value: 'not_checked_in', label: 'Not Checked In' },
  { value: 'pending_sync', label: 'Pending Sync' },
  { value: 'failed', label: 'Failed' },
];

export function AttendanceToday() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [reloadKey, setReloadKey] = useState(0);

  const { data: records, isLoading, error } = useAsync(() => listAttendanceToday(), [reloadKey]);

  const filtered = useMemo(() => {
    if (!records) return [];
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (q && !r.userName.toLowerCase().includes(q)) return false;
      if (role !== 'all' && String(r.role) !== role) return false;
      if (status !== 'all' && r.status !== status) return false;
      return true;
    });
  }, [records, search, role, status]);

  const counts = useMemo(() => {
    const list = records ?? [];
    return {
      present: list.filter((r) => r.status === 'checked_in' || r.status === 'checked_out').length,
      checkedIn: list.filter((r) => r.status === 'checked_in').length,
      checkedOut: list.filter((r) => r.status === 'checked_out').length,
      late: list.filter((r) => r.isLate).length,
      absent: list.filter((r) => r.status === 'not_checked_in').length,
      pendingSync: list.filter((r) => r.syncStatus === 'pending').length,
      failed: list.filter((r) => r.syncStatus === 'failed').length,
    };
  }, [records]);

  const columns: DataTableColumn<AttendanceRecord>[] = [
    {
      key: 'user',
      header: 'Employee / Leader',
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.userName} size="xs" />
          <span className="font-medium text-ink">{r.userName}</span>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (r) => (r.role === RoleId.Leader ? 'Leader' : 'Employee') },
    { key: 'checkIn', header: 'Check-in', render: (r) => (r.checkInAt ? formatTime(r.checkInAt) : '—') },
    { key: 'checkOut', header: 'Check-out', render: (r) => (r.checkOutAt ? formatTime(r.checkOutAt) : '—') },
    { key: 'duration', header: 'Duration', render: (r) => formatHours(r.workingHours) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="attendance" status={r.status} /> },
    { key: 'location', header: 'Location', render: (r) => <StatusBadge kind="geo" status={r.geoFenceResult} /> },
    { key: 'sync', header: 'Sync Status', render: (r) => <StatusBadge kind="sync" status={r.syncStatus} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Today's Attendance"
        description="Live administrative view of Employee and Leader attendance for today. Admins do not have mobile check-in/check-out access."
      />

      {isLoading ? (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <StatCard label="Present" value={counts.present} icon={UserCheck} tone="success" />
          <StatCard label="Checked-in" value={counts.checkedIn} icon={LogIn} tone="info" />
          <StatCard label="Checked-out" value={counts.checkedOut} icon={LogOut} tone="navy" />
          <StatCard label="Late" value={counts.late} icon={Clock3} tone="warning" />
          <StatCard label="Absent" value={counts.absent} icon={UserX} tone="danger" />
          <StatCard label="Pending Sync" value={counts.pendingSync} icon={RefreshCw} tone="accent" />
          <StatCard label="Failed" value={counts.failed} tone="danger" />
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name..." className="w-full sm:w-64" />
          <Select value={role} onChange={(e) => setRole(e.target.value)} options={ROLE_OPTIONS} wrapperClassName="w-40" aria-label="Role filter" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} wrapperClassName="w-44" aria-label="Status filter" />
        </div>
        {error ? (
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            isLoading={isLoading}
            onRowClick={(r) => navigate(`/attendance/${r.id}`)}
            emptyTitle="No attendance records"
            emptyDescription="No records match your current filters for today."
          />
        )}
      </Card>
    </div>
  );
}
