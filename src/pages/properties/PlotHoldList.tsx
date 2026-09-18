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
import { listPlotHolds, createPlotHold, releasePlotHold, unitLabelForHold, projectNameForHold } from '../../services/plotHoldService';
import { refAgents, refEmployees, refLeaders, refProjects } from '../../data/referenceData';
import { listUnits } from '../../services/projectService';
import type { PropertyUnit } from '../../types';
import { formatDate } from '../../utils/format';
import type { PlotHoldRow } from '../../types';

interface FiltersState {
  page: number;
  pageSize: number;
  search: string;
  projectId: string | 'all';
  status: 1 | 0 | 'all';
}

const PROJECT_OPTIONS = [
  { value: 'all', label: 'All Projects' },
  ...refProjects.map((p) => ({ value: p.id, label: p.projectName })),
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '1', label: 'Active' },
  { value: '0', label: 'Released' },
];

const PARTNER_OPTIONS = [...refAgents, ...refEmployees, ...refLeaders].map((u) => ({ value: u.id, label: u.name }));

export function PlotHoldList() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FiltersState>({ page: 1, pageSize: 10, search: '', projectId: 'all', status: 'all' });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, search: debouncedSearch, page: 1 }));
  }, [debouncedSearch]);

  const [createOpen, setCreateOpen] = useState(false);
  const [unitId, setUnitId] = useState('');
  const [holdUserId, setHoldUserId] = useState('');
  const [holdStart, setHoldStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [holdEnd, setHoldEnd] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [releaseTarget, setReleaseTarget] = useState<PlotHoldRow | null>(null);

  // Plots are not part of the cached reference data (there can be thousands), so the
  // picker's options are fetched — filtered to Available — when the create form opens.
  const [availableUnits, setAvailableUnits] = useState<PropertyUnit[]>([]);
  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    listUnits({ bookingStatus: 0, pageSize: 200 })
      .then((page) => !cancelled && setAvailableUnits(page.items.filter((u) => !u.bookedBy)))
      .catch(() => !cancelled && setAvailableUnits([]));
    return () => {
      cancelled = true;
    };
  }, [createOpen]);

  const availableUnitOptions = useMemo(
    () => [
      { value: '', label: 'Select a property' },
      ...availableUnits.map((u) => ({ value: u.id, label: `${u.propertyNumber} · ${u.propertyTitle}` })),
    ],
    [availableUnits]
  );

  const params = useMemo(
    () => ({ page: filters.page, pageSize: filters.pageSize, search: filters.search, projectId: filters.projectId, status: filters.status }),
    [filters]
  );

  const { data, isLoading, error } = useAsync(() => listPlotHolds(params), [JSON.stringify(params), reloadKey]);

  const resetFilters = () => {
    setSearchInput('');
    setFilters((prev) => ({ ...prev, page: 1, search: '', projectId: 'all', status: 'all' }));
  };

  const openCreate = () => {
    setUnitId('');
    setHoldUserId('');
    setHoldStart(new Date().toISOString().slice(0, 10));
    setHoldEnd('');
    setCreateError('');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!unitId || !holdUserId || !holdEnd) {
      setCreateError('All fields are required.');
      return;
    }
    setCreating(true);
    try {
      await createPlotHold(unitId, { userId: holdUserId, holdStart, holdEnd });
      toast({ title: 'Hold created', description: `A hold has been placed on the selected property.`, variant: 'success' });
      setCreateOpen(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create hold.');
    } finally {
      setCreating(false);
    }
  };

  const handleRelease = async () => {
    if (!releaseTarget) return;
    await releasePlotHold(releaseTarget.id);
    toast({ title: 'Hold released', description: `${releaseTarget.id} has been released.`, variant: 'success' });
    setReleaseTarget(null);
    setReloadKey((k) => k + 1);
  };

  const columns: DataTableColumn<PlotHoldRow>[] = [
    { key: 'id', header: 'Hold ID', render: (h) => <span className="font-medium text-ink">{h.id}</span> },
    { key: 'property', header: 'Property', render: (h) => unitLabelForHold(h) },
    { key: 'project', header: 'Project', render: (h) => projectNameForHold(h) },
    { key: 'user', header: 'Held For', render: (h) => h.userName },
    { key: 'holdStart', header: 'Hold Start', render: (h) => formatDate(h.holdStart) },
    { key: 'holdEnd', header: 'Hold End', sortable: true, render: (h) => formatDate(h.holdEnd) },
    { key: 'status', header: 'Status', render: (h) => <Badge tone={h.status === 1 ? 'success' : 'neutral'}>{h.status === 1 ? 'Active' : 'Released'}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (h) =>
        h.status === 1 ? (
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setReleaseTarget(h); }}>
            Release
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Plot Holds"
        description="Temporary reservations placed by admins on unbooked properties, independent of booking status."
        actions={
          <Button variant="primary" onClick={openCreate}>
            Create Hold
          </Button>
        }
      />

      <Card padded={false}>
        <FilterBar search={searchInput} onSearchChange={setSearchInput} searchPlaceholder="Search by hold ID or property..." onReset={resetFilters} hasActiveFilters={!!filters.search || filters.projectId !== 'all' || filters.status !== 'all'}>
          <Select aria-label="Project" value={filters.projectId} onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value, page: 1 }))} options={PROJECT_OPTIONS} wrapperClassName="w-52" />
          <Select
            aria-label="Status"
            value={String(filters.status)}
            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value === 'all' ? 'all' : (Number(e.target.value) as 1 | 0), page: 1 }))}
            options={STATUS_OPTIONS}
            wrapperClassName="w-40"
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(h) => h.id}
          isLoading={isLoading}
          error={error}
          emptyTitle="No plot holds found"
          emptyDescription="Try adjusting your filters, or create a new hold."
        />

        {data && data.total > 0 && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))} />
        )}
      </Card>

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Plot Hold"
        description="Place a temporary reservation on an unbooked property for a specific partner/customer."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreate} isLoading={creating}>
              Create Hold
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Property" required value={unitId} onChange={(e) => setUnitId(e.target.value)} options={availableUnitOptions} />
          <Select label="Held for" required value={holdUserId} onChange={(e) => setHoldUserId(e.target.value)} options={[{ value: '', label: 'Select partner' }, ...PARTNER_OPTIONS]} />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
              Hold start
              <input type="date" value={holdStart} onChange={(e) => setHoldStart(e.target.value)} className="rounded-lg border border-line-strong bg-white px-3 py-2 text-sm focus-ring" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
              Hold end
              <input type="date" value={holdEnd} onChange={(e) => setHoldEnd(e.target.value)} className="rounded-lg border border-line-strong bg-white px-3 py-2 text-sm focus-ring" />
            </label>
          </div>
          {createError && <p className="text-xs text-danger-600">{createError}</p>}
        </div>
      </Modal>

      <ConfirmationDialog
        isOpen={!!releaseTarget}
        onClose={() => setReleaseTarget(null)}
        onConfirm={handleRelease}
        title="Release Hold"
        description={releaseTarget ? `This will release ${releaseTarget.id} early, making the property available again.` : undefined}
        confirmLabel="Release"
        audited
      />
    </div>
  );
}
