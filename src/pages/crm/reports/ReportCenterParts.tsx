import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, FileText } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Skeleton } from '../../../components/ui/LoadingSkeleton';
import { AXIS_TICK } from '../../../components/charts/chartColors';
import { compactMoney } from '../../dashboard/dashboardMath';
import { formatCurrency } from '../../../utils/format';
import { cn } from '../../../utils/cn';

/*
 * The Report Center's shared layout. Every tab reads the same way: a toolbar (filters left,
 * export right), one chart card that says in a line what it answers, then the report's own
 * table, where the key ratio carries a thin bar beside its percentage.
 *
 * Chart colours come from the theme tokens (as class names, the way the dashboard charts do it),
 * so the same chart reads correctly in light and dark: the whole in a muted steel, the part
 * that matters in the brand green.
 */

export const fmtCount = (n: number) => n.toLocaleString('en-IN');

/** "18%" or "18.5%" — never more decimals than the server sent. */
export const fmtPct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

/** A share as a percentage with one decimal, safe against an empty denominator. */
export const shareOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

// --------------------------------------------------------------------------------------------
// Layout
// --------------------------------------------------------------------------------------------

export function ReportToolbar({
  children, meta, onExportCsv, onExportPdf, exportDisabled,
}: {
  children: ReactNode;
  meta?: ReactNode;
  onExportCsv?: () => void;
  onExportPdf?: () => void;
  exportDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <div className="flex flex-wrap items-center gap-2">
        {meta && <span className="mr-1 text-xs tabular-nums text-ink-subtle">{meta}</span>}
        {onExportCsv && (
          <Button variant="outline" size="sm" leftIcon={<Download size={13} />} onClick={onExportCsv} disabled={exportDisabled}>
            Export CSV
          </Button>
        )}
        {onExportPdf && (
          <Button variant="outline" size="sm" leftIcon={<FileText size={13} />} onClick={onExportPdf} disabled={exportDisabled}>
            Export PDF
          </Button>
        )}
      </div>
    </div>
  );
}

/** The one chart a tab leads with. `subtitle` is the question it answers, in a line. */
export function ReportChartCard({
  title, subtitle, legend, meta, footnote, children,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: ReactNode;
  meta?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 px-4 pb-2 pt-3.5">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>}
        </div>
        {(legend || meta) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-ink-subtle">
            {legend}
            {meta && <span className="tabular-nums">{meta}</span>}
          </div>
        )}
      </div>
      <div className="px-4 pb-4">{children}</div>
      {footnote && <p className="border-t border-line px-4 py-2 text-xs text-ink-subtle">{footnote}</p>}
    </Card>
  );
}

/** A table under the chart, headed with what its rows are. */
export function ReportTableCard({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {meta && <span className="text-xs tabular-nums text-ink-subtle">{meta}</span>}
      </div>
      {children}
    </Card>
  );
}

export function LegendSwatch({ tone, label }: { tone: 'muted' | 'brand' | 'danger'; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-[2px]', tone === 'brand' ? 'bg-brand-600' : tone === 'danger' ? 'bg-danger-500' : 'bg-shell-300')}
      />
      {label}
    </span>
  );
}

