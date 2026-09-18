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
import { findUserById } from '../../data/referenceData';
import type { Employee, AccountStatus } from '../../types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
];

const PAGE_SIZE = 10;

export function EmployeeList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AccountStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);
  const params = { page, pageSize: PAGE_SIZE, search: debouncedSearch, status, sortBy: 'name', sortDir: 'asc' as const };

  const { data, isLoading, error } = useAsync(() => userService.listEmployees(params), [JSON.stringify(params)]);

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

  const columns: DataTableColumn<Employee>[] = [
    {
      key: 'name',
      header: 'Employee Name',
      render: (e) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={e.name} src={e.avatarUrl} size="sm" />
          <span className="font-medium text-ink">{e.name}</span>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (e) => e.phone },
    { key: 'email', header: 'Email', render: (e) => e.email },
    { key: 'leader', header: 'Leader', render: (e) => (e.leaderId ? findUserById(e.leaderId)?.name ?? '—' : '—') },
    { key: 'team', header: 'Team', render: (e) => e.teamId ?? '—' },
    { key: 'status', header: 'Status', render: (e) => <StatusBadge kind="account" status={e.status} /> },
    { key: 'attendance', header: 'Attendance Today', render: (e) => <StatusBadge kind="attendance" status={e.attendanceStatusToday} /> },
  ];

  return (
    <div>
      <PageHeader title="Employees" description="Browse and manage internal employee partners and their reporting leader." />

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={updateSearch}
          searchPlaceholder="Search by name, phone or designation..."
          hasActiveFilters={hasActiveFilters}
          onReset={resetFilters}
        >
          <Select value={status} onChange={(e) => updateStatus(e.target.value)} options={STATUS_OPTIONS} wrapperClassName="w-40" aria-label="Status filter" />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(e) => e.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(e) => navigate(`/users/${e.id}`)}
          emptyTitle="No employees found"
          emptyDescription="Try adjusting your search or status filter."
        />

        {data && !isLoading && !error && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        )}
      </Card>
    </div>
  );
}
