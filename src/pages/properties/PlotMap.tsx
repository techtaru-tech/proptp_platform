import { moneyFactor, moneyUnit } from '../../utils/format';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Copy, ExternalLink, Eye, Globe, Lock, Map as MapIcon, Pencil, RotateCw, Share2, Timer, Upload, X } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { Toggle } from '../../components/ui/Toggle';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { PlotMapView, type ViewPlot } from '../../components/plotmap/PlotMapView';
import { PlotMapEditor, type EditorShape } from '../../components/plotmap/PlotMapEditor';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { cn } from '../../utils/cn';
import { formatCurrency, formatDateTime, formatFullCurrency } from '../../utils/format';
import type { PlotMapMeta, PlotMapPlot, PlotMapStatus } from '../../types';
import {
  PLOT_STAGES,
  PLOT_STATUS_COLOR,
  PLOT_STATUS_LABEL,
  PLOT_STATUS_ORDER,
  PLOT_UNLINKED_COLOR,
  getPlotMap,
  setPlotMapSharing,
  setPlotMapStatus,
  uploadPlotMapLayout,
} from '../../services/plotMapService';
import { createPlotHold, getActiveHoldForUnit, releasePlotHold } from '../../services/plotHoldService';

interface Filters {
  statuses: PlotMapStatus[];
  sizeMin: string;
  sizeMax: string;
  priceMin: string;
  priceMax: string;
  facing: string;
  road: string;
  cornerOnly: boolean;
}

const NO_FILTERS: Filters = { statuses: [], sizeMin: '', sizeMax: '', priceMin: '', priceMax: '', facing: 'all', road: 'all', cornerOnly: false };

const HOLD_OPTIONS = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '15', label: '15 days' },
];

/** `''` means "no bound" — a blank box must not be read as zero and hide every plot. */
const num = (v: string): number | null => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));

function matches(plot: PlotMapPlot, f: Filters): boolean {
  if (!plot.status) return false;
  if (f.statuses.length && !f.statuses.includes(plot.status)) return false;

  const sizeMin = num(f.sizeMin);
  const sizeMax = num(f.sizeMax);
  if (sizeMin !== null && (plot.areaValue ?? 0) < sizeMin) return false;
  if (sizeMax !== null && (plot.areaValue ?? Infinity) > sizeMax) return false;

  // The boxes take lakhs, which is how prices are quoted; the data is in rupees.
  const priceMin = num(f.priceMin);
  const priceMax = num(f.priceMax);
  // The boxes hold lakhs of whatever is being shown: rupees, or points when points are on.
  const shownPrice = plot.price * moneyFactor();
  if (priceMin !== null && shownPrice < priceMin * 100000) return false;
  if (priceMax !== null && shownPrice > priceMax * 100000) return false;

  if (f.facing !== 'all' && plot.facing !== f.facing) return false;
  if (f.road !== 'all' && plot.roadWidth !== f.road) return false;
  if (f.cornerOnly && !plot.isCorner) return false;
  return true;
}

const isFiltering = (f: Filters) =>
  f.statuses.length > 0 || !!f.sizeMin || !!f.sizeMax || !!f.priceMin || !!f.priceMax || f.facing !== 'all' || f.road !== 'all' || f.cornerOnly;

/**
 * The live inventory board for one project.
 *
 * The map holds outlines only. Each plot's colour and the counts above it are derived by the
 * server from the unit and its holds, so a booking taken anywhere in the CRM shows up here on
 * the next read — nobody updates the map, and the map cannot disagree with the property list.
 */
