import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Avatar } from '../../components/ui/Avatar';
import { formatDateTime, formatTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { FollowUpWithLeadName } from '../../services/followUpService';

const DAY_MS = 86_400_000;

/** Local midnight of a moment, so day arithmetic follows the calendar the viewer sees, not UTC. */
function localDay(ms: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days `iso` lies before `now`: 1 for yesterday, 0 for any time today. */
export function daysOverdue(iso: string, now: number) {
  return Math.max(0, Math.round((localDay(now) - localDay(new Date(iso).getTime())) / DAY_MS));
}

export function isOpenFollowUp(t: FollowUpWithLeadName) {
  return t.status === 'pending' || t.status === 'rescheduled';
}

/**
 * The Due cell. An open follow-up from an earlier day is a red "Nd overdue" chip, one due today an
 * amber chip with its time; the exact moment stays on hover. Closed ones are just their date.
 */
export function DueCell({ task, now }: { task: FollowUpWithLeadName; now: number }) {
  const exact = formatDateTime(task.dueAt);
  if (!isOpenFollowUp(task)) return <span className="whitespace-nowrap tabular-nums text-ink-muted">{exact}</span>;

  const days = daysOverdue(task.dueAt, now);
  if (days > 0) {
    return (
      <span title={`Was due ${exact}`} className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm bg-danger-50 px-1.5 py-px text-xs font-medium tabular-nums text-danger-700">
        <AlertTriangle size={11} aria-hidden="true" />
        {days}d overdue
      </span>
    );
  }
  if (localDay(new Date(task.dueAt).getTime()) === localDay(now)) {
    return (
      <span title={exact} className="inline-flex items-center whitespace-nowrap rounded-sm bg-warning-50 px-1.5 py-px text-xs font-medium tabular-nums text-warning-700">
        Today, {formatTime(task.dueAt)}
      </span>
    );
  }
  return <span className="whitespace-nowrap tabular-nums">{exact}</span>;
}

/* ------------------------------------------------------------------ overdue by owner */

export interface OwnerLoad {
  /** Null for follow-ups nobody owns. */
  userId: string | null;
  name: string;
  count: number;
  /** Days past due of this owner's oldest one. */
  oldest: number;
}

/** Groups the overdue follow-ups by who owns them, heaviest first. */
export function overdueByOwner(items: FollowUpWithLeadName[], nameOf: (id: string) => string | undefined, now: number): OwnerLoad[] {
  const map = new Map<string, OwnerLoad>();
  for (const t of items) {
    const key = t.assignedUserId ?? '';
    const row = map.get(key) ?? { userId: t.assignedUserId ?? null, name: t.assignedUserId ? nameOf(t.assignedUserId) ?? 'Former user' : 'Unassigned', count: 0, oldest: 0 };
    row.count += 1;
    row.oldest = Math.max(row.oldest, daysOverdue(t.dueAt, now));
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.oldest - a.oldest || a.name.localeCompare(b.name));
}

const OWNER_ROWS = 6;

/**
 * One bar per owner. Clicking one narrows the table to that person's overdue follow-ups, and
 * clicking it again lets go. Unassigned has no id the list can filter on, so it is not a button.
 */
export function OwnerBars({ rows, selectedId, onSelect }: { rows: OwnerLoad[]; selectedId: string; onSelect: (userId: string | null) => void }) {
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const shown = expanded ? rows : rows.slice(0, OWNER_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <div className="px-2 py-2">
      <ul>
        {shown.map((r) => {
          const on = !!r.userId && r.userId === selectedId;
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                {r.userId ? <Avatar name={r.name} size="xs" /> : <span className="h-5 w-5 shrink-0 rounded-full border border-dashed border-line-strong" aria-hidden="true" />}
                <span className={cn('truncate', on ? 'font-semibold text-ink' : r.userId ? 'text-ink-muted' : 'text-ink-faint')}>{r.name}</span>
              </span>
              <span className="block h-1.5 rounded-sm bg-surface-muted">
                <span className="block h-1.5 rounded-sm bg-danger-500" style={{ width: `${(r.count / max) * 100}%` }} />
              </span>
              <span className="text-right font-semibold tabular-nums text-ink">{r.count}</span>
              <span className="text-right text-xs tabular-nums text-ink-faint" title={`Oldest is ${r.oldest} day${r.oldest === 1 ? '' : 's'} past due`}>
                {r.oldest}d
              </span>
            </>
          );
          const cls = 'grid w-full grid-cols-[minmax(0,10rem)_1fr_2rem_2.5rem] items-center gap-3 rounded-md px-2 py-1.5 text-left text-[13px]';
          return (
            <li key={r.userId ?? 'none'}>
              {r.userId ? (
                <button
                  type="button"
                  onClick={() => onSelect(on ? null : r.userId)}
                  aria-pressed={on}
                  title={on ? 'Show everyone again' : `Show only ${r.name}'s overdue follow-ups`}
                  className={cn(cls, 'transition-colors duration-100 focus-ring', on ? 'bg-surface-muted' : 'hover:bg-surface-subtle')}
                >
                  {body}
                </button>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || expanded) && rows.length > OWNER_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-2 mt-1 rounded text-xs font-medium text-ink-subtle hover:text-ink focus-ring"
        >
          {expanded ? 'Show fewer' : `+${hidden} more ${hidden === 1 ? 'owner' : 'owners'}`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ overdue by age */

/** Older steps are stronger: the same red at rising opacity, which reads the same way in light and dark. */
const AGE_BANDS = [
  { label: '1–2 days', min: 1, max: 2, swatch: 'bg-danger-600/25' },
  { label: '3–7 days', min: 3, max: 7, swatch: 'bg-danger-600/45' },
  { label: '8–14 days', min: 8, max: 14, swatch: 'bg-danger-600/65' },
  { label: '15–30 days', min: 15, max: 30, swatch: 'bg-danger-600/85' },
  { label: 'Over 30 days', min: 31, max: Infinity, swatch: 'bg-danger-600' },
];

/** How stale the backlog is: one stacked bar, then each band's count. */
export function OverdueAge({ items, now }: { items: FollowUpWithLeadName[]; now: number }) {
  const bands = AGE_BANDS.map((b) => ({ ...b, count: 0 }));
  for (const t of items) {
    const d = daysOverdue(t.dueAt, now);
    const band = bands.find((b) => d >= b.min && d <= b.max);
    if (band) band.count += 1;
  }
  const total = bands.reduce((a, b) => a + b.count, 0) || 1;

  return (
    <div className="px-4 py-3">
      <div className="flex h-2 gap-px overflow-hidden rounded-sm bg-surface-muted" role="img" aria-label={bands.map((b) => `${b.label}: ${b.count}`).join(', ')}>
        {bands.filter((b) => b.count > 0).map((b) => (
          <span key={b.label} className={cn('h-full', b.swatch)} style={{ width: `${(b.count / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {bands.map((b) => (
          <li key={b.label} className="flex items-center justify-between gap-3 text-[13px]">
            <span className={cn('flex items-center gap-2', b.count ? 'text-ink-muted' : 'text-ink-faint')}>
              <span className={cn('h-2 w-2 shrink-0 rounded-sm', b.swatch)} aria-hidden="true" />
              {b.label}
            </span>
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="text-xs text-ink-faint">{b.count ? `${Math.round((b.count / total) * 100)}%` : ''}</span>
              <span className={cn('w-6 text-right font-semibold', b.count ? 'text-ink' : 'text-ink-faint')}>{b.count}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