/** What a chart shows while its data loads, or when the filters leave nothing to draw. */
export function ChartFrame({
  isLoading, isEmpty, emptyText = 'Nothing in this range.', height, children,
}: {
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyText?: string;
  height: number;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div style={{ height }} className="flex items-end gap-2 pb-6 pl-8">
        {[40, 65, 50, 80, 35, 60, 45].map((h, i) => (
          <div key={i} className="flex-1" style={{ height: `${h}%` }}>
            <Skeleton className="h-full w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div style={{ height: Math.min(height, 160) }} className="flex items-center justify-center rounded-lg border border-dashed border-line text-sm text-ink-faint">
        {emptyText}
      </div>
    );
  }
  return <>{children}</>;
}

// --------------------------------------------------------------------------------------------
// Ratio cells
// --------------------------------------------------------------------------------------------

const BAR_TONE = {
  brand: 'bg-brand-600',
  success: 'bg-success-500',
  info: 'bg-info-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  muted: 'bg-steel-300',
} as const;

export type BarTone = keyof typeof BAR_TONE;

/**
 * A thin bar with its figure beside it. `value` is the percentage shown; the bar is drawn
 * against `max` (100 for a rate, the busiest row for a share) and never past its track.
 */
export function RateBar({ value, max = 100, tone = 'brand', label }: { value: number; max?: number; tone?: BarTone; label?: ReactNode }) {
  const width = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <span className="flex items-center gap-2.5">
      <span className="h-1.5 min-w-[3.5rem] flex-1 overflow-hidden rounded-sm bg-surface-muted">
        <span className={cn('block h-full rounded-sm', BAR_TONE[tone])} style={{ width: `${width}%` }} />
      </span>
      <span className="w-12 shrink-0 text-right tabular-nums text-ink">{label ?? fmtPct(value)}</span>
    </span>
  );
}

/** Column header for a RateBar column, so the header sits over the bar rather than the figure. */
export const rateColumn = { width: '26%', className: 'min-w-[11rem]' };

// --------------------------------------------------------------------------------------------
// Charts
// --------------------------------------------------------------------------------------------

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Two bars per category: the whole (muted) and the part that converted (brand). Integer ticks,
 * or compact ₹ when `money` is set, so an axis never shows a long float.
 */
export function GroupedBarChart({
  data, wholeLabel, partLabel, height = 260, money,
}: {
  data: { label: string; whole: number; part: number }[];
  wholeLabel: string;
  partLabel: string;
  height?: number;
  money?: boolean;
}) {
  const fmt = (v: number) => (money ? formatCurrency(v) : fmtCount(v));
  const dense = data.length > 8;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap={dense ? '18%' : '28%'}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            interval={dense ? 'preserveStartEnd' : 0}
            minTickGap={4}
            tickFormatter={(v: string) => truncate(String(v), dense ? 10 : 22)}
          />
          <YAxis
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={money ? 44 : 32}
            allowDecimals={false}
            tickFormatter={(v: number) => (money ? compactMoney(v) : fmtCount(v))}
          />
          <Tooltip
            cursor={{ fill: 'var(--c-surface-muted)' }}
            formatter={(v, name) => [fmt(Number(v)), name === 'whole' ? wholeLabel : partLabel]}
          />
          {/* Fills go on each cell as a class: a CSS variable in an SVG fill attribute isn't reliable. */}
          <Bar dataKey="whole" maxBarSize={28} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={d.label + i} className="fill-shell-300" />)}
          </Bar>
          <Bar dataKey="part" maxBarSize={28} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={d.label + i} className="fill-brand-600" />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One series over time; the busiest period is labelled and the dashed line is the average. */
export function VolumeBarChart({ data, height = 260, unit }: { data: { label: string; value: number; title?: string }[]; height?: number; unit: string }) {
  const peak = data.reduce((b, p, i) => (p.value > data[b].value ? i : b), 0);
  const avg = data.length ? data.reduce((a, p) => a + p.value, 0) / data.length : 0;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} allowDecimals={false} tickFormatter={(v: number) => fmtCount(v)} />
          <Tooltip
            cursor={{ fill: 'var(--c-surface-muted)' }}
            labelFormatter={(l, p) => p?.[0]?.payload?.title ?? l}
            formatter={(v) => [`${fmtCount(Number(v))} ${unit}`, '']}
            separator=""
          />
          {avg > 0 && <ReferenceLine y={avg} stroke="var(--c-ink-faint)" strokeDasharray="3 3" ifOverflow="extendDomain" />}
          <Bar dataKey="value" maxBarSize={26} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={d.label + i} className="fill-brand-600" />)}
            <LabelList
              dataKey="value"
              position="top"
              content={({ x, y, width, value, index }) =>
                index === peak && Number(value) > 0 ? (
                  <text x={Number(x) + Number(width) / 2} y={Number(y) - 5} textAnchor="middle" className="fill-[var(--c-ink-muted)] text-[10px] font-medium">
                    {fmtCount(Number(value))}
                  </text>
                ) : null
              }
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Labelled horizontal bars, drawn in HTML so long names wrap instead of being clipped by an
 * axis. Bars are scaled to the largest row; `display` is the figure printed at the end.
 */
export function HBarChart({
  rows, format = fmtCount, share,
}: {
  rows: { key: string; label: ReactNode; value: number; tone?: BarTone; display?: ReactNode; sub?: ReactNode }[];
  format?: (v: number) => string;
  /** Prints each row's share of the total after its figure. */
  share?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 py-1 text-[13px] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
          <span className="min-w-0">
            <span className="block truncate text-ink-muted">{r.label}</span>
            {r.sub && <span className="block truncate text-2xs text-ink-faint">{r.sub}</span>}
          </span>
          <span className="h-2.5 overflow-hidden rounded-sm bg-surface-muted">
            <span className={cn('block h-full rounded-sm', BAR_TONE[r.tone ?? 'brand'])} style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
          </span>
          <span className="flex min-w-[3.5rem] items-baseline justify-end gap-1.5 tabular-nums">
            <span className="font-semibold text-ink">{r.display ?? format(r.value)}</span>
            {share && <span className="w-11 text-right text-xs text-ink-faint">{fmtPct(shareOf(r.value, total))}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
