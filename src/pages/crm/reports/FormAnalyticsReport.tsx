import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ExternalLink, FileText, Inbox, UserCheck } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { StatCard } from '../../../components/ui/StatCard';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { getFormAnalyticsSummary } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';

export function FormAnalyticsReport() {
  const navigate = useNavigate();
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset());
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);
  const { data, isLoading, error } = useAsync(() => getFormAnalyticsSummary(params), [JSON.stringify(params)]);
  const forms = data?.forms ?? [];

  const columns: DataTableColumn<(typeof forms)[number]>[] = [
    {
      key: 'name',
      header: 'Form',
      render: (r) => (
        <div>
          <p className="font-medium text-ink">{r.name}</p>
          <code className="text-xs text-ink-faint">/f/{r.slug}</code>
        </div>
      ),
    },
    { key: 'isActive', header: 'Active', align: 'center', render: (r) => <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
    { key: 'submissionsInRange', header: 'Submissions (range)', align: 'right', render: (r) => r.submissionsInRange },
    { key: 'leadsInRange', header: 'Leads Created (range)', align: 'right', render: (r) => r.leadsInRange },
    { key: 'allTimeSubmissions', header: 'All-Time Submissions', align: 'right', render: (r) => r.allTimeSubmissions },
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
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active forms" value={`${data?.activeForms ?? 0} / ${data?.totalForms ?? 0}`} icon={FileText} tone="shell" />
        <StatCard label="Submissions (range)" value={data?.totalSubmissionsInRange ?? 0} icon={Inbox} tone="info" />
        <StatCard label="Leads created (range)" value={data?.totalLeadsInRange ?? 0} icon={UserCheck} tone="success" />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <DateRangeFilter value={range} onChange={setRange} />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download size={13} />}
              disabled={forms.length === 0}
              onClick={() =>
                exportToCsv(
                  'form-analytics-report.csv',
                  forms.map((r) => ({ Form: r.name, Slug: r.slug, Active: r.isActive ? 'Yes' : 'No', 'Submissions (range)': r.submissionsInRange, 'Leads (range)': r.leadsInRange, 'All-Time Submissions': r.allTimeSubmissions }))
                )
              }
            >
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FileText size={13} />}
              disabled={forms.length === 0}
              onClick={() =>
                exportReportPdf({
                  filename: 'form-analytics-report.pdf',
                  title: 'Form Analytics',
                  subtitle: `${range.from ?? 'All time'} to ${range.to ?? 'today'}`,
                  columns: ['Form', 'Active', 'Submissions', 'Leads Created', 'All-Time Submissions'],
                  rows: forms.map((r) => [r.name, r.isActive ? 'Yes' : 'No', r.submissionsInRange, r.leadsInRange, r.allTimeSubmissions]),
                })
              }
            >
              Export PDF
            </Button>
          </div>
        </div>

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
      </Card>
    </div>
  );
}
