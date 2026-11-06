import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, CalendarCheck, ClipboardCheck, IndianRupee, Phone, PhoneCall, UserX } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { StatCard } from '../../components/ui/StatCard';
import { FilterChips } from '../../components/ui/FilterChips';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { AXIS_TICK } from '../../components/charts/chartColors';
import { useAsync } from '../../hooks/useAsync';
import { getTelecallerReport, type TelecallerRow } from '../../services/siteVisitService';
import { Panel, PanelHeader } from '../dashboard/widgets';
import { cn } from '../../utils/cn';

const iso = (d: Date) => d.toLocaleDateString('en-CA');
const today = () => iso(new Date());
/** Monday of this week, so "this week" is the working week so far. */
const weekStart = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
};
const monthStart = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};

const RANGES = [
  { key: 'today', label: 'Today', from: today },
  { key: 'week', label: 'This week', from: weekStart },
  { key: 'month', label: 'This month', from: monthStart },
] as const;

/** Each person's day: calls, connected calls, follow-ups, visits and bookings, plus who did nothing. */
/** A zero in a column of numbers is the absence of something; it reads quieter than a real count. */
const num = (n: number) => (n ? n : <span className="text-ink-faint">0</span>);

const TH = 'whitespace-nowrap px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle';

export function Telecallers() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const { data, isLoading, error } = useAsync(() => getTelecallerReport(from, to), [from, to]);

  const range = to === today() ? RANGES.find((r) => r.from() === from)?.key ?? 'custom' : 'custom';
  const sum = (k: keyof Pick<TelecallerRow, 'visitsDone' | 'followUpsOverdue' | 'talkMinutes'>) => data?.rows.reduce((s, r) => s + r[k], 0) ?? 0;
  const callers = data?.rows.filter((r) => r.calls > 0).length ?? 0;

  return (
    <div>
      <PageHeader title="Telecaller activity" description="Calls and follow-ups per person for a day or a range, with anyone who did nothing and was not on leave called out." breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Telecaller activity' }]} />
      <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2">
        <Input label="From" name="telFrom" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} wrapperClassName="w-40" />
        <Input label="To" name="telTo" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} wrapperClassName="w-40" />
        <FilterChips
          label="Date range"
          className="pb-0.5"
          value={range}
          onChange={(k) => { const r = RANGES.find((x) => x.key === k); if (r) { setFrom(r.from()); setTo(today()); } }}
          items={RANGES.map((r) => ({ key: r.key, label: r.label }))}
        />
        {isLoading && data && <span className="pb-1.5 text-xs text-ink-faint">Updating…</span>}
      </div>
      {error ? <ErrorState title="Could not load the report" description={error.message} /> : !data ? <CardSkeleton /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Calls" value={data.totals.calls} icon={Phone} tone="brand" footer={`${callers} of ${data.rows.length} people called`} />
            <StatCard label="Connected" value={data.totals.connected} icon={PhoneCall} tone="success" footer={`${data.totals.calls ? Math.round((data.totals.connected / data.totals.calls) * 100) : 0}% of calls · ${sum('talkMinutes')} min talk`} />
            <StatCard label="Follow-ups done" value={data.totals.followUpsDone} icon={ClipboardCheck} tone="shell"
              footer={sum('followUpsOverdue') ? <span className="text-danger-700">{sum('followUpsOverdue')} overdue</span> : 'none overdue'} />
            <StatCard label="Site visits" value={data.totals.visitsScheduled} icon={CalendarCheck} tone="info" footer={`${sum('visitsDone')} done`} />
            <StatCard label="Bookings" value={data.totals.bookings} icon={IndianRupee} tone="accent" footer={`${data.totals.newLeads} new leads`} />
          </div>

          <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <Leaderboard rows={data.rows} />
            <div className="flex flex-col gap-3">
              <Panel>
                <PanelHeader title="No activity" meta={data.zeroActivity.length ? `${data.zeroActivity.length} ${data.zeroActivity.length === 1 ? 'person' : 'people'}` : undefined} action={<UserX size={14} className="text-danger-600" aria-hidden="true" />} />
                <div className="px-4 py-3">
                  {data.zeroActivity.length === 0 ? <p className="text-[13px] text-ink-muted">Everyone did something.</p> : (
                    <div className="flex flex-wrap gap-1.5">
                      {data.zeroActivity.map((z) => (
                        <Link key={z.userId} to={`/crm/leads?assignedUserId=${z.userId}`} className="rounded-sm focus-ring"><Badge tone="danger">{z.name}</Badge></Link>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-ink-faint">No calls, no follow-ups done and no visits, and not on approved leave.</p>
                </div>
              </Panel>
              <Panel>
                <PanelHeader title="On approved leave" meta={data.onLeave.length ? `${data.onLeave.length}` : undefined} />
                <div className="px-4 py-3">
                  {data.onLeave.length === 0 ? <p className="text-[13px] text-ink-muted">Nobody.</p> : <div className="flex flex-wrap gap-1.5">{data.onLeave.map((z) => <Badge key={z.userId} tone="neutral">{z.name}</Badge>)}</div>}
                </div>
              </Panel>
            </div>
          </div>

          <Card padded={false} className="overflow-hidden">
            {data.rows.length === 0 ? <EmptyState title="No activity in this period" /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-[13px]">
                  <thead><tr className="border-b border-line bg-surface-subtle text-left">
                    <th className={cn(TH, 'pl-4')}>Person</th><th className={cn(TH, 'text-right')}>Calls</th><th className={cn(TH, 'text-right')}>Connected</th><th className={TH}>Connect rate</th><th className={cn(TH, 'text-right')}>Talk (min)</th>
                    <th className={cn(TH, 'text-right')}>New leads</th><th className={cn(TH, 'text-right')}>Follow-ups done</th><th className={cn(TH, 'text-right')}>Overdue</th>
                    <th className={cn(TH, 'text-right')}>Visits</th><th className={cn(TH, 'pr-4 text-right')}>Bookings</th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.userId} className="border-b border-line transition-colors duration-100 last:border-0 hover:bg-surface-subtle">
                        <td className="whitespace-nowrap py-1.5 pl-4 pr-3">
                          <span className="flex items-center gap-2">
                            <Avatar name={r.name} size="xs" />
                            <Link to={`/crm/leads?assignedUserId=${r.userId}`} className="font-medium text-ink hover:text-brand-700 focus-ring">{r.name}</Link>
                            {r.onLeave && <Badge tone="neutral">On leave</Badge>}{r.zeroActivity && <Badge tone="danger">No activity</Badge>}
                          </span>
                        </td>
                        <td className="px-3 text-right tabular-nums">{num(r.calls)}</td>
                        <td className="px-3 text-right tabular-nums">{num(r.connected)}</td>
                        <td className="px-3"><Rate calls={r.calls} rate={r.connectedRate} /></td>
                        <td className="px-3 text-right tabular-nums">{num(r.talkMinutes)}</td><td className="px-3 text-right tabular-nums">{num(r.newLeads)}</td><td className="px-3 text-right tabular-nums">{num(r.followUpsDone)}</td>
                        <td className={cn('px-3 text-right tabular-nums', r.followUpsOverdue > 0 && 'font-medium text-danger-700')}>{num(r.followUpsOverdue)}</td>
                        <td className="whitespace-nowrap px-3 text-right tabular-nums">{num(r.visitsScheduled)}{r.visitsDone ? <span className="ml-1 text-xs text-ink-faint">({r.visitsDone} done)</span> : null}</td>
                        <td className="pl-3 pr-4 text-right tabular-nums">{num(r.bookings)}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>)}
          </Card>
        </>
      )}
    </div>
  );
}

