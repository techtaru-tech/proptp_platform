import { useMemo, useState } from 'react';
import { Target, TrendingUp, Trophy } from 'lucide-react';
import { Input } from '../../../components/ui/Input';
import { StatCard } from '../../../components/ui/StatCard';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { useDebounce } from '../../../hooks/useDebounce';
import { getSourcePerformanceReport, type SourcePerformanceRow } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import { formatCurrency } from '../../../utils/format';
import {
  ChartFrame, GroupedBarChart, LegendSwatch, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, fmtPct, rateColumn, shareOf,
} from './ReportCenterParts';

export function SourcePerformanceReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const [source, setSource] = useState('');
  const debouncedSource = useDebounce(source, 300);

  const params = useMemo(() => ({ from: range.from, to: range.to, source: debouncedSource || undefined }), [range, debouncedSource]);
  const { data, isLoading, error } = useAsync(() => getSourcePerformanceReport(params), [JSON.stringify(params)]);
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => b.total - a.total), [data]);

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({ total: acc.total + r.total, won: acc.won + r.won, wonValue: acc.wonValue + r.wonValue }), { total: 0, won: 0, wonValue: 0 }),
    [rows]
  );

  const columns: DataTableColumn<SourcePerformanceRow>[] = [
    { key: 'label', header: 'Source', render: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { key: 'total', header: 'Leads', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.total)}</span> },
    { key: 'siteVisits', header: 'Visited', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.siteVisits)}</span> },
    { key: 'won', header: 'Booked', align: 'right', render: (r) => <span className="font-medium tabular-nums">{fmtCount(r.won)}</span> },
    { key: 'lost', header: 'Lost', align: 'right', render: (r) => <span className="tabular-nums text-ink-muted">{fmtCount(r.lost)}</span> },
    { key: 'conversionRate', header: 'Lead → booking', ...rateColumn, render: (r) => <RateBar value={r.conversionRate} /> },
    { key: 'visitToBooking', header: 'Visit → booking', align: 'right', render: (r) => <span className="tabular-nums text-ink-muted">{r.siteVisits ? fmtPct(r.visitToBooking) : '—'}</span> },
    { key: 'wonValue', header: 'Won value', align: 'right', render: (r) => <span className="tabular-nums">{formatCurrency(r.wonValue)}</span> },
  ];

  const csvRows = () => rows.map((r) => ({ Source: r.label, 'Total Leads': r.total, 'Site Visits': r.siteVisits, Booked: r.won, Lost: r.lost, 'Lead to Booking %': r.conversionRate, 'Visit to Booking %': r.visitToBooking, 'Won Value': r.wonValue }));

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data ? `${rows.length} sources` : undefined}
        exportDisabled={rows.length === 0}
        onExportCsv={() => exportToCsv('source-performance-report.csv', csvRows())}
        onExportPdf={() =>
          exportReportPdf({
            filename: 'source-performance-report.pdf',
            title: 'Source Performance Report',
            subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
            columns: ['Source', 'Total', 'Won', 'Lost', 'Conversion %', 'Won Value'],
            rows: rows.map((r) => [r.label, r.total, r.won, r.lost, `${r.conversionRate}%`, formatCurrency(r.wonValue)]),
          })
        }
      >
        <DateRangeFilter value={range} onChange={setRange} />
        <Input aria-label="Filter by source" placeholder="Source, e.g. facebook" value={source} onChange={(e) => setSource(e.target.value)} wrapperClassName="w-44" />
      </ReportToolbar>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total leads" value={fmtCount(totals.total)} icon={Target} tone="shell" />
        <StatCard label="Booked" value={fmtCount(totals.won)} icon={Trophy} tone="success" footer={totals.wonValue > 0 ? `${formatCurrency(totals.wonValue)} won` : undefined} />
        <StatCard label="Overall lead → booking" value={fmtPct(shareOf(totals.won, totals.total))} icon={TrendingUp} tone="info" />
      </div>

      <ReportChartCard
        title="Leads → bookings by source"
        subtitle="Which sources bring leads that actually book, not just the most leads."
        legend={<><LegendSwatch tone="muted" label="Leads" /><LegendSwatch tone="brand" label="Booked" /></>}
      >
        <ChartFrame isLoading={isLoading} isEmpty={rows.length === 0} emptyText="No leads in this range." height={260}>
          <GroupedBarChart data={rows.map((r) => ({ label: r.label, whole: r.total, part: r.won }))} wholeLabel="Leads" partLabel="Booked" />
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title="By source" meta="Sorted by lead count">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.source}
          isLoading={isLoading}
          error={error}
          emptyTitle="No leads in this range"
          emptyDescription="Try widening the date range or clearing the source filter."
        />
      </ReportTableCard>
    </div>
  );
}
