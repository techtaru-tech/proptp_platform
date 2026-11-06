import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Button } from '../../components/ui/Button';
import { FilterChips } from '../../components/ui/FilterChips';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { TableSkeleton } from '../../components/ui/LoadingSkeleton';
import { FilterBar } from '../../components/tables/FilterBar';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listActivities, type ActivityListParams, type ActivityWithLeadName } from '../../services/activityService';
import { formatDateTime, formatTime } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { LeadActivityType } from '../../types';

const PAGE_SIZE = 20;

/**
 * What each kind of activity is called in the feed. The app writes the canonical names
 * (`call_logged`, `note_added`, ...) while imported and seeded history uses short ones
 * (`call`, `note`, ...), so both spellings get the same label and colour.
 */
const TYPE_LABEL: Record<string, string> = {
  created: 'Lead created',
  imported: 'Imported',
  restored: 'Restored',
  archived: 'Archived',
  status_changed: 'Status changed',
  status_change: 'Status changed',
  stage_moved: 'Stage moved',
  assigned: 'Assigned',
  score_changed: 'Score changed',
  note_added: 'Note',
  note: 'Note',
  call_logged: 'Call',
  call: 'Call',
  email_sent: 'Email',
  email: 'Email',
  email_received: 'Email received',
  whatsapp: 'WhatsApp',
  tag_applied: 'Tag added',
  tag_removed: 'Tag removed',
  meeting: 'Meeting',
  meeting_scheduled: 'Meeting scheduled',
  meeting_rescheduled: 'Meeting rescheduled',
  meeting_cancelled: 'Meeting cancelled',
  site_visit: 'Site visit',
};

/** The dot on the timeline. Related kinds share a colour so a day can be scanned by kind. */
const TYPE_DOT: Record<string, string> = {
  // A new lead is a hollow ring: the most common entry, so it stays quiet.
  created: 'border-[1.5px] border-brand-600 bg-surface',
  imported: 'border-[1.5px] border-brand-600 bg-surface',
  restored: 'border-[1.5px] border-brand-600 bg-surface',
  archived: 'bg-ink-faint',
  status_changed: 'bg-shell-400',
  status_change: 'bg-shell-400',
  stage_moved: 'bg-shell-400',
  score_changed: 'bg-shell-400',
  assigned: 'bg-shell-300',
  note_added: 'bg-accent-500',
  note: 'bg-accent-500',
  call_logged: 'bg-success-500',
  call: 'bg-success-500',
  whatsapp: 'bg-blossom-500',
  email_sent: 'bg-info-500',
  email: 'bg-info-500',
  email_received: 'bg-info-500',
  tag_applied: 'bg-warning-500',
  tag_removed: 'bg-warning-500',
  meeting: 'bg-steel-600',
  meeting_scheduled: 'bg-steel-600',
  meeting_rescheduled: 'bg-steel-600',
  site_visit: 'bg-steel-600',
  meeting_cancelled: 'bg-ink-faint',
};

/** Every type the app itself writes, so each stays reachable from "More types". */
const KNOWN_TYPES: LeadActivityType[] = [
  'created', 'imported', 'status_changed', 'stage_moved', 'assigned', 'score_changed', 'note_added', 'call_logged',
  'email_sent', 'email_received', 'tag_applied', 'tag_removed', 'meeting_scheduled', 'meeting_rescheduled', 'meeting_cancelled',
];

/** How many of the most common types get a chip; the rest sit behind "More types". */
const CHIP_COUNT = 7;

const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ');

