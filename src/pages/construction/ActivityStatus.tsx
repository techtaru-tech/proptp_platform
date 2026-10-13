import { Flag } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { ActivityStatus } from '../../services/constructionService';

/**
 * One colour per state, used everywhere an activity appears, so the state reads before any text:
 * grey is waiting to start, blue is under way, green is done, red is blocked.
 */
export const STATUS_META: Record<ActivityStatus, { label: string; bar: string; dot: string; chip: string; edge: string }> = {
  pending: { label: 'Pending', bar: 'bg-ink-faint', dot: 'bg-ink-faint', chip: 'bg-surface-muted text-ink-muted', edge: 'border-l-ink-faint' },
  in_progress: { label: 'In progress', bar: 'bg-info-500', dot: 'bg-info-500', chip: 'bg-info-50 text-info-700', edge: 'border-l-info-500' },
  completed: { label: 'Completed', bar: 'bg-success-500', dot: 'bg-success-500', chip: 'bg-success-50 text-success-700', edge: 'border-l-success-500' },
  blocked: { label: 'Blocked', bar: 'bg-danger-500', dot: 'bg-danger-500', chip: 'bg-danger-50 text-danger-700', edge: 'border-l-danger-500' },
};

export function ActivityStatusBadge({ status, pendingBlockers = 0 }: { status: ActivityStatus; pendingBlockers?: number }) {
  const m = STATUS_META[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', m.chip)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
        {m.label}
      </span>
      {pendingBlockers > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700" title="A blocker was raised from site and is waiting for approval">
          <Flag size={11} /> Blocker waiting for approval
        </span>
      )}
    </span>
  );
}

export function StatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted', className)} aria-label="Colour key">
      {(Object.keys(STATUS_META) as ActivityStatus[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_META[k].dot)} />
          {STATUS_META[k].label}
        </span>
      ))}
    </div>
  );
}
