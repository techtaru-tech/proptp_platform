import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getAutomationStats, type AutomationStatsRow } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import {
  ChartFrame, GroupedBarChart, LegendSwatch, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, fmtPct, rateColumn, shareOf,
} from './ReportCenterParts';

export function AutomationStatsReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset('all'));
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getAutomationStats(params), [JSON.stringify(params)]);
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => b.total - a.total), [data]);
  const totals = rows.reduce((a, r) => ({ total: a.total + r.total, success: a.success + r.success, failed: a.failed + r.failed }), { total: 0, success: 0, failed: 0 });

  const columns: DataTableColumn<AutomationStatsRow>[] = [
    { key: 'name', header: 'Automation', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'total', header: 'Runs', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.total)}</span> },
    { key: 'success', header: 'Succeeded', align: 'right', render: (r) => <span className="font-medium tabular-nums text-success-700">{fmtCount(r.success)}</span> },
    { key: 'failed', header: 'Failed', align: 'right', render: (r) => <span className={r.failed > 0 ? 'font-medium tabular-nums text-danger-700' : 'tabular-nums text-ink-faint'}>{fmtCount(r.failed)}</span> },
    { key: 'skipped', header: 'Skipped', align: 'right', render: (r) => <span className="tabular-nums text-ink-muted">{fmtCount(r.skipped)}</span> },
    {
      key: 'successRate',
      header: 'Success rate',
      ...rateColumn,
      render: (r) => <RateBar value={r.successRate} tone={r.successRate < 80 && r.success + r.failed > 0 ? 'warning' : 'success'} />,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data ? `${fmtCount(totals.total)} runs` : undefined}
        exportDisabled={rows.length === 0}
        onExportCsv={() =>
          exportToCsv(
            'automation-stats-report.csv',
            rows.map((r) => ({ Automation: r.name, 'Total Runs': r.total, Success: r.success, Failed: r.failed, Skipped: r.skipped, 'Success Rate %': r.successRate }))
          )
        }
        onExportPdf={() =>
          exportReportPdf({
            filename: 'automation-stats-report.pdf',
            title: 'Automation Stats',
            subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
            columns: ['Automation', 'Total', 'Success', 'Failed', 'Skipped', 'Success Rate'],
            rows: rows.map((r) => [r.name, r.total, r.success, r.failed, r.skipped, `${r.successRate}%`]),
          })
        }
      >
        <DateRangeFilter value={range} onChange={setRange} defaultPreset="all" />
      </ReportToolbar>

      <ReportChartCard
        title="Runs vs successes"
        subtitle="Which automations are firing, and whether they finish what they start."
        legend={<><LegendSwatch tone="muted" label="Runs" /><LegendSwatch tone="brand" label="Succeeded" /></>}
        meta={totals.success + totals.failed > 0 ? <>overall {fmtPct(shareOf(totals.success, totals.success + totals.failed))} success</> : undefined}
        footnote="Success rate counts finished runs only: skipped runs (the lead didn't match a condition) and runs still waiting on a delay are left out."
      >
        <ChartFrame isLoading={isLoading} isEmpty={rows.length === 0} emptyText="No automation runs in this range." height={240}>
          <GroupedBarChart data={rows.map((r) => ({ label: r.name, whole: r.total, part: r.success }))} wholeLabel="Runs" partLabel="Succeeded" height={240} />
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title="By automation" meta="Success rate under 80% in amber">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.automationId}
          isLoading={isLoading}
          error={error}
          emptyTitle="No automation runs in this range"
          emptyDescription="Automations run when a lead is created, moves stage, or is triggered manually — see CRM > Automation."
        />
      </ReportTableCard>
    </div>
  );
}
