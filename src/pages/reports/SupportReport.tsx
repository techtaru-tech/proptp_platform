import { useMemo, useState } from 'react';
import { Download, LifeBuoy, MessageSquare } from 'lucide-react';
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
import { getSupportReport, exportToCsv } from '../../services/reportService';
import { formatDate } from '../../utils/format';
import type { TicketStatus } from '../../types';

type Row = Awaited<ReturnType<typeof getSupportReport>>[number];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const PAGE_SIZE = 10;

export function SupportReport() {
  const { data, isLoading, error } = useAsync(() => getSupportReport(), []);
  const [status, setStatus] = useState<TicketStatus | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (q && !r.subject.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, status, search]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => {
    const resolved = filtered.filter((r) => r.status === 'resolved' || r.status === 'closed').length;
    const avgMessages = filtered.length ? filtered.reduce((s, r) => s + r.messageCount, 0) / filtered.length : 0;
    return { total: filtered.length, resolved, avgMessages };
  }, [filtered]);

  const statusBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((r) => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));
    return Array.from(counts.entries()).map(([name, value]) => ({ name: STATUS_OPTIONS.find((o) => o.value === name)?.label ?? name, value }));
  }, [filtered]);

  const columns: DataTableColumn<Row>[] = [
    { key: 'id', header: 'Ticket ID', render: (r) => <span className="font-medium text-ink">{r.id}</span> },
    { key: 'subject', header: 'Subject', render: (r) => <span className="line-clamp-1 max-w-xs">{r.subject}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="ticket" status={r.status} /> },
    { key: 'createdAt', header: 'Created', render: (r) => formatDate(r.createdAt) },
    { key: 'messageCount', header: 'Messages', align: 'right', render: (r) => r.messageCount },
  ];

  const hasActiveFilters = status !== 'all' || !!searchInput;

  return (
    <div>
      <PageHeader
        title="Support Report"
        description="Ticket volumes, status distribution and response activity."
        actions={
          <Button variant="outline" leftIcon={<Download size={15} />} onClick={() => exportToCsv('support-report.csv', filtered)} disabled={!filtered.length}>
            Export
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total Tickets" value={stats.total} icon={LifeBuoy} tone="brand" />
        <StatCard label="Resolved / Closed" value={stats.resolved} tone="success" />
        <StatCard label="Avg. Messages / Ticket" value={stats.avgMessages.toFixed(1)} icon={MessageSquare} tone="shell" />
      </div>

      <div className="mb-6">
        <ChartCard title="Status Breakdown" subtitle="Distribution of tickets in the current filter">
          <DonutChart data={statusBreakdown} />
        </ChartCard>
      </div>

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={(v) => { setSearchInput(v); setPage(1); }}
          searchPlaceholder="Search by subject..."
          onReset={() => { setStatus('all'); setSearchInput(''); setPage(1); }}
          hasActiveFilters={hasActiveFilters}
        >
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as TicketStatus | 'all'); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-40" />
        </FilterBar>

        <DataTable columns={columns} rows={paged} rowKey={(r) => r.id} isLoading={isLoading} error={error} emptyTitle="No tickets found" />

        {filtered.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
