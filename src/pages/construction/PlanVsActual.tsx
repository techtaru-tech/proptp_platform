import { cn } from '../../utils/cn';

/**
 * Actual progress as the filled bar, planned progress as the tick on it. Reading "are we where
 * we should be" is one glance: fill short of the tick means behind.
 */
export function PlanVsActual({ planned, actual, className }: { planned: number; actual: number; className?: string }) {
  const behind = actual < planned;
  return (
    <div
      className={cn('relative h-2.5 w-full rounded-full bg-surface-muted', className)}
      role="img"
      aria-label={`${actual}% complete, ${planned}% planned`}
    >
      <div className={cn('h-full rounded-full', behind ? 'bg-warning-500' : 'bg-success-500')} style={{ width: `${actual}%` }} />
      <div className="absolute top-[-3px] h-[16px] w-[2px] rounded bg-ink" style={{ left: `calc(${planned}% - 1px)` }} />
    </div>
  );
}

export function BehindBadge({ days }: { days: number }) {
  if (days <= 0) return <span className="text-xs font-medium text-success-700">On track</span>;
  return <span className="text-xs font-medium text-danger-700">{days} day{days === 1 ? '' : 's'} behind</span>;
}
