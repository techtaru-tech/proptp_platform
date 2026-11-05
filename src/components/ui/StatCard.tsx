import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: 'shell' | 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  trend?: { value: string; direction: 'up' | 'down' };
  footer?: ReactNode;
  onClick?: () => void;
}

const TONE_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  shell: 'bg-shell-50 text-steel-600',
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
        'flex w-full flex-col gap-2 rounded-xl border border-line bg-surface px-3.5 py-3 text-left transition-colors duration-150',
        onClick && 'hover:border-line-strong hover:bg-surface-subtle focus-ring'
      )}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        {Icon && (
          <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', TONE_CLASSES[tone])}>
            <Icon size={13} />
          </span>
        )}
      </div>
      <div className="flex items-end justify-between">
        <span className="text-xl font-semibold tracking-tight text-ink tabular-nums">{value}</span>
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
