import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Avatar } from '../../../components/ui/Avatar';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { Drawer } from '../../../components/ui/Drawer';
import { Badge } from '../../../components/ui/Badge';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import {
  getAgentLeads, getAgentPerformanceReport, type AgentPerformanceRow,
} from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import { formatCurrency, formatDate } from '../../../utils/format';
import {
  ChartFrame, GroupedBarChart, LegendSwatch, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, fmtPct, rateColumn, shareOf,
} from './ReportCenterParts';

/** More agents than this and the chart shows the busiest ones; the table always has everyone. */
const CHART_LIMIT = 12;

export function AgentPerformanceReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const [openAgent, setOpenAgent] = useState<AgentPerformanceRow | null>(null);
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getAgentPerformanceReport(params), [JSON.stringify(params)]);
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => b.total - a.total), [data]);
  const totals = rows.reduce((a, r) => ({ total: a.total + r.total, won: a.won + r.won }), { total: 0, won: 0 });

  const columns: DataTableColumn<AgentPerformanceRow>[] = [
    {
      key: 'name',
      header: 'Agent',
      render: (r) => (
        <span className="flex items-center gap-2">
          <Avatar name={r.name} size="xs" />
          <span className="font-medium text-ink">{r.name}</span>
        </span>
      ),
    },
    { key: 'total', header: 'Leads', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.total)}</span> },
    { key: 'won', header: 'Won', align: 'right', render: (r) => <span className="font-medium tabular-nums">{fmtCount(r.won)}</span> },
    { key: 'lost', header: 'Lost', align: 'right', render: (r) => <span className="tabular-nums text-ink-muted">{fmtCount(r.lost)}</span> },
    { key: 'conversionRate', header: 'Conversion', ...rateColumn, render: (r) => <RateBar value={r.conversionRate} /> },
    { key: 'wonValue', header: 'Won value', align: 'right', render: (r) => <span className="tabular-nums">{formatCurrency(r.wonValue)}</span> },
    { key: 'open', header: '', align: 'right', width: '2rem', render: () => <ChevronRight size={15} className="text-ink-faint" /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data ? `${rows.length} agents` : undefined}
        exportDisabled={rows.length === 0}
        onExportCsv={() =>
          exportToCsv(
            'agent-performance-report.csv',
            rows.map((r) => ({ Agent: r.name, 'Total Leads': r.total, Won: r.won, Lost: r.lost, 'Conversion %': r.conversionRate, 'Won Value': r.wonValue }))
          )
        }
        onExportPdf={() =>
          exportReportPdf({
            filename: 'agent-performance-report.pdf',
            title: 'Agent Performance Report',
            subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
            columns: ['Agent', 'Total', 'Won', 'Lost', 'Conversion %', 'Won Value'],
            rows: rows.map((r) => [r.name, r.total, r.won, r.lost, `${r.conversionRate}%`, formatCurrency(r.wonValue)]),
          })
        }
      >
        <DateRangeFilter value={range} onChange={setRange} />
      </ReportToolbar>

      <ReportChartCard
        title="Leads vs won by agent"
        subtitle={rows.length > CHART_LIMIT ? `Who turns assigned leads into bookings. The ${CHART_LIMIT} agents with the most leads.` : 'Who turns assigned leads into bookings.'}
        legend={<><LegendSwatch tone="muted" label="Leads" /><LegendSwatch tone="brand" label="Won" /></>}
        meta={totals.total ? <>team {fmtPct(shareOf(totals.won, totals.total))}</> : undefined}
      >
        <ChartFrame isLoading={isLoading} isEmpty={rows.length === 0} emptyText="No assigned leads in this range." height={260}>
          <GroupedBarChart data={rows.slice(0, CHART_LIMIT).map((r) => ({ label: r.name, whole: r.total, part: r.won }))} wholeLabel="Leads" partLabel="Won" />
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title="By agent" meta="Click a row for the leads behind it">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.userId}
          isLoading={isLoading}
          error={error}
          onRowClick={(r) => setOpenAgent(r)}
          emptyTitle="No assigned leads in this range"
        />
      </ReportTableCard>

      {openAgent && <AgentLeadsDrawer agent={openAgent} range={range} onClose={() => setOpenAgent(null)} />}
    </div>
  );
}

/**
 * The leads behind one agent's row. Reads from an endpoint that applies the same date window
 * as the report, so the number here always matches the number that was clicked.
 */
function AgentLeadsDrawer({
  agent, range, onClose,
}: { agent: AgentPerformanceRow; range: DateRange; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading } = useAsync(
    () => getAgentLeads(agent.userId, { from: range.from, to: range.to }),
    [agent.userId, range.from, range.to]
  );

  const statuses = Object.entries(data?.byStatus ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <Drawer isOpen onClose={onClose} title={`${agent.name} · ${agent.total} leads`}>
      {isLoading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {statuses.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {statuses.map(([status, count]) => (
                <span key={status} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs">
                  <StatusBadge kind="leadStatus" status={status} dot={false} />
                  <span className="font-medium text-ink">{count}</span>
                </span>
              ))}
            </div>
          )}

          {(data?.leads.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-faint">No leads assigned in this range.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {(data?.leads ?? []).map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => navigate(`/crm/leads/${lead.id}`)}
                  className="flex items-start justify-between gap-3 py-2.5 text-left hover:bg-surface-subtle focus-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{lead.name}</span>
                    <span className="block text-xs text-ink-faint">
                      {lead.phone}
                      {lead.stageName && ` · ${lead.stageName}`}
                      {` · ${formatDate(lead.createdAt)}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {lead.wonValue ? (
                      <span className="text-xs font-medium text-success-700">{formatCurrency(lead.wonValue)}</span>
                    ) : lead.dealValue ? (
                      <span className="text-xs text-ink-muted">{formatCurrency(lead.dealValue)}</span>
                    ) : null}
                    <StatusBadge kind="leadStatus" status={lead.status} dot={false} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {(data?.leads.length ?? 0) === 500 && (
            <Badge tone="warning">Showing the newest 500 — narrow the date range to see the rest</Badge>
          )}
        </div>
      )}
    </Drawer>
  );
}
