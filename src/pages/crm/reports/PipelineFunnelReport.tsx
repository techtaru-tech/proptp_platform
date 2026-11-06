import { useMemo, useState } from 'react';
import { Select } from '../../../components/ui/Select';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { usePipelineReferenceData } from '../../../hooks/usePipelineReferenceData';
import { getPipelineFunnel, type FunnelStage } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import { cn } from '../../../utils/cn';
import {
  ChartFrame, RateBar, ReportChartCard, ReportTableCard, ReportToolbar, fmtCount, fmtPct, rateColumn, shareOf,
} from './ReportCenterParts';

/**
 * Step conversion as shown. "Reached" counts a lead at its stage and every stage after it, so it
 * can only fall stage by stage and the step can't pass 100%; the clamp is a guard in case a
 * pipeline's stage order ever disagrees with that.
 */
const stepRate = (s: FunnelStage) => Math.min(100, Math.max(0, s.conversionFromPrevious));

export function PipelineFunnelReport() {
  const { pipelines, defaultPipeline } = usePipelineReferenceData();
  const [pipelineId, setPipelineId] = useState<string>('');
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset('all'));

  const effectivePipelineId = pipelineId || defaultPipeline()?.id || '';
  const params = useMemo(() => ({ pipelineId: effectivePipelineId || undefined, from: range.from, to: range.to }), [effectivePipelineId, range]);
  const { data, isLoading, error } = useAsync(() => getPipelineFunnel(params), [JSON.stringify(params)]);

  const stages = data?.stages ?? [];
  const top = Math.max(1, stages[0]?.reached ?? 0, ...stages.map((s) => s.reached));
  const first = stages[0]?.reached ?? 0;

  const csvRows = () => stages.map((s) => ({ Stage: s.stage, 'Currently In Stage': s.count, 'Reached (or beyond)': s.reached, 'Conversion From Previous %': stepRate(s) }));

  const columns: DataTableColumn<FunnelStage>[] = [
    {
      key: 'stage',
      header: 'Stage',
      render: (s) => (
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
          <span className="font-medium text-ink">{s.stage}</span>
        </span>
      ),
    },
    { key: 'count', header: 'In stage now', align: 'right', render: (s) => <span className="tabular-nums text-ink-muted">{fmtCount(s.count)}</span> },
    { key: 'reached', header: 'Reached', align: 'right', render: (s) => <span className="font-medium tabular-nums">{fmtCount(s.reached)}</span> },
    { key: 'ofFirst', header: 'Of first stage', ...rateColumn, render: (s) => <RateBar value={shareOf(s.reached, first)} /> },
    {
      key: 'step',
      header: 'From previous',
      align: 'right',
      render: (s) => {
        const i = stages.indexOf(s);
        return i === 0 ? <span className="text-ink-faint">—</span> : <span className={cn('tabular-nums', stepRate(s) < 50 ? 'text-danger-700' : 'text-ink')}>{fmtPct(stepRate(s))}</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar
        meta={data?.pipelineName}
        exportDisabled={stages.length === 0}
        onExportCsv={() => exportToCsv('pipeline-funnel-report.csv', csvRows())}
        onExportPdf={() =>
          exportReportPdf({
            filename: 'pipeline-funnel-report.pdf',
            title: 'Pipeline Funnel Report',
            subtitle: data?.pipelineName ? `Pipeline: ${data.pipelineName}` : undefined,
            columns: ['Stage', 'In Stage', 'Reached (or beyond)', 'Conversion From Previous'],
            rows: stages.map((s) => [s.stage, s.count, s.reached, `${stepRate(s)}%`]),
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
        <DateRangeFilter value={range} onChange={setRange} defaultPreset="all" />
      </ReportToolbar>

      <ReportChartCard
        title="Pipeline funnel"
        subtitle="How many leads reach each stage, and what share carries on from the stage before."
        meta={stages.length > 0 ? <>{fmtCount(first)} leads in the funnel</> : undefined}
        footnote={'"Reached" counts every lead now at this stage or any later one — the closest funnel view without a full stage-entry history for every lead.'}
      >
        <ChartFrame isLoading={isLoading} isEmpty={!!error || stages.length === 0} emptyText={error ? error.message : 'This pipeline has no stages yet.'} height={240}>
          <ol className="space-y-0.5">
            <li className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem_3.5rem] gap-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-ink-subtle sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4rem_4.5rem]">
              <span>Stage</span>
              <span />
              <span className="text-right">Reached</span>
              <span className="text-right">Step</span>
            </li>
            {stages.map((s, i) => {
              const width = Math.max(1.5, (s.reached / top) * 100);
              return (
                <li key={s.stageId} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem_3.5rem] items-center gap-3 py-1 text-[13px] sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4rem_4.5rem]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="truncate text-ink-muted" title={s.stage}>{s.stage}</span>
                  </span>
                  <span className="h-6 overflow-hidden rounded-md bg-surface-muted">
                    <span className="flex h-full items-center overflow-hidden rounded-md bg-brand-600 pl-2 text-2xs font-medium text-white" style={{ width: `${width}%` }}>
                      {/* On a phone the track is too short to hold the figure inside the bar. */}
                      {width >= 12 && <span className="hidden whitespace-nowrap sm:inline">{fmtPct(shareOf(s.reached, first))}</span>}
                    </span>
                  </span>
                  <span className="text-right font-semibold tabular-nums text-ink">{fmtCount(s.reached)}</span>
                  <span className={cn('text-right text-xs tabular-nums', i === 0 ? 'text-ink-faint' : stepRate(s) < 50 ? 'text-danger-700' : 'text-ink-muted')}>
                    {i === 0 ? '—' : fmtPct(stepRate(s))}
                  </span>
                </li>
              );
            })}
          </ol>
        </ChartFrame>
      </ReportChartCard>

      <ReportTableCard title="By stage" meta={stages.length ? 'Steps under 50% in red' : undefined}>
        <DataTable
          columns={columns}
          rows={stages}
          rowKey={(s) => s.stageId}
          isLoading={isLoading}
          error={error}
          emptyTitle="This pipeline has no stages yet"
          emptyDescription="Add stages under CRM > Pipeline."
        />
      </ReportTableCard>
    </div>
  );
}
