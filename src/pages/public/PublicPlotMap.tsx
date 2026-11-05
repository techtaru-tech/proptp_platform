import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapPinOff, MapPin } from 'lucide-react';
import { PlotMapView, type ViewPlot } from '../../components/plotmap/PlotMapView';
import { Skeleton } from '../../components/ui/LoadingSkeleton';
import { Toggle } from '../../components/ui/Toggle';
import { useAsync } from '../../hooks/useAsync';
import { cn } from '../../utils/cn';
import { getPublicPlotMap } from '../../services/plotMapService';
import proptoLockup from '../../assets/brand/propto-lockup.png';

/** Outside the panel, a plot is open or it is not — held, booked and sold all read the same. */
const OPEN = { fill: '#12b76a', stroke: '#027a48', text: '#05492f', halo: '#ffffff' };
const CLOSED = { fill: '#98a2b3', stroke: '#667085', text: '#344054', halo: '#ffffff' };

/**
 * The map a customer sees from a link on WhatsApp — /m/<token>, outside the admin layout and
 * outside ProtectedRoute, since nobody opening it has an account.
 *
 * It shows where each plot is, how big, which way it faces and whether it can be bought, and
 * nothing else. Price, buyer and hold detail never reach this page: the server does not send
 * them, so there is nothing here to hide.
 */
export function PublicPlotMap() {
  const { token = '' } = useParams<{ token: string }>();
  const [availableOnly, setAvailableOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error } = useAsync(() => getPublicPlotMap(token), [token]);

  // A shared link is not something to index.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  const plots: ViewPlot[] = useMemo(
    () =>
      (data?.plots ?? []).map((p) => ({
        id: p.id,
        points: p.points,
        label: p.label,
        ...(p.available ? OPEN : CLOSED),
        dimmed: availableOnly && !p.available,
        description: `Plot ${p.label} — ${p.available ? 'available' : 'not available'}${p.area ? `, ${p.area}` : ''}`,
      })),
    [data, availableOnly]
  );

  const selected = data?.plots.find((p) => p.id === selectedId) ?? null;

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-surface-subtle">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <img src={proptoLockup} alt="Propto CRM" className="h-10 w-auto" />
          <span className="text-xs text-ink-faint">Plot availability</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );

  if (isLoading) {
    return shell(
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-[55vh] w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return shell(
      <div className="mx-auto mt-10 flex max-w-sm flex-col items-center gap-3 rounded-xl border border-line bg-surface p-8 text-center shadow-card">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-ink-faint">
          <MapPinOff size={22} />
        </span>
        <p className="text-sm font-semibold text-ink">This map is not available</p>
        <p className="text-sm text-ink-muted">The link may have been turned off or replaced. Ask your Propto contact for a fresh one.</p>
      </div>
    );
  }

  return shell(
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{data.project.name}</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-muted">
          <MapPin size={13} />
          {data.project.location}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink">
          <span className="text-lg font-semibold text-success-700">{data.summary.available}</span> of {data.summary.total} plots available
        </p>
        <div className="flex items-center gap-4 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OPEN.fill }} /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CLOSED.fill }} /> Not available
          </span>
        </div>
      </div>

      <Toggle checked={availableOnly} onChange={setAvailableOnly} label="Show available plots only" />

      <PlotMapView imageUrl={data.image.url} width={data.image.width} height={data.image.height} plots={plots} selectedId={selectedId} onSelect={setSelectedId} />

      <section aria-live="polite" className={cn('rounded-xl border bg-surface p-4 shadow-card', selected ? 'border-line' : 'border-dashed border-line-strong')}>
        {selected ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-semibold text-ink">Plot {selected.label}</p>
              <span
                className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', selected.available ? 'bg-success-50 text-success-700' : 'bg-surface-muted text-ink-muted')}
              >
                {selected.available ? 'Available' : 'Not available'}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <Fact label="Size" value={selected.area} />
              <Fact label="Facing" value={selected.facing} />
              <Fact label="Road width" value={selected.roadWidth} />
              <Fact label="Corner plot" value={selected.isCorner ? 'Yes' : 'No'} />
            </dl>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Tap a plot on the map to see its size, facing and whether it is available.</p>
        )}
      </section>

      <p className="text-center text-xs text-ink-faint">Availability is shown as of now and can change. Contact Propto CRM to book a plot.</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value || '—'}</dd>
    </div>
  );
}
