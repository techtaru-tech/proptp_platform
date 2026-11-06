import { useMemo, useState } from 'react';
import { Banknote, Handshake, Scale } from 'lucide-react';
import { Avatar } from '../../../components/ui/Avatar';
import { StatCard } from '../../../components/ui/StatCard';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getRevenueByRep, type RevenueByRepRow } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import { formatCurrency } from '../../../utils/format';
import {
  ChartFrame, HBarChart, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, rateColumn, shareOf,
} from './ReportCenterParts';

export function RevenueByRepReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getRevenueByRep(params), [JSON.stringify(params)]);
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => b.revenue - a.revenue), [data]);

  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  const totalDeals = rows.reduce((sum, r) => sum + r.deals, 0);
  const topRevenue = rows[0]?.revenue ?? 0;

  const columns: DataTableColumn<RevenueByRepRow>[] = [
    {
      key: 'name',
      header: 'Rep',
      render: (r) => (
        <span className="flex items-center gap-2">
          <Avatar name={r.name} size="xs" />
          <span className="font-medium text-ink">{r.name}</span>
        </span>
      ),
    },
    { key: 'deals', header: 'Deals won', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.deals)}</span> },
    { key: 'revenue', header: 'Revenue', align: 'right', render: (r) => <span className="font-medium tabular-nums">{formatCurrency(r.revenue)}</span> },
    { key: 'share', header: 'Share of revenue', ...rateColumn, render: (r) => <RateBar value={shareOf(r.revenue, totalRevenue)} max={shareOf(topRevenue, totalRevenue)} /> },
    {
      key: 'avg',
      header: 'Avg. deal size',
      align: 'right',
      render: (r) => <span className="tabular-nums text-ink-muted">{formatCurrency(r.deals > 0 ? Math.round(r.revenue / r.deals) : 0)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data ? `${rows.length} reps` : undefined}
        exportDisabled={rows.length === 0}
        onExportCsv={() => exportToCsv('revenue-by-rep-report.csv', rows.map((r) => ({ Rep: r.name, Deals: r.deals, Revenue: r.revenue })))}
        onExportPdf={() =>
          exportReportPdf({
            filename: 'revenue-by-rep-report.pdf',
            title: 'Revenue by Rep',
            subtitle: `Deals won ${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
            columns: ['Rep', 'Deals Won', 'Revenue'],
            rows: rows.map((r) => [r.name, r.deals, formatCurrency(r.revenue)]),
          })
        }
      >
        <DateRangeFilter value={range} onChange={setRange} />
      </ReportToolbar>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total revenue" value={formatCurrency(totalRevenue)} icon={Banknote} tone="success" />
        <StatCard label="Deals won" value={fmtCount(totalDeals)} icon={Handshake} tone="shell" />
        <StatCard label="Avg. deal size" value={formatCurrency(totalDeals > 0 ? Math.round(totalRevenue / totalDeals) : 0)} icon={Scale} tone="info" />
      </div>

      <ReportChartCard
        title="Revenue by rep"
        subtitle="Who closed the most value in the range, by booking amount."
        footnote="Dated by when each deal closed, not when the lead first came in — a deal that closes this month counts here even if the lead is older."
      >
        <ChartFrame isLoading={isLoading} isEmpty={rows.length === 0} emptyText="No deals won in this range." height={220}>
          <HBarChart
            share
            format={(v) => formatCurrency(v)}
            rows={rows.map((r) => ({ key: r.userId ?? 'unassigned', label: r.name, sub: `${fmtCount(r.deals)} ${r.deals === 1 ? 'deal' : 'deals'}`, value: r.revenue }))}
          />
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title="By rep" meta="Highest revenue first">
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.userId ?? 'unassigned'} isLoading={isLoading} error={error} emptyTitle="No deals won in this range" />
      </ReportTableCard>
    </div>
  );
}
