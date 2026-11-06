import { useMemo, useState } from 'react';
import { CalendarCheck, CalendarX, Percent, UserX } from 'lucide-react';
import { Select } from '../../../components/ui/Select';
import { StatCard } from '../../../components/ui/StatCard';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getVisitReport, type VisitGroupRow } from '../../../services/siteVisitService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import {
  ChartFrame, GroupedBarChart, LegendSwatch, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, fmtPct, rateColumn,
} from './ReportCenterParts';

type GroupKey = 'byProject' | 'byExecutive' | 'bySource';

const GROUPS: { value: GroupKey; label: string; noun: string }[] = [
  { value: 'byProject', label: 'By project', noun: 'Project' },
  { value: 'byExecutive', label: 'By executive', noun: 'Executive' },
  { value: 'bySource', label: 'By source', noun: 'Source' },
];

/** Visits against what came of them: a visit converts when its lead is now booked. */
export function SiteVisitReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const [group, setGroup] = useState<GroupKey>('byProject');
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getVisitReport(params.from, params.to), [JSON.stringify(params)]);

  const meta = GROUPS.find((g) => g.value === group) ?? GROUPS[0];
  const rows = useMemo(() => [...(data?.[group] ?? [])].sort((a, b) => b.scheduled - a.scheduled), [data, group]);

  const columns: DataTableColumn<VisitGroupRow>[] = [
    { key: 'name', header: meta.noun, render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'scheduled', header: 'Scheduled', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.scheduled)}</span> },
    { key: 'done', header: 'Done', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.done)}</span> },
    { key: 'noShow', header: 'No-show', align: 'right', render: (r) => <span className={r.noShow ? 'tabular-nums text-warning-700' : 'tabular-nums text-ink-muted'}>{fmtCount(r.noShow)}</span> },
    { key: 'cancelled', header: 'Cancelled', align: 'right', render: (r) => <span className="tabular-nums text-ink-muted">{fmtCount(r.cancelled)}</span> },
    { key: 'booked', header: 'Booked', align: 'right', render: (r) => <span className="font-medium tabular-nums">{fmtCount(r.booked)}</span> },
    { key: 'conversionRate', header: 'Visit → booking', ...rateColumn, render: (r) => <RateBar value={r.conversionRate} /> },
  ];

  const csvRows = () => rows.map((r) => ({ [meta.noun]: r.name, Scheduled: r.scheduled, Done: r.done, 'No-show': r.noShow, Cancelled: r.cancelled, Booked: r.booked, 'Visit to Booking %': r.conversionRate }));

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data ? `${fmtCount(data.total.scheduled)} visits` : undefined}
        exportDisabled={rows.length === 0}
        onExportCsv={() => exportToCsv(`site-visits-${meta.noun.toLowerCase()}.csv`, csvRows())}
        onExportPdf={() =>
          exportReportPdf({
            filename: `site-visits-${meta.noun.toLowerCase()}.pdf`,
            title: `Site Visits ${meta.label.toLowerCase()}`,
            subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
            columns: [meta.noun, 'Scheduled', 'Done', 'No-show', 'Cancelled', 'Booked', 'Visit → Booking'],
            rows: rows.map((r) => [r.name, r.scheduled, r.done, r.noShow, r.cancelled, r.booked, fmtPct(r.conversionRate)]),
          })
        }
      >
        <DateRangeFilter value={range} onChange={setRange} />
        <Select aria-label="Group visits" value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} options={GROUPS} wrapperClassName="w-36" />
      </ReportToolbar>

      {error ? (
        <ErrorState title="Could not load the report" description={error.message} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Visits scheduled" value={fmtCount(data?.total.scheduled ?? 0)} icon={CalendarCheck} tone="shell" />
            <StatCard label="Visits done" value={fmtCount(data?.total.done ?? 0)} icon={CalendarCheck} tone="success" />
            <StatCard label="No-shows" value={fmtCount(data?.total.noShow ?? 0)} icon={UserX} tone={data?.total.noShow ? 'warning' : 'neutral'} />
            <StatCard
              label="Visit → booking"
              value={fmtPct(data?.total.conversionRate ?? 0)}
              icon={Percent}
              tone="info"
              footer={<span className="flex items-center gap-1"><CalendarX size={11} />{fmtCount(data?.total.booked ?? 0)} booked after a visit</span>}
            />
          </div>

          <ReportChartCard
            title={`Visits vs bookings ${meta.label.toLowerCase()}`}
            subtitle="Where visits turn into bookings, and where they don't."
            legend={<><LegendSwatch tone="muted" label="Visits done" /><LegendSwatch tone="brand" label="Booked" /></>}
          >
            <ChartFrame isLoading={isLoading} isEmpty={rows.length === 0} emptyText="No visits in this period." height={260}>
              <GroupedBarChart data={rows.map((r) => ({ label: r.name, whole: r.done, part: r.booked }))} wholeLabel="Visits done" partLabel="Booked" />
            </ChartFrame>
          </ReportChartCard>

          <ReportTableCard title={meta.label} meta={rows.length ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` : undefined}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => r.name}
              isLoading={isLoading}
              emptyTitle="No visits in this period"
              emptyDescription="Try a wider date range."
            />
          </ReportTableCard>
        </>
      )}
    </div>
  );
}
