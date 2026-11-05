import { RecordRef } from '../../components/ui/RecordRef';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listTickets, type TicketListParams } from '../../services/supportService';
import { formatDate, formatRelativeTime } from '../../utils/format';
import type { SupportTicket, TicketStatus } from '../../types';

const STATUS_OPTIONS: { value: TicketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export function TicketList() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TicketStatus | 'all'>('all');
  const debouncedSearch = useDebounce(search, 300);

  const params: TicketListParams = { page, pageSize: 10, search: debouncedSearch, status, sortBy: 'updatedAt', sortDir: 'desc' };
  const { data, isLoading, error } = useAsync(() => listTickets(params), [JSON.stringify(params)]);

  const hasActiveFilters = search !== '' || status !== 'all';
  const resetFilters = () => {
    setSearch('');
    setStatus('all');
    setPage(1);
  };

  const columns: DataTableColumn<SupportTicket>[] = [
    { key: 'id', header: 'Ticket ID', render: (t) => <RecordRef row={t} /> },
    { key: 'user', header: 'User', render: (t) => t.userName },
    { key: 'subject', header: 'Subject', render: (t) => <span className="line-clamp-1 max-w-xs">{t.subject}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusBadge kind="ticket" status={t.status} /> },
    { key: 'created', header: 'Created', render: (t) => formatDate(t.createdAt) },
    { key: 'updated', header: 'Updated', render: (t) => formatDate(t.updatedAt) },
    { key: 'lastReply', header: 'Last Reply', render: (t) => (t.lastReplyAt ? formatRelativeTime(t.lastReplyAt) : '—') },
  ];

  return (
    <div>
      <PageHeader title="Support Tickets" description="Manage partner and employee support requests." />

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search by subject, user or ticket ID..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <Select value={status} onChange={(e) => { setStatus(e.target.value as TicketStatus | 'all'); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-40" />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(t) => t.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(t) => navigate(`/support/${t.id}`)}
        />

        {data && data.total > 0 && <Pagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
