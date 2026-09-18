import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_SERIES, GRID_STROKE, AXIS_TICK } from './chartColors';

interface SimpleBarChartProps {
  data: { name: string; value: number }[];
  colors?: string[];
  height?: number;
  valueFormatter?: (value: number) => string;
  horizontal?: boolean;
}

export function SimpleBarChart({ data, colors = CHART_SERIES, height = 240, valueFormatter, horizontal }: SimpleBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 8, left: horizontal ? 8 : -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: GRID_STROKE }} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
          </>
        )}
        <Tooltip
          cursor={{ fill: 'rgba(16,24,40,0.04)' }}
          formatter={(value) => (valueFormatter ? valueFormatter(Number(value)) : value)}
          contentStyle={{ borderRadius: 10, border: '1px solid #e4e7ec', fontSize: 12 }}
        />
        <Bar dataKey="value" radius={[6, 6, 6, 6]} maxBarSize={28}>
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={colors[i % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
