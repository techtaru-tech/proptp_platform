import { useMemo, useState } from 'react';
import { Select } from '../../../components/ui/Select';
import { Input } from '../../../components/ui/Input';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { useDebounce } from '../../../hooks/useDebounce';
import { getLeadVolume, type LeadVolumeGroupBy, type LeadVolumePoint } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import {
  ChartFrame, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, VolumeBarChart, fmtCount, rateColumn, shareOf,
} from './ReportCenterParts';

const GROUP_BY_OPTIONS: { value: LeadVolumeGroupBy; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** Turns a raw period key ("2026-09-08", a Monday date for weeks, or "2026-09") into a display label. */
function formatPeriod(period: string, groupBy: LeadVolumeGroupBy): string {
  if (groupBy === 'month') {
    const [y, m] = period.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  const [y, m, d] = period.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return groupBy === 'week' ? `Week of ${label}` : label;
}

/** The short label under a bar; the tooltip carries the full one. */
function axisLabel(period: string, groupBy: LeadVolumeGroupBy): string {
  if (groupBy === 'month') return formatPeriod(period, groupBy);
  const [y, m, d] = period.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function LeadVolumeReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const [source, setSource] = useState('');
  const [groupBy, setGroupBy] = useState<LeadVolumeGroupBy>('day');
  const debouncedSource = useDebounce(source, 300);

  const params = useMemo(() => ({ from: range.from, to: range.to, source: debouncedSource || undefined, groupBy }), [range, debouncedSource, groupBy]);
  const { data, isLoading, error } = useAsync(() => getLeadVolume(params), [JSON.stringify(params)]);

  const rows = useMemo(() => (data?.points ?? []).map((p) => ({ ...p, label: formatPeriod(p.period, groupBy) })), [data, groupBy]);
  const total = data?.total ?? 0;
  const peak = rows.reduce<(typeof rows)[number] | undefined>((b, r) => (!b || r.count > b.count ? r : b), undefined);
  const average = rows.length ? total / rows.length : 0;

  const columns: DataTableColumn<LeadVolumePoint & { label: string }>[] = [
    { key: 'label', header: 'Period', render: (r) => <span className="text-ink">{r.label}</span> },
    { key: 'count', header: 'Leads', align: 'right', render: (r) => <span className="font-medium tabular-nums">{fmtCount(r.count)}</span> },
    { key: 'share', header: 'Share of range', ...rateColumn, render: (r) => <RateBar value={shareOf(r.count, total)} max={peak ? shareOf(peak.count, total) : 100} /> },
  ];

  const handleExportCsv = () => exportToCsv('lead-volume-report.csv', rows.map((r) => ({ Period: r.label, Leads: r.count })));
  const handleExportPdf = () =>
    exportReportPdf({
      filename: 'lead-volume-report.pdf',
      title: 'Lead Volume Report',
      subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'} · grouped by ${groupBy}`,
      columns: ['Period', 'Leads'],
      rows: rows.map((r) => [r.label, r.count]),
    });

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data ? `${fmtCount(total)} leads` : undefined}
        onExportCsv={handleExportCsv}
        onExportPdf={handleExportPdf}
        exportDisabled={rows.length === 0}
      >
        <DateRangeFilter value={range} onChange={setRange} />
        <Input aria-label="Filter by source" placeholder="Source, e.g. facebook" value={source} onChange={(e) => setSource(e.target.value)} wrapperClassName="w-44" />
        <Select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as LeadVolumeGroupBy)} options={GROUP_BY_OPTIONS} wrapperClassName="w-28" />
      </ReportToolbar>

      <ReportChartCard
        title="Leads over time"
        subtitle={`How many new leads came in each ${groupBy}${debouncedSource ? ` from "${debouncedSource}"` : ''}. The dashed line is the average.`}
        meta={
          rows.length > 0 && peak
            ? <>avg {average.toFixed(average < 10 ? 1 : 0)} per {groupBy} · peak {fmtCount(peak.count)} ({peak.label})</>
            : undefined
        }
      >
        <ChartFrame isLoading={isLoading} isEmpty={rows.length === 0} emptyText="No leads in this range." height={260}>
          <VolumeBarChart data={rows.map((r) => ({ label: axisLabel(r.period, groupBy), value: r.count, title: r.label }))} unit="leads" />
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title={`Leads by ${groupBy}`} meta={rows.length ? `${rows.length} ${groupBy === 'day' ? 'days' : `${groupBy}s`}` : undefined}>
        {/* A month of days is thirty rows; keep the table to a scrollable box. */}
        <div className="max-h-[420px] overflow-y-auto">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.period}
            isLoading={isLoading}
            error={error}
            emptyTitle="No leads in this range"
            emptyDescription="Try widening the date range or clearing the source filter."
          />
        </div>
      </ReportTableCard>
    </div>
  );
}
