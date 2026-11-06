import { useMemo, useState } from 'react';
import { Clock3, MessageCircleQuestion, Timer } from 'lucide-react';
import { Input } from '../../../components/ui/Input';
import { StatCard } from '../../../components/ui/StatCard';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { useDebounce } from '../../../hooks/useDebounce';
import { getResponseTimeReport, formatMinutes } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import { cn } from '../../../utils/cn';
import {
  ChartFrame, HBarChart, LegendSwatch, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, fmtPct, rateColumn, shareOf,
} from './ReportCenterParts';

/*
 * The report returns an average per source, not each lead's own response time, so the chart
 * compares sources rather than bucketing leads into "<5m / 5–30m / ..." bands.
 */
export function ResponseTimeReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const [source, setSource] = useState('');
  const debouncedSource = useDebounce(source, 300);

  const params = useMemo(() => ({ from: range.from, to: range.to, source: debouncedSource || undefined }), [range, debouncedSource]);
  const { data, isLoading, error } = useAsync(() => getResponseTimeReport(params), [JSON.stringify(params)]);
  const bySource = useMemo(() => [...(data?.bySource ?? [])].sort((a, b) => a.avgResponseMinutes - b.avgResponseMinutes), [data]);
  const overall = data?.avgResponseMinutes ?? 0;
  const contacted = data?.contactedCount ?? 0;
  const notContacted = data?.notContactedCount ?? 0;
  const mostContacted = Math.max(0, ...bySource.map((r) => r.count));
  const slower = (minutes: number) => overall > 0 && minutes > overall;

  const columns: DataTableColumn<(typeof bySource)[number]>[] = [
    { key: 'label', header: 'Source', render: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { key: 'count', header: 'Contacted leads', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.count)}</span> },
    { key: 'share', header: 'Share of contacted', ...rateColumn, render: (r) => <RateBar value={shareOf(r.count, contacted)} max={shareOf(mostContacted, contacted)} tone="muted" /> },
    {
      key: 'avgResponseMinutes',
      header: 'Avg. first response',
      align: 'right',
      render: (r) => <span className={cn('font-medium tabular-nums', slower(r.avgResponseMinutes) ? 'text-warning-700' : 'text-ink')}>{formatMinutes(r.avgResponseMinutes)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data ? `${fmtCount(data.totalLeads)} leads` : undefined}
        exportDisabled={bySource.length === 0}
        onExportCsv={() => exportToCsv('response-time-report.csv', bySource.map((r) => ({ Source: r.label, 'Contacted Leads': r.count, 'Avg Response (min)': r.avgResponseMinutes })))}
        onExportPdf={() =>
          exportReportPdf({
            filename: 'response-time-report.pdf',
            title: 'Response Time Report',
            subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'} · avg first response ${formatMinutes(overall)}`,
            columns: ['Source', 'Contacted Leads', 'Avg. First Response'],
            rows: bySource.map((r) => [r.label, r.count, formatMinutes(r.avgResponseMinutes)]),
          })
        }
      >
        <DateRangeFilter value={range} onChange={setRange} />
        <Input aria-label="Filter by source" placeholder="Source, e.g. facebook" value={source} onChange={(e) => setSource(e.target.value)} wrapperClassName="w-44" />
      </ReportToolbar>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Avg. first response" value={formatMinutes(overall)} icon={Timer} tone="shell" />
        <StatCard
          label="Contacted"
          value={fmtCount(contacted)}
          icon={Clock3}
          tone="success"
          footer={contacted + notContacted > 0 ? `${fmtPct(shareOf(contacted, contacted + notContacted))} of leads in range` : undefined}
        />
        <StatCard label="Not yet contacted" value={fmtCount(notContacted)} icon={MessageCircleQuestion} tone={notContacted ? 'warning' : 'neutral'} />
      </div>

      <ReportChartCard
        title="Time to first response by source"
        subtitle="How long a new lead waits before someone gets back to it, fastest source first."
        legend={overall > 0 ? <><LegendSwatch tone="brand" label="At or under average" /><span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-warning-500" />Slower than average</span></> : undefined}
        footnote="Time from a lead's creation to when it was first marked contacted. Leads never contacted are left out of the average (counted separately above) so a handful of stale leads doesn't distort it."
      >
        <ChartFrame isLoading={isLoading} isEmpty={bySource.length === 0} emptyText="No contacted leads in this range." height={200}>
          <HBarChart
            format={formatMinutes}
            rows={bySource.map((r) => ({
              key: r.source,
              label: r.label,
              sub: `${fmtCount(r.count)} contacted`,
              value: r.avgResponseMinutes,
              tone: slower(r.avgResponseMinutes) ? 'warning' : 'brand',
            }))}
          />
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title="By source" meta={overall > 0 ? `Overall average ${formatMinutes(overall)}` : undefined}>
        <DataTable
          columns={columns}
          rows={bySource}
          rowKey={(r) => r.source}
          isLoading={isLoading}
          error={error}
          emptyTitle="No contacted leads in this range"
        />
      </ReportTableCard>
    </div>
  );
}
