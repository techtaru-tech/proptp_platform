import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GitBranch, Plus, Printer, RotateCw, SendHorizontal, Sparkles, X } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/LoadingSkeleton';
import { LeadSourceBadge } from '../../components/leads/LeadSourceBadge';
import { useAsync } from '../../hooks/useAsync';
import { listPipelines, listStages } from '../../services/pipelineService';
import { listAdSources } from '../../services/leadService';
import { refAssignees } from '../../data/referenceData';
import { getCrmOverview, type CrmOverview as Overview, type CrmOverviewFilters } from '../../services/crmOverviewService';
import { CRM_ANALYST_SUGGESTIONS } from '../../services/crmAgentService';
import { CrmAnalyst } from './CrmAnalyst';
import { Anchor, AskAi, AskContext, SavedViews, SectionNav } from './crmOverviewParts';
import { formatCurrency } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { LeadSource } from '../../types';
import { Delta, Panel, PanelHeader, Row, Stat, ViewAll } from '../dashboard/widgets';
import { BarList, ColumnChart, Funnel, Heatmap, Ring, SplitBar, TrendCombo } from '../dashboard/charts';

const FILTER_KEYS = ['from', 'to', 'pipelineId', 'formName', 'assignedUserId', 'stageId'] as const;

const IST = { timeZone: 'Asia/Kolkata' } as const;
const isoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', IST).format(d);
const daysBack = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));
const QUICK = [
  { label: 'Today', from: () => daysBack(0) },
  { label: '7 days', from: () => daysBack(6) },
  { label: '30 days', from: () => daysBack(29) },
  { label: '90 days', from: () => daysBack(89) },
  { label: 'This month', from: () => `${isoDay(new Date()).slice(0, 8)}01` },
];

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function talk(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} m` : `${m} m`;
}
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');
const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** CRM Overview: every CRM section at a glance, narrowed by the same filters throughout. */
export function CrmOverview() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters: CrmOverviewFilters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as CrmOverviewFilters;
  const key = FILTER_KEYS.map((k) => params.get(k) ?? '').join('|');
  const [reload, setReload] = useState(0);

  const overview = useAsync(() => getCrmOverview(filters), [key, reload]);
  // Refreshes itself every five minutes, so a screen left open on the wall stays current.
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (overview.data) setLoadedAt(Date.now()); }, [overview.data]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const refresh = window.setInterval(() => setReload((r) => r + 1), 5 * 60_000);
    return () => { window.clearInterval(tick); window.clearInterval(refresh); };
  }, []);
  const updatedMin = Math.floor((now - loadedAt) / 60_000);
  const pipelines = useAsync(() => listPipelines(), []);
  const adSources = useAsync(() => listAdSources(), []);
  const stagePipelineId = filters.pipelineId || overview.data?.pipeline?.id || '';
  const stages = useAsync(() => (stagePipelineId ? listStages(stagePipelineId) : Promise.resolve([])), [stagePipelineId]);

  const set = (patch: Partial<CrmOverviewFilters>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    // A stage belongs to one pipeline; changing the pipeline drops it.
    if ('pipelineId' in patch) next.delete('stageId');
    setParams(next, { replace: true });
  };
  const active = FILTER_KEYS.filter((k) => params.get(k));
  const o = overview.data;

  // The analyst sees what the page shows: the same filters, with names instead of ids.
  const [analystOpen, setAnalystOpen] = useState(false);
  const [handOver, setHandOver] = useState<string | undefined>();
  const [bottomAsk, setBottomAsk] = useState('');
  const labels: Record<string, string> = {};
  if (filters.pipelineId) labels.pipelineId = pipelines.data?.find((p) => p.id === filters.pipelineId)?.name ?? '';
  if (filters.stageId) labels.stageId = stages.data?.find((s) => s.id === filters.stageId)?.name ?? '';
  if (filters.assignedUserId) labels.assignedUserId = filters.assignedUserId === 'unassigned' ? 'Unassigned' : refAssignees.find((u) => u.id === filters.assignedUserId)?.name ?? '';
  const contextSummary = active.length
    ? active.map((k) => `${k === 'from' ? 'From' : k === 'to' ? 'To' : k === 'formName' ? 'Form' : k === 'pipelineId' ? 'Pipeline' : k === 'stageId' ? 'Stage' : 'Owner'}: ${labels[k] || params.get(k)}`).join(' · ')
    : 'No filters — every lead you can see';
  const ask = (q: string) => { const text = q.trim(); if (!text) return; setHandOver(text); setAnalystOpen(true); };

  const sections = useMemo(() => [
    { id: 'crm-numbers', label: 'Numbers' }, { id: 'crm-trend', label: 'Trend' },
    { id: 'crm-funnel', label: 'Funnel' }, { id: 'crm-speed', label: 'Speed' }, { id: 'crm-sources', label: 'Sources' },
    { id: 'crm-waiting', label: 'Waiting' }, { id: 'crm-activity', label: 'Follow-ups · visits · calls' }, { id: 'crm-team', label: 'Team' },
    { id: 'crm-demand', label: 'Demand' }, { id: 'crm-health', label: 'Pipeline health' }, { id: 'crm-forms', label: 'Forms' },
    { id: 'crm-channels', label: 'Channels' }, { id: 'crm-latest', label: 'Latest leads' }, { id: 'crm-analyst', label: '✦ AI Analyst' },
  ], []);

  return (
    <AskContext.Provider value={ask}>
    <div className="space-y-4">
      <PageHeader
        title="CRM Overview"
        description="Leads, pipeline, follow-ups, site visits, calls, the team and every channel — filtered the same way throughout."
        actions={<>
          <Button variant="outline" leftIcon={<RotateCw size={13} className={cn(overview.isLoading && o && 'animate-spin')} />} onClick={() => setReload((r) => r + 1)}>Refresh</Button>
          <Button variant="outline" leftIcon={<Sparkles size={14} className="text-brand-600" />} onClick={() => setAnalystOpen(true)}>Ask AI analyst</Button>
          <Button variant="outline" leftIcon={<Printer size={14} />} onClick={() => window.print()} className="hidden sm:inline-flex">Print</Button>
          <Button variant="outline" leftIcon={<GitBranch size={14} />} onClick={() => navigate('/crm/pipeline/kanban')}>Kanban</Button>
          <Button leftIcon={<Plus size={14} />} onClick={() => navigate('/crm/leads/new')}>Add lead</Button>
        </>}
      />

      {/* ------------------------------------------------------------ filters */}
      <Panel className="print:hidden">
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Input label="From" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          <Input label="To" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          <Select
            label="Pipeline" value={filters.pipelineId} onChange={(e) => set({ pipelineId: e.target.value })}
            options={[{ value: '', label: 'All pipelines' }, ...(pipelines.data ?? []).map((p) => ({ value: p.id, label: p.name }))]}
          />
          <Select
            label="Ad form" value={filters.formName} onChange={(e) => set({ formName: e.target.value })}
            options={[{ value: '', label: 'All forms' }, ...(adSources.data?.forms ?? []).map((f) => ({ value: f.name, label: `${f.name} (${f.count})` }))]}
          />
          <Select
            label="Assigned to" value={filters.assignedUserId} onChange={(e) => set({ assignedUserId: e.target.value })}
            options={[{ value: '', label: 'Anyone' }, { value: 'unassigned', label: 'Unassigned' }, ...refAssignees.map((u) => ({ value: u.id, label: u.name }))]}
          />
          <Select
            label="Stage" value={filters.stageId} onChange={(e) => set({ stageId: e.target.value })}
            options={[{ value: '', label: 'All stages' }, ...(stages.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          <span className="text-xs text-ink-subtle">Quick range</span>
          {QUICK.map((q) => {
            const from = q.from();
            const on = filters.from === from && !filters.to;
            return (
              <button
                key={q.label} type="button" onClick={() => set({ from, to: '' })} aria-pressed={on}
                className={cn('h-7 rounded-md border px-2.5 text-xs transition-colors duration-100 focus-ring', on ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink')}
              >
                {q.label}
              </button>
            );
          })}
          <SavedViews query={params.toString()} apply={(q) => setParams(new URLSearchParams(q), { replace: true })} />
          <span className="ml-auto text-xs text-ink-subtle">
            {o ? `Updated ${updatedMin < 1 ? 'just now' : `${updatedMin} min ago`} · ` : ''}
            {o ? (o.window.defaulted ? 'Leads: all time · activity: last 30 days' : `${shortDate(o.window.from)} – ${shortDate(o.window.to)}`) : ''}
          </span>
          {active.length > 0 && (
            <Button variant="ghost" size="sm" leftIcon={<X size={13} />} onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear {active.length} filter{active.length === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      </Panel>

      <SectionNav sections={sections} />

      <CrmAnalyst
        open={analystOpen}
        onClose={() => setAnalystOpen(false)}
        context={{ page: 'CRM Overview', filters: Object.fromEntries(active.map((k) => [k, params.get(k) ?? ''])), labels }}
        contextSummary={contextSummary}
        question={handOver}
        onQuestionTaken={() => setHandOver(undefined)}
      />

      {overview.error && !o ? (
        <Panel><ErrorState title="Couldn't load the overview" description={overview.error.message} onRetry={() => setReload((r) => r + 1)} /></Panel>
      ) : !o ? <OverviewSkeleton /> : <Body o={o} filters={filters} />}

      {/* ------------------------------------------------------------ ask again, at the end of the page */}
      <Anchor id="crm-analyst" />
      <form
        className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 sm:p-5 print:hidden"
        onSubmit={(e) => { e.preventDefault(); ask(bottomAsk); setBottomAsk(''); }}
      >
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-brand-800"><Sparkles size={16} aria-hidden="true" />Ask the CRM anything</span>
          <span className="text-2xs text-ink-subtle">Uses the filters above · read-only</span>
        </div>
        <div className="relative">
          <input
            value={bottomAsk} onChange={(e) => setBottomAsk(e.target.value)} aria-label="Ask the CRM analyst"
            placeholder="e.g. Kaun se source se sabse zyada booking aa rahi hai, aur kahan leads atak rahi hain?"
            className="h-11 w-full rounded-lg border border-line-strong bg-surface pl-3.5 pr-12 text-[13px] text-ink placeholder:text-ink-faint focus-ring"
          />
          <button type="submit" aria-label="Ask" disabled={!bottomAsk.trim()} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 focus-ring"><SendHorizontal size={14} /></button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CRM_ANALYST_SUGGESTIONS.slice(0, 4).map((q) => (
            <button key={q} type="button" onClick={() => ask(q)} title={q} className="max-w-full truncate rounded-md border border-brand-200 bg-surface px-2.5 py-1.5 text-xs text-ink-muted hover:border-brand-400 hover:text-ink focus-ring sm:max-w-[18rem]">{q}</button>
          ))}
        </div>
      </form>
    </div>
    </AskContext.Provider>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 xl:grid-cols-6 [&>*]:bg-surface">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="space-y-2 px-4 py-3"><Skeleton className="h-3 w-20" /><Skeleton className="h-5 w-16" /></div>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 xl:col-span-2" /><Skeleton className="h-72" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the page body */

const minutes = (m: number | null) => (m === null ? '—' : m < 60 ? `${m} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`);
const change = (now: number, before: number) => (before ? ((now - before) / before) * 100 : null);

function Body({ o, filters }: { o: Overview; filters: CrmOverviewFilters }) {
  const k = o.kpis;
  const leadsLink = (extra: Record<string, string>) => {
    // Everything the overview is filtered by travels with the link, so the list matches the number.
    const carried: Record<string, string> = {};
    if (filters.assignedUserId) carried.assignedUserId = filters.assignedUserId;
    if (filters.pipelineId) carried.pipelineId = filters.pipelineId;
    if (filters.stageId) carried.stageId = filters.stageId;
    if (filters.formName) carried.formName = filters.formName;
    if (filters.from) carried.dateFrom = filters.from;
    if (filters.to) carried.dateTo = filters.to;
    return `/crm/leads?${new URLSearchParams({ ...carried, ...extra })}`;
  };
  const strip = 'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 xl:grid-cols-6 [&>*]:bg-surface';
  const row3 = 'grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3';
  const row4 = 'grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4';
  const stages = o.pipeline?.stages ?? [];
  const stageMax = Math.max(1, ...stages.map((s) => s.leads));
  const stageTotal = stages.reduce((a, s) => a + s.leads, 0);
  const days = o.trend.length;
  const tick = Math.max(0, Math.ceil(days / 8) - 1);
  const trend = o.trend.map((d) => {
    const lbl = shortDate(`${d.date}T12:00:00+05:30`);
    return { label: lbl, bar: d.leads, line: d.won, title: `${lbl}: ${d.leads} new · ${d.won} won` };
  });
  const callTrend = o.trend.map((d) => ({ label: shortDate(`${d.date}T12:00:00+05:30`), value: d.calls, title: `${d.calls} calls · ${d.connected} connected` }));
  const sumStatuses = o.statuses.reduce((a, s) => a + s.leads, 0);
  // The funnel: everyone who reached a stage is everyone at it or any later open stage, plus the wins.
  const flow = stages.filter((s) => !s.isLost);
  const funnel = flow.map((s, i) => ({ name: s.name, reached: flow.slice(i).reduce((a, x) => a + x.leads, 0), to: leadsLink({ stageId: s.id }) }));
  const periodLabel = o.window.defaulted ? 'last 30 days' : 'this period';
  const rt = o.responseTime;
  const fuRate = o.followUpOnTime.completed ? Math.round((o.followUpOnTime.onTime / o.followUpOnTime.completed) * 100) : null;

  return (
    <>
      {/* ---------------------------------------------------------- headline numbers */}
      <Anchor id="crm-numbers" />
      <div className={strip}>
        <Stat label="Total leads" to={leadsLink({})} value={k.total.toLocaleString('en-IN')} meta={`${k.open} open · ${k.lost} lost`} />
        <Stat
          label={`New leads, ${periodLabel}`} to={leadsLink({ dateFrom: o.period.from.slice(0, 10) })} value={o.period.newLeads}
          meta={<><Delta value={change(o.period.newLeads, o.period.newLeadsPrev)} /> vs {o.period.newLeadsPrev} before</>}
        />
        <Stat label="Active in pipeline" to="/crm/pipeline/kanban" value={k.open} meta={k.unassigned ? `${k.unassigned} not assigned yet` : `${k.newToday} new today`} />
        <Stat label="Conversion" value={`${k.conversionRate}%`} meta={`won of closed · ${k.winRateOfAll}% of all`} />
        <Stat
          label={`Won, ${periodLabel}`} to={leadsLink({ status: 'won' })} value={o.period.won}
          meta={<>{formatCurrency(o.period.wonValue)} <Delta value={change(o.period.wonValue, o.period.wonValuePrev)} /></>}
        />
        <Stat label="Overdue follow-ups" to="/crm/follow-ups" value={o.followUps.overdue} tone={o.followUps.overdue ? 'danger' : undefined} meta={`${o.followUps.dueToday} due today`} />
      </div>

      {/* ---------------------------------------------------------- money and discipline */}
      <div className={strip}>
        <Stat label="Open pipeline value" to="/crm/pipeline/kanban" value={formatCurrency(o.value.openValue)} meta={`${o.value.openDeals} open deals`} />
        <Stat label="Expected to close, 30 days" value={formatCurrency(o.value.closing30Value)} meta={`${o.value.closing30} deals with a close date`} />
        <Stat label="Won value, all time" value={formatCurrency(k.wonValue)} meta={`${k.won} deals`} />
        <Stat label="Median first response" value={minutes(rt.medianMinutes)} tone={rt.medianMinutes !== null && rt.medianMinutes > 60 ? 'danger' : undefined} meta={`${pct(rt.within60, rt.contacted)} within an hour`} />
        <Stat label="Follow-ups done on time" to="/crm/follow-ups" value={fuRate === null ? '—' : `${fuRate}%`} meta={`${o.followUpOnTime.completed} completed, ${periodLabel}`} />
        <Stat label="Visit to booking" to="/crm/site-visits" value={pct(o.visitToBooking.booked, o.visitToBooking.visitsDone)} meta={`${o.visitToBooking.booked} of ${o.visitToBooking.visitsDone} visited leads booked`} />
      </div>

      {/* ---------------------------------------------------------- trend + status */}
      <Anchor id="crm-trend" />
      <div className={row3}>
        <Panel className="h-full lg:col-span-2">
          <PanelHeader
            title="New leads and wins"
            ask={<AskAi q="Is period mein leads aur wins ka trend kaisa hai? Kaun se din strong the aur kyun?" />}
            meta={<>{o.trend.reduce((a, d) => a + d.leads, 0)} leads · {o.trend.reduce((a, d) => a + d.won, 0)} won over {days} days</>}
            action={<ViewAll to="/crm/leads" label="Leads" />}
          />
          <div className="flex-1 p-4">
            <TrendCombo data={trend} height={240} barLabel="New leads" lineLabel="Won" interval={tick} />
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-brand-200" />New leads</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-brand-500" />Busy day (1.5× the average)</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 bg-accent-500" />Won</span>
            </p>
          </div>
        </Panel>
        <Panel className="h-full lg:col-span-2 xl:col-span-1">
          <PanelHeader title="Where leads stand" meta={`${sumStatuses} leads`} ask={<AskAi q="Leads ka status breakdown samjhao — kahan sabse zyada leads atki hain?" />} />
          <div className="flex flex-1 flex-col justify-center p-4">
            <Ring
              centre={`${k.conversionRate}%`} caption="converted"
              slices={o.statuses.map((s) => ({
                name: label(s.status), value: s.leads, to: leadsLink({ status: s.status }),
                tone: { new: 'fill-[var(--c-line-strong)] bg-line-strong', contacted: 'fill-info-500 bg-info-500', qualified: 'fill-accent-500 bg-accent-500', won: 'fill-brand-600 bg-brand-600', lost: 'fill-danger-500 bg-danger-500' }[s.status] ?? 'fill-ink-faint bg-ink-faint',
              }))}
            />
          </div>
        </Panel>
      </div>

      {/* ---------------------------------------------------------- funnel + stages */}
      <Anchor id="crm-funnel" />
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
        <Panel className="h-full">
          <PanelHeader title="Conversion funnel" ask={<AskAi q="Funnel mein sabse zyada leads kahan drop ho rahi hain, aur kyun? Kya karein?" />} meta="leads that reached each stage, and how many fell out between" action={<ViewAll to="/crm/pipeline/kanban" label="Kanban" />} />
          <div className="flex-1 p-4">{funnel.length ? <Funnel steps={funnel} /> : <p className="text-center text-xs text-ink-subtle">No pipeline yet.</p>}</div>
        </Panel>
        <Panel className="h-full">
          <PanelHeader title="Pipeline stages" ask={<AskAi q="Kis stage mein sabse zyada value atki hai aur kaun se deals pehle push karne chahiye?" />} meta={o.pipeline ? `${o.pipeline.name} · ${stageTotal} leads · value in each stage` : undefined} action={<ViewAll to="/crm/pipeline" label="Pipelines" />} />
          {!o.pipeline ? <p className="p-6 text-center text-xs text-ink-subtle">No pipeline yet.</p> : (
            <ul className="flex-1 divide-y divide-line">
              {stages.map((s) => (
                <li key={s.id}>
                  <Link to={leadsLink({ stageId: s.id })} className="grid grid-cols-[minmax(0,8.5rem)_1fr_2.5rem_3.25rem_5rem] items-center gap-3 px-4 py-2 text-[13px] transition-colors duration-100 hover:bg-surface-subtle focus-ring">
                    <span className={cn('flex items-center gap-2 truncate', s.isLost ? 'text-ink-faint' : 'text-ink-muted')}>
                      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: s.color }} aria-hidden="true" />{s.name}
                    </span>
                    <span className="h-2 rounded-sm bg-surface-muted"><span className={cn('block h-2 rounded-sm', s.isWon ? 'bg-brand-600' : s.isLost ? 'bg-ink-faint/50' : 'bg-brand-300')} style={{ width: `${(s.leads / stageMax) * 100}%` }} /></span>
                    <span className="text-right font-medium tabular-nums text-ink">{s.leads}</span>
                    <span className="text-right text-xs tabular-nums text-ink-faint">{pct(s.leads, stageTotal)}</span>
                    <span className="text-right text-xs tabular-nums text-ink-subtle">{s.value ? formatCurrency(s.value) : '—'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ---------------------------------------------------------- speed + timing */}
      <Anchor id="crm-speed" />
      <div className={row3}>
        <Panel className="h-full">
          <PanelHeader title="Speed to lead" meta="arrival to first contact" ask={<AskAi q="First response time kaise improve karein? Person aur source wise breakdown do." />} />
          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="flex items-end gap-6">
              <div><p className="text-xs text-ink-subtle">Median</p><p className={cn('text-2xl font-semibold tabular-nums', rt.medianMinutes !== null && rt.medianMinutes > 60 ? 'text-danger-700' : 'text-ink')}>{minutes(rt.medianMinutes)}</p></div>
              <div><p className="text-xs text-ink-subtle">Average</p><p className="text-lg font-semibold tabular-nums text-ink-muted">{minutes(rt.averageMinutes)}</p></div>
              <div><p className="text-xs text-ink-subtle">In 5 min</p><p className="text-lg font-semibold tabular-nums text-ink-muted">{pct(rt.within5, rt.contacted)}</p></div>
            </div>
            <BarList rows={rt.buckets.map((b, i) => ({ name: b.label, value: b.leads, muted: i === rt.buckets.length - 1 }))} accentAll />
            <p className="text-xs text-ink-subtle">Leads called within five minutes convert far more often. Anything over an hour is shown in red above.</p>
          </div>
        </Panel>
        <Panel className="h-full lg:col-span-1 xl:col-span-2">
          <PanelHeader title="When leads arrive" meta="by weekday and hour — plan calling shifts around it" ask={<AskAi q="Heatmap ke hisaab se calling shifts kaise plan karein? Kaun se din aur ghante sabse busy hain?" />} />
          <div className="flex-1 p-4"><Heatmap grid={o.heatmap} unit="leads" /></div>
        </Panel>
      </div>

      {/* ---------------------------------------------------------- source quality */}
      <Anchor id="crm-sources" />
      <Panel>
        <PanelHeader title="Source quality" ask={<AskAi q="Kaun sa source sabse achha hai aur kaun sa leads waste kar raha hai? Budget kahan shift karein?" />} meta="how far each source's leads get, and how fast they are picked up" action={<ViewAll to="/crm/integrations" label="Sources" />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface-subtle text-left text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                <th className="px-4 py-2">Source</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2">Share</th>
                <th className="px-3 py-2 text-right">Contacted</th>
                <th className="px-3 py-2 text-right">Qualified</th>
                <th className="px-3 py-2 text-right">Won</th>
                <th className="px-3 py-2">Conversion</th>
                <th className="px-3 py-2 text-right">First response</th>
                <th className="px-4 py-2 text-right">Won value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {o.sourceQuality.length === 0 ? <tr><td colSpan={9} className="px-4 py-6 text-center text-ink-subtle">No leads in this filter.</td></tr> : o.sourceQuality.map((s) => {
                const conv = s.leads ? (s.won / s.leads) * 100 : 0;
                const best = Math.max(...o.sourceQuality.map((x) => (x.leads ? x.won / x.leads : 0))) * 100 || 1;
                return (
                  <tr key={s.source} className="hover:bg-surface-subtle">
                    <td className="px-4 py-2"><Link to={leadsLink({ source: s.source })} className="focus-ring"><LeadSourceBadge source={s.source as LeadSource} /></Link></td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{s.leads}</td>
                    <td className="w-32 px-3 py-2"><span className="block h-1.5 rounded-sm bg-surface-muted"><span className="block h-1.5 rounded-sm bg-brand-300" style={{ width: `${(s.leads / Math.max(1, k.total)) * 100}%` }} /></span></td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{pct(s.contacted, s.leads)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{pct(s.qualified, s.leads)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{s.won}</td>
                    <td className="w-40 px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 rounded-sm bg-surface-muted"><span className="block h-1.5 rounded-sm bg-brand-600" style={{ width: `${(conv / best) * 100}%` }} /></span>
                        <span className="w-10 text-right text-xs tabular-nums text-ink-muted">{conv.toFixed(1)}%</span>
                      </span>
                    </td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', s.medianResponseMinutes !== null && s.medianResponseMinutes > 60 ? 'text-danger-700' : 'text-ink-muted')}>{minutes(s.medianResponseMinutes)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink">{s.wonValue ? formatCurrency(s.wonValue) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ---------------------------------------------------------- pending leads */}
      <Anchor id="crm-waiting" />
      <div>
        <h2 className="mb-2 px-0.5 font-sans text-2xs font-semibold uppercase tracking-wider text-ink-subtle">Waiting on the team</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5 [&>*]:bg-surface">
          <Stat label="New, untouched < 24 h" to={leadsLink({ status: 'new' })} value={o.pending.under24} meta="not called yet" />
          <Stat label="Untouched 24–48 h" to={leadsLink({ status: 'new' })} value={o.pending.from24to48} meta="getting cold" />
          <Stat label="Untouched > 48 h" to={leadsLink({ status: 'new' })} value={o.pending.over48} tone={o.pending.over48 ? 'danger' : undefined} meta="needs a call today" />
          <Stat label="Overdue follow-ups" to="/crm/follow-ups" value={o.pending.overdueFollowUps} tone={o.pending.overdueFollowUps ? 'danger' : undefined} meta="past their due time" />
          <Stat label="Not assigned" to={leadsLink({ assignedUserId: 'unassigned' })} value={o.pending.unassigned} meta="open leads with no owner" />
        </div>
      </div>

      {/* ---------------------------------------------------------- follow-ups, visits, calls */}
      <Anchor id="crm-activity" />
      <div className={row3}>
        <Panel className="h-full">
          <PanelHeader title="Follow-ups" ask={<AskAi q="Overdue follow-ups ki list do — kiske paas kitne, aur sabse zaroori pehle." />} meta={`${o.followUps.completed} done, ${periodLabel}`} action={<ViewAll to="/crm/follow-ups" />} />
          <div className="space-y-3 p-4">
            <SplitBar parts={[
              { name: 'Overdue', value: o.followUps.overdue, tone: 'bg-danger-500' },
              { name: 'Due today', value: o.followUps.dueToday, tone: 'bg-accent-500' },
              { name: 'Next 7 days', value: o.followUps.next7Days, tone: 'bg-brand-300' },
            ]} />
            <p className="text-xs text-ink-subtle">{o.followUps.missed ? `${o.followUps.missed} marked missed.` : 'None marked missed.'}{fuRate !== null && ` ${fuRate}% of completed ones were on time.`}</p>
          </div>
          <ul className="flex-1 divide-y divide-line border-t border-line">
            {o.followUps.overdueList.length === 0 ? <li className="px-4 py-5 text-center text-xs text-ink-subtle">Nothing overdue.</li> : o.followUps.overdueList.map((f) => (
              <li key={f.id}>
                <Link to={`/crm/leads/${f.leadId}`} className="block px-4 py-2 hover:bg-surface-subtle focus-ring">
                  <span className="flex items-baseline justify-between gap-2"><span className="truncate text-[13px] text-ink" title={f.title}>{f.title}</span><span className="shrink-0 text-xs font-medium text-danger-600">{shortDate(f.dueAt)}</span></span>
                  <span className="block truncate text-xs text-ink-subtle">{f.leadName}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="h-full">
          <PanelHeader title="Site visits" ask={<AskAi q="Site visits ka status kya hai aur visit ke baad booking kaise badhayein?" />} meta={`${o.siteVisits.today} today · ${o.siteVisits.total} in period`} action={<ViewAll to="/crm/site-visits" />} />
          <div className="p-4">
            <SplitBar parts={o.siteVisits.byStatus.filter((s) => s.visits).map((s) => ({
              name: label(s.status), value: s.visits,
              tone: { scheduled: 'bg-brand-300', confirmed: 'bg-brand-500', done: 'bg-brand-700', no_show: 'bg-danger-500', cancelled: 'bg-line-strong' }[s.status] ?? 'bg-line-strong',
            }))} />
          </div>
          <ul className="flex-1 divide-y divide-line border-t border-line">
            {o.siteVisits.upcoming.length === 0 ? <li className="px-4 py-5 text-center text-xs text-ink-subtle">No visits booked ahead.</li> : o.siteVisits.upcoming.map((v) => (
              <li key={v.id}>
                <Link to={`/crm/leads/${v.leadId}`} className="block px-4 py-2 hover:bg-surface-subtle focus-ring">
                  <span className="flex items-baseline justify-between gap-2"><span className="truncate text-[13px] text-ink">{v.leadName} <span className="text-ink-faint">· {v.visitors} pax</span></span><span className="shrink-0 text-xs text-ink-subtle">{dateTime(v.scheduledAt)}</span></span>
                  <span className="block truncate text-xs text-ink-subtle">{v.project}{v.host ? ` · with ${v.host}` : ''} · {label(v.status)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="h-full lg:col-span-2 xl:col-span-1">
          <PanelHeader title="Calls" ask={<AskAi q="Calling performance kaisi hai? Connect rate aur talk time person wise compare karo." />} meta={`${o.calls.total}, ${periodLabel}`} action={<ViewAll to="/crm/calls" label="History" />} />
          <dl className="grid grid-cols-3 divide-x divide-line border-b border-line text-center">
            <div className="px-2 py-2.5"><dt className="text-2xs text-ink-subtle">Connected</dt><dd className="text-base font-semibold tabular-nums text-ink">{o.calls.connected}<span className="ml-1 text-xs font-normal"><Delta value={change(o.calls.connected, o.period.callsConnectedPrev)} /></span></dd></div>
            <div className="px-2 py-2.5"><dt className="text-2xs text-ink-subtle">Missed / no answer</dt><dd className={cn('text-base font-semibold tabular-nums', o.calls.missed ? 'text-danger-700' : 'text-ink')}>{o.calls.missed}</dd></div>
            <div className="px-2 py-2.5"><dt className="text-2xs text-ink-subtle">Talk time</dt><dd className="text-base font-semibold tabular-nums text-ink">{talk(o.calls.talkSeconds)}</dd></div>
          </dl>
          <div className="flex-1 p-4">
            <ColumnChart data={callTrend} height={200} format={(v) => `${v} calls`} interval={tick} />
            <p className="mt-2 text-xs text-ink-subtle">{o.calls.outgoing} outgoing · {o.calls.incoming} incoming · {pct(o.calls.connected, o.calls.total)} connected</p>
          </div>
        </Panel>
      </div>

      <Anchor id="crm-team" />
      <TeamTable team={o.team} />

      {/* ---------------------------------------------------------- what buyers want */}
      <Anchor id="crm-demand" />
      <div>
        <h2 className="mb-2 px-0.5 font-sans text-2xs font-semibold uppercase tracking-wider text-ink-subtle">What buyers are asking for</h2>
        <div className={row4}>
          <MiniList title="Budget" rows={o.demand.budgets} />
          <MiniList title="Property type" rows={o.demand.propertyTypes} />
          <MiniList title="Projects asked about" rows={o.demand.projects.map((p) => ({ name: p.name, leads: p.leads, to: `/projects/${p.id}` }))} />
          <MiniList title="Preferred locations" rows={o.demand.locations} />
        </div>
      </div>

      {/* ---------------------------------------------------------- health of the pipeline */}
      <Anchor id="crm-health" />
      <div className={row4}>
        <Panel className="h-full">
          <PanelHeader title="Lead temperature" meta="open leads" />
          <div className="flex flex-1 flex-col justify-center p-4">
            <Ring
              centre={String(o.temperature.reduce((a, t) => a + t.leads, 0))} caption="open"
              slices={o.temperature.map((t) => ({
                name: label(t.temperature), value: t.leads,
                tone: { hot: 'fill-danger-500 bg-danger-500', warm: 'fill-accent-500 bg-accent-500', cold: 'fill-info-500 bg-info-500' }[t.temperature] ?? 'fill-[var(--c-line-strong)] bg-line-strong',
              }))}
            />
          </div>
        </Panel>
        <Panel className="h-full">
          <PanelHeader title="Age of open leads" meta="since they arrived" ask={<AskAi q="Purani open leads ka kya karein? 90 din se purani leads ki list aur suggestion do." />} />
          <div className="flex-1 p-4"><BarList rows={o.aging.map((a, i) => ({ name: a.label, value: a.leads, muted: i === 3 }))} accentAll /></div>
        </Panel>
        <Panel className="h-full">
          <PanelHeader title="Stage moves" meta={periodLabel} action={<ViewAll to="/crm/activities" label="Activity" />} />
          <div className="flex-1 p-4">
            {o.stageMoves.length === 0 ? <p className="text-center text-xs text-ink-subtle">No stage changes.</p> : <BarList rows={o.stageMoves.map((m) => ({ name: m.stage, value: m.moves }))} showShare={false} accentAll />}
          </div>
        </Panel>
        <Panel className="h-full">
          <PanelHeader title="Why leads were lost" ask={<AskAi q="Leads lost hone ke main reasons kya hain aur inhe kaise kam karein?" />} meta={`${k.lost} lost`} />
          <div className="flex-1 p-4">
            {o.lostReasons.length === 0 ? <p className="text-center text-xs text-ink-subtle">No lost leads with a reason.</p> : <BarList rows={o.lostReasons.map((r) => ({ name: r.reason, value: r.leads }))} />}
          </div>
        </Panel>
      </div>

      {/* ---------------------------------------------------------- forms and cities */}
      <Anchor id="crm-forms" />
      <div className={row3}>
        <Panel className="h-full">
          <PanelHeader title="Meta ad forms" ask={<AskAi q="Kaun sa Meta ad form sabse achhi quality ki leads la raha hai?" />} meta="leads and wins per form" action={<ViewAll to="/crm/integrations" label="Connections" />} />
          <div className="flex-1 p-4">
            {o.forms.meta.length === 0 ? <p className="text-center text-xs text-ink-subtle">No Meta leads in this filter.</p> : <BarList rows={o.forms.meta.map((f) => ({ name: `${f.name} · ${f.won} won`, value: f.leads }))} />}
          </div>
        </Panel>
        <Panel className="h-full">
          <PanelHeader title="Website forms" meta={`${o.forms.activeWebForms} live · submissions, ${periodLabel}`} action={<ViewAll to="/crm/forms" label="Forms" />} />
          <div className="flex-1 p-4">
            {o.forms.web.length === 0 ? <p className="text-center text-xs text-ink-subtle">No submissions in this period.</p> : <BarList rows={o.forms.web.map((f) => ({ name: f.name, value: f.submissions }))} />}
          </div>
        </Panel>
        <MiniList title="Cities leads come from" rows={o.demand.cities} className="lg:col-span-2 xl:col-span-1" />
      </div>

      {/* ---------------------------------------------------------- channels and automation */}
      <Anchor id="crm-channels" />
      <div>
        <h2 className="mb-2 px-0.5 font-sans text-2xs font-semibold uppercase tracking-wider text-ink-subtle">Channels and automation</h2>
        <div className={row4}>
          <Engage title="Automations" to="/crm/automation" lines={[
            ['Running', `${o.engagement.automations.enabled} of ${o.engagement.automations.total}`],
            ['Runs succeeded', o.engagement.automations.runs.success ?? 0],
            ['Runs failed', o.engagement.automations.runs.failed ?? 0, (o.engagement.automations.runs.failed ?? 0) > 0],
            ['Skipped', o.engagement.automations.runs.skipped ?? 0],
          ]} />
          <Engage title="Email sequences" to="/crm/email-sequences" lines={[
            ['Active sequences', o.engagement.emailSequences.active],
            ['Leads enrolled now', o.engagement.emailSequences.enrollments.active ?? 0],
            ['Completed', o.engagement.emailSequences.enrollments.completed ?? 0],
            ['Stopped', o.engagement.emailSequences.enrollments.stopped ?? 0],
          ]} />
          <Engage title="WhatsApp" to="/crm/conversations" lines={[
            ['Conversations', o.engagement.whatsapp.conversations],
            ['Active in period', o.engagement.whatsapp.activeInWindow],
            ['Campaigns sent', Object.entries(o.engagement.whatsapp.campaigns).filter(([s]) => s !== 'draft').reduce((a, [, n]) => a + n, 0)],
            ['Drips running', o.engagement.whatsapp.drips.active ?? 0],
          ]} />
          <Engage title="AI SDR agents" to="/crm/sdr-agents" lines={[
            ['Active agents', `${o.engagement.sdrAgents.active} of ${o.engagement.sdrAgents.total}`],
          ]} />
        </div>
      </div>

      {/* ---------------------------------------------------------- recent leads */}
      <Anchor id="crm-latest" />
      <Panel>
        <PanelHeader title="Latest leads in this filter" action={<ViewAll to={leadsLink({})} />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface-subtle text-left text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                <th className="px-4 py-2">Lead</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Owner</th><th className="px-4 py-2 text-right">Came in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {o.recentLeads.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-subtle">No leads in this filter.</td></tr> : o.recentLeads.map((l) => (
                <tr key={l.id} className="hover:bg-surface-subtle">
                  <td className="px-4 py-2"><Link to={`/crm/leads/${l.id}`} className="font-medium text-ink hover:text-brand-700 hover:underline focus-ring">{l.name}</Link></td>
                  <td className="px-3 py-2"><LeadSourceBadge source={l.source as LeadSource} /></td>
                  <td className="px-3 py-2 text-ink-muted">{l.stage ?? '—'}</td>
                  <td className="px-3 py-2"><StatusBadge kind="leadStatus" status={l.status} dot={false} /></td>
                  <td className="px-3 py-2 text-ink-muted">{l.owner ?? 'Unassigned'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-ink-subtle">{dateTime(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function MiniList({ title, rows, className }: { title: string; rows: { name: string; leads: number; to?: string }[]; className?: string }) {
  return (
    <Panel className={cn('h-full', className)}>
      <PanelHeader title={title} meta={rows.length ? `${rows.reduce((a, r) => a + r.leads, 0)} leads` : undefined} />
      <div className="flex-1 p-4">
        {rows.length === 0 ? <p className="text-center text-xs text-ink-subtle">Not captured yet.</p> : <BarList rows={rows.slice(0, 6).map((r) => ({ name: r.name, value: r.leads, to: r.to }))} />}
      </div>
    </Panel>
  );
}

type TeamRow = Overview['team'][number];
const TEAM_COLUMNS: { key: keyof TeamRow | 'winRate' | 'connectRate'; label: string }[] = [
  { key: 'leads', label: 'Leads' }, { key: 'open', label: 'Open' }, { key: 'untouched', label: 'Untouched' },
  { key: 'dialled', label: 'Calls' }, { key: 'connectRate', label: 'Connected' }, { key: 'talkSeconds', label: 'Talk time' },
  { key: 'visitsDone', label: 'Visits done' }, { key: 'overdueFollowUps', label: 'Overdue F/U' }, { key: 'won', label: 'Won' }, { key: 'winRate', label: 'Win rate' },
];

/** Telecaller activity — click a column to rank the team by it. */
function TeamTable({ team }: { team: TeamRow[] }) {
  const [sortKey, setSortKey] = useState<(typeof TEAM_COLUMNS)[number]['key']>('leads');
  const [desc, setDesc] = useState(true);
  const value = (p: TeamRow, key: typeof sortKey) =>
    key === 'winRate' ? (p.won + p.lost ? p.won / (p.won + p.lost) : -1) : key === 'connectRate' ? (p.dialled ? p.connected / p.dialled : -1) : Number(p[key as keyof TeamRow]);
  const rows = [...team].sort((a, b) => (desc ? value(b, sortKey) - value(a, sortKey) : value(a, sortKey) - value(b, sortKey)));
  const maxLeads = Math.max(1, ...team.map((p) => p.leads));
  const sortBy = (key: typeof sortKey) => { if (key === sortKey) setDesc(!desc); else { setSortKey(key); setDesc(true); } };

  return (
    <Panel>
      <PanelHeader title="Telecaller activity" ask={<AskAi q="Team mein kaun achha kar raha hai aur kise help chahiye? Numbers ke saath batao." />} meta="leads owned, and what each person did in the period · click a column to sort" action={<ViewAll to="/crm/telecallers" label="Details" />} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-surface-subtle text-left text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
              <th className="px-4 py-2">Person</th>
              {TEAM_COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right" aria-sort={sortKey === c.key ? (desc ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" onClick={() => sortBy(c.key)} className={cn('inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-ink focus-ring', sortKey === c.key && 'text-ink')}>
                    {c.label}{sortKey === c.key ? (desc ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? <tr><td colSpan={11} className="px-4 py-6 text-center text-ink-subtle">Nobody owns leads in this filter.</td></tr> : rows.map((p) => (
              <tr key={p.userId} className="hover:bg-surface-subtle">
                <td className="px-4 py-2">
                  <Link to={`/crm/leads?assignedUserId=${p.userId}`} className="font-medium text-ink hover:text-brand-700 hover:underline focus-ring">{p.name}</Link>
                  <span className="mt-1 block h-1 w-28 rounded-sm bg-surface-muted"><span className="block h-1 rounded-sm bg-brand-300" style={{ width: `${(p.leads / maxLeads) * 100}%` }} /></span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{p.leads}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{p.open}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', p.untouched ? 'text-accent-600' : 'text-ink-faint')}>{p.untouched || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{p.dialled || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{p.connected ? `${p.connected} · ${pct(p.connected, p.dialled)}` : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{p.talkSeconds ? talk(p.talkSeconds) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{p.visitsDone || '—'}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', p.overdueFollowUps ? 'font-medium text-danger-700' : 'text-ink-faint')}>{p.overdueFollowUps || '—'}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{p.won}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{pct(p.won, p.won + p.lost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Engage({ title, to, lines }: { title: string; to: string; lines: [string, string | number, boolean?][] }) {
  return (
    <Panel className="h-full">
      <PanelHeader title={title} action={<ViewAll to={to} label="Open" />} />
      <ul className="flex-1 divide-y divide-line">
        {lines.map(([name, value, bad]) => <Row key={name} to={to} label={name} value={value} danger={!!bad} />)}
      </ul>
    </Panel>
  );
}
