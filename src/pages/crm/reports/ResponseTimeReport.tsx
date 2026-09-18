import { useMemo, useState } from 'react';
import { Clock3, Download, FileText, MessageCircleQuestion, Timer } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { StatCard } from '../../../components/ui/StatCard';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { useDebounce } from '../../../hooks/useDebounce';
import { getResponseTimeReport, formatMinutes } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';

export function ResponseTimeReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const [source, setSource] = useState('');
  const debouncedSource = useDebounce(source, 300);

  const params = useMemo(() => ({ from: range.from, to: range.to, source: debouncedSource || undefined }), [range, debouncedSource]);
  const { data, isLoading, error } = useAsync(() => getResponseTimeReport(params), [JSON.stringify(params)]);
  const bySource = data?.bySource ?? [];

  const columns: DataTableColumn<(typeof bySource)[number]>[] = [
    { key: 'label', header: 'Source', render: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { key: 'count', header: 'Contacted Leads', align: 'right', render: (r) => r.count },
    { key: 'avgResponseMinutes', header: 'Avg. First Response', align: 'right', render: (r) => formatMinutes(r.avgResponseMinutes) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Avg. first response" value={formatMinutes(data?.avgResponseMinutes ?? 0)} icon={Timer} tone="shell" />
        <StatCard label="Contacted" value={data?.contactedCount ?? 0} icon={Clock3} tone="success" />
        <StatCard label="Not yet contacted" value={data?.notContactedCount ?? 0} icon={MessageCircleQuestion} tone="warning" />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <DateRangeFilter value={range} onChange={setRange} />
            <Input aria-label="Filter by source" placeholder="e.g. facebook, api…" value={source} onChange={(e) => setSource(e.target.value)} wrapperClassName="w-44" />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download size={13} />}
              disabled={bySource.length === 0}
              onClick={() => exportToCsv('response-time-report.csv', bySource.map((r) => ({ Source: r.label, 'Contacted Leads': r.count, 'Avg Response (min)': r.avgResponseMinutes })))}
            >
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FileText size={13} />}
              disabled={bySource.length === 0}
              onClick={() =>
                exportReportPdf({
                  filename: 'response-time-report.pdf',
                  title: 'Response Time Report',
                  subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'} · avg first response ${formatMinutes(data?.avgResponseMinutes ?? 0)}`,
                  columns: ['Source', 'Contacted Leads', 'Avg. First Response'],
                  rows: bySource.map((r) => [r.label, r.count, formatMinutes(r.avgResponseMinutes)]),
                })
              }
            >
              Export PDF
            </Button>
          </div>
        </div>

        <p className="border-b border-line bg-surface-subtle px-4 py-2.5 text-xs text-ink-muted">
          Time from a lead's creation to when it was first marked contacted. Leads never contacted are excluded from the
          average (shown separately above) so a handful of stale leads doesn't distort it.
        </p>

        <DataTable
          columns={columns}
          rows={bySource}
          rowKey={(r) => r.source}
          isLoading={isLoading}
          error={error}
          emptyTitle="No contacted leads in this range"
        />
      </Card>
    </div>
  );
}
