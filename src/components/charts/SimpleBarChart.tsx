import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_COLORS, AXIS_TICK } from './chartColors';

interface SimpleBarChartProps {
  data: { name: string; value: number }[];
  /** One colour per bar. Left out, every bar is the accent: one series, one colour. */
  colors?: string[];
  height?: number;
  valueFormatter?: (value: number) => string;
  horizontal?: boolean;
}

/** Short axis labels so a crore-sized value never pushes its digits off the chart. */
function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `${+(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${+(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return String(v);
}

export function SimpleBarChart({ data, colors, height = 240, valueFormatter, horizontal }: SimpleBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compact} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={compact} allowDecimals={false} />
          </>
        )}
        <Tooltip formatter={(value) => (valueFormatter ? valueFormatter(Number(value)) : value)} />
        <Bar dataKey="value" radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false}>
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={colors ? colors[i % colors.length] : CHART_COLORS.brand} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
