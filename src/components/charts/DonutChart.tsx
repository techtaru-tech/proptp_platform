import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_COLORS, CHART_SERIES } from './chartColors';

interface DonutChartProps {
  data: { name: string; value: number }[];
  colors?: string[];
  height?: number;
}

/**
 * Status-like slices take the colour their badge has everywhere else (pending amber, confirmed
 * green, failed red), so a chart never contradicts the table under it. Anything else falls back
 * to the series palette.
 */
const SEMANTIC: [RegExp, string][] = [
  [/fail|reject|cancel|absent|overdue|lost|outside/i, CHART_COLORS.danger],
  [/pending|await|late|review|hold|draft/i, CHART_COLORS.accent],
  [/book|confirm|paid|releas|approv|present|resolv|clos|active|won|avail|inside|complet/i, CHART_COLORS.brand],
  [/inactive|deactiv|sold/i, CHART_COLORS.slate],
];

function colourFor(name: string, i: number, colors?: string[]) {
  if (colors) return colors[i % colors.length];
  // "inactive" must not match "active", so the neutral rules are checked first.
  if (/inactive|deactiv/i.test(name)) return CHART_COLORS.slate;
  return SEMANTIC.find(([re]) => re.test(name))?.[1] ?? CHART_SERIES[i % CHART_SERIES.length];
}

function label(name: string) {
  const words = name.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function DonutChart({ data, colors, height = 200 }: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-6">
      <div className="w-[45%] max-w-[220px] shrink-0">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={1.5} strokeWidth={0} isAnimationActive={false}>
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={colourFor(entry.name, i, colors)} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 max-w-xs flex-1 divide-y divide-line">
        {data.map((entry, i) => (
          <li key={entry.name} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-ink-muted">
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: colourFor(entry.name, i, colors) }} />
              <span className="truncate">{label(entry.name)}</span>
            </span>
            <span className="shrink-0 font-medium tabular-nums text-ink">
              {entry.value}
              <span className="ml-1.5 text-xs font-normal text-ink-faint">{total ? ((entry.value / total) * 100).toFixed(1) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
