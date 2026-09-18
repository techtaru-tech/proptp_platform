import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Edit2, Eye, Plus, ShieldCheck, Unlock } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Card } from '../../components/ui/Card';
import { Pagination } from '../../components/ui/Pagination';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Modal } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/ToastContext';
import { listUnits, updateUnit, type FlatUnitListParams } from '../../services/projectService';
import { verifyUnitBooking, freeUnit } from '../../services/bookingService';
import { exportToCsv } from '../../services/reportService';
import { projectById, refProjects } from '../../data/referenceData';
import { formatCurrency, formatDate } from '../../utils/format';
import {
  UnitBasicInfoFields,
  UnitPlotFacingFields,
  UnitMediaFields,
  UnitPricingFields,
  UnitAmenityFields,
  defaultUnitFormValues,
  unitToFormValues,
  unitFormValuesToPatch,
  validateUnitForm,
  type UnitFormValues,
} from '../projects/UnitForm';
import type { PropertyUnit, UnitBookingStatus } from '../../types';

export type PropertyListFilter = 'all' | 'running' | 'sold-out' | 'booked';

interface PropertyListProps {
  filter?: PropertyListFilter;
}

interface FiltersState {
  page: number;
  pageSize: number;
  search: string;
  projectId: string | 'all';
  bookingStatus: UnitBookingStatus | 'all';
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

const PROJECT_OPTIONS = [
  { value: 'all', label: 'All Projects' },
  ...refProjects.map((p) => ({ value: p.id, label: p.projectName })),
];

const TITLE_BY_FILTER: Record<PropertyListFilter, { title: string; description: string; bookingStatus: UnitBookingStatus | 'all' }> = {
  all: { title: 'All Properties', description: 'Every property across all projects.', bookingStatus: 'all' },
  running: { title: 'Running Properties', description: 'Properties currently available for booking.', bookingStatus: 0 },
  'sold-out': { title: 'Sold Out Properties', description: 'Properties that have been fully sold.', bookingStatus: 2 },
  booked: { title: 'Booked Properties', description: 'Properties that have been booked by a customer.', bookingStatus: 1 },
};

export function PropertyList({ filter = 'all' }: PropertyListProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const headerCopy = TITLE_BY_FILTER[filter];

  const [filters, setFilters] = useState<FiltersState>(() => ({
    page: 1,
    pageSize: 10,
    search: '',
    projectId: 'all',
    bookingStatus: headerCopy.bookingStatus,
    sortBy: 'updatedAt',
    sortDir: 'desc',
  }));

  useEffect(() => {
    setFilters((prev) => ({ ...prev, bookingStatus: headerCopy.bookingStatus, page: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, search: debouncedSearch, page: 1 }));
  }, [debouncedSearch]);

  const [reloadKey, setReloadKey] = useState(0);
  const [selectedUnit, setSelectedUnit] = useState<PropertyUnit | null>(null);
  const [editingUnit, setEditingUnit] = useState<PropertyUnit | null>(null);
  const [formValues, setFormValues] = useState<UnitFormValues>(defaultUnitFormValues());
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'verify' | 'free' | null>(null);

  const params: FlatUnitListParams = useMemo(
    () => ({
      page: filters.page,
      pageSize: filters.pageSize,
      search: filters.search,
      projectId: filters.projectId,
      bookingStatus: filters.bookingStatus,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
    }),
    [filters]
  );

  const { data, isLoading, error } = useAsync(() => listUnits(params), [JSON.stringify(params), reloadKey]);

  const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const hasActiveFilters = !!filters.search || filters.projectId !== 'all';

  const resetFilters = () => {
    setSearchInput('');
    setFilters((prev) => ({ ...prev, page: 1, search: '', projectId: 'all' }));
  };

  const openEditUnit = (u: PropertyUnit) => {
    setEditingUnit(u);
    setFormValues(unitToFormValues(u));
    setFormErrors({});
  };

  const handleSaveUnit = async () => {
    if (!editingUnit) return;
    const errors = validateUnitForm(formValues);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      await updateUnit(editingUnit.id, unitFormValuesToPatch(formValues));
      toast({ title: 'Property updated', description: `${formValues.propertyTitle} has been updated.`, variant: 'success' });
      setEditingUnit(null);
      setReloadKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!selectedUnit || !confirmAction) return;
    try {
      if (confirmAction === 'verify') {
        await verifyUnitBooking(selectedUnit.id);
        toast({ title: 'Property verified', description: `${selectedUnit.propertyNumber} has been verified.`, variant: 'success' });
      } else {
        await freeUnit(selectedUnit.id);
        toast({ title: 'Property released', description: `${selectedUnit.propertyNumber} is now available again.`, variant: 'success' });
      }
      setReloadKey((k) => k + 1);
    } finally {
      setConfirmAction(null);
      setSelectedUnit(null);
    }
  };

