import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowUpRight, RotateCw, Sparkles } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/LoadingSkeleton';
import { SectionAssistant } from '../../components/overview/SectionAssistant';
import { useAsync } from '../../hooks/useAsync';
import { getSectionOverview, type Fmt, type SectionAttention, type SectionChart, type SectionKey } from '../../services/sectionService';
import { formatCurrency } from '../../utils/format';
import { cn } from '../../utils/cn';
import { NotFound } from '../NotFound';
import { Panel, PanelHeader, Stat, ViewAll } from '../dashboard/widgets';
import { BarList, ColumnChart, Ring, SplitBar } from '../dashboard/charts';

const SECTIONS: Record<SectionKey, { title: string; description: string }> = {
  hrms: { title: 'HRMS Overview', description: 'Attendance, leave, holidays and payroll at a glance.' },
  tasks: { title: 'Tasks Overview', description: 'Workload, deadlines and blockers across the team.' },
  'real-estate': { title: 'Real Estate Overview', description: 'Inventory, holds, bookings and money still to collect across every project.' },
  finance: { title: 'Finance Overview', description: 'Collections, approvals waiting on you, payouts and incentives.' },
  'construction-legal': { title: 'Construction & Legal Overview', description: 'Site progress against plan, vendors and bills, compliance, registry and court cases.' },
  people: { title: 'People & Partners Overview', description: 'Channel partners, KYC, leaders, teams and disputes.' },
  support: { title: 'Support & Comms Overview', description: 'Tickets, notifications and WhatsApp sends.' },
  reports: { title: 'Reports Overview', description: 'Headline numbers with a shortcut to every report.' },
  settings: { title: 'Settings Overview', description: 'Rules, roles and recent changes that shape how the panel behaves.' },
};
const label = (s: SectionKey) => SECTIONS[s].title.replace(' Overview', '');

const fmt = (f?: Fmt) => (v: number) => (f === 'inr' ? formatCurrency(v) : f === 'pct' ? `${v}%` : v.toLocaleString('en-IN'));
// Literal class names, so the build keeps them; one tone per slice, in Propto's own palette.
const TONES = ['fill-brand-600 bg-brand-600', 'fill-accent-500 bg-accent-500', 'fill-shell-700 bg-shell-700', 'fill-blossom-500 bg-blossom-500', 'fill-info-500 bg-info-500', 'fill-danger-500 bg-danger-500'];
const BAR_TONES = ['bg-brand-500', 'bg-shell-600', 'bg-accent-500', 'bg-blossom-500', 'bg-info-500'];

/** Every section's Overview: KPIs, charts and what needs attention, with the section's assistant beside them. */
export function SectionOverviewPage() {
  const { section = '' } = useParams();
  if (!(section in SECTIONS)) return <NotFound />;
  return <Overview key={section} section={section as SectionKey} />;
}

