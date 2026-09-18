import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_COLORS, GRID_STROKE, AXIS_TICK } from './chartColors';

interface TrendAreaChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: number;
  valueFormatter?: (value: number) => string;
}

export function TrendAreaChart({ data, xKey, yKey, color = CHART_COLORS.brand, height = 240, valueFormatter }: TrendAreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={`trend-${yKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          formatter={(value) => (valueFormatter ? valueFormatter(Number(value)) : value)}
          contentStyle={{ borderRadius: 10, border: '1px solid #e4e7ec', fontSize: 12, boxShadow: '0 4px 6px -2px rgba(16,24,40,.03)' }}
        />
        <Area type="monotone" dataKey={yKey} stroke={color} strokeWidth={2} fill={`url(#trend-${yKey})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
