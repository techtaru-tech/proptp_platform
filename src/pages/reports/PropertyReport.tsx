import { useMemo, useState } from 'react';
import { Download, Building2, LayoutGrid, CircleCheckBig, Layers } from 'lucide-react';
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
import { getPropertyReport, exportToCsv } from '../../services/reportService';

type PropertyRow = Awaited<ReturnType<typeof getPropertyReport>>[number];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'Active', label: 'Active' },
  { value: 'Deactive', label: 'Deactive' },
];

const PAGE_SIZE = 10;

export function PropertyReport() {
  const { data, isLoading, error } = useAsync(() => getPropertyReport(), []);
  const [status, setStatus] = useState<string | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.location.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, status, search]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => {
    const totalUnits = filtered.reduce((s, r) => s + r.totalUnits, 0);
    const available = filtered.reduce((s, r) => s + r.available, 0);
    const sold = filtered.reduce((s, r) => s + r.sold, 0);
    return { count: filtered.length, totalUnits, available, sold };
  }, [filtered]);

  const statusBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((r) => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));
    return Array.from(counts.entries()).map(([name, value]) => ({ name: STATUS_OPTIONS.find((o) => o.value === name)?.label ?? name, value }));
  }, [filtered]);

  const columns: DataTableColumn<PropertyRow>[] = [
    { key: 'name', header: 'Project', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'location', header: 'Location', render: (r) => r.location },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="project" status={r.status} /> },
    { key: 'totalUnits', header: 'Total Units', align: 'right', render: (r) => r.totalUnits },
    { key: 'available', header: 'Available', align: 'right', render: (r) => r.available },
    { key: 'booked', header: 'Booked', align: 'right', render: (r) => r.booked },
    { key: 'sold', header: 'Sold', align: 'right', render: (r) => r.sold },
    { key: 'bookingsCount', header: 'Bookings', align: 'right', render: (r) => r.bookingsCount },
  ];

  const hasActiveFilters = status !== 'all' || !!searchInput;
  const resetFilters = () => {
    setStatus('all');
    setSearchInput('');
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Property Report"
        description="Inventory, availability and booking activity across every project."
        actions={
          <Button variant="outline" leftIcon={<Download size={15} />} onClick={() => exportToCsv('property-report.csv', filtered)} disabled={!filtered.length}>
            Export
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Projects" value={stats.count} icon={Building2} tone="brand" />
        <StatCard label="Total Units" value={stats.totalUnits} icon={LayoutGrid} tone="navy" />
        <StatCard label="Available Units" value={stats.available} icon={Layers} tone="success" />
        <StatCard label="Sold Units" value={stats.sold} icon={CircleCheckBig} tone="accent" />
      </div>

      <div className="mb-6">
        <ChartCard title="Project Status Breakdown" subtitle="Distribution of projects in the current filter">
          <DonutChart data={statusBreakdown} />
        </ChartCard>
      </div>

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={(v) => {
            setSearchInput(v);
            setPage(1);
          }}
          searchPlaceholder="Search by project or city..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            wrapperClassName="w-44"
          />
        </FilterBar>

        <DataTable columns={columns} rows={paged} rowKey={(r) => r.id} isLoading={isLoading} error={error} emptyTitle="No properties found" />

        {filtered.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
