import { useMemo, useState } from 'react';
import { Download, UsersRound, Layers } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { FilterBar } from '../../components/tables/FilterBar';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { ChartCard } from '../../components/charts/ChartCard';
import { SimpleBarChart } from '../../components/charts/SimpleBarChart';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { getTeamReport, exportToCsv } from '../../services/reportService';

type Row = Awaited<ReturnType<typeof getTeamReport>>[number];

const PAGE_SIZE = 10;

export function TeamReport() {
  const { data, isLoading, error } = useAsync(() => getTeamReport(), []);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.leader.toLowerCase().includes(q));
  }, [data, search]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => ({
    teams: filtered.length,
    totalMembers: filtered.reduce((s, r) => s + r.members, 0),
  }), [filtered]);

  const chartData = useMemo(() => filtered.slice(0, 8).map((r) => ({ name: r.name, value: r.members })), [filtered]);

  const columns: DataTableColumn<Row>[] = [
    { key: 'name', header: 'Team', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'leader', header: 'Leader', render: (r) => r.leader },
    { key: 'members', header: 'Member Count', align: 'right', render: (r) => r.members },
  ];

  return (
    <div>
      <PageHeader
        title="Team Report"
        description="Team structure, leaders and member counts across the network."
        actions={
          <Button variant="outline" leftIcon={<Download size={15} />} onClick={() => exportToCsv('team-report.csv', filtered)} disabled={!filtered.length}>
            Export
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-2">
        <StatCard label="Teams" value={stats.teams} icon={UsersRound} tone="brand" />
        <StatCard label="Total Members" value={stats.totalMembers} icon={Layers} tone="shell" />
      </div>

      <div className="mb-6">
        <ChartCard title="Members per Team" subtitle="Top teams by member count">
          <SimpleBarChart data={chartData} horizontal height={260} />
        </ChartCard>
      </div>

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={(v) => { setSearchInput(v); setPage(1); }}
          searchPlaceholder="Search by team or leader..."
        />

        <DataTable columns={columns} rows={paged} rowKey={(r) => r.id} isLoading={isLoading} error={error} emptyTitle="No teams found" />

        {filtered.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
