import { useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { DatePicker } from '../../components/ui/DatePicker';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listCommissionStatements } from '../../services/payoutService';
import { exportToCsv } from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/format';
import type { CommissionStatementEntry } from '../../types';

export function CommissionStatements() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const params = { page, pageSize: 10, search: debouncedSearch, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
  const { data, isLoading, error } = useAsync(() => listCommissionStatements(params), [JSON.stringify(params)]);

  const hasActiveFilters = search !== '' || !!dateFrom || !!dateTo;
  const resetFilters = () => {
    setSearch('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const handleExport = () => {
    exportToCsv(
      'commission-statements.csv',
      (data?.items ?? []).map((c) => ({
        user: c.userName,
        referral: c.referralUserName ?? '',
        commission: c.commission,
        bonus: c.bonus,
        date: c.date,
        status: c.status,
      }))
    );
  };

  const columns: DataTableColumn<CommissionStatementEntry>[] = [
    { key: 'user', header: 'User', render: (c) => <span className="font-medium text-ink">{c.userName}</span> },
    { key: 'referral', header: 'Referral', render: (c) => c.referralUserName ?? '—' },
    { key: 'commission', header: 'Commission', align: 'right', render: (c) => formatCurrency(c.commission) },
    { key: 'bonus', header: 'Bonus', align: 'right', render: (c) => formatCurrency(c.bonus) },
    { key: 'date', header: 'Date', render: (c) => formatDate(c.date) },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge kind="payout" status={c.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Commission Statements"
        description="Date-range commission and bonus statements across all partners."
        breadcrumb={[{ label: 'Payouts', to: '/payouts' }, { label: 'Commission Statements' }]}
        actions={
          <Button variant="outline" leftIcon={<Download size={14} />} onClick={handleExport}>
            Export
          </Button>
        }
      />

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search by user or referral..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <DatePicker value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="From date" />
          <DatePicker value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="To date" />
        </FilterBar>

        <DataTable columns={columns} rows={data?.items ?? []} rowKey={(c) => c.id} isLoading={isLoading} error={error} />

        {data && data.total > 0 && <Pagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
