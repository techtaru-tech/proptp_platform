import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Card, CardHeader } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { ChartCard } from '../../../components/charts/ChartCard';
import { DonutChart } from '../../../components/charts/DonutChart';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getSourceAttribution } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';

export function SourceAttributionReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getSourceAttribution(params), [JSON.stringify(params)]);

  const bySource = data?.bySource ?? [];
  const byCampaign = data?.byCampaign ?? [];

  const sourceColumns: DataTableColumn<(typeof bySource)[number]>[] = [
    { key: 'label', header: 'UTM Source', render: (r) => <span className="font-medium text-ink">{r.label}</span> },
    { key: 'total', header: 'Leads', align: 'right', render: (r) => r.total },
    {
      key: 'share',
      header: 'Share',
      align: 'right',
      render: (r) => `${data && data.total > 0 ? Math.round((r.total / data.total) * 1000) / 10 : 0}%`,
    },
  ];

  const campaignColumns: DataTableColumn<(typeof byCampaign)[number]>[] = [
    { key: 'campaign', header: 'Campaign', render: (r) => r.campaign },
    { key: 'total', header: 'Leads', align: 'right', render: (r) => r.total },
  ];

  const exportBoth = (kind: 'csv' | 'pdf') => {
    if (kind === 'csv') {
      exportToCsv('source-attribution-by-source.csv', bySource.map((r) => ({ 'UTM Source': r.label, Leads: r.total })));
      if (byCampaign.length > 0) {
        exportToCsv('source-attribution-by-campaign.csv', byCampaign.map((r) => ({ Campaign: r.campaign, Leads: r.total })));
      }
    } else {
      exportReportPdf({
        filename: 'source-attribution-report.pdf',
        title: 'Source Attribution Report',
        subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'} · by UTM source`,
        columns: ['UTM Source', 'Leads'],
        rows: bySource.map((r) => [r.label, r.total]),
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeFilter value={range} onChange={setRange} />
          <div className="flex items-center gap-2">
            <Badge tone="navy">Total: {data?.total ?? 0} leads</Badge>
            <Button variant="outline" size="sm" leftIcon={<Download size={13} />} onClick={() => exportBoth('csv')} disabled={bySource.length === 0}>
              Export CSV
            </Button>
            <Button variant="primary" size="sm" leftIcon={<FileText size={13} />} onClick={() => exportBoth('pdf')} disabled={bySource.length === 0}>
              Export PDF
            </Button>
          </div>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <ChartCard title="By UTM Source" subtitle="Where traffic is tagged as coming from">
            {bySource.length > 0 ? (
              <DonutChart data={bySource.map((r) => ({ name: r.label, value: r.total }))} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-faint">{isLoading ? 'Loading…' : 'No leads in this range.'}</p>
            )}
          </ChartCard>

          <div>
            <CardHeader title="Top Campaigns" subtitle="From utm_campaign, where tagged" />
            <DataTable
              columns={campaignColumns}
              rows={byCampaign}
              rowKey={(r) => r.campaign}
              isLoading={isLoading}
              error={error}
              emptyTitle="No campaign tagging found"
              emptyDescription="No leads in this range carry a utm_campaign value."
            />
          </div>
        </div>

        <div className="border-t border-line">
          <DataTable
            columns={sourceColumns}
            rows={bySource}
            rowKey={(r) => r.utmSource}
            isLoading={isLoading}
            error={error}
            emptyTitle="No leads in this range"
          />
        </div>
      </Card>
    </div>
  );
}