/** A thin bar and the percentage; nothing to show for someone who placed no calls. */
function Rate({ calls, rate }: { calls: number; rate: number }) {
  if (!calls) return <span className="text-ink-faint">—</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-sm bg-surface-muted" aria-hidden="true">
        <span className="block h-full rounded-sm bg-brand-600" style={{ width: `${Math.min(100, rate)}%` }} />
      </span>
      <span className={cn('w-9 text-right text-xs tabular-nums', rate ? 'text-ink-muted' : 'text-ink-faint')}>{rate}%</span>
    </span>
  );
}

/** Calls against connected calls for the ten busiest people, calls muted and connected in the accent. */
function Leaderboard({ rows }: { rows: TelecallerRow[] }) {
  const busiest = rows.filter((r) => r.calls > 0).slice(0, 10);
  const first = (n: string) => n.split(' ')[0];
  // Two Rohans would read as one person on the axis; the second word's initial tells them apart.
  const shared = new Set(busiest.map((r) => first(r.name)).filter((f, i, all) => all.indexOf(f) !== i));
  const top = busiest.map((r) => ({
    name: shared.has(first(r.name)) && r.name.includes(' ') ? `${first(r.name)} ${r.name.split(' ')[1][0]}.` : first(r.name),
    full: r.name,
    calls: r.calls,
    connected: r.connected,
  }));
  return (
    <Panel>
      <PanelHeader
        title="Leaderboard"
        meta={top.length ? `Calls vs connected · top ${top.length} by calls` : 'Calls vs connected'}
        action={top.length > 0 && (
          <span className="flex items-center gap-3 text-2xs text-ink-subtle">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-[color-mix(in_oklab,var(--c-ink-faint)_55%,transparent)]" aria-hidden="true" />Calls</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-brand-600" aria-hidden="true" />Connected</span>
          </span>
        )}
      />
      {top.length === 0 ? (
        <EmptyState icon={BarChart3} title="No calls in this period" description="The leaderboard fills in as people place calls." />
      ) : (
        <div className="h-[232px] px-2 pb-2 pt-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="24%">
              <CartesianGrid strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
              <Tooltip
                labelFormatter={(_, p) => p?.[0]?.payload?.full ?? ''}
                formatter={(v, name) => [Number(v), name === 'calls' ? 'Calls' : 'Connected']}
              />
              <Bar dataKey="calls" maxBarSize={16} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {top.map((r) => <Cell key={r.full} className="fill-[color-mix(in_oklab,var(--c-ink-faint)_55%,transparent)]" />)}
              </Bar>
              <Bar dataKey="connected" maxBarSize={16} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {top.map((r) => <Cell key={r.full} className="fill-brand-600" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
