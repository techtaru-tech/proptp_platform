import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getAutomationStats, type AutomationStatsRow } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';

export function AutomationStatsReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset('all'));
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getAutomationStats(params), [JSON.stringify(params)]);
  const rows = data ?? [];

  const columns: DataTableColumn<AutomationStatsRow>[] = [
    { key: 'name', header: 'Automation', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'total', header: 'Total Runs', align: 'right', render: (r) => r.total },
    { key: 'success', header: 'Success', align: 'right', render: (r) => <Badge tone="success">{r.success}</Badge> },
    { key: 'failed', header: 'Failed', align: 'right', render: (r) => (r.failed > 0 ? <Badge tone="danger">{r.failed}</Badge> : <span className="text-ink-faint">0</span>) },
    { key: 'skipped', header: 'Skipped', align: 'right', render: (r) => r.skipped },
    { key: 'successRate', header: 'Success Rate', align: 'right', render: (r) => `${r.successRate}%` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeFilter value={range} onChange={setRange} defaultPreset="all" />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download size={13} />}
              disabled={rows.length === 0}
              onClick={() =>
                exportToCsv(
                  'automation-stats-report.csv',
                  rows.map((r) => ({ Automation: r.name, 'Total Runs': r.total, Success: r.success, Failed: r.failed, Skipped: r.skipped, 'Success Rate %': r.successRate }))
                )
              }
            >
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FileText size={13} />}
              disabled={rows.length === 0}
              onClick={() =>
                exportReportPdf({
                  filename: 'automation-stats-report.pdf',
                  title: 'Automation Stats',
                  subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
                  columns: ['Automation', 'Total', 'Success', 'Failed', 'Skipped', 'Success Rate'],
                  rows: rows.map((r) => [r.name, r.total, r.success, r.failed, r.skipped, `${r.successRate}%`]),
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
          rowKey={(r) => r.automationId}
          isLoading={isLoading}
          error={error}
          emptyTitle="No automation runs in this range"
          emptyDescription="Automations run when a lead is created, moves stage, or is triggered manually — see CRM > Automation."
        />
      </Card>
    </div>
  );
}
