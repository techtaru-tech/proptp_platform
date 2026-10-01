import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Map as MapIcon } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { fileUrl } from '../../services/apiClient';
import { listProjects } from '../../services/projectService';
import { getPlotMap } from '../../services/plotMapService';
import type { PlotMapBundle, Project } from '../../types';

interface Row {
  project: Project;
  map: PlotMapBundle['map'];
  counts: PlotMapBundle['counts'];
}

/**
 * Where the plot map starts: every project, with whether it has a layout and how much of it is
 * left to sell. The counts come from the same derivation as the map itself, so what a manager
 * reads here is what they will see on opening it.
 */
export function PlotMapSelect() {
  const [search, setSearch] = useState('');

  const rows = useAsync<Row[]>(async () => {
    const { items } = await listProjects({ pageSize: 100 });
    // One read per project, in parallel. A project whose map cannot be read still lists —
    // it just shows as having no layout, rather than blanking the whole page.
    return Promise.all(
      items.map(async (project) => {
        const bundle = await getPlotMap(project.id).catch(() => null);
        return { project, map: bundle?.map ?? null, counts: bundle?.counts ?? null };
      })
    );
  }, []);

  const filtered = useMemo(
    () => (rows.data ?? []).filter((r) => r.project.projectName.toLowerCase().includes(search.trim().toLowerCase())),
    [rows.data, search]
  );

  return (
    <div>
      <PageHeader
        title="Plot Map"
        description="Each project's layout as a live inventory board."
        breadcrumb={[{ label: 'Properties', to: '/properties' }, { label: 'Plot Map' }]}
      />

      <div className="mb-5 max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects..." />
      </div>

      {rows.error ? (
        <ErrorState description={rows.error.message} />
      ) : rows.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={MapIcon} title="No projects found" description={search ? 'Nothing matches that search.' : 'Add a project first.'} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(({ project, map, counts }) => (
            <Link
              key={project.id}
              to={`/properties/map/${project.id}`}
              className="group overflow-hidden rounded-xl border border-line bg-white shadow-card transition-shadow hover:shadow-popover focus-ring"
            >
              <div className="relative h-32 bg-surface-muted">
                {map ? (
                  // Contained, not cropped: a preview that cuts off half the plots misrepresents the layout.
                  <img src={fileUrl(map.imageUrl)} alt="" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-ink-faint">
                    <MapIcon size={26} />
                  </div>
                )}
                <div className="absolute right-2.5 top-2.5">
                  {map ? (
                    <Badge tone={map.status === 'live' ? 'success' : 'neutral'} dot>
                      {map.status === 'live' ? 'Live' : 'Draft'}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">No layout</Badge>
                  )}
                </div>
              </div>

              <div className="p-4">
                <p className="truncate text-sm font-semibold text-ink">{project.projectName}</p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">{project.projectLocation}</p>

                {counts && counts.total > 0 ? (
                  <p className="mt-3 text-xs text-ink-muted">
                    <span className="font-semibold text-success-700">{counts.available} available</span> · {counts.onHold} held · {counts.booked} booked · {counts.soldOut} sold
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-ink-faint">{map ? 'No plots outlined yet' : 'Upload a layout to begin'}</p>
                )}

                <p className="mt-3 flex items-center gap-1 text-xs font-medium text-brand-600">
                  Open map <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
