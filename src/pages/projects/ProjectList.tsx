import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, MapPin, Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Card } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listProjects, cityOptions, getProjectUnitCounts, type ProjectListParams } from '../../services/projectService';
import { formatDate } from '../../utils/format';
import type { Project, ProjectStatus } from '../../types';
import { fileUrl } from '../../services/apiClient';

const STATUS_OPTIONS: { value: ProjectStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 1, label: 'Active' },
  { value: 0, label: 'Deactive' },
];

type ViewMode = 'grid' | 'list';

export function ProjectList() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('list');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all');
  const [city, setCity] = useState('all');
  const [sortBy, setSortBy] = useState('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [reloadKey, setReloadKey] = useState(0);
  const debouncedSearch = useDebounce(search, 300);
  const cities = useMemo(() => cityOptions(), []);

  const params: ProjectListParams = {
    page,
    pageSize: 10,
    search: debouncedSearch,
    status,
    city,
    sortBy,
    sortDir,
  };

  const { data, isLoading, error } = useAsync(() => listProjects(params), [JSON.stringify(params), reloadKey]);
  const refetch = () => setReloadKey((k) => k + 1);

  const hasActiveFilters = search !== '' || status !== 'all' || city !== 'all';

  const resetFilters = () => {
    setSearch('');
    setStatus('all');
    setCity('all');
    setPage(1);
  };

  const handleSortChange = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  const columns: DataTableColumn<Project>[] = [
    {
      key: 'projectName',
      header: 'Project',
      sortable: true,
      render: (p) => (
        <div className="flex items-center gap-3">
          <img
            src={fileUrl(p.thumbnail ?? p.banner) ?? 'https://placehold.co/140x100/652251/ffffff?text=Project'}
            alt={p.projectName}
            className="h-10 w-14 shrink-0 rounded-md object-cover"
          />
          <span className="font-medium text-ink">{p.projectName}</span>
        </div>
      ),
    },
    { key: 'projectLocation', header: 'Location', render: (p) => <span className="text-ink-muted">{p.projectLocation}</span> },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge kind="project" status={p.status} /> },
    { key: 'totalUnits', header: 'Total Units', align: 'right', render: (p) => getProjectUnitCounts(p).total },
    { key: 'availableUnits', header: 'Available', align: 'right', render: (p) => getProjectUnitCounts(p).available },
    { key: 'bookedUnits', header: 'Booked', align: 'right', render: (p) => getProjectUnitCounts(p).booked },
    { key: 'soldOutUnits', header: 'Sold Out', align: 'right', render: (p) => getProjectUnitCounts(p).soldOut },
    { key: 'createdAt', header: 'Created', render: (p) => formatDate(p.createdAt) },
    { key: 'updatedAt', header: 'Updated', sortable: true, render: (p) => formatDate(p.updatedAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (p) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/projects/${p.id}`);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Manage property listings, inventory and project details."
        actions={
          <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => navigate('/projects/new')}>
            Add Project
          </Button>
        }
      />

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          searchPlaceholder="Search by name, location or city..."
          onReset={resetFilters}
          hasActiveFilters={hasActiveFilters}
          actions={
            <div className="flex items-center gap-1 rounded-lg border border-line-strong bg-white p-0.5">
              <button
                type="button"
                aria-label="List view"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-ring ${
                  view === 'list' ? 'bg-shell-800 text-white' : 'text-ink-faint hover:text-ink'
                }`}
              >
                <List size={14} />
              </button>
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-ring ${
                  view === 'grid' ? 'bg-shell-800 text-white' : 'text-ink-faint hover:text-ink'
                }`}
              >
                <LayoutGrid size={14} />
              </button>
            </div>
          }
        >
          <Select
            value={String(status)}
            onChange={(e) => {
              setStatus(e.target.value === 'all' ? 'all' : (Number(e.target.value) as ProjectStatus));
              setPage(1);
            }}
            options={STATUS_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            wrapperClassName="w-40"
            aria-label="Status filter"
          />
          <Select
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setPage(1);
            }}
            options={[{ value: 'all', label: 'All Cities' }, ...cities.map((c) => ({ value: c, label: c }))]}
            wrapperClassName="w-40"
            aria-label="City filter"
          />
        </FilterBar>

        {view === 'list' ? (
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(p) => p.id}
            isLoading={isLoading}
            error={error}
            onRetry={refetch}
            onRowClick={(p) => navigate(`/projects/${p.id}`)}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={handleSortChange}
            emptyTitle="No projects found"
            emptyDescription="Try adjusting your search or filters."
          />
        ) : (
          <div className="p-4">
            {isLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : error ? (
              <ErrorState onRetry={refetch} />
            ) : (data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No projects found" description="Try adjusting your search or filters." />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data!.items.map((p) => (
                  <ProjectCard key={p.id} project={p} onClick={() => navigate(`/projects/${p.id}`)} />
                ))}
              </div>
            )}
          </div>
        )}

        {data && data.total > 0 && <Pagination page={page} pageSize={10} total={data.total} onPageChange={setPage} />}
      </Card>
    </div>
  );
}

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const counts = getProjectUnitCounts(project);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-white text-left shadow-card transition-shadow hover:shadow-popover focus-ring"
    >
      <div className="relative h-32 w-full">
        <img
          src={fileUrl(project.thumbnail ?? project.banner) ?? 'https://placehold.co/400x300/652251/ffffff?text=Project'}
          alt={project.projectName}
          className="h-full w-full object-cover"
        />
        <div className="absolute right-2 top-2">
          <StatusBadge kind="project" status={project.status} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div>
          <p className="text-sm font-semibold text-ink line-clamp-1">{project.projectName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
            <MapPin size={12} className="shrink-0" />
            <span className="line-clamp-1">{project.projectLocation}</span>
          </p>
        </div>
        <div className="mt-auto grid grid-cols-4 gap-1.5 border-t border-line pt-2.5 text-center">
          <div>
            <p className="text-sm font-semibold text-ink">{counts.total}</p>
            <p className="text-[10px] uppercase tracking-wide text-ink-faint">Total</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-success-700">{counts.available}</p>
            <p className="text-[10px] uppercase tracking-wide text-ink-faint">Avail.</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-info-700">{counts.booked}</p>
            <p className="text-[10px] uppercase tracking-wide text-ink-faint">Booked</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-shell-700">{counts.soldOut}</p>
            <p className="text-[10px] uppercase tracking-wide text-ink-faint">Sold Out</p>
          </div>
        </div>
      </div>
    </button>
  );
}
