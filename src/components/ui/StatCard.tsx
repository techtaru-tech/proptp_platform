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
  /** The card is the filter currently applied to the list below it. */
  active?: boolean;
}

/** The icon takes the tone's colour; no tinted tile behind it, so a row of cards stays quiet. */
const TONE_ICON: Record<NonNullable<StatCardProps['tone']>, string> = {
  shell: 'text-steel-600',
  brand: 'text-brand-600',
  accent: 'text-accent-600',
  success: 'text-success-600',
  warning: 'text-warning-600',
  danger: 'text-danger-600',
  info: 'text-info-600',
  neutral: 'text-ink-faint',
};

export function StatCard({ label, value, icon: Icon, tone = 'neutral', trend, footer, onClick, active }: StatCardProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      aria-pressed={onClick ? !!active : undefined}
      className={cn(
        'flex w-full flex-col rounded-xl border bg-surface px-3.5 py-2.5 text-left transition-colors duration-100',
        active ? 'border-brand-600 shadow-[inset_0_0_0_1px_var(--c-brand-600)]' : 'border-line',
        onClick && !active && 'hover:border-line-strong hover:bg-surface-subtle',
        onClick && 'focus-ring'
      )}
    >
      <span className="flex items-center gap-1.5">
        {Icon && <Icon size={13} className={cn('shrink-0', TONE_ICON[tone])} aria-hidden="true" />}
        <span className={cn('truncate text-xs font-medium', active ? 'text-brand-700' : 'text-ink-muted')}>{label}</span>
      </span>
      <span className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-[22px] font-semibold leading-7 tracking-tight text-ink tabular-nums">{value}</span>
        {trend && (
          <span className={cn('flex items-center gap-0.5 text-xs font-medium', trend.direction === 'up' ? 'text-success-600' : 'text-danger-600')}>
            {trend.direction === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {trend.value}
          </span>
        )}
      </span>
      {footer && <span className="mt-0.5 block text-xs text-ink-faint">{footer}</span>}
    </Comp>
  );
}
