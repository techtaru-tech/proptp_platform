import { useMemo, useState } from 'react';
import { Download, FileText, Target, TrendingUp, Trophy } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
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

export function SourcePerformanceReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const [source, setSource] = useState('');
  const debouncedSource = useDebounce(source, 300);

  const params = useMemo(() => ({ from: range.from, to: range.to, source: debouncedSource || undefined }), [range, debouncedSource]);
  const { data, isLoading, error } = useAsync(() => getSourcePerformanceReport(params), [JSON.stringify(params)]);
  const rows = useMemo(() => data ?? [], [data]);

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({ total: acc.total + r.total, won: acc.won + r.won, wonValue: acc.wonValue + r.wonValue }), { total: 0, won: 0, wonValue: 0 }),
    [rows]
  );

  const columns: DataTableColumn<SourcePerformanceRow>[] = [
    { key: 'label', header: 'Source', render: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { key: 'total', header: 'Total Leads', align: 'right', render: (r) => r.total },
    { key: 'won', header: 'Won', align: 'right', render: (r) => r.won },
    { key: 'lost', header: 'Lost', align: 'right', render: (r) => r.lost },
    { key: 'conversionRate', header: 'Conversion', align: 'right', render: (r) => `${r.conversionRate}%` },
    { key: 'wonValue', header: 'Won Value', align: 'right', render: (r) => formatCurrency(r.wonValue) },
  ];

  const csvRows = () => rows.map((r) => ({ Source: r.label, 'Total Leads': r.total, Won: r.won, Lost: r.lost, 'Conversion %': r.conversionRate, 'Won Value': r.wonValue }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total leads" value={totals.total} icon={Target} tone="navy" />
        <StatCard label="Won deals" value={totals.won} icon={Trophy} tone="success" />
        <StatCard label="Overall conversion" value={totals.total > 0 ? `${Math.round((totals.won / totals.total) * 1000) / 10}%` : '0%'} icon={TrendingUp} tone="info" />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <DateRangeFilter value={range} onChange={setRange} />
            <Input aria-label="Filter by source" placeholder="e.g. facebook, api…" value={source} onChange={(e) => setSource(e.target.value)} wrapperClassName="w-44" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" leftIcon={<Download size={13} />} onClick={() => exportToCsv('source-performance-report.csv', csvRows())} disabled={rows.length === 0}>
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FileText size={13} />}
              disabled={rows.length === 0}
              onClick={() =>
                exportReportPdf({
                  filename: 'source-performance-report.pdf',
                  title: 'Source Performance Report',
                  subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
                  columns: ['Source', 'Total', 'Won', 'Lost', 'Conversion %', 'Won Value'],
                  rows: rows.map((r) => [r.label, r.total, r.won, r.lost, `${r.conversionRate}%`, formatCurrency(r.wonValue)]),
                })
              }
            >
              Export PDF
            </Button>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.source}
          isLoading={isLoading}
          error={error}
          emptyTitle="No leads in this range"
          emptyDescription="Try widening the date range or clearing the source filter."
        />
      </Card>
    </div>
  );
}
