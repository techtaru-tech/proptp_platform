import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_TICK } from '../../components/charts/chartColors';
import { cn } from '../../utils/cn';
import { compactMoney } from './dashboardMath';

/*
 * The dashboard's chart vocabulary: one accent for the figure that matters, greys for context,
 * labels on the data instead of legends, and no entry animation.
 */

const ACCENT = 'fill-brand-600';
const MUTED = 'fill-[var(--c-line-strong)]';

/** Vertical bars; the last bar (the current period) carries the accent and the tallest one its value. */
export function ColumnChart({
  data, height = 200, money, format, interval,
}: {
  data: { label: string; value: number; title?: string }[];
  height?: number;
  money?: boolean;
  format: (v: number) => string;
  interval?: number;
}) {
  const best = data.reduce((b, p, i) => (p.value > data[b].value ? i : b), 0);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={interval ?? "preserveEnd"} minTickGap={6} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={money ? 44 : 28} allowDecimals={false} tickFormatter={money ? compactMoney : undefined} />
          <Tooltip formatter={(v) => [format(Number(v)), '']} labelFormatter={(l, p) => p?.[0]?.payload?.title ?? l} separator="" />
          <Bar dataKey="value" maxBarSize={22} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((p, i) => <Cell key={p.label + i} className={i === data.length - 1 ? ACCENT : MUTED} />)}
            <LabelList
              dataKey="value" position="top"
              content={({ x, y, width, value, index }) =>
                index === best && Number(value) > 0 ? (
                  <text x={Number(x) + Number(width) / 2} y={Number(y) - 5} textAnchor="middle" className="fill-[var(--c-ink-muted)] text-[10px] font-medium">
                    {money ? compactMoney(Number(value)) : Number(value)}
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

/** A daily line with a flat tint under it. */
export function DailyArea({ data, height = 170 }: { data: { label: string; value: number }[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={2} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <Tooltip formatter={(v) => [`${v} booking${Number(v) === 1 ? '' : 's'}`, '']} separator="" />
          <Area
            type="monotone" dataKey="value" stroke="var(--c-brand-600)" strokeWidth={1.75}
            className="[&_.recharts-area-area]:fill-brand-500/10 [&_.recharts-area-curve]:stroke-brand-600"
            dot={false} activeDot={{ r: 3 }} isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface Slice { name: string; value: number; tone: string; to?: string }

/** A ring with its total in the middle and the slices listed beside it. */
export function Ring({ slices, centre, caption, format = String }: { slices: Slice[]; centre: string; caption: string; format?: (v: number) => string }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[136px] w-[136px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" innerRadius={46} outerRadius={66} paddingAngle={1.5} stroke="none" isAnimationActive={false}>
              {slices.map((s) => <Cell key={s.name} className={s.tone} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-ink">{centre}</span>
          <span className="text-2xs text-ink-subtle">{caption}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s) => {
          const row = (
            <>
              <span className="flex min-w-0 items-center gap-2 text-ink-muted">
                <svg width="8" height="8" className="shrink-0" aria-hidden="true"><rect width="8" height="8" rx="2" className={s.tone} /></svg>
                <span className="truncate">{s.name}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-medium text-ink">{format(s.value)}</span>
                <span className="ml-1.5 text-xs text-ink-faint">{total ? ((s.value / total) * 100).toFixed(0) : 0}%</span>
              </span>
            </>
          );
          return (
            <li key={s.name}>
              {s.to
                ? <Link to={s.to} className="flex items-center justify-between gap-2 rounded text-[13px] hover:text-ink focus-ring">{row}</Link>
                : <div className="flex items-center justify-between gap-2 text-[13px]">{row}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Labelled horizontal bars, longest first; the leader in the accent. */
export function BarList({
  rows, format = String, showShare = true, accentAll,
}: {
  rows: { name: string; value: number; to?: string; muted?: boolean }[];
  format?: (v: number) => string;
  showShare?: boolean;
  accentAll?: boolean;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className={cn('truncate', r.muted ? 'text-ink-faint' : 'text-ink-muted')}>{r.name}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-medium text-ink">{format(r.value)}</span>
                {showShare && <span className="ml-1.5 text-xs text-ink-faint">{total ? ((r.value / total) * 100).toFixed(1) : 0}%</span>}
              </span>
            </span>
            <span className="mt-1 block h-1.5 rounded-sm bg-surface-muted">
              <span
                className={cn('block h-1.5 rounded-sm', r.muted ? 'bg-ink-faint/40' : (accentAll || i === 0) ? 'bg-brand-600' : 'bg-brand-300')}
                style={{ width: `${(r.value / max) * 100}%` }}
              />
            </span>
          </>
        );
        return (
          <li key={r.name}>
            {r.to ? <Link to={r.to} className="block rounded focus-ring hover:[&_span]:text-ink">{body}</Link> : body}
          </li>
        );
      })}
    </ul>
  );
}

/** One bar split into parts, for things that add up to a whole (today's team, inventory). */
export function SplitBar({ parts }: { parts: { name: string; value: number; tone: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-sm bg-surface-muted">
        {parts.map((p) => p.value > 0 && <span key={p.name} className={p.tone} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.name}: ${p.value}`} />)}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
        {parts.map((p) => (
          <li key={p.name} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-[2px]', p.tone)} aria-hidden="true" />
            {p.name} <span className="font-medium tabular-nums text-ink">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