export function PlotMap() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session } = useAuth();

  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<'board' | 'edit'>('board');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const bundle = useAsync(() => getPlotMap(projectId), [projectId, reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  const data = bundle.data;
  const plots = useMemo(() => data?.plots ?? [], [data]);
  const filtering = isFiltering(filters);

  const facings = useMemo(() => [...new Set(plots.map((p) => p.facing).filter((v): v is string => !!v))].sort(), [plots]);
  const roads = useMemo(() => [...new Set(plots.map((p) => p.roadWidth).filter((v): v is string => !!v))].sort(), [plots]);

  const viewPlots: ViewPlot[] = useMemo(
    () =>
      plots.map((plot) => {
        const color = plot.status ? PLOT_STATUS_COLOR[plot.status] : PLOT_UNLINKED_COLOR;
        const status = plot.status ? PLOT_STATUS_LABEL[plot.status] : 'Not linked to a plot';
        return {
          id: plot.shapeId,
          points: plot.points,
          label: plot.label,
          ...color,
          // Dimmed rather than hidden: the matching plots stand out and the layout never reflows.
          dimmed: filtering && !matches(plot, filters),
          description: `${plot.label} — ${status}${plot.area ? `, ${plot.area}` : ''}`,
        };
      }),
    [plots, filters, filtering]
  );

  const matchCount = filtering ? plots.filter((p) => matches(p, filters)).length : plots.length;
  const selected = plots.find((p) => p.shapeId === selectedId) ?? null;

  const run = async (task: () => Promise<unknown>, failureTitle: string) => {
    setIsBusy(true);
    try {
      await task();
      return true;
    } catch (err) {
      toast({ title: failureTitle, description: (err as Error).message, variant: 'error' });
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const uploadLayout = async (file: File | undefined, replacing: boolean) => {
    if (!file) return;
    const ok = await run(() => uploadPlotMapLayout(projectId, file), replacing ? 'Could not replace the layout' : 'Could not upload the layout');
    if (ok) {
      toast({ title: replacing ? 'Layout replaced' : 'Layout uploaded', description: 'Outline the plots, then publish.', variant: 'success' });
      setMode('edit');
      reload();
    }
  };

  const togglePublished = async () => {
    if (!data?.map) return;
    const next = data.map.status === 'live' ? 'draft' : 'live';
    const ok = await run(() => setPlotMapStatus(projectId, next), 'Could not change the map status');
    if (ok) {
      toast({ title: next === 'live' ? 'Map is live' : 'Map taken offline', variant: 'success' });
      reload();
    }
  };

  if (bundle.isLoading && !data) return <CardSkeleton />;
  if (bundle.error) return <ErrorState description={bundle.error.message} onRetry={reload} />;
  if (!data) return null;

  const { project, map, counts } = data;

  // ---------------------------------------------------------------------------
  // No layout yet
  // ---------------------------------------------------------------------------
  if (!map) {
    return (
      <div>
        <PageHeader
          title={`${project.projectName} — Plot Map`}
          description={project.projectLocation}
          breadcrumb={[{ label: 'Plot Map', to: '/properties/map' }, { label: project.projectName }]}
        />
        <Card padded={false}>
          <EmptyState
            icon={MapIcon}
            title="Upload this project's layout"
            description="Add the layout as an image, outline each plot on it, and the same drawing becomes a live inventory board."
            action={
              <>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void uploadLayout(e.target.files?.[0], false); e.target.value = ''; }} />
                <Button leftIcon={<Upload size={15} />} onClick={() => fileRef.current?.click()} isLoading={isBusy}>
                  Upload layout image
                </Button>
                <p className="text-xs text-ink-faint">PNG or JPG. {data.unmappedUnits.length} plots are waiting to be placed on it.</p>
              </>
            }
          />
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------------
  const editorShapes: EditorShape[] = plots.map((p) => ({
    key: p.shapeId,
    unitId: p.unitId,
    // A linked outline is named by its plot, so only an unlinked one carries a label of its own.
    label: p.unitId ? '' : p.label,
    points: p.points,
    source: p.source,
    confirmed: p.confirmed,
  }));
  const editorUnits = [
    ...data.unmappedUnits,
    ...plots.filter((p) => p.unitId).map((p) => ({ id: p.unitId!, propertyNumber: p.plotNumber ?? '', area: p.area ?? '' })),
  ];

  const header = (
    <PageHeader
      title={`${project.projectName} — Plot Map`}
      description={
        mode === 'edit'
          ? 'Outline each plot on the layout and link it to its record.'
          : `${project.projectLocation} · live from the CRM — no separate updating.`
      }
      breadcrumb={[{ label: 'Plot Map', to: '/properties/map' }, { label: project.projectName }]}
      actions={
        <>
          <Badge tone={map.status === 'live' ? 'success' : 'neutral'} dot>
            {map.status === 'live' ? 'Live' : 'Draft'}
          </Badge>
          <div className="flex overflow-hidden rounded-lg border border-line bg-white" role="group" aria-label="Map mode">
            {(
              [
                ['board', 'Board', Eye],
                ['edit', 'Edit map', Pencil],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium focus-ring', mode === id ? 'bg-brand-600 text-white' : 'text-ink-muted hover:bg-surface-subtle')}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <Button variant="outline" leftIcon={<Share2 size={14} />} onClick={() => setIsShareOpen(true)}>
            Share
          </Button>
          <Button variant={map.status === 'live' ? 'outline' : 'primary'} onClick={togglePublished} isLoading={isBusy}>
            {map.status === 'live' ? 'Take offline' : 'Publish'}
          </Button>
        </>
      }
    />
  );

  if (mode === 'edit') {
    return (
      <div>
        {header}
        <PlotMapEditor
          key={`${map.id}-${map.version}-${reloadKey}`}
          projectId={projectId}
          imageUrl={map.imageUrl}
          width={map.imageWidth}
          height={map.imageHeight}
          initialShapes={editorShapes}
          units={editorUnits}
          onSaved={reload}
          onReplaceLayout={async (file) => {
            await uploadPlotMapLayout(projectId, file);
            toast({ title: 'Layout replaced', description: 'Check that the outlines still fit, then publish again.', variant: 'success' });
            reload();
          }}
        />
        <ShareModal isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} projectId={projectId} map={map} onChanged={reload} />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Board
  // ---------------------------------------------------------------------------
  const toggleStatus = (status: PlotMapStatus) =>
    setFilters((f) => ({ ...f, statuses: f.statuses.includes(status) ? f.statuses.filter((s) => s !== status) : [...f.statuses, status] }));

  return (
    <div>
      {header}

      {map.status === 'draft' && (
        <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-warning-100 bg-warning-50 px-4 py-2.5 text-sm text-warning-700">
          <Lock size={15} className="shrink-0" />
          <p>This map is a draft. Only you can see it until it is published.</p>
        </div>
      )}

      {counts && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLOT_STATUS_ORDER.map((status) => {
            const active = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                onClick={() => toggleStatus(status)}
                className={cn(
                  'flex items-center gap-3.5 rounded-xl border bg-white p-4 text-left shadow-card transition-shadow hover:shadow-popover focus-ring',
                  active ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line'
                )}
              >
                <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: PLOT_STATUS_COLOR[status].fill }} />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-ink-muted">{PLOT_STATUS_LABEL[status]}</span>
                  <span className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-ink">{counts[status]}</span>
                    <span className="truncate text-xs text-ink-faint">{formatCurrency(counts.value[status])}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted" aria-label="Plots by stage">
        <span className="font-medium text-ink">By stage:</span>
        {PLOT_STAGES.map((s) => <span key={s.key}>{s.label} <strong className="tabular-nums text-ink">{counts?.stages?.[s.key] ?? 0}</strong></span>)}
      </p>

      <Card padded={false} className="mb-5">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <RangeBox label="Size (sq ft)" min={filters.sizeMin} max={filters.sizeMax} onMin={(v) => setFilters((f) => ({ ...f, sizeMin: v }))} onMax={(v) => setFilters((f) => ({ ...f, sizeMax: v }))} />
          <RangeBox label={moneyUnit() === '₹' ? 'Price (₹ lakh)' : 'Price (lakh points)'} min={filters.priceMin} max={filters.priceMax} onMin={(v) => setFilters((f) => ({ ...f, priceMin: v }))} onMax={(v) => setFilters((f) => ({ ...f, priceMax: v }))} />
          <Select
            label="Facing"
            name="plotFacing"
            value={filters.facing}
            onChange={(e) => setFilters((f) => ({ ...f, facing: e.target.value }))}
            options={[{ value: 'all', label: 'Any' }, ...facings.map((v) => ({ value: v, label: v }))]}
            wrapperClassName="w-36"
          />
          <Select
            label="Road width"
            name="plotRoadWidth"
            value={filters.road}
            onChange={(e) => setFilters((f) => ({ ...f, road: e.target.value }))}
            options={[{ value: 'all', label: 'Any' }, ...roads.map((v) => ({ value: v, label: v }))]}
            wrapperClassName="w-36"
          />
          <label className="flex h-9 items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={filters.cornerOnly} onChange={(e) => setFilters((f) => ({ ...f, cornerOnly: e.target.checked }))} className="h-4 w-4 rounded border-line-strong accent-brand-600" />
            Corner plots only
          </label>
          <label className="flex h-9 items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="h-4 w-4 rounded border-line-strong accent-brand-600" />
            Plot numbers
          </label>
          {filtering && (
            <Button variant="ghost" size="sm" leftIcon={<X size={13} />} onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </Button>
          )}
          <p className="ml-auto text-sm text-ink-muted" aria-live="polite">
            {filtering ? `${matchCount} of ${plots.length} plots match` : `${plots.length} plots`}
          </p>
        </div>
      </Card>

      {plots.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={MapIcon}
            title="No plots outlined yet"
            description="Switch to Edit map and draw each plot on the layout."
            action={<Button onClick={() => setMode('edit')}>Edit map</Button>}
          />
        </Card>
      ) : (
        <PlotMapView imageUrl={map.imageUrl} width={map.imageWidth} height={map.imageHeight} plots={viewPlots} selectedId={selectedId} onSelect={setSelectedId} showLabels={showLabels} />
      )}

      <PlotDrawer
        plot={selected}
        onClose={() => setSelectedId(null)}
        userId={session?.id}
        onChanged={() => {
          reload();
        }}
        onNavigate={(path) => navigate(path)}
      />

      <ShareModal isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} projectId={projectId} map={map} onChanged={reload} />
    </div>
  );
}

function RangeBox({ label, min, max, onMin, onMax }: { label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input aria-label={`${label} minimum`} type="number" inputMode="numeric" min={0} placeholder="Min" value={min} onChange={(e) => onMin(e.target.value)} wrapperClassName="w-24" />
        <span className="text-ink-faint">–</span>
        <Input aria-label={`${label} maximum`} type="number" inputMode="numeric" min={0} placeholder="Max" value={max} onChange={(e) => onMax(e.target.value)} wrapperClassName="w-24" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Plot detail
// -----------------------------------------------------------------------------

function PlotDrawer({
  plot,
  onClose,
  userId,
  onChanged,
  onNavigate,
}: {
  plot: PlotMapPlot | null;
  onClose: () => void;
  userId?: string;
  onChanged: () => void;
  onNavigate: (path: string) => void;
}) {
  const { toast } = useToast();
  const [days, setDays] = useState('3');
  const [isBusy, setIsBusy] = useState(false);

  const act = async (task: () => Promise<unknown>, success: string, failure: string) => {
    setIsBusy(true);
    try {
      await task();
      toast({ title: success, variant: 'success' });
      onChanged();
    } catch (err) {
      toast({ title: failure, description: (err as Error).message, variant: 'error' });
    } finally {
      setIsBusy(false);
    }
  };

  const placeHold = () => {
    if (!plot?.unitId || !userId) return;
    const start = new Date();
    const end = new Date(start.getTime() + Number(days) * 86400000);
    return act(
      () => createPlotHold(plot.unitId!, { userId, holdStart: start.toISOString(), holdEnd: end.toISOString() }),
      `${plot.label} held for ${days} day${days === '1' ? '' : 's'}`,
      'Could not place the hold'
    );
  };

  const releaseHold = () => {
    if (!plot?.unitId) return;
    return act(
      async () => {
        const hold = await getActiveHoldForUnit(plot.unitId!);
        if (!hold) throw new Error('This plot no longer has an active hold.');
        await releasePlotHold(hold.id);
      },
      `${plot.label} released`,
      'Could not release the hold'
    );
  };

  const status = plot?.status ?? null;
  const color = status ? PLOT_STATUS_COLOR[status] : PLOT_UNLINKED_COLOR;

  return (
    <Drawer isOpen={!!plot} onClose={onClose} title={plot ? `Plot ${plot.label}` : undefined} width="sm">
      {plot && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2.5">
            <span className="h-3 w-3 rounded-full" style={{ background: color.fill }} />
            <span className="text-sm font-medium text-ink">{status ? PLOT_STATUS_LABEL[status] : 'Not linked to a plot'}</span>
            {plot.holdUntil && <span className="text-xs text-ink-muted">until {formatDateTime(plot.holdUntil)}</span>}
          </div>
          {plot.stage && (
            <ol aria-label="Plot stage" className="flex items-center gap-1 text-[11px]">
              {PLOT_STAGES.map((s, i) => {
                const reached = PLOT_STAGES.findIndex((x) => x.key === plot.stage) >= i;
                return (
                  <li key={s.key} aria-current={s.key === plot.stage ? 'step' : undefined} className={cn('flex-1 rounded px-1 py-1 text-center', s.key === plot.stage ? 'bg-brand-600 font-semibold text-white' : reached ? 'bg-brand-50 text-brand-700' : 'bg-surface-muted text-ink-faint')}>
                    {s.label}
                  </li>
                );
              })}
            </ol>
          )}

          {plot.unitId ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <Detail label="Size" value={plot.area} />
              <Detail label="Price" value={plot.price ? formatFullCurrency(plot.price) : null} />
              <Detail label="Facing" value={plot.facing} />
              <Detail label="Road width" value={plot.roadWidth} />
              <Detail label="Corner plot" value={plot.isCorner ? 'Yes' : 'No'} />
              <Detail label="Plot number" value={plot.plotNumber} />
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">This outline is not linked to a plot yet. Open Edit map to link it.</p>
          )}

          {status === 'available' && (
            <section className="rounded-xl border border-line bg-surface-subtle p-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Timer size={14} /> Hold this plot
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">Blocks it from being sold. It is released automatically if no booking follows.</p>
              <div className="mt-3 flex items-end gap-2">
                <Select aria-label="Hold period" value={days} onChange={(e) => setDays(e.target.value)} options={HOLD_OPTIONS} wrapperClassName="w-32" />
                <Button onClick={placeHold} isLoading={isBusy} disabled={!userId}>
                  Place hold
                </Button>
              </div>
            </section>
          )}

          {status === 'onHold' && (
            <Button variant="outline" onClick={releaseHold} isLoading={isBusy}>
              Release hold now
            </Button>
          )}

          {(status === 'booked' || status === 'soldOut') && (
            <p className="text-sm text-ink-muted">
              This plot has a booking.{' '}
              <button type="button" className="font-medium text-brand-600 hover:underline focus-ring rounded" onClick={() => onNavigate('/bookings')}>
                See bookings
              </button>
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value || '—'}</dd>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sharing
// -----------------------------------------------------------------------------

function ShareModal({
  isOpen,
  onClose,
  projectId,
  map,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  map: PlotMapMeta | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [isBusy, setIsBusy] = useState(false);
  if (!map) return null;

  const link = map.publicToken ? `${window.location.origin}/m/${map.publicToken}` : '';

  const update = async (input: { enabled: boolean; rotate?: boolean }, success: string) => {
    setIsBusy(true);
    try {
      await setPlotMapSharing(projectId, input);
      toast({ title: success, variant: 'success' });
      onChanged();
    } catch (err) {
      toast({ title: 'Could not update sharing', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: 'Link copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy', description: 'Select the link and copy it by hand.', variant: 'warning' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share with customers" description="A read-only map showing which plots are open — no prices, no buyers.">
      <div className="flex flex-col gap-5">
        <Toggle
          checked={map.publicEnabled}
          onChange={(enabled) => update({ enabled }, enabled ? 'Sharing turned on' : 'Sharing turned off')}
          label="Anyone with the link can view"
          description="Turn off to stop it working for everyone at once."
          disabled={isBusy}
        />

        {map.publicEnabled && link && (
          <>
            <div className="flex items-end gap-2">
              <Input label="Customer link" name="plotMapLink" readOnly value={link} wrapperClassName="flex-1" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" leftIcon={<Copy size={14} />} onClick={copy}>
                Copy
              </Button>
            </div>

            {map.status !== 'live' && (
              <p className="flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2.5 text-sm text-warning-700">
                <Lock size={14} className="mt-0.5 shrink-0" />
                The map is still a draft, so this link shows nothing until you publish it.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <Link to={`/m/${map.publicToken}`} target="_blank" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline focus-ring rounded">
                <ExternalLink size={14} /> Preview as a customer
              </Link>
              <Button variant="ghost" size="sm" leftIcon={<RotateCw size={13} />} onClick={() => update({ enabled: true, rotate: true }, 'New link created')} disabled={isBusy}>
                Create a new link
              </Button>
            </div>
            <p className="-mt-2 text-xs text-ink-faint">A new link stops every link already sent from working.</p>
          </>
        )}

        {!map.publicEnabled && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Globe size={14} /> Sharing is off. Nobody outside the panel can open this map.
          </p>
        )}
      </div>
    </Modal>
  );
}
