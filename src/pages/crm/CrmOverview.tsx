import { useNavigate } from 'react-router-dom';
import { Users, UserPlus, TrendingUp, Target, Trophy, Plus, GitBranch, CalendarClock } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/ui/StatCard';
import { StatCardSkeleton } from '../../components/ui/LoadingSkeleton';
import { Card, CardHeader } from '../../components/ui/Card';
import { ChartCard } from '../../components/charts/ChartCard';
import { TrendAreaChart } from '../../components/charts/TrendAreaChart';
import { DonutChart } from '../../components/charts/DonutChart';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { LeadSourceBadge } from '../../components/leads/LeadSourceBadge';
import { useAsync } from '../../hooks/useAsync';
import { getDashboardStats, getLeadCreationTrend, getStatusBreakdown, getSourcePerformance } from '../../services/leadReportService';
import { listFollowUps } from '../../services/followUpService';
import { listLeads } from '../../services/leadService';
import { leadFullName, formatCurrency, formatDate } from '../../utils/format';

export function CrmOverview() {
  const navigate = useNavigate();

  const { data: stats, isLoading: statsLoading } = useAsync(() => getDashboardStats(), []);
  const { data: trend } = useAsync(() => getLeadCreationTrend(14), []);
  const { data: statusData } = useAsync(() => getStatusBreakdown(), []);
  const { data: sourceRows } = useAsync(() => getSourcePerformance(), []);
  const { data: overdue } = useAsync(() => listFollowUps({ bucket: 'overdue', pageSize: 5 }), []);
  const { data: recentLeadsPage } = useAsync(() => listLeads({ pageSize: 6, sortBy: 'createdAt', sortDir: 'desc' }), []);
  const recentLeads = recentLeadsPage?.items ?? [];

  return (
    <div>
      <PageHeader
        title="CRM Overview"
        description="Lead pipeline health across sources, stages and the sales team."
        actions={
          <>
            <Button variant="outline" leftIcon={<GitBranch size={15} />} onClick={() => navigate('/crm/pipeline')}>
              Pipeline
            </Button>
            <Button variant="primary" leftIcon={<Plus size={15} />} onClick={() => navigate('/crm/leads/new')}>
              Add Lead
            </Button>
          </>
        }
      />

      {statsLoading || !stats ? (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total Leads" value={stats.totalLeads} icon={Users} tone="brand" onClick={() => navigate('/crm/leads')} />
          <StatCard label="New Today" value={stats.newToday} icon={UserPlus} tone="info" />
          <StatCard label="New This Week" value={stats.newThisWeek} tone="info" />
          <StatCard label="Active in Pipeline" value={stats.activeInPipeline} icon={Target} tone="warning" onClick={() => navigate('/crm/pipeline')} />
          <StatCard label="Conversion Rate" value={`${stats.conversionRate}%`} icon={TrendingUp} tone="success" />
          <StatCard label="Won Deals" value={stats.wonDeals} icon={Trophy} tone="accent" footer={formatCurrency(stats.wonValue)} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Lead Creation Trend" subtitle="New leads over the last 14 days">
            {trend && <TrendAreaChart data={trend} xKey="date" yKey="leads" />}
          </ChartCard>
        </div>
        <ChartCard title="Status Breakdown" subtitle="Where leads stand right now">{statusData && <DonutChart data={statusData} />}</ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Recent Leads" action={<Button variant="ghost" size="sm" onClick={() => navigate('/crm/leads')}>View all</Button>} />
          </div>
          <div className="divide-y divide-line">
            {recentLeads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => navigate(`/crm/leads/${lead.id}`)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-subtle"
              >
                <Avatar name={leadFullName(lead)} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{leadFullName(lead)}</p>
                  <p className="text-xs text-ink-faint">{formatDate(lead.createdAt)}</p>
                </div>
                <LeadSourceBadge source={lead.source} otherSource={lead.otherSource} />
                <StatusBadge kind="leadStatus" status={lead.status} dot={false} />
              </button>
            ))}
          </div>
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader
              title="Overdue Follow-ups"
              action={
                <Button variant="ghost" size="sm" leftIcon={<CalendarClock size={13} />} onClick={() => navigate('/crm/follow-ups')}>
                  View all
                </Button>
              }
            />
          </div>
          {!overdue || overdue.items.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-ink-muted">No overdue follow-ups. Nice work.</p>
          ) : (
            <div className="divide-y divide-line">
              {overdue.items.map((t) => (
                <button key={t.id} onClick={() => navigate(`/crm/leads/${t.leadId}`)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-surface-subtle">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{t.title}</p>
                    {t.leadName && <p className="text-xs text-ink-faint">{t.leadName}</p>}
                  </div>
                  <span className="shrink-0 text-xs font-medium text-danger-600">{formatDate(t.dueAt)}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {sourceRows && sourceRows.length > 0 && (
        <div className="mt-6">
          <ChartCard title="Top Sources" subtitle="Where leads are coming from">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {sourceRows.slice(0, 6).map((s) => (
                <div key={s.source} className="rounded-lg border border-line p-3 text-center">
                  <p className="text-xl font-semibold text-ink">{s.total}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{s.label}</p>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
      )}
    </div>
  );
}
