import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, MousePointer2, PenTool, Save, Square, Trash2, Undo2, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { useToast } from '../../context/ToastContext';
import { cn } from '../../utils/cn';
import { fileUrl } from '../../services/apiClient';
import { savePlotMapShapes } from '../../services/plotMapService';
import type { PlotMapPoint, PlotMapUnitOption } from '../../types';
import { clamp01, labelAnchor, labelFontSize, toSvgPoints } from './shapeGeometry';

export interface EditorShape {
  key: string;
  unitId: string | null;
  label: string;
  points: PlotMapPoint[];
  source: 'manual' | 'detected';
  confirmed: boolean;
}

type Tool = 'select' | 'rect' | 'polygon';

interface PlotMapEditorProps {
  projectId: string;
  imageUrl: string;
  width: number;
  height: number;
  initialShapes: EditorShape[];
  /** Every plot in the project, linked or not — the editor needs names for both. */
  units: PlotMapUnitOption[];
  onSaved: () => void;
  onReplaceLayout: (file: File) => Promise<void>;
}

type Drag =
  | { kind: 'move'; key: string; start: PlotMapPoint; original: PlotMapPoint[] }
  | { kind: 'vertex'; key: string; index: number }
  | null;

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;

/** A click closer than this to the first point of a polygon closes it. */
const CLOSE_DISTANCE = 0.012;
/** A drawn rectangle smaller than this is a stray click, not a plot. */
const MIN_RECT = 0.004;
const HISTORY_LIMIT = 60;

const fingerprint = (shapes: EditorShape[]) =>
  JSON.stringify(shapes.map((s) => [s.unitId, s.label, s.points, s.confirmed]));

/**
 * Draw, move, reshape and link plot outlines on the layout.
 *
 * Everything is edited locally and saved as one set, because a canvas edit is rarely one shape:
 * a partial save would leave the map half-moved. Outlines are stored relative to the image, so
 * a revised layout at a different resolution leaves them where they were.
 */
