import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Building2, Edit2, HardHat, ImageIcon, ClipboardList, History, LayoutGrid, MapPin, Plus, Search } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { StatCard } from '../../components/ui/StatCard';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { Modal } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { SearchInput } from '../../components/ui/SearchInput';
import { Select } from '../../components/ui/Select';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import {
  ProjectBasicInfoFields,
  ProjectMediaFields,
  ProjectMetadataFields,
  ProjectCertificateFields,
  defaultProjectFormValues,
  projectToFormValues,
  validateProjectForm,
  type ProjectFormValues,
} from './ProjectForm';
import { useAsync } from '../../hooks/useAsync';
import { ConstructionTab } from './ConstructionTab';
import { useToast } from '../../context/ToastContext';
import { getProject, getProjectDetail, listProjectUnits, updateProject } from '../../services/projectService';
import { amenityNamesForIds, userDisplayName } from '../../data/referenceData';
import type { BookingRow } from '../../types';
import { formatCurrency, formatDate } from '../../utils/format';
import type { PropertyUnit, UnitBookingStatus } from '../../types';
import { fileUrl } from '../../services/apiClient';

const UNIT_STATUS_OPTIONS: { value: UnitBookingStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 0, label: 'Available' },
  { value: 1, label: 'Booked' },
  { value: 2, label: 'Sold Out' },
];

