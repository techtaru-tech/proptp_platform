import { useRef, useState, type KeyboardEvent } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fileUrl } from '../../services/apiClient';
import type { PlotMapPoint } from '../../types';
import { labelAnchor, labelFontSize, toSvgPoints } from './shapeGeometry';

export interface ViewPlot {
  id: string;
  points: PlotMapPoint[];
  label: string;
  fill: string;
  stroke: string;
  text: string;
  /** The outline behind the label — dark behind light text, light behind dark. */
  halo?: string;
  /** Filtered out — drawn faint so the match set stands out without the map reflowing. */
  dimmed?: boolean;
  /** Spoken and tooltip text, since colour alone must not carry the status. */
  description?: string;
}

interface PlotMapViewProps {
  imageUrl: string;
  width: number;
  height: number;
  plots: ViewPlot[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Off when the layout already prints its own plot numbers and the overlay would double them. */
  showLabels?: boolean;
  className?: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/**
 * The layout with each plot painted over it.
 *
 * Read-only on purpose: the internal board and the customer page both use it, and neither may
 * move a shape. Zoom is just the image getting wider inside a scrollable frame — a layout with
 * hundreds of plots needs it, and it keeps every pointer coordinate in the editor honest.
 */
export function PlotMapView({ imageUrl, width, height, plots, selectedId, onSelect, showLabels = true, className }: PlotMapViewProps) {
  const [zoom, setZoom] = useState(1);
  const frameRef = useRef<HTMLDivElement>(null);

  const step = (delta: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((z + delta).toFixed(2)))));

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(id);
    }
  };

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-line bg-surface-subtle', className)}>
      <div ref={frameRef} className="max-h-[72vh] overflow-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: `${zoom * 100}%` }}
          className="block h-auto select-none"
          role="group"
          aria-label="Plot map"
          onClick={() => onSelect?.(null)}
        >
          <image href={fileUrl(imageUrl)} width={width} height={height} />

          {plots.map((plot) => {
            const selected = plot.id === selectedId;
            const [cx, cy] = labelAnchor(plot.points, width, height);
            const size = labelFontSize(plot.points, plot.label, width, height);
            return (
              <g
                key={plot.id}
                role="button"
                tabIndex={0}
                aria-label={plot.description ?? plot.label}
                aria-pressed={selected}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(plot.id);
                }}
                onKeyDown={(e) => onKey(e, plot.id)}
                className="cursor-pointer outline-none [&:focus-visible>polygon]:stroke-[3]"
                opacity={plot.dimmed ? 0.18 : 1}
              >
                <title>{plot.description ?? plot.label}</title>
                <polygon
                  points={toSvgPoints(plot.points, width, height)}
                  fill={plot.fill}
                  fillOpacity={0.5}
                  stroke={plot.stroke}
                  strokeWidth={selected ? 3.5 : 1.5}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
                {showLabels && !plot.dimmed && (
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={size}
                    fontWeight={700}
                    fill={plot.text}
                    stroke={plot.halo ?? '#fff'}
                    strokeWidth={size * 0.12}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {plot.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-line bg-white shadow-card">
        <button type="button" aria-label="Zoom in" onClick={() => step(0.5)} disabled={zoom >= MAX_ZOOM} className="p-2 text-ink-muted hover:bg-surface-muted disabled:opacity-40 focus-ring">
          <ZoomIn size={16} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => step(-0.5)} disabled={zoom <= MIN_ZOOM} className="border-t border-line p-2 text-ink-muted hover:bg-surface-muted disabled:opacity-40 focus-ring">
          <ZoomOut size={16} />
        </button>
        <button type="button" aria-label="Fit to screen" onClick={() => setZoom(1)} className="border-t border-line p-2 text-ink-muted hover:bg-surface-muted focus-ring">
          <Maximize2 size={16} />
        </button>
      </div>
    </div>
  );
}