export function PlotMapEditor({ projectId, imageUrl, width, height, initialShapes, units, onSaved, onReplaceLayout }: PlotMapEditorProps) {
  const { toast } = useToast();
  const svgRef = useRef<SVGSVGElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [shapes, setShapes] = useState<EditorShape[]>(initialShapes);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [draftRect, setDraftRect] = useState<{ a: PlotMapPoint; b: PlotMapPoint } | null>(null);
  const [draftPoly, setDraftPoly] = useState<PlotMapPoint[]>([]);
  const [cursor, setCursor] = useState<PlotMapPoint | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [scale, setScale] = useState(1);

  const history = useRef<EditorShape[][]>([]);
  const drag = useRef<Drag>(null);
  // State, not a ref: "is there anything unsaved" and "is there anything to undo" both decide
  // what the buttons say, so a change to either has to re-render.
  const [baseline, setBaseline] = useState(() => fingerprint(initialShapes));
  const [canUndo, setCanUndo] = useState(false);

  const isDirty = fingerprint(shapes) !== baseline;

  // Handles and the rubber-band need a constant on-screen size however wide the image renders.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setScale(svg.getBoundingClientRect().width / width || 1));
    observer.observe(svg);
    return () => observer.disconnect();
  }, [width]);

  // A save-less tab close would throw the work away silently.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const unitInfo = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const usedUnitIds = useMemo(() => new Set(shapes.map((s) => s.unitId).filter((id): id is string => !!id)), [shapes]);
  const selected = shapes.find((s) => s.key === selectedKey) ?? null;
  const linkedCount = shapes.filter((s) => s.unitId).length;
  const unlinked = shapes.filter((s) => !s.unitId);
  const needsReview = shapes.filter((s) => !s.confirmed).length;
  /** Plots with no outline yet — what is left to place, which the progress bar alone cannot name. */
  const toPlace = units
    .filter((u) => !usedUnitIds.has(u.id))
    .sort((a, b) => a.propertyNumber.localeCompare(b.propertyNumber, undefined, { numeric: true }));
  const canLinkFromList = !!selected && !selected.unitId;

  /** Plots still free to link, plus the one this shape already points at. */
  const optionsFor = (shape: EditorShape) =>
    units
      .filter((u) => u.id === shape.unitId || !usedUnitIds.has(u.id))
      .sort((a, b) => a.propertyNumber.localeCompare(b.propertyNumber, undefined, { numeric: true }));

  const pushHistory = useCallback(() => {
    history.current.push(shapes);
    if (history.current.length > HISTORY_LIMIT) history.current.shift();
    setCanUndo(true);
  }, [shapes]);

  const undo = useCallback(() => {
    const previous = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!previous) return;
    setShapes(previous);
    // Undoing a move should leave the outline selected; only one that no longer exists (an
    // undone drawing) has nothing left to select.
    setSelectedKey((current) => (previous.some((s) => s.key === current) ? current : null));
  }, []);

  const toNorm = (e: { clientX: number; clientY: number }): PlotMapPoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height)];
  };

  const addShape = useCallback(
    (points: PlotMapPoint[]) => {
      pushHistory();
      const shape: EditorShape = { key: newKey(), unitId: null, label: '', points, source: 'manual', confirmed: true };
      setShapes((prev) => [...prev, shape]);
      setSelectedKey(shape.key);
      // Straight to the plot picker — linking is the next thing every new outline needs.
      requestAnimationFrame(() => selectRef.current?.focus());
    },
    [pushHistory]
  );

  const finishPolygon = useCallback(() => {
    if (draftPoly.length >= 3) addShape(draftPoly);
    setDraftPoly([]);
    setCursor(null);
  }, [draftPoly, addShape]);

  const removeSelected = useCallback(() => {
    if (!selectedKey) return;
    pushHistory();
    setShapes((prev) => prev.filter((s) => s.key !== selectedKey));
    setSelectedKey(null);
  }, [selectedKey, pushHistory]);

  const patchSelected = (patch: Partial<EditorShape>) => {
    if (!selectedKey) return;
    pushHistory();
    setShapes((prev) => prev.map((s) => (s.key === selectedKey ? { ...s, ...patch } : s)));
  };

  // Keyboard: ignored while typing in a field, so renaming a label never deletes a plot.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'Escape') {
        setDraftPoly([]);
        setDraftRect(null);
        setCursor(null);
        setSelectedKey(null);
      } else if (e.key === 'Enter' && tool === 'polygon') {
        finishPolygon();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && tool === 'polygon' && draftPoly.length) {
        e.preventDefault();
        setDraftPoly((p) => p.slice(0, -1));
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && tool === 'select' && selectedKey) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, draftPoly, selectedKey, undo, finishPolygon, removeSelected]);

  // -------------------------------------------------------------------------
  // Pointer handling — the whole canvas is one SVG, so one set of handlers
  // -------------------------------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toNorm(e);
    if (tool === 'rect') {
      svgRef.current!.setPointerCapture(e.pointerId);
      setDraftRect({ a: p, b: p });
    } else if (tool === 'polygon') {
      const first = draftPoly[0];
      if (first && draftPoly.length >= 3 && Math.hypot(first[0] - p[0], first[1] - p[1]) < CLOSE_DISTANCE) {
        finishPolygon();
      } else {
        setDraftPoly((prev) => [...prev, p]);
      }
    } else {
      setSelectedKey(null);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toNorm(e);
    const active = drag.current;

    if (active?.kind === 'move') {
      const box = active.original;
      const minX = Math.min(...box.map((q) => q[0]));
      const maxX = Math.max(...box.map((q) => q[0]));
      const minY = Math.min(...box.map((q) => q[1]));
      const maxY = Math.max(...box.map((q) => q[1]));
      // Clamp the shift rather than each point, so dragging past the edge stops the shape
      // instead of squashing it against the border.
      const dx = Math.min(1 - maxX, Math.max(-minX, p[0] - active.start[0]));
      const dy = Math.min(1 - maxY, Math.max(-minY, p[1] - active.start[1]));
      setShapes((prev) =>
        prev.map((s) => (s.key === active.key ? { ...s, points: active.original.map(([x, y]) => [x + dx, y + dy] as PlotMapPoint) } : s))
      );
    } else if (active?.kind === 'vertex') {
      setShapes((prev) =>
        prev.map((s) => (s.key === active.key ? { ...s, points: s.points.map((q, i) => (i === active.index ? p : q)) } : s))
      );
    } else if (draftRect) {
      setDraftRect({ ...draftRect, b: p });
    } else if (tool === 'polygon' && draftPoly.length) {
      setCursor(p);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    drag.current = null;

    if (draftRect) {
      const [x0, y0] = draftRect.a;
      const [x1, y1] = draftRect.b;
      if (Math.abs(x1 - x0) > MIN_RECT && Math.abs(y1 - y0) > MIN_RECT) {
        const [l, r] = [Math.min(x0, x1), Math.max(x0, x1)];
        const [t, b] = [Math.min(y0, y1), Math.max(y0, y1)];
        addShape([[l, t], [r, t], [r, b], [l, b]]);
      }
      setDraftRect(null);
    }
  };

  const startMove = (e: ReactPointerEvent<SVGGElement>, shape: EditorShape) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    pushHistory();
    setSelectedKey(shape.key);
    drag.current = { kind: 'move', key: shape.key, start: toNorm(e), original: shape.points };
  };

  const startVertex = (e: ReactPointerEvent<SVGCircleElement>, shape: EditorShape, index: number) => {
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    pushHistory();
    drag.current = { kind: 'vertex', key: shape.key, index };
  };

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  const save = async () => {
    setIsSaving(true);
    try {
      const result = await savePlotMapShapes(
        projectId,
        shapes.map((s) => ({
          unitId: s.unitId,
          points: s.points,
          // A linked shape is named by its plot; storing a label would only go stale.
          label: s.unitId ? null : s.label.trim() || null,
          source: s.source,
          confirmed: s.confirmed,
        }))
      );
      setBaseline(fingerprint(shapes));
      history.current = [];
      setCanUndo(false);
      toast({ title: 'Map saved', description: `${result.saved} outlines, ${result.linked} linked to a plot.`, variant: 'success' });
      onSaved();
    } catch (err) {
      toast({ title: 'Could not save the map', description: (err as Error).message, variant: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const replaceLayout = async (file: File | undefined) => {
    if (!file) return;
    if (isDirty) {
      toast({ title: 'Save your changes first', description: 'Replacing the layout reloads the editor.', variant: 'warning' });
      return;
    }
    try {
      await onReplaceLayout(file);
    } catch (err) {
      toast({ title: 'Could not replace the layout', description: (err as Error).message, variant: 'error' });
    }
  };

  const handleR = 6 / scale;
  const strokeBase = 1.6;

  const tools: { id: Tool; label: string; icon: typeof Square; hint: string }[] = [
    { id: 'select', label: 'Select', icon: MousePointer2, hint: 'Click an outline to edit it. Drag to move; drag a corner to reshape.' },
    { id: 'rect', label: 'Rectangle', icon: Square, hint: 'Drag across a plot to outline it.' },
    { id: 'polygon', label: 'Polygon', icon: PenTool, hint: 'Click each corner. Click the first point or press Enter to close.' },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
      <div className="overflow-hidden rounded-xl border border-line bg-surface-subtle">
        <div className="max-h-[75vh] overflow-auto">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className={cn('block h-auto w-full select-none touch-none', tool === 'select' ? 'cursor-default' : 'cursor-crosshair')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <image href={fileUrl(imageUrl)} width={width} height={height} pointerEvents="none" />

            {shapes.map((shape) => {
              const isSelected = shape.key === selectedKey;
              const linked = !!shape.unitId;
              const text = linked ? (unitInfo.get(shape.unitId!)?.propertyNumber ?? '') : shape.label || '?';
              const [cx, cy] = labelAnchor(shape.points, width, height);
              const size = labelFontSize(shape.points, text, width, height);
              return (
                <g
                  key={shape.key}
                  onPointerDown={(e) => startMove(e, shape)}
                  style={{ pointerEvents: tool === 'select' ? 'auto' : 'none' }}
                  className={tool === 'select' ? 'cursor-move' : ''}
                >
                  <polygon
                    points={toSvgPoints(shape.points, width, height)}
                    fill={linked ? '#2596BE' : '#f79009'}
                    fillOpacity={isSelected ? 0.55 : 0.38}
                    stroke={isSelected ? '#0e7f51' : linked ? '#1d6581' : '#b54708'}
                    strokeWidth={isSelected ? 3.5 : strokeBase}
                    strokeDasharray={linked ? undefined : '6 4'}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={size}
                    fontWeight={700}
                    fill="#101828"
                    stroke="#fff"
                    strokeWidth={size * 0.12}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {text}
                  </text>
                </g>
              );
            })}

            {/* Corner handles — only on the selected outline, and only when selecting. */}
            {tool === 'select' &&
              selected &&
              selected.points.map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x * width}
                  cy={y * height}
                  r={handleR}
                  fill="#fff"
                  stroke="#0e7f51"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-grab"
                  onPointerDown={(e) => startVertex(e, selected, i)}
                />
              ))}

            {draftRect && (
              <rect
                x={Math.min(draftRect.a[0], draftRect.b[0]) * width}
                y={Math.min(draftRect.a[1], draftRect.b[1]) * height}
                width={Math.abs(draftRect.b[0] - draftRect.a[0]) * width}
                height={Math.abs(draftRect.b[1] - draftRect.a[1]) * height}
                fill="#0e7f51"
                fillOpacity={0.2}
                stroke="#0e7f51"
                strokeWidth={2}
                strokeDasharray="5 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}

            {draftPoly.length > 0 && (
              <g pointerEvents="none">
                <polyline
                  points={toSvgPoints(cursor ? [...draftPoly, cursor] : draftPoly, width, height)}
                  fill="none"
                  stroke="#0e7f51"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  vectorEffect="non-scaling-stroke"
                />
                {draftPoly.map(([x, y], i) => (
                  <circle key={i} cx={x * width} cy={y * height} r={i === 0 ? handleR * 1.3 : handleR * 0.8} fill={i === 0 ? '#0e7f51' : '#fff'} stroke="#0e7f51" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            )}
          </svg>
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl border border-line bg-white p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Tools</p>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {tools.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tool === id}
                onClick={() => {
                  setTool(id);
                  setDraftPoly([]);
                  setDraftRect(null);
                }}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-medium focus-ring',
                  tool === id ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted hover:bg-surface-subtle'
                )}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">{tools.find((t) => t.id === tool)?.hint}</p>

          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" leftIcon={<Undo2 size={13} />} onClick={undo} disabled={!canUndo}>
              Undo
            </Button>
            {tool === 'polygon' && draftPoly.length >= 3 && (
              <Button size="sm" variant="outline" onClick={finishPolygon}>
                Close shape
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-white p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Selected outline</p>
          {selected ? (
            <div className="mt-3 flex flex-col gap-3.5">
              <Select
                ref={selectRef}
                label="Plot"
                name="plotUnit"
                value={selected.unitId ?? ''}
                onChange={(e) => patchSelected({ unitId: e.target.value || null })}
                options={[
                  { value: '', label: 'Not linked to a plot' },
                  ...optionsFor(selected).map((u) => ({ value: u.id, label: `${u.propertyNumber} · ${u.area}` })),
                ]}
              />
              {!selected.unitId && (
                <Input
                  label="Label"
                  name="plotLabel"
                  value={selected.label}
                  onChange={(e) => patchSelected({ label: e.target.value })}
                  placeholder="As printed on the layout"
                  hint="Used only until this is linked to a plot."
                />
              )}
              <Button variant="outline" size="sm" leftIcon={<Trash2 size={13} />} onClick={removeSelected}>
                Delete outline
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Select an outline on the map to link it to a plot.</p>
          )}
        </div>

        <div className="rounded-xl border border-line bg-white p-4 shadow-card">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Progress</p>
            <p className="text-sm font-semibold text-ink">
              {linkedCount} / {units.length}
              <span className="ml-1 text-xs font-normal text-ink-muted">plots mapped</span>
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-success-500 transition-all" style={{ width: `${units.length ? (linkedCount / units.length) * 100 : 0}%` }} />
          </div>

          {unlinked.length > 0 && (
            <div className="mt-3 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning-700">
                <AlertTriangle size={13} />
                {unlinked.length} outline{unlinked.length > 1 ? 's' : ''} not linked
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {unlinked.slice(0, 12).map((s, i) => (
                  <button key={s.key} type="button" onClick={() => setSelectedKey(s.key)} className="rounded-md bg-white px-2 py-0.5 text-xs text-warning-700 ring-1 ring-warning-100 hover:bg-warning-100 focus-ring">
                    {s.label || `#${i + 1}`}
                  </button>
                ))}
                {unlinked.length > 12 && <span className="px-1 text-xs text-warning-700">+{unlinked.length - 12} more</span>}
              </div>
            </div>
          )}
          {toPlace.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-ink-muted">
                Still to place ({toPlace.length})
                {canLinkFromList ? <span className="font-normal text-ink-faint"> — click one to link the selected outline</span> : null}
              </p>
              <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {toPlace.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    disabled={!canLinkFromList}
                    onClick={() => patchSelected({ unitId: u.id })}
                    title={canLinkFromList ? `Link the selected outline to ${u.propertyNumber}` : `${u.propertyNumber} · ${u.area}`}
                    className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-ink-muted enabled:hover:bg-brand-50 enabled:hover:text-brand-700 focus-ring disabled:cursor-default"
                  >
                    {u.propertyNumber}
                  </button>
                ))}
              </div>
            </div>
          )}
          {needsReview > 0 && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-ink-muted">{needsReview} outline{needsReview > 1 ? 's' : ''} still need review.</p>
              <button
                type="button"
                onClick={() => { pushHistory(); setShapes((prev) => prev.map((s) => ({ ...s, confirmed: true }))); }}
                className="shrink-0 text-xs font-medium text-brand-700 hover:underline focus-ring"
              >
                Confirm all
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button leftIcon={<Save size={15} />} onClick={save} isLoading={isSaving} disabled={!isDirty}>
            {isDirty ? 'Save map' : 'All changes saved'}
          </Button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void replaceLayout(e.target.files?.[0]); e.target.value = ''; }} />
          <Button variant="outline" leftIcon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            Replace layout image
          </Button>
          <p className="text-xs leading-relaxed text-ink-faint">
            Replacing the layout keeps every outline and every plot&apos;s bookings. The map returns to draft so you can check the fit.
          </p>
        </div>
      </aside>
    </div>
  );
}
