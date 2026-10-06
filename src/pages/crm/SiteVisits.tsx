import { useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarDays, ClipboardCheck } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { getVisitSummary, listSiteVisits } from '../../services/siteVisitService';
import { VisitList } from '../../components/leads/VisitList';

const VIEWS = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'needs_outcome', label: 'Needs outcome' },
  { key: 'done', label: 'Done' },
  { key: 'closed', label: 'Cancelled / no-show' },
];

export function SiteVisits() {
  const [view, setView] = useState('today');
  const [reload, setReload] = useState(0);
  const summary = useAsync(() => getVisitSummary(), [reload]);
  const { data, isLoading, error } = useAsync(() => listSiteVisits({ view }), [view, reload]);
  const s = summary.data;

  return (
    <div>
      <PageHeader title="Site visits" description="Visits booked for buyers: who is coming, where, with whom, and how it went. Schedule one from a lead." breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Site visits' }]} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Today" value={s?.today ?? '…'} icon={CalendarDays} tone="brand" onClick={() => setView('today')} />
        <StatCard label="Upcoming" value={s?.upcoming ?? '…'} icon={CalendarClock} tone="info" onClick={() => setView('upcoming')} />
        <StatCard label="Waiting for an outcome" value={s?.needsOutcome ?? '…'} icon={ClipboardCheck} tone={s?.needsOutcome ? 'warning' : 'neutral'} onClick={() => setView('needs_outcome')} />
        <StatCard label="Done this month" value={s?.doneThisMonth ?? '…'} icon={CalendarCheck} tone="success" onClick={() => setView('done')} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm focus-ring ${view === v.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>{v.label}</button>
        ))}
      </div>
      <Card padded={false}>
        {error ? <ErrorState title="Could not load visits" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : (
          <VisitList visits={data} onChanged={() => setReload((k) => k + 1)} empty={view === 'today' ? 'No visits today' : 'Nothing here'} />
        )}
      </Card>
    </div>
  );
}
