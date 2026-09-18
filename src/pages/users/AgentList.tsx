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
import { formatDate } from '../../utils/format';
import type { Agent, AccountStatus } from '../../types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

const PAGE_SIZE = 10;

export function AgentList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AccountStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);
  const params = { page, pageSize: PAGE_SIZE, search: debouncedSearch, status, sortBy: 'name', sortDir: 'asc' as const };

  const { data, isLoading, error } = useAsync(() => userService.listAgents(params), [JSON.stringify(params)]);

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

  const columns: DataTableColumn<Agent>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (a) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={a.name} src={a.avatarUrl} size="sm" />
          <span className="font-medium text-ink">{a.name}</span>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (a) => a.phone },
    { key: 'email', header: 'Email', render: (a) => a.email },
    { key: 'referralCode', header: 'Referral Code', render: (a) => <span className="font-mono text-xs">{a.referralCode}</span> },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge kind="account" status={a.status} /> },
    { key: 'team', header: 'Team', render: (a) => a.teamId ?? '—' },
    { key: 'createdAt', header: 'Created Date', render: (a) => formatDate(a.createdAt) },
  ];

  return (
    <div>
      <PageHeader title="Agents" description="Browse and manage agent partners across the referral network." />

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={updateSearch}
          searchPlaceholder="Search by name, phone or referral code..."
          hasActiveFilters={hasActiveFilters}
          onReset={resetFilters}
        >
          <Select value={status} onChange={(e) => updateStatus(e.target.value)} options={STATUS_OPTIONS} wrapperClassName="w-40" aria-label="Status filter" />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(a) => a.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(a) => navigate(`/users/${a.id}`)}
          emptyTitle="No agents found"
          emptyDescription="Try adjusting your search or status filter."
        />

        {data && !isLoading && !error && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        )}
      </Card>
    </div>
  );
}
