import { RecordRef } from '../../components/ui/RecordRef';
import { useMemo, useState } from 'react';
import { Download, Wallet, CheckCircle2, Repeat } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { Badge } from '../../components/ui/Badge';
import { FilterBar } from '../../components/tables/FilterBar';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { ChartCard } from '../../components/charts/ChartCard';
import { SimpleBarChart } from '../../components/charts/SimpleBarChart';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { getPaymentReport, exportToCsv } from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/format';

type Row = Awaited<ReturnType<typeof getPaymentReport>>[number];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'Initial Payment', label: 'Initial Payment' },
  { value: 'Installment', label: 'Installment' },
];

const PAGE_SIZE = 10;

export function PaymentReport() {
  const { data, isLoading, error } = useAsync(() => getPaymentReport(), []);
  const [status, setStatus] = useState<string | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (q && !r.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, status, search]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => {
    const totalAmount = filtered.reduce((s, r) => s + r.amount, 0);
    const initial = filtered.filter((r) => r.status === 'Initial Payment').length;
    const installment = filtered.filter((r) => r.status === 'Installment').length;
    return { totalAmount, initial, installment };
  }, [filtered]);

  const modeBreakdown = useMemo(() => {
    const sums = new Map<string, number>();
    filtered.forEach((r) => sums.set(r.paymentMode, (sums.get(r.paymentMode) ?? 0) + r.amount));
    return Array.from(sums.entries()).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const columns: DataTableColumn<Row>[] = [
    { key: 'id', header: 'Payment ID', render: (r) => <RecordRef row={r} /> },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'mode', header: 'Payment Mode', render: (r) => r.paymentMode },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => formatCurrency(r.amount) },
    { key: 'status', header: 'Type', render: (r) => <Badge tone={r.status === 'Installment' ? 'accent' : 'shell'}>{r.status}</Badge> },
  ];

  const hasActiveFilters = status !== 'all' || !!searchInput;

  return (
    <div>
      <PageHeader
        title="Payment Report"
        description="Collections summarized by payment mode, type and date."
        actions={
          <Button variant="outline" leftIcon={<Download size={15} />} onClick={() => exportToCsv('payment-report.csv', filtered)} disabled={!filtered.length}>
            Export
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total Amount" value={formatCurrency(stats.totalAmount)} icon={Wallet} tone="brand" />
        <StatCard label="Initial Payments" value={stats.initial} icon={CheckCircle2} tone="success" />
        <StatCard label="Installments" value={stats.installment} icon={Repeat} tone="info" />
      </div>

      <div className="mb-6">
        <ChartCard title="Amount by Payment Mode" subtitle="Sum of payment amounts per mode in the current filter">
          <SimpleBarChart data={modeBreakdown} valueFormatter={formatCurrency} />
        </ChartCard>
      </div>

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={(v) => { setSearchInput(v); setPage(1); }}
          searchPlaceholder="Search by payment ID..."
          onReset={() => { setStatus('all'); setSearchInput(''); setPage(1); }}
          hasActiveFilters={hasActiveFilters}
        >
          <Select aria-label="Type" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-44" />
        </FilterBar>

        <DataTable columns={columns} rows={paged} rowKey={(r) => r.id} isLoading={isLoading} error={error} emptyTitle="No payments found" />

        {filtered.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
