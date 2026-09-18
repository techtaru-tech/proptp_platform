import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { formatDateTime } from '../../utils/format';

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  timestamp: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

const DOT_CLASSES: Record<NonNullable<TimelineEntry['tone']>, string> = {
  neutral: 'bg-ink-faint',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
};

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative ml-1.5 border-l border-line pl-5">
      {entries.map((entry) => (
        <li key={entry.id} className="relative pb-6 last:pb-0">
          <span className={cn('absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white', DOT_CLASSES[entry.tone ?? 'neutral'])} />
          <p className="text-sm font-medium text-ink">{entry.title}</p>
          {entry.description && <p className="mt-0.5 text-sm text-ink-muted">{entry.description}</p>}
          <p className="mt-1 text-xs text-ink-faint">{formatDateTime(entry.timestamp)}</p>
        </li>
      ))}
    </ol>
  );
}
