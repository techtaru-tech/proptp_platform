import { RecordRef } from '../../components/ui/RecordRef';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Eye, PauseCircle, PlayCircle, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import {
  listInvestments,
  setInvestmentActive,
  triggerProfitReturn,
  triggerProfitReturnForProperty,
  projectNameForInvestment,
  unitLabelForInvestment,
  investmentBucket,
  type InvestmentListParams,
} from '../../services/investmentService';
import { refProjects } from '../../data/referenceData';
import { exportToCsv } from '../../services/reportService';
import { formatCurrency, formatDate } from '../../utils/format';
import type { InvestmentBucket, InvestmentRow } from '../../types';

export type InvestmentListFilter = InvestmentBucket | 'all';

interface InvestmentListProps {
  filter?: InvestmentListFilter;
}

interface FiltersState {
  page: number;
  pageSize: number;
  search: string;
  projectId: string | 'all';
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

const PROJECT_OPTIONS = [
  { value: 'all', label: 'All Projects' },
  ...refProjects.map((p) => ({ value: p.id, label: p.projectName })),
];

const TITLE_BY_FILTER: Record<InvestmentListFilter, { title: string; description: string }> = {
  all: { title: 'All Deposits', description: 'Every investment placed against a property, across all projects.' },
  running: { title: 'Running Deposits', description: 'Active investments on booked & verified properties.' },
  due: { title: 'Due Deposits', description: 'Active investments whose profit/return is due today or earlier.' },
  expired: { title: 'Expired Deposits', description: 'Investments that have been deactivated.' },
  completed: { title: 'Completed Deposits', description: 'Investments on properties that are fully sold out.' },
};

export function InvestmentList({ filter = 'all' }: InvestmentListProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const headerCopy = TITLE_BY_FILTER[filter];

  const [filters, setFilters] = useState<FiltersState>({
    page: 1,
    pageSize: 10,
    search: '',
    projectId: 'all',
    sortBy: 'updatedAt',
    sortDir: 'desc',
  });

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, search: debouncedSearch, page: 1 }));
  }, [debouncedSearch]);

  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<InvestmentRow | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [confirmAction, setConfirmAction] = useState<'activate' | 'return' | null>(null);

  const params: InvestmentListParams = useMemo(
    () => ({
      page: filters.page,
      pageSize: filters.pageSize,
      search: filters.search,
      bucket: filter,
      projectId: filters.projectId,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
    }),
    [filters, filter]
  );

  const { data, isLoading, error } = useAsync(() => listInvestments(params), [JSON.stringify(params), reloadKey]);

  const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const hasActiveFilters = !!filters.search || filters.projectId !== 'all';

  const resetFilters = () => {
    setSearchInput('');
    setFilters((prev) => ({ ...prev, page: 1, search: '', projectId: 'all' }));
  };

  const handleExport = () => {
    const rows = data?.items ?? [];
    exportToCsv(
      `investments-${filter}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((inv) => ({
        id: inv.id,
        investor: inv.userName,
        project: projectNameForInvestment(inv),
        unit: unitLabelForInvestment(inv),
        amount: inv.amount,
        profit: inv.profit,
        netProfit: inv.netProfit,
        bucket: investmentBucket(inv),
        active: inv.isActive === 1 ? 'Active' : 'Deactivated',
        returnDate: inv.returnDate ?? '',
        lastReturnDate: inv.lastReturnDate ?? '',
      }))
    );
  };

  const handleConfirm = async () => {
    if (!selected || !confirmAction) return;
    try {
      if (confirmAction === 'activate') {
        await setInvestmentActive(selected.id, 1);
        toast({ title: 'Investment activated', description: `${selected.id} is now active.`, variant: 'success' });
      } else {
        await triggerProfitReturn(selected.id);
        toast({ title: 'Profit return triggered', description: `Return disbursed for ${selected.id}.`, variant: 'success' });
      }
      setReloadKey((k) => k + 1);
    } finally {
      setConfirmAction(null);
    }
  };

  const handleDeactivate = async () => {
    if (!selected || !deactivateReason.trim()) return;
    await setInvestmentActive(selected.id, 0, deactivateReason.trim());
    toast({ title: 'Investment deactivated', description: `${selected.id} has been deactivated.`, variant: 'success' });
    setDeactivateOpen(false);
    setDeactivateReason('');
    setReloadKey((k) => k + 1);
  };

  const handleBulkReturn = async (propertyId: string) => {
    const count = await triggerProfitReturnForProperty(propertyId);
    toast({ title: 'Bulk profit return triggered', description: `Return disbursed to ${count} investor(s).`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<InvestmentRow>[] = [
    { key: 'id', header: 'Investment ID', render: (inv) => <RecordRef row={inv} /> },
    { key: 'investor', header: 'Investor', render: (inv) => inv.userName },
    { key: 'project', header: 'Project', render: (inv) => projectNameForInvestment(inv) },
    { key: 'unit', header: 'Property', render: (inv) => unitLabelForInvestment(inv) },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (inv) => formatCurrency(inv.amount) },
    { key: 'profit', header: 'Profit', align: 'right', sortable: true, render: (inv) => formatCurrency(inv.profit) },
    {
      key: 'bucket',
      header: 'Status',
      render: (inv) => {
        const bucket = investmentBucket(inv);
        const tone = bucket === 'completed' ? 'shell' : bucket === 'running' ? 'success' : bucket === 'due' ? 'warning' : 'danger';
        return <Badge tone={tone}>{bucket.charAt(0).toUpperCase() + bucket.slice(1)}</Badge>;
      },
    },
    { key: 'updatedAt', header: 'Updated', sortable: true, render: (inv) => formatDate(inv.updatedAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (inv) => (
        <Button variant="ghost" size="sm" leftIcon={<Eye size={13} />} onClick={(e) => { e.stopPropagation(); setSelected(inv); }}>
          View
        </Button>
      ),
    },
  ];

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
          searchPlaceholder="Search by investment ID or property..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <Select
            aria-label="Project"
            value={filters.projectId}
            onChange={(e) => updateFilter('projectId', e.target.value)}
            options={PROJECT_OPTIONS}
            wrapperClassName="w-52"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(inv) => inv.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(inv) => setSelected(inv)}
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
          onSortChange={(key) => setFilters((prev) => ({ ...prev, sortBy: key, sortDir: prev.sortBy === key && prev.sortDir === 'asc' ? 'desc' : 'asc' }))}
          emptyTitle="No investments found"
          emptyDescription="Try adjusting your filters or search terms."
        />

        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))} />
        )}
      </Card>

      <Drawer isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? `Investment ${selected.id}` : undefined}>
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selected.isActive === 1 ? 'success' : 'danger'}>{selected.isActive === 1 ? 'Active' : 'Deactivated'}</Badge>
              <Badge tone="shell">{investmentBucket(selected).charAt(0).toUpperCase() + investmentBucket(selected).slice(1)}</Badge>
            </div>
            <dl className="space-y-2.5 text-sm">
              <DetailRow label="Investor" value={selected.userName} />
              <DetailRow label="Project" value={projectNameForInvestment(selected)} />
              <DetailRow label="Property" value={unitLabelForInvestment(selected)} />
              <DetailRow label="Originating Booking" value={selected.bookingId} />
              <DetailRow label="Amount" value={formatCurrency(selected.amount)} />
              <DetailRow label="Profit" value={`${formatCurrency(selected.profit)} (${selected.profitType === 1 ? '%' : 'flat'})`} />
              <DetailRow label="Net Profit" value={formatCurrency(selected.netProfit)} />
              <DetailRow label="Return Date" value={selected.returnDate ? formatDate(selected.returnDate) : '—'} />
              <DetailRow label="Last Return Paid" value={selected.lastReturnDate ? formatDate(selected.lastReturnDate) : '—'} />
              {selected.deactiveReason && <DetailRow label="Deactivation Reason" value={selected.deactiveReason} />}
            </dl>
            <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
              {selected.isActive === 1 ? (
                <Button variant="danger" leftIcon={<PauseCircle size={14} />} onClick={() => setDeactivateOpen(true)}>
                  Deactivate
                </Button>
              ) : (
                <Button variant="outline" leftIcon={<PlayCircle size={14} />} onClick={() => setConfirmAction('activate')}>
                  Activate
                </Button>
              )}
              {investmentBucket(selected) === 'running' && (
                <Button variant="primary" leftIcon={<RefreshCw size={14} />} onClick={() => setConfirmAction('return')}>
                  Trigger Profit Return
                </Button>
              )}
              <Button variant="outline" onClick={() => handleBulkReturn(selected.propertyId)}>
                Trigger Return for All Investors on This Property
              </Button>
              <Button
                variant="ghost"
                onClick={() => navigate(`/bookings/${selected.bookingId}`)}
              >
                View Originating Booking
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        isOpen={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        title="Deactivate Investment"
        description="Give a reason — it is kept on the investment's history."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeactivateOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeactivate} disabled={!deactivateReason.trim()}>
              Deactivate
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="deactivate-reason" className="text-sm font-medium text-ink">
            Reason<span className="text-danger-500"> *</span>
          </label>
          <textarea
            id="deactivate-reason"
            rows={3}
            value={deactivateReason}
            onChange={(e) => setDeactivateReason(e.target.value)}
            placeholder="e.g. Investor requested early exit"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
          />
        </div>
      </Modal>

      <ConfirmationDialog
        isOpen={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirm}
        title={confirmAction === 'activate' ? 'Activate Investment' : 'Trigger Profit Return'}
        description={
          confirmAction === 'activate'
            ? `This will reactivate ${selected?.id ?? 'this investment'}.`
            : `This will disburse the profit return for ${selected?.id ?? 'this investment'}.`
        }
        confirmLabel="Confirm"
        audited
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line pb-2.5 last:border-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
