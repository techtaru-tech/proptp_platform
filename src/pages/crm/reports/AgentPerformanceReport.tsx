import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Download, FileText } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
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

export function AgentPerformanceReport() {
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const [openAgent, setOpenAgent] = useState<AgentPerformanceRow | null>(null);
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getAgentPerformanceReport(params), [JSON.stringify(params)]);
  const rows = data ?? [];

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
    { key: 'total', header: 'Total Leads', align: 'right', render: (r) => r.total },
    { key: 'won', header: 'Won', align: 'right', render: (r) => r.won },
    { key: 'lost', header: 'Lost', align: 'right', render: (r) => r.lost },
    { key: 'conversionRate', header: 'Conversion', align: 'right', render: (r) => `${r.conversionRate}%` },
    { key: 'wonValue', header: 'Won Value', align: 'right', render: (r) => formatCurrency(r.wonValue) },
    { key: 'open', header: '', align: 'right', render: () => <ChevronRight size={15} className="text-ink-faint" /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeFilter value={range} onChange={setRange} />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download size={13} />}
              disabled={rows.length === 0}
              onClick={() =>
                exportToCsv(
                  'agent-performance-report.csv',
                  rows.map((r) => ({ Agent: r.name, 'Total Leads': r.total, Won: r.won, Lost: r.lost, 'Conversion %': r.conversionRate, 'Won Value': r.wonValue }))
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
                  filename: 'agent-performance-report.pdf',
                  title: 'Agent Performance Report',
                  subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
                  columns: ['Agent', 'Total', 'Won', 'Lost', 'Conversion %', 'Won Value'],
                  rows: rows.map((r) => [r.name, r.total, r.won, r.lost, `${r.conversionRate}%`, formatCurrency(r.wonValue)]),
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
          rowKey={(r) => r.userId}
          isLoading={isLoading}
          error={error}
          onRowClick={(r) => setOpenAgent(r)}
          emptyTitle="No assigned leads in this range"
        />
      </Card>

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
