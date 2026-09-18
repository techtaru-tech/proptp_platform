import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
import { ChartCard } from '../../../components/charts/ChartCard';
import { SimpleBarChart } from '../../../components/charts/SimpleBarChart';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { useDebounce } from '../../../hooks/useDebounce';
import { getLeadVolume, type LeadVolumeGroupBy, type LeadVolumePoint } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';

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

export function LeadVolumeReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const [source, setSource] = useState('');
  const [groupBy, setGroupBy] = useState<LeadVolumeGroupBy>('day');
  const debouncedSource = useDebounce(source, 300);

  const params = useMemo(() => ({ from: range.from, to: range.to, source: debouncedSource || undefined, groupBy }), [range, debouncedSource, groupBy]);
  const { data, isLoading, error } = useAsync(() => getLeadVolume(params), [JSON.stringify(params)]);

  const rows = useMemo(() => (data?.points ?? []).map((p) => ({ ...p, label: formatPeriod(p.period, groupBy) })), [data, groupBy]);

  const columns: DataTableColumn<LeadVolumePoint & { label: string }>[] = [
    { key: 'label', header: 'Period', render: (r) => r.label },
    { key: 'count', header: 'Leads', align: 'right', render: (r) => r.count },
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
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <DateRangeFilter value={range} onChange={setRange} />
            <Input
              aria-label="Filter by source"
              placeholder="e.g. facebook, api…"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              wrapperClassName="w-44"
            />
            <Select
              aria-label="Group by"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as LeadVolumeGroupBy)}
              options={GROUP_BY_OPTIONS}
              wrapperClassName="w-32"
            />
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="shell">Total: {data?.total ?? 0} leads</Badge>
            <Button variant="outline" size="sm" leftIcon={<Download size={13} />} onClick={handleExportCsv} disabled={rows.length === 0}>
              Export CSV
            </Button>
            <Button variant="primary" size="sm" leftIcon={<FileText size={13} />} onClick={handleExportPdf} disabled={rows.length === 0}>
              Export PDF
            </Button>
          </div>
        </div>

        <div className="p-4">
          <ChartCard title="Leads over time" subtitle={`Grouped by ${groupBy}`}>
            {rows.length > 0 ? (
              <SimpleBarChart data={rows.map((r) => ({ name: r.label, value: r.count }))} height={220} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-faint">{isLoading ? 'Loading…' : 'No leads in this range.'}</p>
            )}
          </ChartCard>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.period}
          isLoading={isLoading}
          error={error}
          emptyTitle="No leads in this range"
          emptyDescription="Try widening the date range or clearing the source filter."
        />
      </Card>
    </div>
  );
}