  const handleExport = () => {
    const rows = data?.items ?? [];
    exportToCsv(
      `properties-${filter}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((u) => ({
        id: u.id,
        title: u.propertyTitle,
        number: u.propertyNumber,
        project: projectById(u.projectId)?.projectName ?? '',
        type: u.propertyType,
        area: `${u.propertyArea} ${u.propertyMeasurement}`,
        totalInvestmentAmount: u.totalInvestmentAmount,
        bookingStatus: u.bookingStatus === 0 ? 'Available' : u.bookingStatus === 1 ? 'Booked' : 'Sold Out',
        status: u.status === 1 ? 'Active' : 'Deactive',
        updatedAt: u.updatedAt,
      }))
    );
  };

  const columns: DataTableColumn<PropertyUnit>[] = [
    { key: 'propertyNumber', header: 'Property', render: (u) => (
      <div>
        <p className="font-medium text-ink">{u.propertyNumber}</p>
        <p className="text-xs text-ink-faint line-clamp-1">{u.propertyTitle}</p>
      </div>
    ) },
    { key: 'project', header: 'Project', render: (u) => (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); navigate(`/projects/${u.projectId}`); }}
        className="text-brand-600 hover:text-brand-700 focus-ring rounded"
      >
        {projectById(u.projectId)?.projectName ?? '—'}
      </button>
    ) },
    { key: 'propertyType', header: 'Type', render: (u) => u.propertyType },
    { key: 'propertyArea', header: 'Area', align: 'right', render: (u) => `${u.propertyArea} ${u.propertyMeasurement}` },
    { key: 'totalInvestmentAmount', header: 'Deposit Amount', align: 'right', sortable: true, render: (u) => formatCurrency(u.totalInvestmentAmount) },
    { key: 'bookingStatus', header: 'Booking Status', render: (u) => <StatusBadge kind="unit" status={u.bookingStatus} /> },
    { key: 'status', header: 'Active', render: (u) => <StatusBadge kind="unitActive" status={u.status} /> },
    { key: 'verified', header: 'Verified', render: (u) => (u.isVerified ? <StatusBadge kind="unitActive" status={1} /> : <span className="text-ink-faint">—</span>) },
    { key: 'updatedAt', header: 'Updated', sortable: true, render: (u) => formatDate(u.updatedAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (u) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" leftIcon={<Eye size={13} />} onClick={(e) => { e.stopPropagation(); setSelectedUnit(u); }}>
            View
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Edit2 size={13} />} onClick={(e) => { e.stopPropagation(); openEditUnit(u); }}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={headerCopy.title}
        description={headerCopy.description}
        actions={
          <>
            <Button variant="outline" leftIcon={<Download size={15} />} onClick={handleExport} disabled={!data?.items.length}>
              Export
            </Button>
            <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => navigate('/properties/new')}>
              Add Property
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder="Search by property number, title or type..."
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
          rowKey={(u) => u.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(u) => setSelectedUnit(u)}
          sortBy={filters.sortBy}
          sortDir={filters.sortDir}
          onSortChange={(key) => setFilters((prev) => ({ ...prev, sortBy: key, sortDir: prev.sortBy === key && prev.sortDir === 'asc' ? 'desc' : 'asc' }))}
          emptyTitle="No properties found"
          emptyDescription="Try adjusting your filters or search terms."
        />

        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))} />
        )}
      </Card>

      <Drawer isOpen={!!selectedUnit} onClose={() => setSelectedUnit(null)} title={selectedUnit ? `Property ${selectedUnit.propertyNumber}` : undefined}>
        {selectedUnit && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="unit" status={selectedUnit.bookingStatus} />
              <StatusBadge kind="unitActive" status={selectedUnit.status} />
            </div>
            <dl className="space-y-2.5 text-sm">
              <DetailRow label="Title" value={selectedUnit.propertyTitle} />
              <DetailRow label="Project" value={projectById(selectedUnit.projectId)?.projectName ?? '—'} />
              <DetailRow label="Type" value={selectedUnit.propertyType} />
              <DetailRow label="Area" value={`${selectedUnit.propertyArea} ${selectedUnit.propertyMeasurement}`} />
              <DetailRow label="Total Deposit Amount" value={formatCurrency(selectedUnit.totalInvestmentAmount)} />
              <DetailRow label="Total Commission" value={formatCurrency(selectedUnit.profit)} />
              <DetailRow label="Verified" value={selectedUnit.isVerified ? 'Yes' : 'No'} />
            </dl>
            <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
              {!selectedUnit.isVerified && selectedUnit.bookingStatus !== 0 && (
                <Button variant="outline" leftIcon={<ShieldCheck size={14} />} onClick={() => setConfirmAction('verify')}>
                  Verify
                </Button>
              )}
              {selectedUnit.bookingStatus !== 0 && (
                <Button variant="danger" leftIcon={<Unlock size={14} />} onClick={() => setConfirmAction('free')}>
                  Release
                </Button>
              )}
              <Button variant="primary" leftIcon={<Edit2 size={14} />} onClick={() => openEditUnit(selectedUnit)}>
                Edit
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        isOpen={!!editingUnit}
        onClose={() => setEditingUnit(null)}
        title="Edit Property"
        description="Unit details, media, pricing and amenities."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingUnit(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveUnit} isLoading={saving}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <UnitBasicInfoFields values={formValues} errors={formErrors} onChange={(patch: Partial<UnitFormValues>) => setFormValues((v) => ({ ...v, ...patch }))} />
          <div className="border-t border-line pt-5">
            <UnitPlotFacingFields values={formValues} onChange={(patch: Partial<UnitFormValues>) => setFormValues((v) => ({ ...v, ...patch }))} />
          </div>
          <div className="border-t border-line pt-5">
            <UnitMediaFields values={formValues} onChange={(patch: Partial<UnitFormValues>) => setFormValues((v) => ({ ...v, ...patch }))} />
          </div>
          <div className="border-t border-line pt-5">
            <UnitPricingFields values={formValues} errors={formErrors} onChange={(patch: Partial<UnitFormValues>) => setFormValues((v) => ({ ...v, ...patch }))} />
          </div>
          <div className="border-t border-line pt-5">
            <UnitAmenityFields values={formValues} errors={formErrors} onChange={(patch: Partial<UnitFormValues>) => setFormValues((v) => ({ ...v, ...patch }))} />
          </div>
        </div>
      </Modal>

      <ConfirmationDialog
        isOpen={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={confirmAction === 'verify' ? 'Verify Property' : 'Release Property'}
        description={
          confirmAction === 'verify'
            ? `This will mark ${selectedUnit?.propertyNumber ?? 'this property'}'s booking as verified.`
            : `This will release ${selectedUnit?.propertyNumber ?? 'this property'} back to Available and clear its booking assignment.`
        }
        confirmLabel="Confirm"
        variant={confirmAction === 'free' ? 'danger' : 'primary'}
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
