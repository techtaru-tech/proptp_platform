import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import * as userService from '../../services/userService';
import type { Leader, AccountStatus } from '../../types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

const PAGE_SIZE = 10;

export function LeaderList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AccountStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);
  const params = { page, pageSize: PAGE_SIZE, search: debouncedSearch, status, sortBy: 'name', sortDir: 'asc' as const };

  const { data, isLoading, error } = useAsync(() => userService.listLeaders(params), [JSON.stringify(params)]);

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const updateStatus = (value: string) => {
    setStatus(value as AccountStatus | 'all');
    setPage(1);
  };

  const hasActiveFilters = search !== '' || status !== 'all';
  const resetFilters = () => {
    setSearch('');
    setStatus('all');
    setPage(1);
  };

  const columns: DataTableColumn<Leader>[] = [
    {
      key: 'name',
      header: 'Leader Name',
      render: (l) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={l.name} src={l.avatarUrl} size="sm" />
          <span className="font-medium text-ink">{l.name}</span>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (l) => l.phone },
    { key: 'email', header: 'Email', render: (l) => l.email },
    { key: 'teamSize', header: 'Team Size', align: 'right', render: (l) => l.teamSize },
    { key: 'employeeCount', header: 'Employees', align: 'right', render: (l) => l.employeeCount },
    { key: 'agentCount', header: 'Channel partners', align: 'right', render: (l) => l.agentCount },
    { key: 'status', header: 'Status', render: (l) => <StatusBadge kind="account" status={l.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Leaders" description="Browse and manage team leaders and their downline network." />

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={updateSearch}
          searchPlaceholder="Search by name or phone..."
          hasActiveFilters={hasActiveFilters}
          onReset={resetFilters}
        >
          <Select value={status} onChange={(e) => updateStatus(e.target.value)} options={STATUS_OPTIONS} wrapperClassName="w-40" aria-label="Status filter" />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(l) => l.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(l) => navigate(`/users/${l.id}`)}
          emptyTitle="No leaders found"
          emptyDescription="Try adjusting your search or status filter."
        />

        {data && !isLoading && !error && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        )}
      </Card>
    </div>
  );
}
