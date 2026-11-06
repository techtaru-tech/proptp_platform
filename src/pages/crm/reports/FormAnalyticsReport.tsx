import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, FileText, Inbox, UserCheck } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { StatCard } from '../../../components/ui/StatCard';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getFormAnalyticsSummary } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import {
  ChartFrame, GroupedBarChart, LegendSwatch, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, fmtPct, rateColumn, shareOf,
} from './ReportCenterParts';

/**
 * Forms don't record page views, so the comparison is submissions against the leads they
 * produced: a submission counts as a lead once it is linked to one.
 */
export function FormAnalyticsReport() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getFormAnalyticsSummary(params), [JSON.stringify(params)]);
  const forms = useMemo(() => [...(data?.forms ?? [])].sort((a, b) => b.submissionsInRange - a.submissionsInRange), [data]);
  const leadRate = (r: { submissionsInRange: number; leadsInRange: number }) => Math.min(100, shareOf(r.leadsInRange, r.submissionsInRange));

  const columns: DataTableColumn<(typeof forms)[number]>[] = [
    {
      key: 'name',
      header: 'Form',
      render: (r) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{r.name}</p>
          <code className="text-xs text-ink-faint">/f/{r.slug}</code>
        </div>
      ),
    },
    { key: 'isActive', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'success' : 'neutral'} dot>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    { key: 'submissionsInRange', header: 'Submissions', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.submissionsInRange)}</span> },
    { key: 'leadsInRange', header: 'Leads created', align: 'right', render: (r) => <span className="font-medium tabular-nums">{fmtCount(r.leadsInRange)}</span> },
    {
      key: 'rate',
      header: 'Submission → lead',
      ...rateColumn,
      render: (r) => (r.submissionsInRange > 0 ? <RateBar value={leadRate(r)} /> : <span className="text-ink-faint">—</span>),
    },
    { key: 'allTimeSubmissions', header: 'All-time', align: 'right', render: (r) => <span className="tabular-nums text-ink-muted">{fmtCount(r.allTimeSubmissions)}</span> },
    {
      key: 'view',
      header: '',
      align: 'right',
      render: (r) => (
        <Button variant="ghost" size="sm" leftIcon={<ExternalLink size={12} />} onClick={(e) => { e.stopPropagation(); navigate(`/crm/forms/${r.id}`); }}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data ? `${data.totalForms} forms` : undefined}
        exportDisabled={forms.length === 0}
        onExportCsv={() =>
          exportToCsv(
            'form-analytics-report.csv',
            forms.map((r) => ({ Form: r.name, Slug: r.slug, Active: r.isActive ? 'Yes' : 'No', 'Submissions (range)': r.submissionsInRange, 'Leads (range)': r.leadsInRange, 'All-Time Submissions': r.allTimeSubmissions }))
          )
        }
        onExportPdf={() =>
          exportReportPdf({
            filename: 'form-analytics-report.pdf',
            title: 'Form Analytics',
            subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
            columns: ['Form', 'Active', 'Submissions', 'Leads Created', 'All-Time Submissions'],
            rows: forms.map((r) => [r.name, r.isActive ? 'Yes' : 'No', r.submissionsInRange, r.leadsInRange, r.allTimeSubmissions]),
          })
        }
      >
        <DateRangeFilter value={range} onChange={setRange} />
      </ReportToolbar>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Active forms" value={`${data?.activeForms ?? 0} / ${data?.totalForms ?? 0}`} icon={FileText} tone="shell" />
        <StatCard label="Submissions" value={fmtCount(data?.totalSubmissionsInRange ?? 0)} icon={Inbox} tone="info" footer="In the selected range" />
        <StatCard
          label="Leads created"
          value={fmtCount(data?.totalLeadsInRange ?? 0)}
          icon={UserCheck}
          tone="success"
          footer={data?.totalSubmissionsInRange ? `${fmtPct(Math.min(100, shareOf(data.totalLeadsInRange, data.totalSubmissionsInRange)))} of submissions` : undefined}
        />
      </div>

      <ReportChartCard
        title="Submissions → leads by form"
        subtitle="Which forms are being filled in, and how many of those become leads in the CRM."
        legend={<><LegendSwatch tone="muted" label="Submissions" /><LegendSwatch tone="brand" label="Leads created" /></>}
      >
        <ChartFrame isLoading={isLoading} isEmpty={forms.length === 0} emptyText="No forms yet." height={240}>
          <GroupedBarChart data={forms.map((r) => ({ label: r.name, whole: r.submissionsInRange, part: r.leadsInRange }))} wholeLabel="Submissions" partLabel="Leads created" height={240} />
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title="By form" meta="Most submissions first">
        <DataTable
          columns={columns}
          rows={forms}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          error={error}
          onRowClick={(r) => navigate(`/crm/forms/${r.id}`)}
          emptyTitle="No forms yet"
          emptyDescription="Create a form under CRM > Forms to start seeing submissions here."
        />
      </ReportTableCard>
    </div>
  );
}
