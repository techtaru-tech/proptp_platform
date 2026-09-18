import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { Badge } from '../../../components/ui/Badge';
import { DataTable, type DataTableColumn } from '../../../components/tables/DataTable';
import { useAsync } from '../../../hooks/useAsync';
import { usePipelineReferenceData } from '../../../hooks/usePipelineReferenceData';
import { getPipelineBottlenecks, type BottleneckStage } from '../../../services/reportCenterService';
import { exportToCsv } from '../../../services/reportService';
import { exportReportPdf } from '../../../services/reportExport';

/** Flags a stage as a bottleneck once leads sit there noticeably longer than average across the pipeline. */
function isBottleneck(days: number, average: number): boolean {
  return average > 0 && days > average * 1.5 && days > 2;
}

export function PipelineBottlenecksReport() {
  const { pipelines, defaultPipeline } = usePipelineReferenceData();
  const [pipelineId, setPipelineId] = useState('');
  const effectivePipelineId = pipelineId || defaultPipeline()?.id || '';

  const params = useMemo(() => ({ pipelineId: effectivePipelineId || undefined }), [effectivePipelineId]);
  const { data, isLoading, error } = useAsync(() => getPipelineBottlenecks(params), [JSON.stringify(params)]);

  const stages = data?.stages ?? [];
  const withLeads = stages.filter((s) => s.leadsInStage > 0);
  const average = withLeads.length > 0 ? withLeads.reduce((sum, s) => sum + s.avgDaysInStage, 0) / withLeads.length : 0;

  const columns: DataTableColumn<BottleneckStage>[] = [
    {
      key: 'stage',
      header: 'Stage',
      render: (r) => (
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
          <span className="font-medium text-ink">{r.stage}</span>
        </span>
      ),
    },
    { key: 'leadsInStage', header: 'Leads Currently Here', align: 'right', render: (r) => r.leadsInStage },
    { key: 'avgDaysInStage', header: 'Avg. Days In Stage', align: 'right', render: (r) => `${r.avgDaysInStage}d` },
    {
      key: 'flag',
      header: 'Flag',
      align: 'right',
      render: (r) => (isBottleneck(r.avgDaysInStage, average) ? <Badge tone="danger">Bottleneck</Badge> : <span className="text-ink-faint">—</span>),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <Select
            aria-label="Pipeline"
            value={effectivePipelineId}
            onChange={(e) => setPipelineId(e.target.value)}
            options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
            wrapperClassName="w-52"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download size={13} />}
              disabled={stages.length === 0}
              onClick={() => exportToCsv('pipeline-bottlenecks-report.csv', stages.map((s) => ({ Stage: s.stage, 'Leads In Stage': s.leadsInStage, 'Avg Days': s.avgDaysInStage })))}
            >
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<FileText size={13} />}
              disabled={stages.length === 0}
              onClick={() =>
                exportReportPdf({
                  filename: 'pipeline-bottlenecks-report.pdf',
                  title: 'Pipeline Bottlenecks Report',
                  subtitle: data?.pipelineName ? `Pipeline: ${data.pipelineName}` : undefined,
                  columns: ['Stage', 'Leads In Stage', 'Avg Days In Stage'],
                  rows: stages.map((s) => [s.stage, s.leadsInStage, `${s.avgDaysInStage}d`]),
                })
              }
            >
              Export PDF
            </Button>
          </div>
        </div>

        <p className="border-b border-line bg-surface-subtle px-4 py-2.5 text-xs text-ink-muted">
          Average time a currently-open lead has spent in each stage, sorted slowest first. A stage is flagged when it runs at
          least 1.5× the pipeline's own average — not against a fixed number of days, since every pipeline moves at a
          different pace.
        </p>

        <DataTable
          columns={columns}
          rows={stages}
          rowKey={(r) => r.stageId}
          isLoading={isLoading}
          error={error}
          emptyTitle="No open leads"
          emptyDescription="Nothing is currently sitting in this pipeline's stages."
        />
      </Card>
    </div>
  );
}
