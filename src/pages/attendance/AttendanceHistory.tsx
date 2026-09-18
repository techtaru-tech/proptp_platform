import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, RefreshCw, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Avatar } from '../../components/ui/Avatar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listAttendance, type AttendanceListParams } from '../../services/attendanceService';
import { exportToCsv } from '../../services/reportService';
import { refEmployees, refLeaders } from '../../data/referenceData';
import { formatDate, formatHours, formatTime } from '../../utils/format';
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

const LOCATION_OPTIONS = [
  { value: 'all', label: 'All Locations' },
  { value: 'inside', label: 'Inside Geo-fence' },
  { value: 'outside', label: 'Outside Geo-fence' },
  { value: 'unknown', label: 'Unknown' },
];

const SYNC_OPTIONS = [
  { value: 'all', label: 'All Sync Status' },
  { value: 'synced', label: 'Synced' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
];

const USER_OPTIONS = [
  { value: 'all', label: 'All Employees / Leaders' },
  ...refEmployees.map((e) => ({ value: e.id, label: e.name })),
  ...refLeaders.map((l) => ({ value: l.id, label: l.name })),
];

export function AttendanceHistory() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('all');
  const [role, setRole] = useState<AttendanceListParams['role']>('all');
  const [status, setStatus] = useState<AttendanceListParams['status']>('all');
  const [locationStatus, setLocationStatus] = useState<AttendanceListParams['locationStatus']>('all');
  const [syncStatus, setSyncStatus] = useState<AttendanceListParams['syncStatus']>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const debouncedSearch = useDebounce(search, 300);

  const params: AttendanceListParams = {
    page,
    pageSize: 10,
    search: debouncedSearch,
    userId: userId === 'all' ? undefined : userId,
    role,
    status,
    locationStatus,
    syncStatus,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    sortBy,
    sortDir,
  };

  const { data, isLoading, error } = useAsync(() => listAttendance(params), [JSON.stringify(params)]);

  const hasActiveFilters = useMemo(
    () => !!(search || userId !== 'all' || role !== 'all' || status !== 'all' || locationStatus !== 'all' || syncStatus !== 'all' || dateFrom || dateTo),
    [search, userId, role, status, locationStatus, syncStatus, dateFrom, dateTo]
  );

  const resetFilters = () => {
    setSearch('');
    setUserId('all');
    setRole('all');
    setStatus('all');
    setLocationStatus('all');
    setSyncStatus('all');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const handleSortChange = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const handleExport = () => {
    exportToCsv(
      'attendance-history.csv',
      (data?.items ?? []).map((r) => ({
        user: r.userName,
        role: r.role === RoleId.Leader ? 'Leader' : 'Employee',
        date: r.date,
        checkIn: r.checkInAt ?? '',
        checkOut: r.checkOutAt ?? '',
        workingHours: r.workingHours ?? '',
        status: r.status,
        geoFenceResult: r.geoFenceResult,
        syncStatus: r.syncStatus,
      }))
    );
  };

  const columns: DataTableColumn<AttendanceRecord>[] = [
    {
      key: 'userName',
      header: 'Employee / Leader',
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={r.userName} size="xs" />
          <span className="font-medium text-ink">{r.userName}</span>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (r) => (r.role === RoleId.Leader ? 'Leader' : 'Employee') },
    { key: 'date', header: 'Date', sortable: true, render: (r) => formatDate(r.date) },
    { key: 'checkIn', header: 'Check-in', render: (r) => (r.checkInAt ? formatTime(r.checkInAt) : '—') },
    { key: 'checkOut', header: 'Check-out', render: (r) => (r.checkOutAt ? formatTime(r.checkOutAt) : '—') },
    { key: 'duration', header: 'Duration', render: (r) => formatHours(r.workingHours) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="attendance" status={r.status} /> },
    { key: 'location', header: 'Location', render: (r) => <StatusBadge kind="geo" status={r.geoFenceResult} /> },
    { key: 'sync', header: 'Sync', render: (r) => <StatusBadge kind="sync" status={r.syncStatus} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Attendance History"
        description="Full attendance records for Employees and Leaders, filterable by date, status, location and sync state."
        actions={
          <Button variant="outline" leftIcon={<Download size={14} />} onClick={handleExport}>
            Export
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={syncStatus === 'pending' ? 'accent' : 'outline'}
          size="sm"
          leftIcon={<RefreshCw size={13} />}
          onClick={() => {
            setSyncStatus((s) => (s === 'pending' ? 'all' : 'pending'));
            setPage(1);
          }}
        >
          Pending Sync only
        </Button>
        <Button
          variant={syncStatus === 'failed' ? 'danger' : 'outline'}
          size="sm"
          leftIcon={<AlertTriangle size={13} />}
          onClick={() => {
            setSyncStatus((s) => (s === 'failed' ? 'all' : 'failed'));
            setPage(1);
          }}
        >
          Failed only
        </Button>
      </div>

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          searchPlaceholder="Search by name..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <DatePicker value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="From date" />
          <DatePicker value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="To date" />
          <Select value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} options={USER_OPTIONS} wrapperClassName="w-48" />
          <Select value={role} onChange={(e) => { setRole(e.target.value as AttendanceListParams['role']); setPage(1); }} options={ROLE_OPTIONS} wrapperClassName="w-36" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value as AttendanceListParams['status']); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-40" />
          <Select value={locationStatus} onChange={(e) => { setLocationStatus(e.target.value as AttendanceListParams['locationStatus']); setPage(1); }} options={LOCATION_OPTIONS} wrapperClassName="w-44" />
          <Select value={syncStatus} onChange={(e) => { setSyncStatus(e.target.value as AttendanceListParams['syncStatus']); setPage(1); }} options={SYNC_OPTIONS} wrapperClassName="w-40" />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          error={error}
          onRetry={() => setPage((p) => p)}
          onRowClick={(r) => navigate(`/attendance/${r.id}`)}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
        />

        {data && data.total > 0 && <Pagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