function Dot({ type, className }: { type: string; className?: string }) {
  return <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', TYPE_DOT[type] ?? 'bg-ink-faint', className)} />;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday", or "Tue, 03 Nov" (with the year when it isn't this one). */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Today';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Yesterday';
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function groupByDay(items: ActivityWithLeadName[]) {
  const groups: { key: string; label: string; items: ActivityWithLeadName[] }[] = [];
  for (const a of items) {
    const key = dayKey(a.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(a);
    else groups.push({ key, label: dayLabel(a.createdAt), items: [a] });
  }
  return groups;
}

export function LeadActivities() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  // A plain string: stored history holds type names beyond the LeadActivityType union.
  const [type, setType] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const params: ActivityListParams = { page, pageSize: PAGE_SIZE, search: debouncedSearch, type: type as LeadActivityType | 'all', dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
  const { data, isLoading, error } = useAsync(() => listActivities(params), [JSON.stringify(params)]);

  const groups = useMemo(() => groupByDay(data?.items ?? []), [data]);

  /*
   * The type filter matches the stored name exactly, and which names a workspace holds depends
   * on where its history came from. So the chips are the types actually present in the latest
   * activity, most common first, rather than a fixed list that could filter down to nothing.
   */
  const { data: recent } = useAsync(() => listActivities({ page: 1, pageSize: 300 }), []);
  const { chipTypes, chipLabels, moreTypes } = useMemo(() => {
    const freq = new Map<string, number>();
    for (const a of recent?.items ?? []) freq.set(a.type, (freq.get(a.type) ?? 0) + 1);
    const seen = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const chips = seen.slice(0, CHIP_COUNT);
    const chipLabels = new Set(chips.map(typeLabel));
    // Unseen app types stay reachable, minus any that would read as a second "Call" beside the chip.
    const unseen = KNOWN_TYPES.filter((t) => !seen.includes(t) && !chipLabels.has(typeLabel(t)));
    return { chipTypes: chips, chipLabels, moreTypes: [...seen.slice(CHIP_COUNT), ...unseen] };
  }, [recent]);
  const hasFilters = type !== 'all' || !!search || !!dateFrom || !!dateTo;

  const pickType = (next: string) => {
    setType(next || 'all');
    setPage(1);
  };
  const clearFilters = () => {
    setSearch('');
    setType('all');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  return (
    <div>
      <PageHeader title="Activities" description="A live, cross-lead feed of everything happening across the CRM." breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Activities' }]} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <FilterChips
          label="Activity type"
          value={type}
          onChange={pickType}
          items={[
            { key: 'all', label: 'All' },
            ...chipTypes.map((t) => ({ key: t, label: typeLabel(t), icon: <Dot type={t} className="h-1.5 w-1.5" /> })),
          ]}
        />
        {data && (
          <span className="text-xs tabular-nums text-ink-subtle">
            {data.total.toLocaleString('en-IN')} {data.total === 1 ? 'activity' : 'activities'}
            {type !== 'all' && <> · {typeLabel(type).toLowerCase()}</>}
          </span>
        )}
      </div>

      <Card padded={false}>
        <FilterBar
          search={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search activity or user..."
          onReset={clearFilters}
          hasActiveFilters={hasFilters}
        >
          <Select
            aria-label="More activity types"
            value={moreTypes.includes(type) ? type : ''}
            onChange={(e) => pickType(e.target.value)}
            options={[{ value: '', label: 'More types' }, ...moreTypes.map((t) => ({ value: t, label: chipLabels.has(typeLabel(t)) ? `${typeLabel(t)} (${t})` : typeLabel(t) }))]}
            wrapperClassName="w-44"
          />
          <DatePicker value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="From date" />
          <span className="hidden text-xs text-ink-faint sm:inline">to</span>
          <DatePicker value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} wrapperClassName="w-40" aria-label="To date" />
        </FilterBar>

        {isLoading ? (
          <TableSkeleton cols={1} />
        ) : error ? (
          <ErrorState />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity found"
            description={hasFilters ? 'Nothing matches these filters.' : 'Calls, notes, stage moves and new leads will show up here as they happen.'}
            action={hasFilters ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button> : undefined}
          />
        ) : (
          <div className="pb-2">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h2 className="flex items-center gap-2 px-4 pb-1 pt-3">
                  <span className="text-xs font-semibold text-ink">{g.label}</span>
                  <span className="text-2xs tabular-nums text-ink-faint">{g.items.length}</span>
                  <span className="h-px flex-1 bg-line" aria-hidden="true" />
                </h2>
                <ol>
                  {g.items.map((a, i) => {
                    const first = i === 0;
                    const last = i === g.items.length - 1;
                    return (
                      <li key={a.id}>
                        <Link
                          to={`/crm/leads/${a.leadId}`}
                          className="group relative flex gap-3 px-4 py-1.5 transition-colors duration-100 hover:bg-surface-subtle focus-ring"
                        >
                          {/* The guide line runs dot to dot, so it starts at a day's first entry and stops at its last. */}
                          {!(first && last) && (
                            <span
                              aria-hidden="true"
                              className={cn('absolute left-[19.5px] w-px bg-line-strong', first ? 'top-[13px] bottom-0' : last ? 'top-0 h-[13px]' : 'inset-y-0')}
                            />
                          )}
                          <span className="relative flex w-2 shrink-0 justify-center pt-[9px]">
                            <Dot type={a.type} className="ring-[3px] ring-surface group-hover:ring-surface-subtle" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-3">
                              <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                                <span className="font-medium text-ink">{typeLabel(a.type)}</span>
                                {a.leadName && (
                                  <>
                                    <span className="text-ink-faint"> · </span>
                                    <span className="font-medium text-ink group-hover:text-brand-700">{a.leadName}</span>
                                  </>
                                )}
                                {a.userName && <span className="text-xs text-ink-subtle"> · by {a.userName}</span>}
                              </span>
                              <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)} className="shrink-0 text-xs tabular-nums text-ink-faint">
                                {formatTime(a.createdAt)}
                              </time>
                            </span>
                            {a.description && <span className="mt-px block text-sm text-ink-muted line-clamp-2">{a.description}</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}

        {data && data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
