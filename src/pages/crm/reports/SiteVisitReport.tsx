import { useMemo, useState } from 'react';
import { CalendarCheck, CalendarX, Percent, UserX } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { StatCard } from '../../../components/ui/StatCard';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { CardSkeleton } from '../../../components/ui/LoadingSkeleton';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getVisitReport, type VisitGroupRow } from '../../../services/siteVisitService';

function Table({ title, rows }: { title: string; rows: VisitGroupRow[] }) {
  return (
    <Card padded={false}>
      <h3 className="border-b border-line px-5 py-3 font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? <EmptyState title="No visits in this period" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint"><th className="px-5 py-2 font-medium">{title.replace('By ', '')}</th><th className="px-3 text-right font-medium">Scheduled</th><th className="px-3 text-right font-medium">Done</th><th className="px-3 text-right font-medium">No-show</th><th className="px-3 text-right font-medium">Cancelled</th><th className="px-3 text-right font-medium">Booked</th><th className="px-5 text-right font-medium">Visit → Booking</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.name} className="border-t border-line"><td className="px-5 py-2.5 font-medium text-ink">{r.name}</td><td className="px-3 text-right tabular-nums">{r.scheduled}</td><td className="px-3 text-right tabular-nums">{r.done}</td><td className="px-3 text-right tabular-nums">{r.noShow}</td><td className="px-3 text-right tabular-nums">{r.cancelled}</td><td className="px-3 text-right tabular-nums">{r.booked}</td><td className="px-5 text-right tabular-nums">{r.conversionRate}%</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Visits against what came of them: a visit converts when its lead is now booked. */
export function SiteVisitReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getVisitReport(params.from, params.to), [JSON.stringify(params)]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5"><DateRangeFilter value={range} onChange={setRange} /></div>
      {error ? <ErrorState title="Could not load the report" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Visits scheduled" value={data.total.scheduled} icon={CalendarCheck} tone="shell" />
            <StatCard label="Visits done" value={data.total.done} icon={CalendarCheck} tone="success" />
            <StatCard label="No-shows" value={data.total.noShow} icon={UserX} tone={data.total.noShow ? 'warning' : 'neutral'} />
            <StatCard label="Visit → booking" value={`${data.total.conversionRate}%`} icon={Percent} tone="info" footer={<span className="flex items-center gap-1 text-xs text-ink-muted"><CalendarX size={11} />{data.total.booked} booked after a visit</span>} />
          </div>
          <Table title="By project" rows={data.byProject} />
          <Table title="By executive" rows={data.byExecutive} />
          <Table title="By source" rows={data.bySource} />
        </>
      )}
    </div>
  );
}
