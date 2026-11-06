import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarClock, CalendarDays, ClipboardCheck } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Tabs } from '../../components/ui/Tabs';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { getVisitSummary, listSiteVisits, type SiteVisit } from '../../services/siteVisitService';
import { Panel, PanelHeader } from '../dashboard/widgets';
import { SiteVisitsTable, visitTime } from './SiteVisitsTable';
import { cn } from '../../utils/cn';

const VIEWS = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'needs_outcome', label: 'Needs outcome' },
  { key: 'done', label: 'Done' },
  { key: 'closed', label: 'Cancelled / no-show' },
] as const;
type ViewKey = (typeof VIEWS)[number]['key'];

const EMPTY: Record<ViewKey, { title: string; description?: string }> = {
  today: { title: 'No visits today', description: 'Schedule one from a lead; it shows up here on the day.' },
  upcoming: { title: 'Nothing booked ahead', description: 'Visits scheduled from a lead appear here until they happen.' },
  needs_outcome: { title: 'Every visit has an outcome', description: 'Visits that took place but were never closed off show up here.' },
  done: { title: 'No completed visits yet' },
  closed: { title: 'No cancelled visits or no-shows' },
};

/** The list endpoint returns at most this many rows per view. */
const LIST_CAP = 300;
const countLabel = (n: number) => (n >= LIST_CAP ? `${LIST_CAP}+` : n);

/** Every view at once, so the tab counts are the lists' own lengths and switching tabs is instant. */
async function loadAll(): Promise<Record<ViewKey, SiteVisit[]>> {
  const lists = await Promise.all(VIEWS.map((v) => listSiteVisits({ view: v.key })));
  return Object.fromEntries(VIEWS.map((v, i) => [v.key, lists[i]])) as Record<ViewKey, SiteVisit[]>;
}

export function SiteVisits() {
  const [view, setView] = useState<ViewKey>('today');
  const [reload, setReload] = useState(0);
  const summary = useAsync(() => getVisitSummary(), [reload]);
  const { data, error } = useAsync(loadAll, [reload]);
  const s = summary.data;
  const refresh = () => setReload((k) => k + 1);

  const nextToday = data?.today.find((v) => new Date(v.scheduledAt).getTime() >= Date.now());

  return (
    <div>
      <PageHeader title="Site visits" description="Visits booked for buyers: who is coming, where, with whom, and how it went. Schedule one from a lead." breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Site visits' }]} />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today" value={s?.today ?? '…'} icon={CalendarDays} tone="brand" active={view === 'today'} onClick={() => setView('today')}
          footer={s ? (s.today === 0 ? 'none booked' : nextToday ? `next at ${visitTime(nextToday.scheduledAt)}` : 'all past their slot') : undefined} />
        <StatCard label="Upcoming" value={s?.upcoming ?? '…'} icon={CalendarClock} tone="info" active={view === 'upcoming'} onClick={() => setView('upcoming')}
          footer={s ? 'after today' : undefined} />
        <StatCard label="Waiting for an outcome" value={s?.needsOutcome ?? '…'} icon={ClipboardCheck} tone={s?.needsOutcome ? 'warning' : 'neutral'} active={view === 'needs_outcome'} onClick={() => setView('needs_outcome')}
          footer={s ? (s.needsOutcome ? <span className="text-warning-700">record how they went</span> : <span className="text-success-700">all captured</span>) : undefined} />
        <StatCard label="Done this month" value={s?.doneThisMonth ?? '…'} icon={CalendarCheck} tone="success" active={view === 'done'} onClick={() => setView('done')}
          footer={s ? `since 1 ${new Date().toLocaleDateString('en-IN', { month: 'short' })}` : undefined} />
      </div>

      {data && <WeekStrip visits={data.upcoming} />}

      <div className="mb-3">
        <Tabs
          value={view}
          onChange={(k) => setView(k as ViewKey)}
          items={VIEWS.map((v) => ({ key: v.key, label: v.label, badge: data ? countLabel(data[v.key].length) : undefined }))}
        />
      </div>
      <Card padded={false} className="overflow-hidden">
        {error ? <ErrorState title="Could not load visits" description={error.message} /> : !data ? <CardSkeleton /> : (
          <SiteVisitsTable visits={data[view]} onChanged={refresh} empty={EMPTY[view]} />
        )}
      </Card>
    </div>
  );
}

