import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { listKycRequests, approveKyc, rejectKyc } from '../../services/kycService';
import { ROLE_NAME_BY_ID } from '../../types';
import { formatDate } from '../../utils/format';
import type { PartnerUser } from '../../types';

interface FiltersState {
  page: number;
  pageSize: number;
  search: string;
  status: 0 | 1 | 2 | 'all';
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '0', label: 'Pending' },
  { value: '1', label: 'Verified' },
  { value: '2', label: 'Rejected' },
];

const STATUS_TONE = { 0: 'warning', 1: 'success', 2: 'danger' } as const;
const STATUS_LABEL = { 0: 'Pending', 1: 'Verified', 2: 'Rejected' } as const;

export function KycApprovals() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [filters, setFilters] = useState<FiltersState>({ page: 1, pageSize: 10, search: '', status: 0 });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [reloadKey, setReloadKey] = useState(0);
  const [approveTarget, setApproveTarget] = useState<PartnerUser | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PartnerUser | null>(null);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, search: debouncedSearch, page: 1 }));
  }, [debouncedSearch]);

  const params = useMemo(
    () => ({ page: filters.page, pageSize: filters.pageSize, search: filters.search, status: filters.status }),
    [filters]
  );

  const { data, isLoading, error } = useAsync(() => listKycRequests(params), [JSON.stringify(params), reloadKey]);

  const handleApprove = async () => {
    if (!approveTarget) return;
    await approveKyc(approveTarget.id);
    toast({ title: 'KYC verified', description: `${approveTarget.name}'s KYC has been approved.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    await rejectKyc(rejectTarget.id);
    toast({ title: 'KYC rejected', description: `${rejectTarget.name}'s KYC was rejected and the account has been deactivated.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<PartnerUser>[] = [
    { key: 'name', header: 'Name', render: (u) => <span className="font-medium text-ink">{u.name}</span> },
    { key: 'role', header: 'Role', render: (u) => ROLE_NAME_BY_ID[u.role] },
    { key: 'phone', header: 'Phone', render: (u) => u.phone },
    { key: 'createdAt', header: 'Joined', render: (u) => formatDate(u.createdAt) },
    { key: 'status', header: 'KYC Status', render: (u) => <Badge tone={STATUS_TONE[u.kycStatus]}>{STATUS_LABEL[u.kycStatus]}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (u) =>
        u.kycStatus === 0 ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setApproveTarget(u); }}>
              Approve
            </Button>
            <Button variant="ghost" size="sm" className="text-danger-600 hover:bg-danger-50" onClick={(e) => { e.stopPropagation(); setRejectTarget(u); }}>
              Reject
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/users/${u.id}`); }}>
            View
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="KYC Approvals"
        description="Rejecting a KYC submission also deactivates the partner's account."
      />

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder="Search by name or phone..."
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
          rowKey={(u) => u.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(u) => navigate(`/users/${u.id}`)}
          emptyTitle="No KYC requests found"
          emptyDescription="Try adjusting your filters."
        />

        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))} />
        )}
      </Card>

      <ConfirmationDialog
        isOpen={!!approveTarget}
        onClose={() => setApproveTarget(null)}
        onConfirm={handleApprove}
        title="Approve KYC"
        description={approveTarget ? `This will mark ${approveTarget.name}'s KYC as verified.` : undefined}
        confirmLabel="Approve"
        audited
      />

      <ConfirmationDialog
        isOpen={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleReject}
        title="Reject KYC"
        description={rejectTarget ? `This will reject ${rejectTarget.name}'s KYC and deactivate their account.` : undefined}
        confirmLabel="Reject & Deactivate"
        variant="danger"
        audited
      />
    </div>
  );
}
