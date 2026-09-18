import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Eye } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listBookings, projectNameForBooking } from '../../services/bookingService';
import { exportToCsv } from '../../services/reportService';
import { refAgents, refEmployees, refLeaders, refProjects } from '../../data/referenceData';
import { formatCurrency, formatDate } from '../../utils/format';
import { PAYMENT_MODE_LABEL, type BookingRow, type BookingStatus, type PaymentMode } from '../../types';

interface BookingListProps {
  statusFilter?: 'pending' | 'confirmed';
}

interface FiltersState {
  page: number;
  pageSize: number;
  search: string;
  status: BookingStatus | 'all';
  projectId: string | 'all';
  partnerId: string | 'all';
  paymentMode: PaymentMode | 'all';
  dateFrom: string;
  dateTo: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: '0', label: 'Pending' },
  { value: '1', label: 'Confirmed' },
];

const PAYMENT_MODE_OPTIONS = [
  { value: 'all', label: 'All Payment Modes' },
  ...Object.entries(PAYMENT_MODE_LABEL).map(([value, label]) => ({ value, label })),
];

const PROJECT_OPTIONS = [
  { value: 'all', label: 'All Projects' },
  ...refProjects.map((p) => ({ value: p.id, label: p.projectName })),
];

const PARTNER_OPTIONS = [
  { value: 'all', label: 'All Partners' },
  ...[...refAgents, ...refEmployees, ...refLeaders]
    .map((u) => ({ value: u.id, label: u.name }))
    .sort((a, b) => a.label.localeCompare(b.label)),
];

const TITLE_BY_FILTER: Record<'pending' | 'confirmed', { title: string; description: string }> = {
  pending: { title: 'Pending Bookings', description: 'Bookings currently awaiting confirmation.' },
  confirmed: { title: 'Confirmed Bookings', description: 'Bookings that have been confirmed and finalized.' },
};

function statusFilterToValue(filter?: 'pending' | 'confirmed'): BookingStatus | 'all' {
  if (filter === 'pending') return 0;
  if (filter === 'confirmed') return 1;
  return 'all';
}

export function BookingList({ statusFilter }: BookingListProps) {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FiltersState>(() => ({
    page: 1,
    pageSize: 10,
    search: '',
    status: statusFilterToValue(statusFilter),
    projectId: 'all',
    partnerId: 'all',
    paymentMode: 'all',
    dateFrom: '',
    dateTo: '',
    sortBy: 'createdAt',
    sortDir: 'desc',
  }));

  // Lock the status filter whenever the route-driven prop changes (e.g. navigating between
  // /bookings/pending and /bookings/booked without a full remount).
  useEffect(() => {
    setFilters((prev) => ({ ...prev, status: statusFilterToValue(statusFilter), page: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

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
      status: filters.status,
      projectId: filters.projectId,
      partnerId: filters.partnerId,
      paymentMode: filters.paymentMode,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
    }),
    [filters]
  );

  const { data, isLoading, error } = useAsync(() => listBookings(params), [JSON.stringify(params)]);

  const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handleSortChange = (key: string) => {
    setFilters((prev) => ({
      ...prev,
      sortBy: key,
      sortDir: prev.sortBy === key && prev.sortDir === 'asc' ? 'desc' : 'asc',
    }));
  };

  const hasActiveFilters =
    !!filters.search ||
    filters.projectId !== 'all' ||
    filters.partnerId !== 'all' ||
    filters.paymentMode !== 'all' ||
    !!filters.dateFrom ||
    !!filters.dateTo ||
    (!statusFilter && filters.status !== 'all');

  const resetFilters = () => {
    setSearchInput('');
    setFilters((prev) => ({
      ...prev,
      page: 1,
      search: '',
      status: statusFilterToValue(statusFilter),
      projectId: 'all',
      partnerId: 'all',
      paymentMode: 'all',
      dateFrom: '',
      dateTo: '',
    }));
  };

  const handleExport = () => {
    const rows = data?.items ?? [];
    exportToCsv(
      `bookings-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((b) => ({
        id: b.id,
        customer: b.bookingName,
        phone: b.phone,
        project: projectNameForBooking(b),
        unitId: b.propertyId,
        partner: b.partnerName,
        amount: b.amount,
        paymentMode: PAYMENT_MODE_LABEL[b.paymentMode],
        createdAt: b.createdAt,
        status: b.status === 1 ? 'Confirmed' : 'Pending',
      }))
    );
  };

  const columns: DataTableColumn<BookingRow>[] = [
    { key: 'id', header: 'Booking ID', render: (b) => <span className="font-medium text-ink">{b.id}</span> },
    { key: 'bookingName', header: 'Customer', render: (b) => b.bookingName },
    { key: 'phone', header: 'Phone', render: (b) => b.phone },
    { key: 'project', header: 'Project', render: (b) => projectNameForBooking(b) },
    { key: 'unit', header: 'Property / Unit', render: (b) => b.plotNumber || b.propertyId },
    { key: 'partner', header: 'Partner', render: (b) => b.partnerName },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (b) => formatCurrency(b.amount) },
    { key: 'mode', header: 'Payment Mode', render: (b) => <StatusBadge kind="paymentMode" status={b.paymentMode} dot={false} /> },
    { key: 'createdAt', header: 'Booking Date', sortable: true, render: (b) => formatDate(b.createdAt) },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge kind="booking" status={b.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (b) => (
        <Button variant="ghost" size="sm" leftIcon={<Eye size={13} />} onClick={() => navigate(`/bookings/${b.id}`)}>
          View
        </Button>
      ),
    },
  ];

  const headerCopy = statusFilter ? TITLE_BY_FILTER[statusFilter] : { title: 'Bookings', description: 'Manage all customer bookings across projects and partners.' };

  return (
    <div>
      <PageHeader
        title={headerCopy.title}
        description={headerCopy.description}
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
          searchPlaceholder="Search by customer, phone or booking ID..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <DatePicker
            aria-label="From date"
            value={filters.dateFrom}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
            wrapperClassName="w-40"
          />
          <DatePicker
            aria-label="To date"
            value={filters.dateTo}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
            wrapperClassName="w-40"
          />
          <Select
            aria-label="Project"
            value={filters.projectId}
            onChange={(e) => updateFilter('projectId', e.target.value)}
            options={PROJECT_OPTIONS}
            wrapperClassName="w-44"
          />
          <Select
            aria-label="Partner"
            value={filters.partnerId}
            onChange={(e) => updateFilter('partnerId', e.target.value)}
            options={PARTNER_OPTIONS}
            wrapperClassName="w-44"
          />
          {!statusFilter && (
            <Select
              aria-label="Status"
              value={String(filters.status)}
              onChange={(e) => updateFilter('status', e.target.value === 'all' ? 'all' : (Number(e.target.value) as BookingStatus))}
              options={STATUS_OPTIONS}
              wrapperClassName="w-44"
            />
          )}
          <Select
            aria-label="Payment mode"
            value={String(filters.paymentMode)}
            onChange={(e) => updateFilter('paymentMode', e.target.value === 'all' ? 'all' : (Number(e.target.value) as PaymentMode))}
            options={PAYMENT_MODE_OPTIONS}
            wrapperClassName="w-44"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(b) => b.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(b) => navigate(`/bookings/${b.id}`)}
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
          onSortChange={handleSortChange}
          emptyTitle="No bookings found"
          emptyDescription="Try adjusting your filters or search terms."
        />

        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))} />
        )}
      </Card>
    </div>
  );
}
