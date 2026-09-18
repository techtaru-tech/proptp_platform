import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: 'navy' | 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  trend?: { value: string; direction: 'up' | 'down' };
  footer?: ReactNode;
  onClick?: () => void;
}

const TONE_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  navy: 'bg-navy-50 text-navy-700',
  brand: 'bg-brand-50 text-brand-700',
  accent: 'bg-accent-50 text-accent-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-700',
  neutral: 'bg-surface-muted text-ink-muted',
};

export function StatCard({ label, value, icon: Icon, tone = 'neutral', trend, footer, onClick }: StatCardProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-3 rounded-xl border border-line bg-white p-4 text-left shadow-card transition-shadow',
        onClick && 'hover:shadow-popover focus-ring'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        {Icon && (
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', TONE_CLASSES[tone])}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className="flex items-end justify-between">
        <span className="text-2xl font-semibold tracking-tight text-ink">{value}</span>
        {trend && (
          <span className={cn('flex items-center gap-0.5 text-xs font-medium', trend.direction === 'up' ? 'text-success-600' : 'text-danger-600')}>
            {trend.direction === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {trend.value}
          </span>
        )}
      </div>
      {footer && <div className="text-xs text-ink-faint">{footer}</div>}
    </Comp>
  );
}
