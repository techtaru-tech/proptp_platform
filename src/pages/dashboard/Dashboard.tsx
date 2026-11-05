import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RotateCw, UserPlus, BarChart3 } from 'lucide-react';
import { CartesianGrid, Cell, ComposedChart, Bar, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/LoadingSkeleton';
import { AXIS_TICK } from '../../components/charts/chartColors';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../app/usePermissions';
import {
  getDashboardSnapshot, getRecentBookings, getRecentPayments, getRecentTickets, invalidateRecent, type DashboardSnapshot,
} from '../../services/dashboardService';
import { getManagementView, type ManagementView } from '../../services/channelPartnerService';
import { LEAD_SOURCE_META } from '../../constants/leadSources';
import { formatCurrency } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { BookingRow, SupportTicket } from '../../types';
import heroTowers from '../../assets/dashboard/hero-towers-full.webp';
import { Delta, Panel, PanelHeader, Row, Stat, ViewAll } from './widgets';
import { BarList, ColumnChart, DailyArea, Ring, SplitBar } from './charts';
import { compactMoney, percentChange, sinceLabel } from './dashboardMath';

export function Dashboard() {
  const [reload, setReload] = useState(0);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const snapshot = useAsync(() => getDashboardSnapshot(), [reload]);
  const { data: view } = useAsync(() => getManagementView(), [reload]);
  // The three lists below share one request (see dashboardService.recent).
  const { data: bookings, isLoading: bookingsLoading } = useAsync(() => getRecentBookings(10), [reload]);
  const { data: payments } = useAsync(() => getRecentPayments(10), [reload]);
  const { data: tickets } = useAsync(() => getRecentTickets(10), [reload]);

  useEffect(() => {
    if (snapshot.data) setLoadedAt(Date.now());
  }, [snapshot.data]);

  const refresh = () => {
    invalidateRecent();
    setReload((r) => r + 1);
  };
  const s = snapshot.data;
  // Every row is a grid whose cards stretch to the tallest one, so no column ever ends early.
  const row = 'grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="space-y-4">
      <Masthead view={view} loadedAt={loadedAt} refreshing={snapshot.isLoading && !!s} onRefresh={refresh} offline={!!snapshot.error} />

      {snapshot.error && !s ? (
        <Panel>
          <ErrorState title="Couldn't load the overview" description={snapshot.error.message} onRetry={refresh} />
        </Panel>
      ) : (
        <StatStrip s={s} view={view} />
      )}

      <div className={row}>
        <div className="lg:col-span-2"><Collections trend={s?.collectionTrend} /></div>
        <div className="lg:col-span-2 xl:col-span-1"><Pipeline view={view} /></div>
      </div>

      <div className={row}>
        <BookingsByMonth s={s} />
        <Inventory s={s} />
        <LeadSources view={view} />
      </div>

      <div className={row}>
        <DailyBookings s={s} />
        <PaymentMix s={s} />
        <TeamToday s={s} />
      </div>

      <div className={row}>
        <div className="lg:col-span-2"><RecentBookings rows={(bookings ?? []).slice(0, 8)} loading={bookingsLoading && !bookings} /></div>
        <div className="lg:col-span-2 xl:col-span-1"><Activity payments={payments ?? []} tickets={tickets ?? []} /></div>
      </div>

      <AfterTheSale view={view} s={s} />
    </div>
  );
}

/* ------------------------------------------------------------------ masthead */

