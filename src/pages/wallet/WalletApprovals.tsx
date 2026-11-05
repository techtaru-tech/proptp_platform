import { RecordRef } from '../../components/ui/RecordRef';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import { listFunds, approveFund, rejectFund, type FundListParams } from '../../services/fundService';
import { userDisplayName } from '../../data/referenceData';
import { formatCurrency, formatDate } from '../../utils/format';
import type { FundRequest, FundStatus } from '../../types';

interface FiltersState {
  page: number;
  pageSize: number;
  search: string;
  status: FundStatus | 'all';
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '2', label: 'Pending' },
  { value: '1', label: 'Approved' },
  { value: '3', label: 'Rejected' },
];

const STATUS_TONE: Record<FundStatus, 'warning' | 'success' | 'danger'> = {
  2: 'warning',
  1: 'success',
  3: 'danger',
};
const STATUS_LABEL: Record<FundStatus, string> = { 2: 'Pending', 1: 'Approved', 3: 'Rejected' };

export function WalletApprovals() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FiltersState>({ page: 1, pageSize: 10, search: '', status: 2 });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<FundRequest | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, search: debouncedSearch, page: 1 }));
  }, [debouncedSearch]);

  const params: FundListParams = useMemo(
    () => ({ page: filters.page, pageSize: filters.pageSize, search: filters.search, status: filters.status }),
    [filters]
  );

  const { data, isLoading, error } = useAsync(() => listFunds(params), [JSON.stringify(params), reloadKey]);

  const handleApprove = async () => {
    if (!selected) return;
    await approveFund(selected.id);
    toast({ title: 'Deposit approved', description: `${formatCurrency(selected.amount)} credited to ${userDisplayName(selected.userId)}'s wallet.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const handleReject = async () => {
    if (!selected || !feedback.trim()) return;
    await rejectFund(selected.id, feedback.trim());
    toast({ title: 'Deposit rejected', description: `${selected.id} has been rejected.`, variant: 'success' });
    setRejectOpen(false);
    setFeedback('');
    setSelected(null);
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<FundRequest>[] = [
    { key: 'id', header: 'Fund ID', render: (f) => <RecordRef row={f} /> },
    { key: 'user', header: 'User', render: (f) => userDisplayName(f.userId) },
    { key: 'gateway', header: 'Method', render: (f) => f.gatewayName },
    { key: 'trxId', header: 'Transaction Ref', render: (f) => f.trxId },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (f) => formatCurrency(f.amount) },
    { key: 'status', header: 'Status', render: (f) => <Badge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge> },
    { key: 'createdAt', header: 'Requested', sortable: true, render: (f) => formatDate(f.createdAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (f) =>
        f.status === 2 ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(f); setConfirmApprove(true); }}>
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger-600 hover:bg-danger-50"
              onClick={(e) => { e.stopPropagation(); setSelected(f); setFeedback(''); setRejectOpen(true); }}
            >
              Reject
            </Button>
          </div>
        ) : (
          <span className="text-xs text-ink-faint">{f.feedback ?? '—'}</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Wallet Deposit Approvals"
        description="Manual gateway deposits (Bank Transfer) requiring admin approval. Automated gateways confirm on their own and never appear here."
      />

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder="Search by fund ID, transaction ref or user..."
          onReset={() => { setSearchInput(''); setFilters((p) => ({ ...p, search: '', status: 'all', page: 1 })); }}
          hasActiveFilters={!!filters.search || filters.status !== 'all'}
        >
          <Select
            aria-label="Status"
            value={String(filters.status)}
            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value === 'all' ? 'all' : (Number(e.target.value) as FundStatus), page: 1 }))}
            options={STATUS_OPTIONS}
            wrapperClassName="w-40"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(f) => f.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(f) => setSelected(f)}
          emptyTitle="No deposit requests found"
          emptyDescription="Try adjusting your filters."
        />

        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))} />
        )}
      </Card>

      <Modal
        isOpen={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject Deposit"
        description="Feedback is sent to the user explaining why the deposit was rejected."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReject} disabled={!feedback.trim()}>
              Reject
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fund-reject-feedback" className="text-sm font-medium text-ink">
            Feedback<span className="text-danger-500"> *</span>
          </label>
          <textarea
            id="fund-reject-feedback"
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Bank reference number could not be verified."
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-ink-faint focus-ring"
          />
        </div>
      </Modal>

      <ConfirmationDialog
        isOpen={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        onConfirm={handleApprove}
        title="Approve Deposit"
        description={selected ? `This will credit ${formatCurrency(selected.amount)} to ${userDisplayName(selected.userId)}'s wallet.` : undefined}
        confirmLabel="Approve"
        audited
      />
    </div>
  );
}
