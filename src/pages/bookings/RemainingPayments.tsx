import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Edit2, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { Select } from '../../components/ui/Select';
import { ACCEPT_DOCUMENT, FileUploadField } from '../../components/ui/FileUpload';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { Pagination } from '../../components/ui/Pagination';
import { Badge } from '../../components/ui/Badge';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import {
  listRemainingPayments,
  addRemainingPayment,
  updateBookingKyc,
  deleteBookingWithReversal,
} from '../../services/bookingService';
import { exportToCsv } from '../../services/reportService';
import { formatCurrency } from '../../utils/format';
import { PAYMENT_MODE_LABEL, type Booking, type PaymentMode } from '../../types';

const PAYMENT_MODE_OPTIONS = Object.entries(PAYMENT_MODE_LABEL).map(([value, label]) => ({ value, label }));

interface FiltersState {
  page: number;
  pageSize: number;
  search: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

interface RemainingRow {
  booking: Booking;
  /** Joined on by the endpoint, so the row renders without a client-side lookup. */
  projectName: string;
  unitLabel: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
}

export function RemainingPayments() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [filters, setFilters] = useState<FiltersState>({
    page: 1,
    pageSize: 10,
    search: '',
    sortBy: 'remainingAmount',
    sortDir: 'desc',
  });

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, search: debouncedSearch, page: 1 }));
  }, [debouncedSearch]);

  const [reloadKey, setReloadKey] = useState(0);
  const [addPaymentRow, setAddPaymentRow] = useState<RemainingRow | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(0);
  const [chequeImage, setChequeImage] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const [editRow, setEditRow] = useState<RemainingRow | null>(null);
  const [kycName, setKycName] = useState('');
  const [kycPhone, setKycPhone] = useState('');
  const [kycAadhaar, setKycAadhaar] = useState('');
  const [savingKyc, setSavingKyc] = useState(false);

  const [deleteRow, setDeleteRow] = useState<RemainingRow | null>(null);

  const params = useMemo(
    () => ({
      page: filters.page,
      pageSize: filters.pageSize,
      search: filters.search,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
    }),
    [filters]
  );

  const { data, isLoading, error } = useAsync(() => listRemainingPayments(params), [JSON.stringify(params), reloadKey]);

  const openAddPayment = (row: RemainingRow) => {
    setAddPaymentRow(row);
    setPaymentAmount('');
    setPaymentMode(0);
    setChequeImage(undefined);
  };

  const handleAddPayment = async () => {
    if (!addPaymentRow) return;
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      await addRemainingPayment(addPaymentRow.booking.propertyId, { amount, paymentMode, chequeImage });
      toast({ title: 'Payment recorded', description: `${formatCurrency(amount)} recorded against ${addPaymentRow.booking.id}.`, variant: 'success' });
      setAddPaymentRow(null);
      setReloadKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  const openEditKyc = (row: RemainingRow) => {
    setEditRow(row);
    setKycName(row.booking.bookingName);
    setKycPhone(row.booking.phone);
    setKycAadhaar(row.booking.aadhaarNumber ?? '');
  };

  const handleSaveKyc = async () => {
    if (!editRow) return;
    setSavingKyc(true);
    try {
      await updateBookingKyc(editRow.booking.id, { bookingName: kycName.trim(), phone: kycPhone.trim(), aadhaarNumber: kycAadhaar.trim() || undefined });
      toast({ title: 'KYC details updated', description: `${editRow.booking.id} has been updated.`, variant: 'success' });
      setEditRow(null);
      setReloadKey((k) => k + 1);
    } finally {
      setSavingKyc(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteRow) return;
    await deleteBookingWithReversal(deleteRow.booking.id);
    toast({ title: 'Deposit deleted', description: `${deleteRow.booking.id} was removed and the balance reversed.`, variant: 'success' });
    setDeleteRow(null);
    setReloadKey((k) => k + 1);
  };

  const handleSortChange = (key: string) => {
    setFilters((prev) => ({
      ...prev,
      sortBy: key,
      sortDir: prev.sortBy === key && prev.sortDir === 'asc' ? 'desc' : 'asc',
    }));
  };

  const resetFilters = () => {
    setSearchInput('');
    setFilters((prev) => ({ ...prev, page: 1, search: '' }));
  };

  const handleExport = () => {
    const rows = data?.items ?? [];
    exportToCsv(
      `remaining-payments-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((r) => ({
        bookingId: r.booking.id,
        customer: r.booking.bookingName,
        project: r.projectName,
        unit: r.unitLabel,
        totalAmount: r.totalAmount,
        paidAmount: r.paidAmount,
        remainingAmount: r.remainingAmount,
      }))
    );
  };

  const columns: DataTableColumn<RemainingRow>[] = [
    {
      key: 'id',
      header: 'Booking',
      render: (r) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/bookings/${r.booking.id}`);
          }}
          className="font-medium text-brand-600 hover:text-brand-700 focus-ring rounded"
        >
          {r.booking.id}
        </button>
      ),
    },
    { key: 'customer', header: 'Customer', render: (r) => r.booking.bookingName },
    { key: 'project', header: 'Project', render: (r) => r.projectName },
    { key: 'unit', header: 'Unit', render: (r) => r.unitLabel },
    { key: 'total', header: 'Total Investment', align: 'right', render: (r) => formatCurrency(r.totalAmount) },
    { key: 'paid', header: 'Paid Amount', align: 'right', render: (r) => formatCurrency(r.paidAmount) },
    { key: 'remaining', header: 'Remaining Amount', align: 'right', sortable: true, render: (r) => formatCurrency(r.remainingAmount) },
    {
      key: 'dueStatus',
      header: 'Due Status',
      render: (r) => {
        const overHalf = r.remainingAmount > r.totalAmount * 0.5;
        return <Badge tone={overHalf ? 'danger' : 'warning'}>{overHalf ? 'Critical' : 'Due'}</Badge>;
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" leftIcon={<Plus size={13} />} onClick={(e) => { e.stopPropagation(); openAddPayment(r); }}>
            Add Payment
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Edit2 size={13} />} onClick={(e) => { e.stopPropagation(); openEditKyc(r); }}>
            Edit KYC
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 size={13} />}
            className="text-danger-600 hover:bg-danger-50"
            onClick={(e) => { e.stopPropagation(); setDeleteRow(r); }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Remaining Payments"
        description="Units with outstanding investment balances still due."
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
          searchPlaceholder="Search by customer or booking ID..."
          onReset={resetFilters}
          hasActiveFilters={!!filters.search}
        />

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.booking.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(r) => navigate(`/bookings/${r.booking.id}`)}
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
          onSortChange={handleSortChange}
          emptyTitle="No outstanding payments"
          emptyDescription="All units are fully paid, or try adjusting your search."
        />

        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))} />
        )}
      </Card>

      <Modal
        isOpen={!!addPaymentRow}
        onClose={() => setAddPaymentRow(null)}
        title="Add Payment"
        description="Manually record a deposit/installment payment against this property, mirroring the real admin's deposit entry flow."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddPaymentRow(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAddPayment} isLoading={saving} disabled={!paymentAmount || Number(paymentAmount) <= 0 || (paymentMode === 2 && !chequeImage)}>
              Record Payment
            </Button>
          </>
        }
      >
        {addPaymentRow && (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Remaining on {addPaymentRow.booking.id}: <span className="font-medium text-ink">{formatCurrency(addPaymentRow.remainingAmount)}</span>
            </p>
            <MoneyInput label="Amount (₹)" type="number" min={0} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
            <Select
              label="Payment mode"
              value={String(paymentMode)}
              onChange={(e) => setPaymentMode(Number(e.target.value) as PaymentMode)}
              options={PAYMENT_MODE_OPTIONS}
            />
            {/* The booking engine refuses a cheque payment without the cheque photo. */}
            {paymentMode === 2 && (
              <FileUploadField
                label="Cheque photo"
                required
                accept={ACCEPT_DOCUMENT}
                value={chequeImage}
                onChange={setChequeImage}
              />
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!editRow}
        onClose={() => setEditRow(null)}
        title="Edit KYC Details"
        description="Amend the customer's KYC details recorded against this booking."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditRow(null)} disabled={savingKyc}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveKyc} isLoading={savingKyc}>
              Save Changes
            </Button>
          </>
        }
      >
        {editRow && (
          <div className="space-y-4">
            <Input label="Customer name" value={kycName} onChange={(e) => setKycName(e.target.value)} />
            <Input label="Phone" value={kycPhone} onChange={(e) => setKycPhone(e.target.value)} />
            <Input label="Aadhaar number" value={kycAadhaar} onChange={(e) => setKycAadhaar(e.target.value)} />
          </div>
        )}
      </Modal>

      <ConfirmationDialog
        isOpen={!!deleteRow}
        onClose={() => setDeleteRow(null)}
        onConfirm={handleDelete}
        title="Delete Deposit"
        description={
          deleteRow
            ? `This permanently deletes ${deleteRow.booking.id} and reverses the unit's balance/booking status — this is the real system's only way to "reject" a deposit.`
            : undefined
        }
        confirmLabel="Delete"
        variant="danger"
        audited
      />
    </div>
  );
}
