import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Download, Eye } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Drawer } from '../../components/ui/Drawer';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listPayments, unitLabelForPayment, projectNameForPayment } from '../../services/paymentService';
import { exportToCsv } from '../../services/reportService';
import { refProjects } from '../../data/referenceData';
import { formatCurrency, formatDate } from '../../utils/format';
import { PAYMENT_MODE_LABEL, type BookingRow, type PaymentMode } from '../../types';

interface FiltersState {
  page: number;
  pageSize: number;
  search: string;
  dateFrom: string;
  dateTo: string;
  projectId: string | 'all';
  paymentMode: PaymentMode | 'all';
  isDeposit: 0 | 1 | 'all';
}

const DEPOSIT_OPTIONS = [
  { value: 'all', label: 'All Payment Types' },
  { value: '0', label: 'Initial Payment' },
  { value: '1', label: 'Installment' },
];

const PAYMENT_MODE_OPTIONS = [
  { value: 'all', label: 'All Payment Modes' },
  ...Object.entries(PAYMENT_MODE_LABEL).map(([value, label]) => ({ value, label })),
];

const PROJECT_OPTIONS = [
  { value: 'all', label: 'All Projects' },
  ...refProjects.map((p) => ({ value: p.id, label: p.projectName })),
];

export function Transactions() {
  const [selectedPayment, setSelectedPayment] = useState<BookingRow | null>(null);

  const [filters, setFilters] = useState<FiltersState>({
    page: 1,
    pageSize: 10,
    search: '',
    dateFrom: '',
    dateTo: '',
    projectId: 'all',
    paymentMode: 'all',
    isDeposit: 'all',
  });

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, search: debouncedSearch, page: 1 }));
  }, [debouncedSearch]);

  const params = useMemo(
    () => ({
      page: filters.page,
      pageSize: filters.pageSize,
      search: filters.search,
      isDeposit: filters.isDeposit,
      paymentMode: filters.paymentMode,
      projectId: filters.projectId,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      sortBy: 'createdAt',
      sortDir: 'desc' as const,
    }),
    [filters]
  );

  const { data, isLoading, error } = useAsync(() => listPayments(params), [JSON.stringify(params)]);

  const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const hasActiveFilters =
    !!filters.search || !!filters.dateFrom || !!filters.dateTo || filters.projectId !== 'all' || filters.paymentMode !== 'all' || filters.isDeposit !== 'all';

  const resetFilters = () => {
    setSearchInput('');
    setFilters((prev) => ({ ...prev, page: 1, search: '', dateFrom: '', dateTo: '', projectId: 'all', paymentMode: 'all', isDeposit: 'all' }));
  };

  const handleExport = () => {
    const rows = data?.items ?? [];
    exportToCsv(
      `payments-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((b) => ({
        id: b.id,
        bookingName: b.bookingName,
        phone: b.phone,
        unit: unitLabelForPayment(b),
        project: projectNameForPayment(b),
        paymentMode: PAYMENT_MODE_LABEL[b.paymentMode],
        amount: b.amount,
        type: b.isDeposit === 1 ? 'Installment' : 'Initial Payment',
        date: b.createdAt,
      }))
    );
  };

  const columns: DataTableColumn<BookingRow>[] = [
    { key: 'id', header: 'Payment ID', render: (b) => <span className="font-medium text-ink">{b.id}</span> },
    { key: 'bookingName', header: 'Customer', render: (b) => b.bookingName },
    { key: 'unit', header: 'Unit', render: (b) => unitLabelForPayment(b) },
    { key: 'project', header: 'Project', render: (b) => projectNameForPayment(b) },
    { key: 'mode', header: 'Payment Mode', render: (b) => <StatusBadge kind="paymentMode" status={b.paymentMode} dot={false} /> },
    { key: 'amount', header: 'Amount', align: 'right', render: (b) => formatCurrency(b.amount) },
    { key: 'type', header: 'Type', render: (b) => <StatusBadge kind="depositType" status={b.isDeposit} dot={false} /> },
    { key: 'date', header: 'Date', render: (b) => formatDate(b.createdAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (b) => (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Eye size={13} />}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedPayment(b);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Track initial booking payments and installments across all units. Every payment mode is bank transfer, cash, cheque or other — matching the real system."
        actions={
          <Button variant="outline" leftIcon={<Download size={15} />} onClick={handleExport} disabled={!data?.items.length}>
            Export
          </Button>
        }
      />

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder="Search by booking ID, name or phone..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <DatePicker aria-label="From date" value={filters.dateFrom} onChange={(e) => updateFilter('dateFrom', e.target.value)} wrapperClassName="w-40" />
          <DatePicker aria-label="To date" value={filters.dateTo} onChange={(e) => updateFilter('dateTo', e.target.value)} wrapperClassName="w-40" />
          <Select
            aria-label="Project"
            value={filters.projectId}
            onChange={(e) => updateFilter('projectId', e.target.value)}
            options={PROJECT_OPTIONS}
            wrapperClassName="w-44"
          />
          <Select
            aria-label="Payment mode"
            value={String(filters.paymentMode)}
            onChange={(e) => updateFilter('paymentMode', e.target.value === 'all' ? 'all' : (Number(e.target.value) as PaymentMode))}
            options={PAYMENT_MODE_OPTIONS}
            wrapperClassName="w-44"
          />
          <Select
            aria-label="Payment type"
            value={String(filters.isDeposit)}
            onChange={(e) => updateFilter('isDeposit', e.target.value === 'all' ? 'all' : (Number(e.target.value) as 0 | 1))}
            options={DEPOSIT_OPTIONS}
            wrapperClassName="w-44"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(b) => b.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(b) => setSelectedPayment(b)}
          emptyTitle="No payments found"
          emptyDescription="Try adjusting your filters or search terms."
        />

        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))} />
        )}
      </Card>

      <Drawer isOpen={selectedPayment !== null} onClose={() => setSelectedPayment(null)} title={selectedPayment ? `Payment ${selectedPayment.id}` : undefined}>
        {selectedPayment && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <StatusBadge kind="depositType" status={selectedPayment.isDeposit} />
              <StatusBadge kind="paymentMode" status={selectedPayment.paymentMode} dot={false} />
            </div>

            <dl className="space-y-2.5 text-sm">
              <DetailRow label="Amount" value={formatCurrency(selectedPayment.amount)} />
              <DetailRow label="Customer" value={selectedPayment.bookingName} />
              <DetailRow label="Phone" value={selectedPayment.phone} />
              <DetailRow label="Date" value={formatDate(selectedPayment.createdAt)} />
              <DetailRow
                label="Booking"
                value={
                  <Link to={`/bookings/${selectedPayment.id}`} className="font-medium text-brand-600 hover:text-brand-700 focus-ring rounded">
                    {selectedPayment.id}
                  </Link>
                }
              />
              {selectedPayment.userId && (
                <DetailRow
                  label="Partner"
                  value={
                    <Link to={`/users/${selectedPayment.userId}`} className="font-medium text-brand-600 hover:text-brand-700 focus-ring rounded">
                      {selectedPayment.partnerName}
                    </Link>
                  }
                />
              )}
              <DetailRow label="Unit" value={unitLabelForPayment(selectedPayment)} />
              <DetailRow
                label="Project"
                value={
                  selectedPayment.projectId ? (
                    <Link
                      to={`/projects/${selectedPayment.projectId}`}
                      className="font-medium text-brand-600 hover:text-brand-700 focus-ring rounded"
                    >
                      {selectedPayment.projectName}
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
            </dl>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line pb-2.5 last:border-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
