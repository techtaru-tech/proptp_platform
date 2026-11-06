import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getSourceAttribution } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import {
  ChartFrame, HBarChart, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, rateColumn, shareOf,
} from './ReportCenterParts';

export function SourceAttributionReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getSourceAttribution(params), [JSON.stringify(params)]);

  const total = data?.total ?? 0;
  const bySource = useMemo(() => [...(data?.bySource ?? [])].sort((a, b) => b.total - a.total), [data]);
  const byCampaign = useMemo(() => [...(data?.byCampaign ?? [])].sort((a, b) => b.total - a.total), [data]);
  const campaignTotal = byCampaign.reduce((a, r) => a + r.total, 0);
  const topCampaign = byCampaign[0]?.total ?? 0;

  const campaignColumns: DataTableColumn<(typeof byCampaign)[number]>[] = [
    { key: 'campaign', header: 'Campaign', render: (r) => <span className="font-medium text-ink">{r.campaign}</span> },
    { key: 'total', header: 'Leads', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.total)}</span> },
    {
      key: 'share',
      header: 'Share of tagged leads',
      ...rateColumn,
      render: (r) => <RateBar value={shareOf(r.total, campaignTotal)} max={shareOf(topCampaign, campaignTotal)} />,
    },
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
      <ReportToolbar
        meta={data ? `${fmtCount(total)} leads` : undefined}
        exportDisabled={bySource.length === 0}
        onExportCsv={() => exportBoth('csv')}
        onExportPdf={() => exportBoth('pdf')}
      >
        <DateRangeFilter value={range} onChange={setRange} />
      </ReportToolbar>

      <ReportChartCard
        title="Leads by UTM source"
        subtitle="Where tagged traffic says it came from, as a share of every lead in the range."
        meta={bySource.length ? `${bySource.length} sources` : undefined}
      >
        <ChartFrame isLoading={isLoading} isEmpty={bySource.length === 0} emptyText="No leads in this range." height={220}>
          <HBarChart share rows={bySource.map((r) => ({ key: r.utmSource, label: r.label, value: r.total }))} />
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title="Top campaigns" meta={byCampaign.length ? `From utm_campaign · ${fmtCount(campaignTotal)} tagged leads` : 'From utm_campaign'}>
        <DataTable
          columns={campaignColumns}
          rows={byCampaign}
          rowKey={(r) => r.campaign}
          isLoading={isLoading}
          error={error}
          emptyTitle="No campaign tagging found"
          emptyDescription="No leads in this range carry a utm_campaign value."
        />
      </ReportTableCard>
    </div>
  );
}
