import { Link } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { formatCurrency } from '../../utils/format';
import { getManagementView } from '../../services/channelPartnerService';
import { LEAD_SOURCE_META } from '../../constants/leadSources';

/** A figure that opens the records behind it. */
function Figure({ to, label, value, sub, tone }: { to: string; label: string; value: string | number; sub?: string; tone?: 'danger' }) {
  return (
    <Link to={to} className="block rounded-lg border border-line px-4 py-3 transition-colors hover:border-brand-300 hover:bg-surface-subtle focus-ring">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone === 'danger' ? 'text-danger-700' : 'text-ink'}`}>{value}</p>
      {sub && <p className="text-xs text-ink-faint">{sub}</p>}
    </Link>
  );
}

/** The management view: every figure here links to the list of records it was counted from. */
export function BusinessOverview() {
  const { data: v, error } = useAsync(() => getManagementView(), []);
  if (error) return null;
  if (!v) return <div className="mb-6"><CardSkeleton /></div>;
  if (Object.keys(v).length === 0) return null;
  const maxStage = Math.max(1, ...(v.pipeline ?? []).map((s) => s.leads));

  return (
    <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
      {v.pipeline && (
        <Card className="lg:col-span-2">
          <CardHeader title="Sales pipeline" subtitle={v.expectedBusiness ? `Expected business ${formatCurrency(v.expectedBusiness.value)} across ${v.expectedBusiness.leads} open leads. Click a stage to see its leads.` : 'Click a stage to see its leads.'} />
          <ul className="flex flex-col gap-1.5">
            {v.pipeline.map((s) => (
              <li key={s.stageId}>
                <Link to={s.to} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 rounded px-1 py-0.5 text-sm hover:bg-surface-subtle focus-ring">
                  <span className="truncate text-ink">{s.name}</span>
                  <span className="h-2 rounded-full bg-surface-subtle"><span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(s.leads / maxStage) * 100}%` }} /></span>
                  <span className="tabular-nums text-ink-muted"><strong className="text-ink">{s.leads}</strong> · {formatCurrency(s.value)}</span>
                </Link>
              </li>))}
          </ul>
        </Card>
      )}

      {v.sources && (
        <Card>
          <CardHeader title="Leads by original source" subtitle="Where each lead first came from." />
          <div className="grid grid-cols-2 gap-3">
            {v.sources.map((s) => <Figure key={s.source} to={s.to} label={LEAD_SOURCE_META[s.source]?.label ?? s.source} value={s.leads} />)}
          </div>
        </Card>
      )}

      {(v.bookings || v.collections) && (
        <Card>
          <CardHeader title="Bookings and collections" />
          <div className="grid grid-cols-2 gap-3">
            {v.bookings && <>
              <Figure to={v.bookings.pending.to} label="Bookings awaiting confirmation" value={v.bookings.pending.count} sub={formatCurrency(v.bookings.pending.amount)} />
              <Figure to={v.bookings.confirmed.to} label="Confirmed bookings" value={v.bookings.confirmed.count} sub={formatCurrency(v.bookings.confirmed.amount)} />
            </>}
            {v.collections && <>
              <Figure to="/legal" label="Outstanding to collect" value={formatCurrency(v.collections.outstanding)} />
              <Figure to={v.collections.to} label="Overdue" value={formatCurrency(v.collections.overdue)} sub={`${v.collections.overdueCount} instalment${v.collections.overdueCount === 1 ? '' : 's'}`} tone={v.collections.overdueCount ? 'danger' : undefined} />
            </>}
          </div>
        </Card>
      )}

      {v.postSales && (
        <Card>
          <CardHeader title="After the booking" subtitle="Agreement, registration and possession." />
          <div className="grid grid-cols-2 gap-3">
            <Figure to={v.postSales.agreementNotStarted.to} label="Agreement not started" value={v.postSales.agreementNotStarted.count} />
            <Figure to={v.postSales.registryInProgress.to} label="Registry in progress" value={v.postSales.registryInProgress.count} />
            <Figure to={v.postSales.possessionPending.to} label="Registered, not handed over" value={v.postSales.possessionPending.count} />
            <Figure to={v.postSales.possessed.to} label="Possession given" value={v.postSales.possessed.count} />
            <Figure to="/legal" label="Bank loans awaiting the bank" value={v.postSales.loansAwaitingBank} />
          </div>
        </Card>
      )}

      {v.partners && v.partners.length > 0 && (
        <Card>
          <CardHeader title="Channel partner business" subtitle="Top partners by booking value." />
          <ul className="divide-y divide-line text-sm">
            {v.partners.map((p) => (
              <li key={p.id}><Link to={p.to} className="flex items-center justify-between py-2 hover:text-brand-700 focus-ring rounded"><span className="font-medium text-ink">{p.name}</span><span className="tabular-nums text-ink-muted">{p.bookings} booking{p.bookings === 1 ? '' : 's'} · {formatCurrency(p.value)}</span></Link></li>))}
          </ul>
        </Card>
      )}
    </div>
  );
}
