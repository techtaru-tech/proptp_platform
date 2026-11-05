import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  /**
   * Takes the layout's own yellow fill out, so a drawing that already colours its plots (yellow for
   * sold, say) does not tint the status — every available plot reads the same green — while the
   * printed sizes stay readable. The original-layout view keeps the drawing as uploaded.
   */
  evenFill?: boolean;
  className?: string;
}

/**
 * The layout with its own yellow fill taken out. A drawing that already paints sold plots yellow
 * would tint a status colour laid over it; here every yellow pixel becomes neutral grey (its
 * brightness kept) so the printed sizes and lines stay readable and a status colour reads the same
 * on every plot. Returns the original address until the new one is ready, or if the browser will not
 * let the image be read.
 */
function useNeutralLayout(src: string, enabled: boolean): string {
  const [neutral, setNeutral] = useState<{ src: string; url: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const lum = Math.min(r, g);
          // Yellow: red and green high together, blue well under them.
          if (lum > 90 && b < lum - 40 && Math.abs(r - g) < 70) {
            px[i] = lum;
            px[i + 1] = lum;
            px[i + 2] = lum;
          }
        }
        ctx.putImageData(data, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob || cancelled) return;
          setNeutral({ src, url: URL.createObjectURL(blob) });
        }, 'image/png');
      } catch {
        /* the image cannot be read here; the plain layout stays */
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, enabled]);

  useEffect(() => () => { if (neutral) URL.revokeObjectURL(neutral.url); }, [neutral]);
  return enabled && neutral?.src === src ? neutral.url : src;
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
export function PlotMapView({ imageUrl, width, height, plots, selectedId, onSelect, showLabels = true, evenFill = false, className }: PlotMapViewProps) {
  const [zoom, setZoom] = useState(1);
  const frameRef = useRef<HTMLDivElement>(null);
  const baseSrc = useNeutralLayout(fileUrl(imageUrl) ?? imageUrl, evenFill);

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
          <image href={baseSrc} width={width} height={height} />

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

      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card">
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
