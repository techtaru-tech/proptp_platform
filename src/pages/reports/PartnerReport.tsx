import { useMemo, useState } from 'react';
import { Download, Users, UserCheck, UserX } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { Badge } from '../../components/ui/Badge';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { FilterBar } from '../../components/tables/FilterBar';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { ChartCard } from '../../components/charts/ChartCard';
import { DonutChart } from '../../components/charts/DonutChart';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { getPartnerReport, exportToCsv } from '../../services/reportService';
import type { AccountStatus } from '../../types';

type Row = Awaited<ReturnType<typeof getPartnerReport>>[number];

const ROLE_OPTIONS = [
  { value: 'all', label: 'All Roles' },
  { value: 'Agent', label: 'Agent' },
  { value: 'Employee', label: 'Employee' },
  { value: 'Leader', label: 'Leader' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

const PAGE_SIZE = 10;

export function PartnerReport() {
  const { data, isLoading, error } = useAsync(() => getPartnerReport(), []);
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState<AccountStatus | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (role !== 'all' && r.role !== role) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, role, status, search]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => ({
    total: filtered.length,
    active: filtered.filter((r) => r.status === 'active').length,
    inactive: filtered.filter((r) => r.status !== 'active').length,
  }), [filtered]);

  const roleBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((r) => counts.set(r.role, (counts.get(r.role) ?? 0) + 1));
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const columns: DataTableColumn<Row>[] = [
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'role', header: 'Role', render: (r) => <Badge tone="navy">{r.role}</Badge> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="account" status={r.status} /> },
    { key: 'team', header: 'Team / Referral Mapping', render: (r) => r.team ?? '—' },
  ];

  const hasActiveFilters = role !== 'all' || status !== 'all' || !!searchInput;

  return (
    <div>
      <PageHeader
        title="Partner Report"
        description="Agents, Employees and Leaders with status and team/referral mapping."
        actions={
          <Button variant="outline" leftIcon={<Download size={15} />} onClick={() => exportToCsv('partner-report.csv', filtered)} disabled={!filtered.length}>
            Export
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total Partners" value={stats.total} icon={Users} tone="brand" />
        <StatCard label="Active" value={stats.active} icon={UserCheck} tone="success" />
        <StatCard label="Inactive / Suspended" value={stats.inactive} icon={UserX} tone="neutral" />
      </div>

      <div className="mb-6">
        <ChartCard title="Role Distribution" subtitle="Breakdown of partners in the current filter">
          <DonutChart data={roleBreakdown} />
        </ChartCard>
      </div>

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={(v) => { setSearchInput(v); setPage(1); }}
          searchPlaceholder="Search by name..."
          onReset={() => { setRole('all'); setStatus('all'); setSearchInput(''); setPage(1); }}
          hasActiveFilters={hasActiveFilters}
        >
          <Select aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} options={ROLE_OPTIONS} wrapperClassName="w-36" />
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as AccountStatus | 'all'); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-40" />
        </FilterBar>

        <DataTable columns={columns} rows={paged} rowKey={(r) => r.id} isLoading={isLoading} error={error} emptyTitle="No partners found" />

        {filtered.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
