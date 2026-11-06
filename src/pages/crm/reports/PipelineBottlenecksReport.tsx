import { useMemo, useState } from 'react';
import { Select } from '../../../components/ui/Select';
import { Badge } from '../../../components/ui/Badge';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { useAsync } from '../../../hooks/useAsync';
import { usePipelineReferenceData } from '../../../hooks/usePipelineReferenceData';
import { getPipelineBottlenecks, type BottleneckStage } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import {
  ChartFrame, HBarChart, LegendSwatch, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, rateColumn, shareOf,
} from './ReportCenterParts';

/** Flags a stage as a bottleneck once leads sit there noticeably longer than average across the pipeline. */
function isBottleneck(days: number, average: number): boolean {
  return average > 0 && days > average * 1.5 && days > 2;
}

const fmtDays = (d: number) => `${Number.isInteger(d) ? d : d.toFixed(1)}d`;

export function PipelineBottlenecksReport() {
  const { pipelines, defaultPipeline } = usePipelineReferenceData();
  const [pipelineId, setPipelineId] = useState('');
  const effectivePipelineId = pipelineId || defaultPipeline()?.id || '';

  const params = useMemo(() => ({ pipelineId: effectivePipelineId || undefined }), [effectivePipelineId]);
  const { data, isLoading, error } = useAsync(() => getPipelineBottlenecks(params), [JSON.stringify(params)]);

  const stages = data?.stages ?? [];
  const withLeads = stages.filter((s) => s.leadsInStage > 0);
  const average = withLeads.length > 0 ? withLeads.reduce((sum, s) => sum + s.avgDaysInStage, 0) / withLeads.length : 0;
  const openLeads = stages.reduce((a, s) => a + s.leadsInStage, 0);
  const busiest = Math.max(0, ...stages.map((s) => s.leadsInStage));
  const flagged = withLeads.filter((s) => isBottleneck(s.avgDaysInStage, average));

  const columns: DataTableColumn<BottleneckStage>[] = [
    {
      key: 'stage',
      header: 'Stage',
      render: (r) => (
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
          <span className="font-medium text-ink">{r.stage}</span>
        </span>
      ),
    },
    { key: 'leadsInStage', header: 'Open leads here', align: 'right', render: (r) => <span className="tabular-nums">{fmtCount(r.leadsInStage)}</span> },
    { key: 'share', header: 'Share of open leads', ...rateColumn, render: (r) => <RateBar value={shareOf(r.leadsInStage, openLeads)} max={shareOf(busiest, openLeads)} tone="muted" /> },
    { key: 'avgDaysInStage', header: 'Avg. days in stage', align: 'right', render: (r) => <span className="font-medium tabular-nums">{r.leadsInStage ? fmtDays(r.avgDaysInStage) : '—'}</span> },
    {
      key: 'flag',
      header: 'Flag',
      align: 'right',
      render: (r) => (isBottleneck(r.avgDaysInStage, average) ? <Badge tone="danger">Bottleneck</Badge> : <span className="text-ink-faint">—</span>),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data ? `${fmtCount(openLeads)} open leads` : undefined}
        exportDisabled={stages.length === 0}
        onExportCsv={() => exportToCsv('pipeline-bottlenecks-report.csv', stages.map((s) => ({ Stage: s.stage, 'Leads In Stage': s.leadsInStage, 'Avg Days': s.avgDaysInStage })))}
        onExportPdf={() =>
          exportReportPdf({
            filename: 'pipeline-bottlenecks-report.pdf',
            title: 'Pipeline Bottlenecks Report',
            subtitle: data?.pipelineName ? `Pipeline: ${data.pipelineName}` : undefined,
            columns: ['Stage', 'Leads In Stage', 'Avg Days In Stage'],
            rows: stages.map((s) => [s.stage, s.leadsInStage, `${s.avgDaysInStage}d`]),
          })
        }
      >
        <Select
          aria-label="Pipeline"
          value={effectivePipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
          wrapperClassName="w-52"
        />
      </ReportToolbar>

      <ReportChartCard
        title="Average days in stage"
        subtitle={
          average > 0
            ? <>Where open leads wait longest. Red marks a stage at 1.5× or more of this pipeline's own average ({fmtDays(Math.round(average * 10) / 10)}).</>
            : 'Where open leads wait longest.'
        }
        legend={flagged.length ? <><LegendSwatch tone="brand" label="Within pace" /><LegendSwatch tone="danger" label={`Bottleneck (${flagged.length})`} /></> : undefined}
        footnote="Time a currently-open lead has spent in its stage, averaged per stage. Judged against the pipeline's own pace, not a fixed number of days, since every pipeline moves differently."
      >
        <ChartFrame isLoading={isLoading} isEmpty={!!error || withLeads.length === 0} emptyText={error ? error.message : 'Nothing is sitting in this pipeline right now.'} height={220}>
          <HBarChart
            format={fmtDays}
            rows={withLeads.map((s) => ({
              key: s.stageId,
              label: s.stage,
              sub: `${fmtCount(s.leadsInStage)} open`,
              value: s.avgDaysInStage,
              tone: isBottleneck(s.avgDaysInStage, average) ? 'danger' : 'brand',
            }))}
          />
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title="By stage" meta="Slowest first">
        <DataTable
          columns={columns}
          rows={stages}
          rowKey={(r) => r.stageId}
          isLoading={isLoading}
          error={error}
          emptyTitle="No open leads"
          emptyDescription="Nothing is currently sitting in this pipeline's stages."
        />
      </ReportTableCard>
    </div>
  );
}
