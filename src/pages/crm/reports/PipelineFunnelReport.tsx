import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { DateRangeFilter, initialRangeForPreset, type DateRange } from '../../../components/reports/DateRangeFilter';
import { useAsync } from '../../../hooks/useAsync';
import { usePipelineReferenceData } from '../../../hooks/usePipelineReferenceData';
import { getPipelineFunnel, type FunnelStage } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';
import { cn } from '../../../utils/cn';

export function PipelineFunnelReport() {
  const { pipelines, defaultPipeline } = usePipelineReferenceData();
  const [pipelineId, setPipelineId] = useState<string>('');
  const [range, setRange] = useState<DateRange>(() => initialRangeForPreset('all'));

  const effectivePipelineId = pipelineId || defaultPipeline()?.id || '';
  const params = useMemo(() => ({ pipelineId: effectivePipelineId || undefined, from: range.from, to: range.to }), [effectivePipelineId, range]);
  const { data, isLoading, error } = useAsync(() => getPipelineFunnel(params), [JSON.stringify(params)]);

  const stages = data?.stages ?? [];
  const maxReached = Math.max(1, ...stages.map((s) => s.reached));

  const csvRows = () => stages.map((s) => ({ Stage: s.stage, 'Currently In Stage': s.count, 'Reached (or beyond)': s.reached, 'Conversion From Previous %': s.conversionFromPrevious }));

  return (
    <div className="flex flex-col gap-4">
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <Select
              aria-label="Pipeline"
              value={effectivePipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
              options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
              wrapperClassName="w-52"
            />
            <DateRangeFilter value={range} onChange={setRange} defaultPreset="all" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" leftIcon={<Download size={13} />} onClick={() => exportToCsv('pipeline-funnel-report.csv', csvRows())} disabled={stages.length === 0}>
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FileText size={13} />}
              disabled={stages.length === 0}
              onClick={() =>
                exportReportPdf({
                  filename: 'pipeline-funnel-report.pdf',
                  title: 'Pipeline Funnel Report',
                  subtitle: data?.pipelineName ? `Pipeline: ${data.pipelineName}` : undefined,
                  columns: ['Stage', 'In Stage', 'Reached (or beyond)', 'Conversion From Previous'],
                  rows: stages.map((s) => [s.stage, s.count, s.reached, `${s.conversionFromPrevious}%`]),
                })
              }
            >
              Export PDF
            </Button>
          </div>
        </div>

        <p className="border-b border-line bg-surface-subtle px-4 py-2.5 text-xs text-ink-muted">
          "Reached" counts every lead currently at this stage or any later one — the closest funnel view available without a
          full stage-entry history for every lead.
        </p>

        <div className="flex flex-col gap-3 p-4">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-ink-faint">Loading…</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-danger-600">{error.message}</p>
          ) : stages.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-faint">This pipeline has no stages yet.</p>
          ) : (
            stages.map((stage: FunnelStage, i) => (
              <div key={stage.stageId} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate text-sm font-medium text-ink" title={stage.stage}>
                  {stage.stage}
                </span>
                <div className="relative h-9 flex-1 overflow-hidden rounded-lg bg-surface-muted">
                  <div
                    className="flex h-full items-center rounded-lg px-3 text-xs font-semibold text-white transition-all"
                    style={{ width: `${Math.max(6, (stage.reached / maxReached) * 100)}%`, backgroundColor: stage.color }}
                  >
                    {stage.reached}
                  </div>
                </div>
                <span className={cn('w-16 shrink-0 text-right text-xs font-medium', i === 0 ? 'text-ink-faint' : 'text-ink-muted')}>
                  {i === 0 ? '—' : `${stage.conversionFromPrevious}%`}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
