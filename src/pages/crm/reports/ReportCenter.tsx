import { useState } from 'react';
import {
  BarChart3, Clock3, Filter, Funnel, Gauge, LineChart, Radar, Trophy, UserCog, Zap,
} from 'lucide-react';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Tabs, type TabItem } from '../../../components/ui/Tabs';
import { LeadVolumeReport } from './LeadVolumeReport';
import { SourcePerformanceReport } from './SourcePerformanceReport';
import { SourceAttributionReport } from './SourceAttributionReport';
import { PipelineFunnelReport } from './PipelineFunnelReport';
import { PipelineBottlenecksReport } from './PipelineBottlenecksReport';
import { AgentPerformanceReport } from './AgentPerformanceReport';
import { RevenueByRepReport } from './RevenueByRepReport';
import { AutomationStatsReport } from './AutomationStatsReport';
import { ResponseTimeReport } from './ResponseTimeReport';
import { FormAnalyticsReport } from './FormAnalyticsReport';

const REPORTS = [
  { key: 'lead-volume', label: 'Lead Volume', icon: <LineChart size={14} />, Component: LeadVolumeReport },
  { key: 'source-performance', label: 'Source Performance', icon: <BarChart3 size={14} />, Component: SourcePerformanceReport },
  { key: 'source-attribution', label: 'Source Attribution', icon: <Radar size={14} />, Component: SourceAttributionReport },
  { key: 'pipeline-funnel', label: 'Pipeline Funnel', icon: <Funnel size={14} />, Component: PipelineFunnelReport },
  { key: 'pipeline-bottlenecks', label: 'Pipeline Bottlenecks', icon: <Gauge size={14} />, Component: PipelineBottlenecksReport },
  { key: 'agent-performance', label: 'Agent Performance', icon: <UserCog size={14} />, Component: AgentPerformanceReport },
  { key: 'revenue-by-rep', label: 'Revenue by Rep', icon: <Trophy size={14} />, Component: RevenueByRepReport },
  { key: 'automation-stats', label: 'Automation Stats', icon: <Zap size={14} />, Component: AutomationStatsReport },
  { key: 'response-time', label: 'Response Time', icon: <Clock3 size={14} />, Component: ResponseTimeReport },
  { key: 'form-analytics', label: 'Form Analytics', icon: <Filter size={14} />, Component: FormAnalyticsReport },
] as const;

const TAB_ITEMS: TabItem[] = REPORTS.map((r) => ({ key: r.key, label: r.label, icon: r.icon }));

/**
 * The CRM's reporting hub. Each report is its own filterable, exportable page; switching
 * tabs swaps which one is mounted so an expensive report's data isn't fetched until someone
 * actually opens it.
 */
export function ReportCenter() {
  const [active, setActive] = useState<string>(REPORTS[0].key);
  const ActiveReport = REPORTS.find((r) => r.key === active)?.Component ?? LeadVolumeReport;

  return (
    <div>
      <PageHeader
        title="Report Center"
        description="Every CRM report in one place — filter, chart and export each on its own."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Report Center' }]}
      />

      <Tabs items={TAB_ITEMS} value={active} onChange={setActive} />
      <div className="pt-5">
        <ActiveReport />
      </div>
    </div>
  );
}
