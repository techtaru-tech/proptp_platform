import { useMemo, useState } from 'react';
import { Download, ClipboardList, IndianRupee, CheckCircle2, Clock3 } from 'lucide-react';
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
import { getBookingReport, exportToCsv } from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/format';

type Row = Awaited<ReturnType<typeof getBookingReport>>[number];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Confirmed', label: 'Confirmed' },
];

const PAGE_SIZE = 10;

export function BookingReport() {
  const { data, isLoading, error } = useAsync(() => getBookingReport(), []);
  const [status, setStatus] = useState<string | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (q && !r.project.toLowerCase().includes(q) && !r.partner.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, status, search]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => {
    const totalAmount = filtered.reduce((s, r) => s + r.amount, 0);
    const booked = filtered.filter((r) => r.status === 'Confirmed').length;
    const pending = filtered.filter((r) => r.status === 'Pending').length;
    return { count: filtered.length, totalAmount, booked, pending };
  }, [filtered]);

  const statusBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((r) => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));
    return Array.from(counts.entries()).map(([name, value]) => ({ name: STATUS_OPTIONS.find((o) => o.value === name)?.label ?? name, value }));
  }, [filtered]);

  const columns: DataTableColumn<Row>[] = [
    { key: 'id', header: 'Booking ID', render: (r) => <span className="font-medium text-ink">{r.id}</span> },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'project', header: 'Project', render: (r) => r.project },
    { key: 'partner', header: 'Partner', render: (r) => r.partner },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="booking" status={r.status} /> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => formatCurrency(r.amount) },
  ];

  const hasActiveFilters = status !== 'all' || !!searchInput;

  return (
    <div>
      <PageHeader
        title="Booking Report"
        description="Booking activity by date, property, partner and status."
        actions={
          <Button variant="outline" leftIcon={<Download size={15} />} onClick={() => exportToCsv('booking-report.csv', filtered)} disabled={!filtered.length}>
            Export
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Bookings" value={stats.count} icon={ClipboardList} tone="brand" />
        <StatCard label="Total Amount" value={formatCurrency(stats.totalAmount)} icon={IndianRupee} tone="navy" />
        <StatCard label="Booked" value={stats.booked} icon={CheckCircle2} tone="success" />
        <StatCard label="Pending" value={stats.pending} icon={Clock3} tone="warning" />
      </div>

      <div className="mb-6">
        <ChartCard title="Status Breakdown" subtitle="Distribution of bookings in the current filter">
          <DonutChart data={statusBreakdown} />
        </ChartCard>
      </div>

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={(v) => { setSearchInput(v); setPage(1); }}
          searchPlaceholder="Search by project, partner or booking ID..."
          onReset={() => { setStatus('all'); setSearchInput(''); setPage(1); }}
          hasActiveFilters={hasActiveFilters}
        >
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-48" />
        </FilterBar>

        <DataTable columns={columns} rows={paged} rowKey={(r) => r.id} isLoading={isLoading} error={error} emptyTitle="No bookings found" />

        {filtered.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