function Masthead({
  view, loadedAt, refreshing, onRefresh, offline,
}: { view?: ManagementView; loadedAt: number; refreshing: boolean; onRefresh: () => void; offline: boolean }) {
  const { session } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  // The stamp counts minutes, so a minute tick is all it needs.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const pending = view?.bookings?.pending.count ?? 0;
  const overdue = view?.collections;
  const today = new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <section className="relative overflow-hidden rounded-xl bg-[#041a31] text-white xl:h-[240px] 2xl:h-[272px]">
      {/* The whole photograph (Unsplash License), never cropped: it keeps its own proportions and
          sits on the right on wide screens, on top on narrow ones. Bundled, so the page never
          waits on another host. */}
      <div className="relative xl:absolute xl:inset-y-0 xl:right-0">
        <img
          src={heroTowers} alt="" aria-hidden="true" decoding="async" fetchPriority="high" width={1600} height={600}
          className="mx-auto block h-auto max-h-[300px] w-auto max-w-full xl:h-full xl:max-h-none xl:max-w-none"
        />
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-2/5 bg-[linear-gradient(90deg,#041a31,rgba(4,26,49,0.75)_35%,transparent)] xl:block" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-[linear-gradient(0deg,#041a31,transparent)] xl:hidden" />
      </div>

      <div className="relative flex h-full flex-col justify-end gap-4 px-5 pb-5 pt-1 sm:px-7 sm:pb-6 xl:max-w-[min(560px,60%)] xl:pt-6">
        <div className="min-w-0">
          <p className="text-xs font-medium text-white/65">{greeting}, {session?.name?.split(' ')[0] ?? 'there'} · {today}</p>
          <h1 className="mt-1.5 text-[28px] font-bold leading-tight text-white">Overview</h1>
          <p className="mt-2 min-h-5 text-[13px] text-white/85">
            {!view ? null : pending > 0 ? <Link to="/bookings/pending" className="underline decoration-white/30 underline-offset-2 hover:decoration-white">{pending} booking{pending === 1 ? '' : 's'} awaiting confirmation</Link> : 'No bookings awaiting confirmation'}
            {overdue && overdue.overdueCount > 0 && (
              <> · <Link to={overdue.to} className="text-[#f5c04f] underline decoration-[#f5c04f]/40 underline-offset-2 hover:decoration-[#f5c04f]">{formatCurrency(overdue.overdue)} overdue on {overdue.overdueCount} instalment{overdue.overdueCount === 1 ? '' : 's'}</Link></>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <span className="mx-1 flex items-center gap-1.5 text-xs text-white/60" aria-live="polite">
            <span className={cn('h-1.5 w-1.5 rounded-full', offline ? 'bg-danger-500' : 'bg-brand-400')} aria-hidden="true" />
            {offline ? 'Server unreachable' : `Updated ${sinceLabel(loadedAt, now)}`}
          </span>
          <button
            type="button" onClick={onRefresh} disabled={refreshing}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-white/20 px-2.5 text-sm font-medium text-white/90 transition-colors duration-150 hover:bg-white/10 disabled:opacity-60 focus-ring"
          >
            <RotateCw size={13} className={cn(refreshing && 'animate-spin')} /> Refresh
          </button>
          {can('crm') && (
            <button
              type="button" onClick={() => navigate('/crm/leads/new')}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-white/20 px-2.5 text-sm font-medium text-white/90 transition-colors duration-150 hover:bg-white/10 focus-ring"
            >
              <UserPlus size={13} /> Add lead
            </button>
          )}
          {can('reports') && (
            <Button variant="primary" leftIcon={<BarChart3 size={13} />} onClick={() => navigate('/reports')}>Reports</Button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ stat strip */

function StatStrip({ s, view }: { s?: DashboardSnapshot; view?: ManagementView }) {
  // A one-pixel gap over the line colour draws the dividers, and keeps them right when the strip wraps.
  const strip = 'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 xl:grid-cols-6 [&>*]:bg-surface';
  if (!s) {
    return (
      <div className={strip} aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 px-4 py-3"><Skeleton className="h-3 w-20" /><Skeleton className="h-5 w-24" /><Skeleton className="h-3 w-28" /></div>
        ))}
      </div>
    );
  }
  const m = s.monthCompare;
  const occupied = s.units.total ? ((s.units.booked + s.units.soldOut) / s.units.total) * 100 : 0;
  const billed = s.payments.collected + s.payments.remaining;

  return (
    <div className={strip}>
      <Stat
        label="Collected, all time" to="/transactions" value={formatCurrency(s.payments.collected)}
        meta={<>{formatCurrency(m.collectedThisMonth)} this month <Delta value={percentChange(m.collectedThisMonth, m.collectedLastMonthToDate)} /></>}
      />
      <Stat
        label="Still to collect" to="/bookings/remaining" value={formatCurrency(s.payments.remaining)}
        meta={billed ? `${((s.payments.collected / billed) * 100).toFixed(1)}% of booked value in` : undefined}
      />
      <Stat
        label="Confirmed bookings" to="/bookings/booked" value={s.bookings.confirmed}
        meta={<>{m.confirmedThisMonth} this month · {s.bookings.pending} pending</>}
      />
      <Stat
        label="Available units" to="/projects" value={<>{s.units.available}<span className="text-sm font-normal text-ink-faint"> / {s.units.total}</span></>}
        meta={`${occupied.toFixed(1)}% booked or sold`}
      />
      {view?.expectedBusiness ? (
        <Stat
          label="Open pipeline" to={view.expectedBusiness.to} value={formatCurrency(view.expectedBusiness.value)}
          meta={`${view.expectedBusiness.leads} open leads`}
        />
      ) : <Stat label="Open tickets" to="/support" value={s.support.open} meta={`${s.support.pendingReplies} awaiting reply`} />}
      {view?.collections ? (
        <Stat
          label="Overdue instalments" to={view.collections.to} value={formatCurrency(view.collections.overdue)}
          tone={view.collections.overdueCount > 0 ? 'danger' : undefined}
          meta={view.collections.overdueCount ? `${view.collections.overdueCount} instalments past due` : 'Nothing past due'}
        />
      ) : <Stat label="Present today" to="/attendance/today" value={s.attendance.present} meta={`${s.attendance.late} late`} />}
    </div>
  );
}

/* ------------------------------------------------------------------ collections chart */

const RANGES = [{ key: '6M', months: 6 }, { key: '12M', months: 12 }, { key: '24M', months: 24 }] as const;

function Collections({ trend }: { trend?: DashboardSnapshot['collectionTrend'] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('12M');
  const months = RANGES.find((r) => r.key === range)!.months;
  const data = useMemo(
    () => (trend ?? []).slice(-months).map((p) => ({ ...p, label: months > 12 ? `${p.month} ’${String(p.year).slice(2)}` : p.month })),
    [trend, months]
  );
  const total = data.reduce((a, p) => a + p.collection, 0);
  const previous = data.reduce((a, p) => a + p.lastYear, 0);
  const best = data.reduce((b, p) => (p.collection > b.collection ? p : b), data[0] ?? { collection: 0, key: '' });

  return (
    <Panel className="h-full">
      <PanelHeader
        title="Collections"
        meta={trend ? <>{formatCurrency(total)} in {months} months{previous > 0 && <> · <Delta value={percentChange(total, previous)} /> on the year before</>}</> : undefined}
        action={
          <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Chart range">
            {RANGES.map((r) => (
              <button
                key={r.key} type="button" onClick={() => setRange(r.key)} aria-pressed={range === r.key}
                className={cn('rounded-sm px-2 py-0.5 text-xs font-medium tabular-nums transition-colors duration-100 focus-ring', range === r.key ? 'bg-surface-muted text-ink' : 'text-ink-subtle hover:text-ink')}
              >
                {r.key}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex-1 px-2 pb-2 pt-3">
        {!trend ? <Skeleton className="mx-2 h-[248px]" /> : (
          <div className="h-[248px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={months > 12 ? 2 : 0} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compactMoney} width={44} />
                <Tooltip
                  formatter={(v, name) => [formatCurrency(Number(v)), name === 'collection' ? 'Collected' : 'Same month, year before']}
                  labelFormatter={(_, p) => (p?.[0]?.payload ? `${p[0].payload.month} ${p[0].payload.year}` : '')}
                />
                <Bar dataKey="collection" maxBarSize={22} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {data.map((p, i) => (
                    <Cell key={p.key} className={i === data.length - 1 ? 'fill-brand-600' : 'fill-[var(--c-line-strong)]'} />
                  ))}
                  {/* Only the best month carries a label; the tooltip has the rest. */}
                  <LabelList
                    dataKey="collection" position="top"
                    content={({ x, y, width, value, index }) =>
                      data[index as number]?.key === best.key && Number(value) > 0 ? (
                        <text x={Number(x) + Number(width) / 2} y={Number(y) - 5} textAnchor="middle" className="fill-[var(--c-ink-muted)] text-[10px] font-medium">
                          {compactMoney(Number(value))}
                        </text>
                      ) : null
                    }
                  />
                </Bar>
                {previous > 0 && <Line dataKey="lastYear" stroke="var(--c-ink-faint)" className="[&_path]:stroke-[var(--c-ink-faint)]" strokeWidth={1.25} strokeDasharray="3 3" dot={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="px-2 pt-1 text-xs text-ink-faint">
          <span className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-brand-600 align-middle" aria-hidden="true" />this month
          {previous > 0 && <><span className="ml-3 mr-1 inline-block w-3 border-t border-dashed border-ink-faint align-middle" aria-hidden="true" />same month, year before</>}
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ pipeline */

function Pipeline({ view }: { view?: ManagementView }) {
  const stages = view?.pipeline ?? [];
  const all = stages.reduce((a, s) => a + s.leads, 0);
  const won = stages.filter((s) => s.isWon).reduce((a, s) => a + s.leads, 0);
  const max = Math.max(1, ...stages.map((s) => s.leads));

  if (view && !view.pipeline) return null;
  return (
    <Panel className="h-full">
      <PanelHeader
        title="Pipeline"
        meta={all ? <>{((won / all) * 100).toFixed(1)}% won · {won} of {all}</> : undefined}
        action={<ViewAll to="/crm/pipeline" label="Board" />}
      />
      {!view ? <div className="space-y-2.5 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-3" />)}</div> : stages.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-ink-subtle">No leads in a pipeline yet. <Link to="/crm/leads/new" className="font-medium text-brand-700 hover:underline">Add a lead</Link></p>
      ) : (
        <ul className="py-1.5">
          {stages.map((s) => (
            <li key={s.stageId}>
              <Link to={s.to} className="grid grid-cols-[minmax(0,7.5rem)_1fr_2rem] items-center gap-3 px-4 py-1.5 text-[13px] transition-colors duration-100 hover:bg-surface-subtle focus-ring">
                <span className={cn('truncate', s.isLost ? 'text-ink-faint' : 'text-ink-muted')} title={s.name}>{s.name}</span>
                <span className="h-1.5 rounded-sm bg-surface-muted">
                  <span
                    className={cn('block h-1.5 rounded-sm', s.isWon ? 'bg-brand-600' : s.isLost ? 'bg-ink-faint/50' : 'bg-brand-300')}
                    style={{ width: `${(s.leads / max) * 100}%` }}
                  />
                </span>
                <span className="text-right font-medium tabular-nums text-ink">{s.leads}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ chart panels */

function ChartPanel({ title, meta, action, loading, children }: { title: string; meta?: React.ReactNode; action?: React.ReactNode; loading?: boolean; children: React.ReactNode }) {
  return (
    <Panel className="h-full">
      <PanelHeader title={title} meta={meta} action={action} />
      <div className="flex flex-1 flex-col justify-center p-4">{loading ? <Skeleton className="h-[170px] w-full" /> : children}</div>
    </Panel>
  );
}

function BookingsByMonth({ s }: { s?: DashboardSnapshot }) {
  const data = (s?.collectionTrend ?? []).slice(-12).map((p) => ({ label: p.month, value: p.bookings, title: `${p.month} ${p.year}` }));
  const total = data.reduce((a, p) => a + p.value, 0);
  return (
    <ChartPanel title="Bookings confirmed" meta={s ? `${total} in 12 months` : undefined} action={<ViewAll to="/bookings/booked" />} loading={!s}>
      <ColumnChart data={data} height={180} format={(v) => `${v} booking${v === 1 ? '' : 's'}`} />
    </ChartPanel>
  );
}

function Inventory({ s }: { s?: DashboardSnapshot }) {
  const u = s?.units;
  const taken = u ? u.booked + u.soldOut : 0;
  return (
    <ChartPanel title="Inventory" meta={u ? `${u.total} units across ${s!.properties.total} projects` : undefined} action={<ViewAll to="/properties" label="Units" />} loading={!s}>
      {u && (
        <Ring
          centre={`${u.total ? ((taken / u.total) * 100).toFixed(0) : 0}%`} caption="taken"
          slices={[
            { name: 'Booked', value: u.booked, tone: 'fill-brand-600 bg-brand-600', to: '/properties/booked' },
            { name: 'Sold out', value: u.soldOut, tone: 'fill-brand-300 bg-brand-300', to: '/properties/sold-out' },
            { name: 'Available', value: u.available, tone: 'fill-[var(--c-line-strong)] bg-line-strong', to: '/properties/running' },
          ]}
        />
      )}
    </ChartPanel>
  );
}

function LeadSources({ view }: { view?: ManagementView }) {
  if (view && !view.sources) return null;
  const sources = view?.sources ?? [];
  const total = sources.reduce((a, x) => a + x.leads, 0);
  return (
    <ChartPanel title="Where leads come from" meta={total ? `${total} leads` : undefined} action={<ViewAll to="/crm/leads" label="Leads" />} loading={!view}>
      {total === 0 ? <p className="text-center text-xs text-ink-subtle">No leads yet.</p> : (
        <BarList rows={sources.slice(0, 6).map((x) => ({ name: LEAD_SOURCE_META[x.source]?.label ?? x.source, value: x.leads, to: x.to }))} />
      )}
    </ChartPanel>
  );
}

function DailyBookings({ s }: { s?: DashboardSnapshot }) {
  const data = (s?.bookingTrend ?? []).map((d) => {
    const [m, day] = d.date.split('-').map(Number);
    return { label: `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`, value: d.bookings };
  });
  const total = data.reduce((a, p) => a + p.value, 0);
  return (
    <ChartPanel title="Bookings, last 14 days" meta={s ? `${total} new · ${s.bookings.today} today` : undefined} loading={!s}>
      <DailyArea data={data} height={180} />
    </ChartPanel>
  );
}

function PaymentMix({ s }: { s?: DashboardSnapshot }) {
  const rows = (s?.paymentOverview ?? []).filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  return (
    <ChartPanel title="How buyers pay" meta={s ? `${formatCurrency(s.payments.collected)} received` : undefined} action={<ViewAll to="/transactions" label="Payments" />} loading={!s}>
      {rows.length === 0 ? <p className="text-center text-xs text-ink-subtle">No payments recorded yet.</p> : (
        <BarList rows={rows.map((p) => ({ name: p.name, value: p.value, to: '/transactions' }))} format={formatCurrency} />
      )}
    </ChartPanel>
  );
}

function TeamToday({ s }: { s?: DashboardSnapshot }) {
  const { can } = usePermissions();
  if (!can('attendance') && !can('support')) return null;
  const a = s?.attendance;
  return (
    <ChartPanel title="Team today" meta={a ? `${a.present} of ${a.present + a.absent} in` : undefined} action={<ViewAll to="/attendance/today" label="Attendance" />} loading={!s}>
      {a && s && (
        <div className="space-y-4">
          <SplitBar parts={[
            { name: 'Working', value: a.checkedIn, tone: 'bg-brand-600' },
            { name: 'Checked out', value: a.checkedOut, tone: 'bg-brand-300' },
            { name: 'Not in', value: a.absent, tone: 'bg-line-strong' },
          ]} />
          <dl className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line text-center">
            <div className="px-2 py-2"><dt className="text-2xs text-ink-subtle">Late</dt><dd className="text-base font-semibold tabular-nums text-ink">{a.late || '—'}</dd></div>
            <Link to="/support" className="px-2 py-2 hover:bg-surface-subtle focus-ring"><dt className="text-2xs text-ink-subtle">Open tickets</dt><dd className="text-base font-semibold tabular-nums text-ink">{s.support.open || '—'}</dd></Link>
            <Link to="/support" className="px-2 py-2 hover:bg-surface-subtle focus-ring"><dt className="text-2xs text-ink-subtle">Awaiting reply</dt><dd className={cn('text-base font-semibold tabular-nums', s.support.pendingReplies ? 'text-accent-600' : 'text-ink')}>{s.support.pendingReplies || '—'}</dd></Link>
          </dl>
        </div>
      )}
    </ChartPanel>
  );
}

/* ------------------------------------------------------------------ recent bookings */

function RecentBookings({ rows, loading }: { rows: BookingRow[]; loading: boolean }) {
  const navigate = useNavigate();
  return (
    <Panel className="h-full overflow-hidden">
      <PanelHeader title="Recent bookings" action={<ViewAll to="/bookings" />} />
      <div className="flex-1 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-surface-subtle text-left text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
              <th scope="col" className="px-4 py-2 font-semibold">Ref</th>
              <th scope="col" className="px-3 py-2 font-semibold">Buyer · project</th>
              <th scope="col" className="px-3 py-2 font-semibold">Status</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}><td colSpan={4} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td></tr>
            )) : rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-subtle">No bookings yet. <Link to="/bookings" className="font-medium text-brand-700 hover:underline">Record one</Link></td></tr>
            ) : rows.map((b) => (
              <tr key={b.id} onClick={() => navigate(`/bookings/${b.id}`)} className="cursor-pointer transition-colors duration-100 hover:bg-surface-subtle">
                <td className="whitespace-nowrap px-4 py-2">
                  <span className="block font-mono text-xs text-ink-muted">{b.reference || b.id}</span>
                  <span className="block text-xs text-ink-faint">{when(b.createdAt)}</span>
                </td>
                <td className="max-w-0 px-3 py-2">
                  <span className="block truncate font-medium text-ink" title={b.bookingName}>{b.bookingName}</span>
                  <span className="block truncate text-xs text-ink-subtle" title={`${b.projectName} · ${b.unitLabel}`}>{b.projectName} · {b.unitLabel.split(' · ')[0]}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2"><StatusBadge kind="booking" status={b.status} /></td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums text-ink">{formatCurrency(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ activity */

/** "8 min ago", "3 h ago", "Yesterday, 4:12 pm", "Mon, 11:05 am", "12 Oct". */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const min = Math.round((now.getTime() - d.getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (d.getTime() >= startOfToday) return `${Math.round(min / 60)} h ago`;
  if (d.getTime() >= startOfToday - 86400000) return `Yesterday, ${time}`;
  if (d.getTime() >= startOfToday - 6 * 86400000) return `${d.toLocaleDateString('en-IN', { weekday: 'short' })}, ${time}`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

interface ActivityItem { key: string; at: string; kind: string; text: string; sub: string; to: string }

function Activity({ payments, tickets }: { payments: BookingRow[]; tickets: SupportTicket[] }) {
  const items: ActivityItem[] = [
    ...payments.map((b): ActivityItem => b.isDeposit === 1
      ? { key: `p${b.id}`, at: b.createdAt, kind: 'Payment', text: `${formatCurrency(b.amount)} from ${b.bookingName}`, sub: b.projectName, to: `/bookings/${b.id}` }
      : { key: `b${b.id}`, at: b.createdAt, kind: 'Booking', text: `${b.bookingName} booked ${b.unitLabel.split(' · ')[0]}`, sub: `${b.projectName} · ${formatCurrency(b.amount)}`, to: `/bookings/${b.id}` }),
    ...tickets.map((t): ActivityItem => ({
      key: `t${t.id}`, at: t.lastReplyAt ?? t.updatedAt, kind: 'Ticket', text: t.subject, sub: t.userName, to: `/support/${t.id}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);

  return (
    <Panel className="h-full">
      <PanelHeader title="Activity" meta={items.length ? `latest ${items.length}` : undefined} action={<ViewAll to="/transactions" />} />
      {/* On wide screens the list takes the height the bookings table sets and scrolls inside it. */}
      <div className="relative min-h-[240px] flex-1">
        {items.length === 0 ? <p className="px-4 py-6 text-center text-xs text-ink-subtle">Nothing recorded yet.</p> : (
          <ol className="divide-y divide-line overflow-y-auto xl:absolute xl:inset-0">
            {items.map((it) => (
              <li key={it.key}>
                <Link to={it.to} className="block px-4 py-2 transition-colors duration-100 hover:bg-surface-subtle focus-ring">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] text-ink" title={it.text}>{it.text}</span>
                    <time dateTime={it.at} className="shrink-0 text-xs text-ink-faint">{when(it.at)}</time>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-subtle">
                    <span className="font-medium text-ink-muted">{it.kind}</span> · {it.sub}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ after the sale */

function AfterTheSale({ view, s }: { view?: ManagementView; s?: DashboardSnapshot }) {
  const post = view?.postSales;
  if (!post && !view?.partners?.length && !s) return null;

  return (
    <div>
      <h2 className="mb-2 px-0.5 font-sans text-2xs font-semibold uppercase tracking-wider text-ink-subtle">After the sale</h2>
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {(post || view?.bookings) && (
          <Panel className="h-full">
            <PanelHeader title="Bookings to possession" />
            <ul className="divide-y divide-line">
              {view?.bookings && <Row to={view.bookings.pending.to} label="Awaiting confirmation" value={view.bookings.pending.count} sub={formatCurrency(view.bookings.pending.amount)} />}
              {post && <>
                <Row to={post.agreementNotStarted.to} label="Agreement not started" value={post.agreementNotStarted.count} />
                <Row to={post.registryInProgress.to} label="Registry in progress" value={post.registryInProgress.count} />
                <Row to={post.possessionPending.to} label="Registered, not handed over" value={post.possessionPending.count} />
                <Row to={post.possessed.to} label="Possession given" value={post.possessed.count || '—'} />
                <Row to="/legal" label="Loans waiting on the bank" value={post.loansAwaitingBank || '—'} />
              </>}
            </ul>
          </Panel>
        )}

        {view?.partners && view.partners.length > 0 && (
          <Panel className="h-full">
            <PanelHeader title="Top channel partners" meta="by booking value" action={<ViewAll to="/channel-partners" />} />
            <div className="flex-1 p-4">
              <BarList
                rows={view.partners.map((p) => ({ name: `${p.name} · ${p.bookings} bkg`, value: p.value, to: p.to }))}
                format={formatCurrency} showShare={false}
              />
            </div>
          </Panel>
        )}

        {s && (
          <Panel className="h-full">
            <PanelHeader title="Sales network" meta={`${s.partners.active} active`} action={<ViewAll to="/channel-partners" label="People" />} />
            <div className="flex flex-1 flex-col justify-center p-4">
              <Ring
                centre={String(s.partners.agents + s.partners.employees + s.partners.leaders)} caption="people"
                slices={[
                  { name: 'Channel partners', value: s.partners.agents, tone: 'fill-brand-600 bg-brand-600', to: '/channel-partners' },
                  { name: 'Leaders', value: s.partners.leaders, tone: 'fill-brand-300 bg-brand-300', to: '/users/leaders' },
                  { name: 'Employees', value: s.partners.employees, tone: 'fill-[var(--c-line-strong)] bg-line-strong', to: '/users/employees' },
                ]}
              />
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
