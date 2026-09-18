import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import {
  listIncentiveRequests,
  changeIncentiveRequestStatus,
  unitLabelForIncentiveRequest,
  projectNameForIncentiveRequest,
} from '../../services/incentiveRequestService';
import { userDisplayName } from '../../data/referenceData';
import { formatDate } from '../../utils/format';
import type { IncentiveRequestRow } from '../../types';

interface FiltersState {
  page: number;
  pageSize: number;
  search: string;
  status: 0 | 1 | 2 | 'all';
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '0', label: 'Pending' },
  { value: '1', label: 'Accepted' },
  { value: '2', label: 'Rejected' },
];

const STATUS_TONE = { 0: 'warning', 1: 'success', 2: 'danger' } as const;
const STATUS_LABEL = { 0: 'Pending', 1: 'Accepted', 2: 'Rejected' } as const;

export function IncentiveRequestList() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FiltersState>({ page: 1, pageSize: 10, search: '', status: 0 });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [reloadKey, setReloadKey] = useState(0);
  const [acceptTarget, setAcceptTarget] = useState<IncentiveRequestRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<IncentiveRequestRow | null>(null);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, search: debouncedSearch, page: 1 }));
  }, [debouncedSearch]);

  const params = useMemo(
    () => ({ page: filters.page, pageSize: filters.pageSize, search: filters.search, status: filters.status }),
    [filters]
  );

  const { data, isLoading, error } = useAsync(() => listIncentiveRequests(params), [JSON.stringify(params), reloadKey]);

  const handleAccept = async () => {
    if (!acceptTarget) return;
    await changeIncentiveRequestStatus(acceptTarget.id, 1);
    toast({ title: 'Request accepted', description: `${acceptTarget.id} has been accepted.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    await changeIncentiveRequestStatus(rejectTarget.id, 2);
    toast({ title: 'Request rejected', description: `${rejectTarget.id} has been rejected.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<IncentiveRequestRow>[] = [
    { key: 'id', header: 'Request ID', render: (r) => <span className="font-medium text-ink">{r.id}</span> },
    { key: 'user', header: 'Agent / Partner', render: (r) => userDisplayName(r.userId) },
    { key: 'property', header: 'Property', render: (r) => unitLabelForIncentiveRequest(r) },
    { key: 'project', header: 'Project', render: (r) => projectNameForIncentiveRequest(r) },
    { key: 'createdAt', header: 'Requested', render: (r) => formatDate(r.createdAt) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) =>
        r.status === 0 ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setAcceptTarget(r); }}>
              Accept
            </Button>
            <Button variant="ghost" size="sm" className="text-danger-600 hover:bg-danger-50" onClick={(e) => { e.stopPropagation(); setRejectTarget(r); }}>
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Incentive Requests"
        description="Agents raise incentive requests against a booked property; the real system's accept/reject action is a simple status flip with no automatic payout."
      />

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder="Search by request ID or agent..."
          onReset={() => { setSearchInput(''); setFilters((p) => ({ ...p, search: '', status: 'all', page: 1 })); }}
          hasActiveFilters={!!filters.search || filters.status !== 'all'}
        >
          <Select
            aria-label="Status"
            value={String(filters.status)}
            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value === 'all' ? 'all' : (Number(e.target.value) as 0 | 1 | 2), page: 1 }))}
            options={STATUS_OPTIONS}
            wrapperClassName="w-40"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          error={error}
          emptyTitle="No incentive requests found"
          emptyDescription="Try adjusting your filters."
        />

        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))} />
        )}
      </Card>

      <ConfirmationDialog
        isOpen={!!acceptTarget}
        onClose={() => setAcceptTarget(null)}
        onConfirm={handleAccept}
        title="Accept Incentive Request"
        description={acceptTarget ? `This will accept ${acceptTarget.id}.` : undefined}
        confirmLabel="Accept"
        audited
      />

      <ConfirmationDialog
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleReject}
        title="Reject Incentive Request"
        description={rejectTarget ? `This will reject ${rejectTarget.id}.` : undefined}
        confirmLabel="Reject"
        variant="danger"
        audited
      />
    </div>
  );
}