function Overview({ section }: { section: SectionKey }) {
  const [reload, setReload] = useState(0);
  const [handOver, setHandOver] = useState<string | undefined>();
  const overview = useAsync(() => getSectionOverview(section), [section, reload]);
  // Refreshes itself every five minutes, so a screen left open stays current.
  useEffect(() => {
    const t = window.setInterval(() => setReload((r) => r + 1), 5 * 60_000);
    return () => window.clearInterval(t);
  }, []);
  const o = overview.data;
  const meta = SECTIONS[section];
  const main = o?.charts.filter((c) => !c.side) ?? [];
  const side = o?.charts.filter((c) => c.side) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={meta.title}
        description={meta.description}
        actions={<Button variant="outline" leftIcon={<RotateCw size={13} className={cn(overview.isLoading && o && 'animate-spin')} />} onClick={() => setReload((r) => r + 1)}>Refresh</Button>}
      />

      {overview.error && !o ? (
        <Panel><ErrorState title="Couldn't load the overview" description={overview.error.message} onRetry={() => setReload((r) => r + 1)} /></Panel>
      ) : !o ? <OverviewSkeleton /> : (
        <>
          {o.kpis.length > 0 && (
            <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 [&>*]:bg-surface', o.kpis.length >= 6 ? 'xl:grid-cols-6' : o.kpis.length === 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
              {o.kpis.map((k) => (
                <Stat
                  key={k.label} label={k.label} to={k.to} meta={k.meta}
                  tone={k.tone === 'danger' ? 'danger' : undefined}
                  value={<span className={cn(k.tone === 'warn' && 'text-accent-700', k.tone === 'good' && 'text-brand-700')}>{fmt(k.format)(k.value)}</span>}
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-2">
              {main.map((c, i) => <ChartPanel key={c.id} chart={c} wide={c.kind === 'stack' || c.kind === 'progress' || (main.length % 2 === 1 && i === 0)} />)}
              <AttentionPanel rows={o.attention} onAsk={(q) => setHandOver(q)} wide />
            </div>
            <div className="space-y-4">
              <SectionAssistant section={section} label={label(section)} question={handOver} onQuestionTaken={() => setHandOver(undefined)} />
              {side.map((c) => <ChartPanel key={c.id} chart={c} />)}
            </div>
          </div>

          {o.links.length > 0 && (
            <div>
              <h2 className="mb-2 px-0.5 font-sans text-2xs font-semibold uppercase tracking-wider text-ink-subtle">Jump to</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {o.links.map((l) => (
                  <Link key={l.to} to={l.to} className="group flex items-start justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 transition-colors duration-150 hover:border-brand-300 hover:bg-brand-50/50 focus-ring">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-ink">{l.label}</span>
                      <span className="block truncate text-xs text-ink-subtle">{l.meta}</span>
                    </span>
                    <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-ink-faint group-hover:text-brand-700" />
                  </Link>
                ))}
              </div>
            </div>
          )}
          <p className="text-right text-2xs text-ink-faint">Updated {new Date(o.generatedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>
        </>
      )}
    </div>
  );
}

function ChartPanel({ chart: c, wide }: { chart: SectionChart; wide?: boolean }) {
  const f = fmt(c.format);
  const total = c.rows.reduce((s, r) => s + r.value, 0);
  const nothing = c.rows.length === 0 || (c.kind !== 'progress' && total === 0);
  return (
    <Panel className={cn('h-full', wide && 'md:col-span-2')}>
      <PanelHeader title={c.title} meta={c.meta} action={c.to ? <ViewAll to={c.to} label="Open" /> : undefined} />
      <div className="flex-1 p-4">
        {nothing ? <p className="py-6 text-center text-xs text-ink-subtle">Nothing to show yet.</p>
          : c.kind === 'columns' ? <ColumnChart data={c.rows.map((r) => ({ label: r.name, value: r.value }))} height={200} money={c.format === 'inr'} format={f} />
          : c.kind === 'bars' ? <BarList rows={c.rows.map((r) => ({ name: r.name, value: r.value, to: r.to }))} format={f} />
          : c.kind === 'ring' ? <Ring centre={f(total)} caption="total" format={f} slices={c.rows.map((r, i) => ({ name: r.name, value: r.value, tone: TONES[i % TONES.length], to: r.to }))} />
          : c.kind === 'split' ? <SplitBar parts={c.rows.map((r, i) => ({ name: r.name, value: r.value, tone: BAR_TONES[i % BAR_TONES.length] }))} />
          : c.kind === 'progress' ? <Progress rows={c.rows} />
          : <Stacks rows={c.rows} />}
      </div>
    </Panel>
  );
}

/** Actual against target, one pair of bars per row (construction: % done vs % planned by today). */
function Progress({ rows }: { rows: SectionChart['rows'] }) {
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => {
        const behind = r.target != null && r.value < r.target - 5;
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate font-medium text-ink">{r.name}</span>
              <span className={cn('shrink-0 text-xs tabular-nums', behind ? 'font-medium text-danger-700' : 'text-ink-subtle')}>{r.value}% done · {r.target ?? 0}% planned</span>
            </span>
            <span className="mt-1.5 block h-2 rounded-sm bg-surface-muted"><span className={cn('block h-2 rounded-sm', behind ? 'bg-danger-500' : 'bg-brand-600')} style={{ width: `${r.value}%` }} /></span>
            <span className="mt-1 block h-1 rounded-sm bg-surface-muted"><span className="block h-1 rounded-sm bg-shell-300" style={{ width: `${r.target ?? 0}%` }} /></span>
          </>
        );
        return <li key={r.name}>{r.to ? <Link to={r.to} className="block rounded focus-ring">{body}</Link> : body}</li>;
      })}
      <li className="flex gap-4 pt-1 text-xs text-ink-subtle">
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-brand-600" />Done</span>
        <span className="flex items-center gap-1.5"><span className="h-1 w-3 rounded-sm bg-shell-300" />Planned by today</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-danger-500" />Behind</span>
      </li>
    </ul>
  );
}

/** One stacked bar per row, with a shared legend (inventory by project). */
function Stacks({ rows }: { rows: SectionChart['rows'] }) {
  const names = rows[0]?.parts?.map((p) => p.name) ?? [];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const body = (
            <>
              <span className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate text-ink-muted">{r.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{(r.parts ?? []).map((p) => p.value).join(' · ')}</span>
              </span>
              <span className="mt-1 flex h-2 overflow-hidden rounded-sm bg-surface-muted" style={{ width: `${Math.max(8, (r.value / max) * 100)}%` }}>
                {(r.parts ?? []).map((p, i) => p.value > 0 && <span key={p.name} className={BAR_TONES[i % BAR_TONES.length]} style={{ width: `${(p.value / r.value) * 100}%` }} title={`${p.name}: ${p.value}`} />)}
              </span>
            </>
          );
          return <li key={r.name}>{r.to ? <Link to={r.to} className="block rounded focus-ring">{body}</Link> : body}</li>;
        })}
      </ul>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
        {names.map((n, i) => <span key={n} className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-[2px]', BAR_TONES[i % BAR_TONES.length])} />{n}</span>)}
      </p>
    </div>
  );
}

