import type { ReactNode } from 'react';
import { Card, CardHeader } from '../ui/Card';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  legend?: ReactNode;
}

export function ChartCard({ title, subtitle, action, children, legend }: ChartCardProps) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      {children}
      {legend && <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-3">{legend}</div>}
    </Card>
  );
}
