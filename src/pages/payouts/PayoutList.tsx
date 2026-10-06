import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Modal } from '../../components/ui/Modal';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Pagination } from '../../components/ui/Pagination';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import { listPayouts, createManualPayout, type PayoutListParams } from '../../services/payoutService';
import { roleLabel } from '../../services/userService';
import { refAgents, refEmployees, refLeaders } from '../../data/referenceData';
import { formatCurrency, formatDate } from '../../utils/format';
import type { PayoutRequest, PayoutStatus } from '../../types';

const STATUS_OPTIONS: { value: PayoutStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'released', label: 'Released' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
];

const PARTNER_OPTIONS = [...refAgents, ...refEmployees, ...refLeaders].map((u) => ({ value: u.id, label: u.name }));

export function PayoutList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PayoutStatus | 'all'>('all');
  const [sortBy, setSortBy] = useState('requestDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [reloadKey, setReloadKey] = useState(0);
  const debouncedSearch = useDebounce(search, 300);

  const [createOpen, setCreateOpen] = useState(false);
  const [createUserId, setCreateUserId] = useState('');
  const [createAmount, setCreateAmount] = useState('');
  const [createStatus, setCreateStatus] = useState<'confirmed' | 'released'>('confirmed');
  const [creating, setCreating] = useState(false);

  const params: PayoutListParams = { page, pageSize: 10, search: debouncedSearch, status, sortBy, sortDir };
  const { data, isLoading, error } = useAsync(() => listPayouts(params), [JSON.stringify(params), reloadKey]);

  const openCreate = () => {
    setCreateUserId('');
    setCreateAmount('');
    setCreateStatus('confirmed');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!createUserId || !createAmount || Number(createAmount) <= 0) return;
    setCreating(true);
    try {
      await createManualPayout({ userId: createUserId, amount: Number(createAmount), status: createStatus });
      toast({ title: 'Payout created', description: 'A manual payout has been created.', variant: 'success' });
      setCreateOpen(false);
      setReloadKey((k) => k + 1);
    } finally {
      setCreating(false);
    }
  };

  const hasActiveFilters = search !== '' || status !== 'all';
  const resetFilters = () => {
    setSearch('');
    setStatus('all');
    setPage(1);
  };

  const handleSortChange = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const columns: DataTableColumn<PayoutRequest>[] = [
    { key: 'id', header: 'Request ID', render: (p) => <span className="font-medium text-ink">{p.id}</span> },
    { key: 'user', header: 'User', render: (p) => p.userName },
    { key: 'role', header: 'Role', render: (p) => roleLabel(p.role) },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (p) => formatCurrency(p.amount) },
    { key: 'requestDate', header: 'Request Date', sortable: true, render: (p) => formatDate(p.requestDate) },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge kind="payout" status={p.status} /> },
    { key: 'processor', header: 'Processor', render: (p) => p.processor ?? '—' },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (p) => (
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/payouts/${p.id}`); }}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Payouts / Earnings"
        description="Review and process payout requests raised by Agents, Employees and Leaders."
        actions={
          <>
            <Button variant="outline" leftIcon={<FileSpreadsheet size={14} />} onClick={() => navigate('/payouts/statements')}>
              Commission Statements
            </Button>
            <Button variant="primary" leftIcon={<Plus size={14} />} onClick={openCreate}>
              Create Payout
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search by user or request ID..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
        >
          <Select value={status} onChange={(e) => { setStatus(e.target.value as PayoutStatus | 'all'); setPage(1); }} options={STATUS_OPTIONS} wrapperClassName="w-44" />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(p) => p.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(p) => navigate(`/payouts/${p.id}`)}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
        />

        {data && data.total > 0 && <Pagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Payout"
        description="Manually create a payout on a partner's behalf, mirroring the real admin's manual payout entry."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreate} isLoading={creating}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Partner" required value={createUserId} onChange={(e) => setCreateUserId(e.target.value)} options={[{ value: '', label: 'Select partner' }, ...PARTNER_OPTIONS]} />
          <MoneyInput label="Amount (₹)" type="number" min={0} value={createAmount} onChange={(e) => setCreateAmount(e.target.value)} />
          <Select
            label="Initial status"
            value={createStatus}
            onChange={(e) => setCreateStatus(e.target.value as 'confirmed' | 'released')}
            options={[
              { value: 'confirmed', label: 'Confirmed (awaiting release)' },
              { value: 'released', label: 'Released (immediately debited)' },
            ]}
          />
        </div>
      </Modal>
    </div>
  );
}
