import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BarChart3, Check, ExternalLink, Globe, Inbox, Pencil, Settings2, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatCard } from '../../components/ui/StatCard';
import { Tabs } from '../../components/ui/Tabs';
import { Pagination } from '../../components/ui/Pagination';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable, type DataTableColumn } from '../../components/tables/DataTable';
import { ChartCard } from '../../components/charts/ChartCard';
import { SimpleBarChart } from '../../components/charts/SimpleBarChart';
import { useAsync } from '../../hooks/useAsync';
import { usePipelineReferenceData } from '../../hooks/usePipelineReferenceData';
import { EmbedBox } from './FormBuilder';
import {
  FIELD_TYPE_OPTIONS, getForm, getFormAnalytics, listFormSubmissions, publicFormUrl,
} from '../../services/formService';
import { listAssignableUsers } from '../../services/leadService';
import { formatDate, formatDateTime } from '../../utils/format';
import type { LeadFormSubmission } from '../../types';

const SUBMISSIONS_PAGE_SIZE = 10;

export function FormView() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pipelineById, stageById } = usePipelineReferenceData();
  const assignableUsers = listAssignableUsers();

  const [tab, setTab] = useState('details');
  const [submissionsPage, setSubmissionsPage] = useState(1);

  const { data: form, isLoading, error } = useAsync(() => getForm(id), [id]);
  const { data: submissions, isLoading: submissionsLoading, error: submissionsError } = useAsync(
    () => listFormSubmissions(id, { page: submissionsPage, pageSize: SUBMISSIONS_PAGE_SIZE }),
    [id, submissionsPage]
  );
  const { data: analytics } = useAsync(() => getFormAnalytics(id, 30), [id]);

  if (isLoading) return <CardSkeleton />;
  if (error || !form) {
    return <ErrorState title="Form not found" description={error?.message ?? 'This form may have been deleted.'} />;
  }

  const fieldTypeLabel = (type: string) => FIELD_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
  const assignee = assignableUsers.find((u) => u.id === form.assignedUserId)?.name;

  const submissionColumns: DataTableColumn<LeadFormSubmission>[] = [
    { key: 'createdAt', header: 'Submitted', render: (row) => formatDateTime(row.createdAt) },
    {
      key: 'lead',
      header: 'Lead',
      render: (row) =>
        row.leadId ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/crm/leads/${row.leadId}`);
            }}
            className="text-left focus-ring"
          >
            <span className="font-medium text-ink underline decoration-line-strong underline-offset-2">{row.leadName || 'View lead'}</span>
            {row.leadPhone && <span className="block text-xs text-ink-faint">{row.leadPhone}</span>}
          </button>
        ) : (
          <span className="text-ink-faint">Lead deleted</span>
        ),
    },
    {
      key: 'answers',
      header: 'Answers',
      render: (row) => (
        <div className="max-w-md space-y-0.5">
          {Object.entries(row.data)
            .filter(([, value]) => value !== '' && value !== null && value !== undefined)
            .slice(0, 4)
            .map(([key, value]) => (
              <p key={key} className="truncate text-xs text-ink-muted">
                <span className="text-ink-faint">{key}:</span> {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
              </p>
            ))}
        </div>
      ),
    },
    {
      key: 'pageUrl',
      header: 'Source page',
      render: (row) => (row.pageUrl ? <span className="block max-w-[14rem] truncate text-xs text-ink-muted">{row.pageUrl}</span> : <span className="text-ink-faint">—</span>),
    },
  ];

  return (
    <div>
      <PageHeader
        title="View Form"
        description={form.name}
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Forms', to: '/crm/forms' }, { label: 'View' }]}
        actions={
          <>
            <Button variant="outline" leftIcon={<Pencil size={14} />} onClick={() => navigate(`/crm/forms/${form.id}/edit`)}>
              Edit
            </Button>
            <Button
              variant="outline"
              leftIcon={<Globe size={14} />}
              onClick={() => window.open(publicFormUrl(form.slug), '_blank', 'noopener,noreferrer')}
            >
              View Public Form
            </Button>
            <Button variant="primary" leftIcon={<BarChart3 size={14} />} onClick={() => setTab('analytics')}>
              Analytics
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={form.isActive ? 'success' : 'neutral'} dot>
          {form.isActive ? 'Active' : 'Inactive'}
        </Badge>
        {form.isMultiStep && <Badge tone="info">Multi-step</Badge>}
        {form.recaptchaEnabled && <Badge tone="navy">reCAPTCHA v3</Badge>}
        <code className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">/f/{form.slug}</code>
        <span className="text-xs text-ink-faint">Created {formatDate(form.createdAt)}</span>
      </div>

      <Tabs
        items={[
          { key: 'details', label: 'Details', icon: <Settings2 size={14} /> },
          { key: 'submissions', label: 'Submissions', icon: <Inbox size={14} />, badge: form.submissionCount ?? 0 },
          { key: 'analytics', label: 'Analytics', icon: <BarChart3 size={14} /> },
        ]}
        value={tab}
        onChange={setTab}
      >
        {(active) => (
          <div className="pt-5">
            {active === 'details' && (
              <div className="grid gap-5 lg:grid-cols-3">
                <div className="flex flex-col gap-5 lg:col-span-2">
                  <Card>
                    <CardHeader title="Basic Details" />
                    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                      <Detail label="Form Name" value={form.name} />
                      <Detail label="Slug" value={`/f/${form.slug}`} mono />
                      <Detail label="Display Title" value={form.displayTitle} />
                      <Detail label="Description" value={form.description} />
                      <Detail label="Submit Button Label" value={form.submitLabel} />
                      <Detail label="Thank-You Message" value={form.thankYouMessage} />
                      <Detail label="Redirect URL" value={form.redirectUrl} />
                      <Detail label="Multi-Step Form" value={form.isMultiStep ? 'On — fields grouped into steps' : 'Off'} />
                    </dl>
                  </Card>

                  <Card>
                    <CardHeader title="Pipeline Connection" subtitle="Where a lead from this form lands." />
                    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
                      <Detail label="Pipeline" value={pipelineById(form.pipelineId ?? undefined)?.name} />
                      <Detail label="Stage" value={stageById(form.pipelineStageId ?? undefined)?.name} />
                      <Detail label="Assigned to" value={assignee ?? 'Unassigned'} />
                    </dl>
                  </Card>

                  <Card padded={false}>
                    <div className="px-5 pt-5">
                      <CardHeader title="Form Fields" subtitle={`${form.fields?.length ?? 0} fields, in the order visitors see them.`} />
                    </div>
                    <div className="divide-y divide-line border-t border-line">
                      {(form.fields ?? []).map((field, index) => (
                        <div key={field.id ?? index} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {index + 1}. {field.label}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-muted">
                              key <code className="text-ink">{field.fieldKey}</code>
                              {form.isMultiStep && ` · step ${field.step}`}
                              {field.options && field.options.length > 0 && ` · ${field.options.length} options`}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {field.required && <Badge tone="warning">Required</Badge>}
                            {field.type === 'gdpr_consent' && <Badge tone="neutral">Locked</Badge>}
                            <Badge tone="navy">{fieldTypeLabel(field.type)}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                <div className="flex flex-col gap-5">
                  <Card>
                    <CardHeader title="Appearance" />
                    <dl className="flex flex-col gap-4">
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Accent colour</dt>
                        <dd className="mt-1 flex items-center gap-2 text-sm text-ink">
                          <span className="h-5 w-5 rounded border border-line" style={{ backgroundColor: form.accentColor }} />
                          <code>{form.accentColor}</code>
                        </dd>
                      </div>
                      <Detail label="Layout" value={form.layout === 'card' ? 'Card' : 'Plain'} />
                    </dl>
                  </Card>

                  <Card>
                    <CardHeader title="Spam Protection" />
                    <div className="flex flex-col gap-2.5 text-sm">
                      <p className="flex items-center gap-2 text-ink">
                        {form.recaptchaEnabled ? <Check size={14} className="text-success-600" /> : <span className="text-ink-faint">—</span>}
                        reCAPTCHA v3 {form.recaptchaEnabled ? 'enabled' : 'disabled'}
                      </p>
                      {form.recaptchaEnabled && (
                        <p className="text-xs text-ink-muted">
                          Secret key {form.hasRecaptchaSecret ? 'is stored and verified server-side.' : 'is not set — submissions are accepted without verification.'}
                        </p>
                      )}
                      <p className="flex items-center gap-2 text-ink">
                        <ShieldCheck size={14} className="text-success-600" />
                        Honeypot field always active
                      </p>
                    </div>
                  </Card>

                  <Card>
                    <CardHeader title="Embed Snippet" subtitle="Paste this into any webpage." />
                    <EmbedBox slug={form.slug} title={form.displayTitle || form.name} />
                  </Card>
                </div>
              </div>
            )}

            {active === 'submissions' && (
              <Card padded={false}>
                <DataTable
                  columns={submissionColumns}
                  rows={submissions?.items ?? []}
                  rowKey={(row) => row.id}
                  isLoading={submissionsLoading}
                  error={submissionsError}
                  emptyTitle="No submissions yet"
                  emptyDescription="Share the public link or embed the form to start collecting leads."
                />
                {submissions && submissions.total > 0 && (
                  <Pagination
                    page={submissionsPage}
                    pageSize={SUBMISSIONS_PAGE_SIZE}
                    total={submissions.total}
                    onPageChange={setSubmissionsPage}
                  />
                )}
              </Card>
            )}

            {active === 'analytics' && (
              <div className="flex flex-col gap-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <StatCard label="Total submissions" value={analytics?.total ?? 0} icon={Inbox} tone="navy" />
                  <StatCard label="Leads created" value={analytics?.leadsCreated ?? 0} icon={Check} tone="success" />
                  <StatCard label="Last 7 days" value={analytics?.last7Days ?? 0} icon={BarChart3} tone="info" />
                </div>

                <ChartCard title="Submissions — last 30 days" subtitle="One bar per day, in this form's public link and embeds.">
                  {analytics && analytics.daily.some((d) => d.count > 0) ? (
                    <SimpleBarChart
                      data={analytics.daily.map((d) => ({ name: d.date.slice(5), value: d.count }))}
                      colors={[form.accentColor]}
                      height={260}
                    />
                  ) : (
                    <EmptyState
                      icon={BarChart3}
                      title="Nothing to chart yet"
                      description="Once the form starts receiving submissions, daily volume shows up here."
                      action={
                        <Button
                          variant="outline"
                          size="sm"
                          leftIcon={<ExternalLink size={13} />}
                          onClick={() => window.open(publicFormUrl(form.slug), '_blank', 'noopener,noreferrer')}
                        >
                          Open the public form
                        </Button>
                      }
                    />
                  )}
                </ChartCard>
              </div>
            )}
          </div>
        )}
      </Tabs>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className={mono ? 'mt-1 text-sm text-ink' : 'mt-1 text-sm text-ink'}>
        {value ? mono ? <code>{value}</code> : value : <span className="text-ink-faint">—</span>}
      </dd>
    </div>
  );
}
