import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, Phone, PhoneCall, UserX } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { StatCard } from '../../components/ui/StatCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { getTelecallerReport } from '../../services/siteVisitService';

const today = () => new Date().toLocaleDateString('en-CA');

/** Each person's day: calls, connected calls, follow-ups, visits and bookings, plus who did nothing. */
export function Telecallers() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const { data, isLoading, error } = useAsync(() => getTelecallerReport(from, to), [from, to]);

  return (
    <div>
      <PageHeader title="Telecaller activity" description="Calls and follow-ups per person for a day or a range, with anyone who did nothing and was not on leave called out." breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Telecaller activity' }]} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input label="From" name="telFrom" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} wrapperClassName="w-44" />
        <Input label="To" name="telTo" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} wrapperClassName="w-44" />
        <button type="button" className="mb-0.5 rounded-lg border border-line px-3 py-2 text-sm text-ink-muted focus-ring" onClick={() => { setFrom(today()); setTo(today()); }}>Today</button>
      </div>
      {error ? <ErrorState title="Could not load the report" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Calls" value={data.totals.calls} icon={Phone} tone="brand" />
            <StatCard label="Connected" value={data.totals.connected} icon={PhoneCall} tone="success" footer={<span className="text-xs text-ink-muted">{data.totals.calls ? Math.round((data.totals.connected / data.totals.calls) * 100) : 0}% of calls</span>} />
            <StatCard label="Follow-ups done" value={data.totals.followUpsDone} tone="shell" />
            <StatCard label="Site visits" value={data.totals.visitsScheduled} icon={CalendarCheck} tone="info" />
            <StatCard label="Bookings" value={data.totals.bookings} tone="accent" />
          </div>

          {(data.zeroActivity.length > 0 || data.onLeave.length > 0) && (
            <div className="mb-5 grid gap-4 md:grid-cols-2">
              <Card>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><UserX size={15} className="text-danger-600" /> No activity</h3>
                {data.zeroActivity.length === 0 ? <p className="text-sm text-ink-muted">Everyone did something.</p> : (
                  <div className="flex flex-wrap gap-1.5">{data.zeroActivity.map((z) => <Badge key={z.userId} tone="danger">{z.name}</Badge>)}</div>
                )}
                <p className="mt-2 text-xs text-ink-faint">No calls, no follow-ups done and no visits, and not on approved leave.</p>
              </Card>
              <Card>
                <h3 className="mb-2 text-sm font-semibold text-ink">On approved leave</h3>
                {data.onLeave.length === 0 ? <p className="text-sm text-ink-muted">Nobody.</p> : <div className="flex flex-wrap gap-1.5">{data.onLeave.map((z) => <Badge key={z.userId} tone="neutral">{z.name}</Badge>)}</div>}
              </Card>
            </div>
          )}

          <Card padded={false}>
            {data.rows.length === 0 ? <EmptyState title="No activity in this period" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                    <th className="px-5 py-2.5 font-medium">Person</th><th className="px-3 text-right font-medium">Calls</th><th className="px-3 text-right font-medium">Connected</th><th className="px-3 text-right font-medium">Talk (min)</th>
                    <th className="px-3 text-right font-medium">New leads</th><th className="px-3 text-right font-medium">Follow-ups done</th><th className="px-3 text-right font-medium">Overdue</th>
                    <th className="px-3 text-right font-medium">Visits</th><th className="px-5 text-right font-medium">Bookings</th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.userId} className="border-t border-line">
                        <td className="px-5 py-2.5"><Link to={`/crm/leads?assignedUserId=${r.userId}`} className="font-medium text-ink hover:text-brand-700">{r.name}</Link>{r.onLeave && <Badge tone="neutral" className="ml-2">On leave</Badge>}{r.zeroActivity && <Badge tone="danger" className="ml-2">No activity</Badge>}</td>
                        <td className="px-3 text-right tabular-nums">{r.calls}</td>
                        <td className="px-3 text-right tabular-nums">{r.connected}<span className="ml-1 text-xs text-ink-faint">{r.calls ? `${r.connectedRate}%` : ''}</span></td>
                        <td className="px-3 text-right tabular-nums">{r.talkMinutes}</td><td className="px-3 text-right tabular-nums">{r.newLeads}</td><td className="px-3 text-right tabular-nums">{r.followUpsDone}</td>
                        <td className={`px-3 text-right tabular-nums ${r.followUpsOverdue ? 'font-medium text-danger-700' : ''}`}>{r.followUpsOverdue}</td>
                        <td className="px-3 text-right tabular-nums">{r.visitsScheduled}{r.visitsDone ? <span className="ml-1 text-xs text-ink-faint">({r.visitsDone} done)</span> : null}</td>
                        <td className="px-5 text-right tabular-nums">{r.bookings}</td>
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