const UNIT_STATUS_TINT: Record<UnitBookingStatus, string> = {
  0: 'border-success-200 bg-success-50 text-success-700',
  1: 'border-info-200 bg-info-50 text-info-700',
  2: 'border-shell-200 bg-shell-50 text-shell-700',
};

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editValues, setEditValues] = useState<ProjectFormValues>(defaultProjectFormValues());
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<PropertyUnit | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);

  // The project, its plots, every booking against it, its amenity names, the plot tallies
  // and its audit trail all arrive in one request.
  const { data: detail, isLoading, error } = useAsync(() => getProjectDetail(id ?? ''), [id, reloadKey]);

  const project = detail?.project;
  const bookings = detail?.bookings ?? [];
  const auditEntries = detail?.audit ?? [];
  const unitCounts = detail?.counts ?? { total: 0, available: 0, booked: 0, soldOut: 0 };

  const openEdit = () => {
    if (!project) return;
    setEditValues(projectToFormValues(project));
    setEditErrors({});
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    const errors = validateProjectForm(editValues);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0 || !project) return;
    setSaving(true);
    try {
      await updateProject(project.id, {
        projectName: editValues.projectName,
        projectType: editValues.projectType || undefined,
        projectLocation: editValues.projectLocation,
        landArea: editValues.landArea,
        projectPrice: editValues.projectPrice || undefined,
        projectDescription: editValues.projectDescription,
        status: editValues.status,
        sortOrder: editValues.sortOrder,
        // Sent as-is, empty included: a removed image has to clear the stored value.
        banner: editValues.banner,
        thumbnail: editValues.thumbnail,
        map: editValues.map,
        googleLocation: editValues.googleLocation,
        distanceMap: editValues.distanceMap,
        d3ViewLink: editValues.d3ViewLink || undefined,
        d3WalkthroughLink: editValues.d3WalkthroughLink || undefined,
        amenityIds: editValues.amenityIds,
        jdaCertificates: editValues.jdaCertificates,
        reraCertificates: editValues.reraCertificates,
        constructionPhotographs: editValues.constructionPhotographs,
      });
      toast({ title: 'Project updated', description: `${editValues.projectName} has been updated.`, variant: 'success' });
      setEditOpen(false);
      setReloadKey((k) => k + 1);
    } finally {
      setSaving(false);
    }
  };

  const timelineEntries: TimelineEntry[] = auditEntries.map((entry) => ({
    id: entry.id,
    title: `${entry.action} — ${entry.userName}`,
    description: entry.description,
    timestamp: entry.timestamp,
    tone: 'info',
  }));

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Project Details" breadcrumb={[{ label: 'Projects', to: '/projects' }, { label: id ?? '' }]} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CardSkeleton className="lg:col-span-2" />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div>
        <PageHeader title="Project Details" breadcrumb={[{ label: 'Projects', to: '/projects' }, { label: id ?? '' }]} />
        <Card>
          {error ? (
            <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <EmptyState
              title="Project not found"
              description="This project does not exist or may have been removed."
              action={
                <Button variant="outline" onClick={() => navigate('/projects')}>
                  Back to Projects
                </Button>
              }
            />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: 'Projects', to: '/projects' }, { label: project.projectName }]}
        title={project.projectName}
        description={
          <span className="flex items-center gap-1.5">
            <MapPin size={13} /> {project.projectLocation}
          </span>
        }
        actions={
          <>
            <StatusBadge kind="project" status={project.status} />
            <Button variant="outline" leftIcon={<Edit2 size={14} />} onClick={openEdit}>
              Edit
            </Button>
          </>
        }
      />

      <Card padded={false} className="mb-6 overflow-hidden">
        <img
          src={fileUrl(project.banner) ?? 'https://placehold.co/1200x480/652251/ffffff?text=Project'}
          alt={project.projectName}
          className="h-48 w-full object-cover sm:h-64"
        />
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Units" value={unitCounts.total} tone="shell" icon={Building2} />
        <StatCard label="Available" value={unitCounts.available} tone="success" />
        <StatCard label="Booked" value={unitCounts.booked} tone="info" />
        <StatCard label="Sold Out" value={unitCounts.soldOut} tone="brand" />
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <Tabs
            items={[
              { key: 'overview', label: 'Overview' },
              { key: 'inventory', label: 'Inventory', icon: <LayoutGrid size={14} /> },
              { key: 'construction', label: 'Construction', icon: <HardHat size={14} /> },
              { key: 'media', label: 'Media', icon: <ImageIcon size={14} /> },
              { key: 'bookings', label: 'Bookings', icon: <ClipboardList size={14} />, badge: bookings.length || undefined },
              { key: 'activity', label: 'Activity / Audit', icon: <History size={14} /> },
            ]}
          >
            {(active) => (
              <div className="pb-5">
                {active === 'overview' && <OverviewTab project={project} />}
                {active === 'inventory' && <InventoryTab projectId={project.id} onSelectUnit={setSelectedUnit} />}
                {active === 'construction' && <ConstructionTab projectId={project.id} />}
                {active === 'media' && <MediaTab project={project} onPreview={setMediaPreview} />}
                {active === 'bookings' && <BookingsTab bookings={bookings} />}
                {active === 'activity' && (
                  <>
                    {timelineEntries.length === 0 ? (
                      <p className="text-sm text-ink-muted">No audit history recorded for this project yet.</p>
                    ) : (
                      <Timeline entries={timelineEntries} />
                    )}
                    <div className="mt-4 border-t border-line pt-4 text-xs text-ink-faint">
                      Created {formatDate(project.createdAt)} · Last updated {formatDate(project.updatedAt)}
                    </div>
                  </>
                )}
              </div>
            )}
          </Tabs>
        </div>
      </Card>

      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Project"
        description="Update project information, media and metadata."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveEdit} isLoading={saving}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <ProjectBasicInfoFields values={editValues} errors={editErrors} onChange={(patch) => setEditValues((v) => ({ ...v, ...patch }))} />
          <div className="border-t border-line pt-5">
            <ProjectMediaFields values={editValues} onChange={(patch) => setEditValues((v) => ({ ...v, ...patch }))} />
          </div>
          <div className="border-t border-line pt-5">
            <ProjectMetadataFields values={editValues} onChange={(patch) => setEditValues((v) => ({ ...v, ...patch }))} />
          </div>
          <div className="border-t border-line pt-5">
            <ProjectCertificateFields values={editValues} onChange={(patch) => setEditValues((v) => ({ ...v, ...patch }))} />
          </div>
        </div>
      </Modal>

      <Drawer isOpen={!!selectedUnit} onClose={() => setSelectedUnit(null)} title={selectedUnit ? `Unit ${selectedUnit.propertyNumber}` : undefined}>
        {selectedUnit && (
          <dl className="space-y-3 text-sm">
            <UnitRow label="Status" value={<StatusBadge kind="unit" status={selectedUnit.bookingStatus} />} />
            <UnitRow label="Property Number" value={selectedUnit.propertyNumber} />
            <UnitRow label="Property Type" value={selectedUnit.propertyType} />
            <UnitRow label="Area" value={`${selectedUnit.propertyArea} ${selectedUnit.propertyMeasurement}`} />
            <UnitRow label="Total Deposit Amount" value={formatCurrency(selectedUnit.totalInvestmentAmount)} />
            <UnitRow label="Total Commission" value={formatCurrency(selectedUnit.profit)} />
            <UnitRow label="Per-area Amount" value={formatCurrency(selectedUnit.perAreaAmount)} />
            <UnitRow label="Per-area Profit" value={formatCurrency(selectedUnit.perAreaProfit)} />
            {selectedUnit.bookedBy && <UnitRow label="Booked By" value={userDisplayName(selectedUnit.bookedBy)} />}
            <div className="border-t border-line pt-4">
              <Button variant="outline" leftIcon={<Edit2 size={14} />} onClick={() => navigate('/properties')}>
                Manage in Properties
              </Button>
            </div>
          </dl>
        )}
      </Drawer>

      <Modal isOpen={!!mediaPreview} onClose={() => setMediaPreview(null)} title="Media Preview" size="lg">
        {mediaPreview && <img src={fileUrl(mediaPreview)} alt="Project media" className="w-full rounded-lg" />}
      </Modal>
    </div>
  );
}

function UnitRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-2.5 last:border-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

function OverviewTab({ project }: { project: NonNullable<Awaited<ReturnType<typeof getProject>>> }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Description</p>
        <p className="text-sm leading-relaxed text-ink-muted">{project.projectDescription}</p>

        <p className="mb-1.5 mt-5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Amenities</p>
        <div className="flex flex-wrap gap-2">
          {amenityNamesForIds(project.amenityIds).map((a) => (
            <Badge key={a} tone="shell">
              {a}
            </Badge>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-lg border border-line bg-surface-subtle p-4">
        <UnitRow label="Starting Price" value={project.projectPrice ?? '—'} />
        <UnitRow label="Land Area" value={project.landArea} />
        <UnitRow label="Project Type" value={project.projectType ?? '—'} />
        <UnitRow label="Created" value={formatDate(project.createdAt)} />
        <UnitRow label="Updated" value={formatDate(project.updatedAt)} />
      </div>
    </div>
  );
}

/**
 * Read-only, mirroring the real `admin.prjectView` page — the project detail screen nests a
 * listing of its properties for convenience, but all property CRUD (add/edit/verify/release)
 * happens in the separate, standalone Property module (see src/pages/properties), matching how
 * the real admin has "Project" and "Property" as two independent top-level modules.
 */
function InventoryTab({ projectId, onSelectUnit }: { projectId: string; onSelectUnit: (u: PropertyUnit) => void }) {
  const navigate = useNavigate();
  const [bookingStatus, setBookingStatus] = useState<UnitBookingStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('grid');

  const { data: units, isLoading, error } = useAsync(
    () => listProjectUnits(projectId, { bookingStatus, search }),
    [projectId, bookingStatus, search]
  );

  const columns: DataTableColumn<PropertyUnit>[] = [
    { key: 'propertyNumber', header: 'Unit', render: (u) => <span className="font-medium text-ink">{u.propertyNumber}</span> },
    { key: 'propertyType', header: 'Type', render: (u) => u.propertyType },
    { key: 'propertyArea', header: 'Area', align: 'right', render: (u) => `${u.propertyArea} ${u.propertyMeasurement}` },
    { key: 'totalInvestmentAmount', header: 'Deposit Amount', align: 'right', render: (u) => formatCurrency(u.totalInvestmentAmount) },
    { key: 'bookingStatus', header: 'Status', render: (u) => <StatusBadge kind="unit" status={u.bookingStatus} /> },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Search unit number or type..." className="w-56" />
        <Select
          value={String(bookingStatus)}
          onChange={(e) => setBookingStatus(e.target.value === 'all' ? 'all' : (Number(e.target.value) as UnitBookingStatus))}
          options={UNIT_STATUS_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
          wrapperClassName="w-40"
        />
        <div className="ml-auto flex items-center gap-2.5">
          <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => navigate('/properties/new')}>
            Add Property
          </Button>
          <div className="flex items-center gap-1 rounded-lg border border-line-strong bg-white p-0.5">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === 'grid' ? 'bg-shell-800 text-white' : 'text-ink-faint'}`}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === 'table' ? 'bg-shell-800 text-white' : 'text-ink-faint'}`}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState />
      ) : !units || units.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No units found"
          description="Try adjusting the status filter or search, or add a new property."
          action={
            <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => navigate('/properties/new')}>
              Add Property
            </Button>
          }
        />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
          {units.map((u) => (
            <button
              key={u.id}
              onClick={() => onSelectUnit(u)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-3 text-center transition-transform hover:-translate-y-0.5 focus-ring ${UNIT_STATUS_TINT[u.bookingStatus]}`}
            >
              <span className="text-xs font-semibold">{u.propertyNumber}</span>
              <span className="text-[10px] opacity-80">{u.propertyType}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="-mx-5 border-t border-line">
          <DataTable columns={columns} rows={units} rowKey={(u) => u.id} onRowClick={onSelectUnit} />
        </div>
      )}
    </div>
  );
}

function MediaTab({ project, onPreview }: { project: NonNullable<Awaited<ReturnType<typeof getProject>>>; onPreview: (url: string) => void }) {
  const items = [
    project.banner && { id: 'banner', url: project.banner, caption: 'Banner' },
    project.thumbnail && { id: 'thumbnail', url: project.thumbnail, caption: 'Thumbnail' },
    project.map && { id: 'map', url: project.map, caption: 'Site Map' },
    project.distanceMap && { id: 'distance-map', url: project.distanceMap, caption: 'Distance Map' },
    ...project.jdaCertificates.map((c, i) => ({ id: c.id, url: c.file, caption: `JDA Certificate ${i + 1}` })),
    ...project.reraCertificates.map((c, i) => ({ id: c.id, url: c.file, caption: `RERA Certificate ${i + 1}` })),
    ...project.constructionPhotographs.map((c, i) => ({ id: c.id, url: c.file, caption: `Construction Photo ${i + 1}` })),
  ].filter((item): item is { id: string; url: string; caption: string } => !!item);

  if (items.length === 0) {
    return <EmptyState title="No media" description="No media files have been added to this project." />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <button key={item.id} onClick={() => onPreview(item.url)} className="group overflow-hidden rounded-lg border border-line focus-ring">
          <img src={fileUrl(item.url)} alt={item.caption} className="h-28 w-full object-cover transition-transform group-hover:scale-105" />
          <p className="truncate px-2 py-1.5 text-left text-xs text-ink-muted">{item.caption}</p>
        </button>
      ))}
    </div>
  );
}

function BookingsTab({ bookings }: { bookings: BookingRow[] }) {
  const navigate = useNavigate();
  if (bookings.length === 0) {
    return <EmptyState title="No bookings yet" description="No bookings have been made for this project." />;
  }
  const columns: DataTableColumn<(typeof bookings)[number]>[] = [
    { key: 'id', header: 'Booking ID', render: (b) => <span className="font-medium text-ink">{b.id}</span> },
    { key: 'bookingName', header: 'Customer', render: (b) => b.bookingName },
    { key: 'partner', header: 'Partner', render: (b) => b.partnerName },
    { key: 'amount', header: 'Amount', align: 'right', render: (b) => formatCurrency(b.amount) },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge kind="booking" status={b.status} /> },
    { key: 'date', header: 'Date', render: (b) => formatDate(b.createdAt) },
  ];
  return (
    <div className="-mx-5 border-t border-line">
      <DataTable columns={columns} rows={bookings} rowKey={(b) => b.id} onRowClick={(b) => navigate(`/bookings/${b.id}`)} />
    </div>
  );
}
