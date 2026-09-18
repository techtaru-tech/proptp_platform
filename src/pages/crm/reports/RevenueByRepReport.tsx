import { useMemo, useState } from 'react';
import { Banknote, Download, FileText, Handshake } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Avatar } from '../../../components/ui/Avatar';
import { StatCard } from '../../../components/ui/StatCard';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getRevenueByRep, type RevenueByRepRow } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import { formatCurrency } from '../../../utils/format';

export function RevenueByRepReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getRevenueByRep(params), [JSON.stringify(params)]);
  const rows = data ?? [];

  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  const totalDeals = rows.reduce((sum, r) => sum + r.deals, 0);

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
    { key: 'deals', header: 'Deals Won', align: 'right', render: (r) => r.deals },
    { key: 'revenue', header: 'Revenue', align: 'right', render: (r) => formatCurrency(r.revenue) },
    {
      key: 'avg',
      header: 'Avg. Deal Size',
      align: 'right',
      render: (r) => formatCurrency(r.deals > 0 ? Math.round(r.revenue / r.deals) : 0),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total revenue" value={formatCurrency(totalRevenue)} icon={Banknote} tone="success" />
        <StatCard label="Deals won" value={totalDeals} icon={Handshake} tone="navy" />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeFilter value={range} onChange={setRange} />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download size={13} />}
              disabled={rows.length === 0}
              onClick={() => exportToCsv('revenue-by-rep-report.csv', rows.map((r) => ({ Rep: r.name, Deals: r.deals, Revenue: r.revenue })))}
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
                  filename: 'revenue-by-rep-report.pdf',
                  title: 'Revenue by Rep',
                  subtitle: `Deals won ${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
                  columns: ['Rep', 'Deals Won', 'Revenue'],
                  rows: rows.map((r) => [r.name, r.deals, formatCurrency(r.revenue)]),
                })
              }
            >
              Export PDF
            </Button>
          </div>
        </div>

        <p className="border-b border-line bg-surface-subtle px-4 py-2.5 text-xs text-ink-muted">
          Dated by when each deal closed, not when the lead first came in — a deal that closes this month counts here even if
          the lead is older.
        </p>

        <DataTable columns={columns} rows={rows} rowKey={(r) => r.userId ?? 'unassigned'} isLoading={isLoading} error={error} emptyTitle="No deals won in this range" />
      </Card>
    </div>
  );
}
