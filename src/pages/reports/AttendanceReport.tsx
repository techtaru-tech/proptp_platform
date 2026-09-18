import { useMemo, useState } from 'react';
import { Download, Fingerprint, Clock3, MapPinOff } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { FilterBar } from '../../components/tables/FilterBar';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart } from '../../components/charts/DonutChart';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { getAttendanceReport, exportToCsv } from '../../services/reportService';
import { formatDate, formatHours } from '../../utils/format';
import type { AttendanceStatus } from '../../types';

type Row = Awaited<ReturnType<typeof getAttendanceReport>>[number];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'checked_in', label: 'Checked In' },
  { value: 'checked_out', label: 'Checked Out' },
  { value: 'not_checked_in', label: 'Not Checked In' },
  { value: 'pending_sync', label: 'Pending Sync' },
  { value: 'failed', label: 'Failed' },
];

const PAGE_SIZE = 10;

export function AttendanceReport() {
  const { data, isLoading, error } = useAsync(() => getAttendanceReport(), []);
  const [status, setStatus] = useState<AttendanceStatus | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (q && !r.user.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, status, search]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => {
    const withHours = filtered.filter((r) => r.hours > 0);
    const avgHours = withHours.length ? withHours.reduce((s, r) => s + r.hours, 0) / withHours.length : 0;
    return {
      count: filtered.length,
      avgHours,
      late: filtered.filter((r) => r.late).length,
      outside: filtered.filter((r) => r.geoResult === 'outside').length,
    };
  }, [filtered]);

  const geoBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((r) => counts.set(r.geoResult, (counts.get(r.geoResult) ?? 0) + 1));
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const columns: DataTableColumn<Row>[] = [
    { key: 'user', header: 'Employee / Leader', render: (r) => <span className="font-medium text-ink">{r.user}</span> },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'hours', header: 'Working Hours', align: 'right', render: (r) => formatHours(r.hours) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="attendance" status={r.status} /> },
    { key: 'geoResult', header: 'Geo Result', render: (r) => <StatusBadge kind="geo" status={r.geoResult} /> },
  ];

  const hasActiveFilters = status !== 'all' || !!searchInput;

  return (
    <div>
      <PageHeader
        title="Attendance Report"
        description="Employee and Leader attendance across date range, status and geo-fence result."
        actions={
          <Button variant="outline" leftIcon={<Download size={15} />} onClick={() => exportToCsv('attendance-report.csv', filtered)} disabled={!filtered.length}>
            Export
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Records" value={stats.count} icon={Fingerprint} tone="brand" />
        <StatCard label="Avg. Working Hours" value={formatHours(stats.avgHours)} icon={Clock3} tone="navy" />
        <StatCard label="Late" value={stats.late} tone="warning" />
        <StatCard label="Outside Geo-fence" value={stats.outside} icon={MapPinOff} tone="danger" />
      </div>

      <div className="mb-6">
        <ChartCard title="Geo-fence Result" subtitle="Inside vs outside allowed radius">
          <DonutChart data={geoBreakdown} height={180} />
        </ChartCard>
      </div>

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={(v) => { setSearchInput(v); setPage(1); }}
          searchPlaceholder="Search by employee/leader name..."
          onReset={() => { setStatus('all'); setSearchInput(''); setPage(1); }}
          hasActiveFilters={hasActiveFilters}
        >
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as AttendanceStatus | 'all'); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-44" />
        </FilterBar>

        <DataTable columns={columns} rows={paged} rowKey={(r) => r.id} isLoading={isLoading} error={error} emptyTitle="No attendance records found" />

        {filtered.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