const dayKey = (d: Date) => d.toLocaleDateString('en-CA');

/** Today and the six days after it, each with its open visits as time-and-name chips. */
function WeekStrip({ visits }: { visits: SiteVisit[] }) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const byDay = new Map<string, SiteVisit[]>();
  for (const v of visits) {
    const k = dayKey(new Date(v.scheduledAt));
    byDay.set(k, [...(byDay.get(k) ?? []), v]);
  }
  const inWeek = days.reduce((n, d) => n + (byDay.get(dayKey(d))?.length ?? 0), 0);
  const MAX = 4;

  return (
    <Panel className="mb-3">
      <PanelHeader
        title="This week"
        meta={inWeek ? `${inWeek} open ${inWeek === 1 ? 'visit' : 'visits'} in the next 7 days` : 'No open visits in the next 7 days'}
        action={
          <span className="hidden items-center gap-3 text-2xs text-ink-subtle sm:flex">
            <Legend className="bg-success-500" label="Confirmed" />
            <Legend className="bg-info-500" label="Scheduled" />
            <Legend className="bg-warning-500" label="Needs outcome" />
          </span>
        }
      />
      <div className="overflow-x-auto p-3">
        <ol className="grid min-w-[760px] grid-cols-7 gap-2">
          {days.map((d, i) => {
            const list = (byDay.get(dayKey(d)) ?? []).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
            const today = i === 0;
            return (
              <li
                key={dayKey(d)}
                className={cn(
                  'flex min-h-[92px] flex-col rounded-lg border p-2',
                  today ? 'border-brand-600 shadow-[inset_0_0_0_1px_var(--c-brand-600)]' : 'border-line',
                  !today && list.length === 0 && 'bg-surface-subtle'
                )}
              >
                <span className="mb-1.5 flex items-baseline justify-between gap-1">
                  <span className={cn('text-xs', today ? 'font-semibold text-brand-700' : 'text-ink-muted')}>
                    <span className="font-semibold">{today ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>{' '}
                    <span className="tabular-nums">{d.getDate()}</span>
                  </span>
                  {list.length > 0 && <span className="text-2xs tabular-nums text-ink-faint">{list.length}</span>}
                </span>
                <span className="flex flex-col gap-1">
                  {list.slice(0, MAX).map((v) => (
                    <Link
                      key={v.id}
                      to={`/crm/leads/${v.leadId}`}
                      title={`${v.leadName} · ${v.projectName} · host ${v.hostName ?? 'unassigned'}`}
                      className="flex min-w-0 items-center gap-1.5 rounded-md bg-surface-muted py-0.5 pl-1 pr-1.5 text-2xs transition-colors duration-100 hover:bg-line focus-ring"
                    >
                      <span
                        aria-hidden="true"
                        className={cn('h-3 w-[3px] shrink-0 rounded-full', v.needsOutcome ? 'bg-warning-500' : v.status === 'confirmed' ? 'bg-success-500' : 'bg-info-500')}
                      />
                      <span className="shrink-0 font-medium tabular-nums text-ink">{visitTime(v.scheduledAt)}</span>
                      <span className="truncate text-ink-muted">{v.leadName}</span>
                    </Link>
                  ))}
                  {list.length > MAX && <span className="px-1.5 text-2xs text-ink-subtle">+{list.length - MAX} more</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('h-2 w-2 rounded-[2px]', className)} aria-hidden="true" />
      {label}
    </span>
  );
}