const LEVEL = {
  act: { text: 'Act now', cls: 'bg-danger-50 text-danger-700 border-danger-100' },
  review: { text: 'Review', cls: 'bg-accent-50 text-accent-700 border-accent-100' },
  info: { text: 'Info', cls: 'bg-surface-muted text-ink-muted border-line' },
} as const;

function AttentionPanel({ rows, onAsk, wide }: { rows: SectionAttention[]; onAsk: (q: string) => void; wide?: boolean }) {
  return (
    <Panel className={cn('h-full', wide && 'md:col-span-2')}>
      <PanelHeader title="Needs attention" meta={rows.length ? `${rows.length} item${rows.length === 1 ? '' : 's'}` : undefined} />
      {rows.length === 0 ? <p className="px-4 py-6 text-center text-xs text-ink-subtle">Nothing waiting on you right now.</p> : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.title + r.detail} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-subtle">
              <span className={cn('w-16 shrink-0 rounded border px-1.5 py-0.5 text-center text-2xs font-semibold', LEVEL[r.level].cls)}>{LEVEL[r.level].text}</span>
              <Link to={r.to} className="min-w-0 flex-1 rounded focus-ring">
                <span className="block truncate text-[13px] font-medium text-ink">{r.title}</span>
                <span className="block truncate text-xs text-ink-subtle">{r.detail}</span>
              </Link>
              <button
                type="button" onClick={() => onAsk(`${r.title} — ${r.detail}. Iske baare mein detail mein batao aur kya karna chahiye?`)}
                title="Ask the assistant about this" aria-label={`Ask the assistant about: ${r.title}`}
                className="shrink-0 rounded-md p-1.5 text-ink-faint hover:bg-brand-50 hover:text-brand-700 focus-ring"
              >
                <Sparkles size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 xl:grid-cols-5 [&>*]:bg-surface">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="space-y-2 px-4 py-3"><Skeleton className="h-3 w-20" /><Skeleton className="h-5 w-16" /></div>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="grid gap-4 md:grid-cols-2 xl:col-span-2"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-48 md:col-span-2" /></div>
        <Skeleton className="h-[560px]" />
      </div>
    </div>
  );
}
