import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Star } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { LeadSourceBadge } from '../../components/leads/LeadSourceBadge';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { moveLeadStage, listAssignableUsers, listLeads } from '../../services/leadService';
import { listPipelines, listStages } from '../../services/pipelineService';
import { formatCurrency, leadFullName } from '../../utils/format';
import { cn } from '../../utils/cn';
import type { Lead } from '../../types';

const PAGE_SIZE = 20;

/** The Unassigned column's stage id on the wire — leads not yet on a pipeline. */
const UNASSIGNED = 'none';

interface ColumnData {
  leads: Lead[];
  /** Every lead in this stage, not just the ones fetched. */
  total: number;
  /** Pages fetched so far; the next Load more asks for page + 1. */
  page: number;
}

export function PipelineBoard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [pipelineId, setPipelineId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const { data: pipelines } = useAsync(() => listPipelines(), []);
  const activePipelineId = pipelineId || pipelines?.[0]?.id || '';
  const { data: stages } = useAsync(() => (activePipelineId ? listStages(activePipelineId) : Promise.resolve([])), [activePipelineId]);

  // One request per column rather than one enormous one for the board: a pipeline whose first
  // stage holds thousands of leads used to drag every one of them over the wire to render
  // twenty cards.
  const [columns, setColumns] = useState<Record<string, ColumnData>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const columnKeys = useMemo(() => [UNASSIGNED, ...(stages ?? []).map((s) => s.id)], [stages]);
  const columnSignature = columnKeys.join(',');

  const fetchPage = useCallback(async (key: string, page: number) => {
    setLoadingKey(key);
    try {
      const result = await listLeads({ stageId: key, page, pageSize: PAGE_SIZE, sortBy: 'createdAt', sortDir: 'desc' });
      setColumns((prev) => ({
        ...prev,
        [key]: {
          leads: page === 1 ? result.items : [...(prev[key]?.leads ?? []), ...result.items],
          total: result.total,
          page,
        },
      }));
    } finally {
      setLoadingKey((current) => (current === key ? null : current));
    }
  }, []);

  useEffect(() => {
    setColumns({});
    columnSignature.split(',').forEach((key) => key && fetchPage(key, 1));
    // columnSignature stands in for the stage list, which is rebuilt on every render.
  }, [columnSignature, reloadKey, fetchPage]);

  const assignableUsers = listAssignableUsers();

  const handleDrop = async (stageId: string) => {
    if (!dragLeadId || !activePipelineId) return;
    await moveLeadStage(dragLeadId, activePipelineId, stageId);
    toast({ title: 'Lead moved', variant: 'success' });
    setDragLeadId(null);
    setDragOverStage(null);
    // Both the column it left and the one it joined have changed, so reload the board.
    setReloadKey((k) => k + 1);
  };

  return (
    <div>
      <PageHeader
        title="Kanban"
        description="Drag leads between stages to move them through the pipeline."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Pipeline', to: '/crm/pipeline' }, { label: 'Kanban' }]}
        actions={
          pipelines && pipelines.length > 0 ? (
            <Select value={activePipelineId} onChange={(e) => setPipelineId(e.target.value)} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} wrapperClassName="w-56" />
          ) : undefined
        }
      />

      <div className="flex gap-4 overflow-x-auto pb-4">
        <StageColumn
          title="Unassigned"
          color="#98a2b3"
          column={columns[UNASSIGNED]}
          isLoading={loadingKey === UNASSIGNED}
          onLoadMore={() => fetchPage(UNASSIGNED, (columns[UNASSIGNED]?.page ?? 1) + 1)}
          isDragOver={dragOverStage === '__unassigned__'}
          onDragOverStage={() => setDragOverStage('__unassigned__')}
          onDropStage={() => {}}
          droppable={false}
          onDragStartLead={setDragLeadId}
          onCardClick={(id) => navigate(`/crm/leads/${id}`)}
          assignableUsers={assignableUsers}
        />
        {(stages ?? []).map((stage) => (
          <StageColumn
            key={stage.id}
            title={stage.name}
            color={stage.color}
            column={columns[stage.id]}
            isLoading={loadingKey === stage.id}
            onLoadMore={() => fetchPage(stage.id, (columns[stage.id]?.page ?? 1) + 1)}
            isDragOver={dragOverStage === stage.id}
            onDragOverStage={() => setDragOverStage(stage.id)}
            onDropStage={() => handleDrop(stage.id)}
            droppable
            onDragStartLead={setDragLeadId}
            onCardClick={(id) => navigate(`/crm/leads/${id}`)}
            assignableUsers={assignableUsers}
          />
        ))}
      </div>
    </div>
  );
}

interface StageColumnProps {
  title: string;
  color: string;
  /** Undefined until this column's first page has arrived. */
  column?: ColumnData;
  isLoading: boolean;
  onLoadMore: () => void;
  isDragOver: boolean;
  onDragOverStage: () => void;
  onDropStage: () => void;
  droppable: boolean;
  onDragStartLead: (id: string) => void;
  onCardClick: (id: string) => void;
  assignableUsers: ReturnType<typeof listAssignableUsers>;
}

function StageColumn({ title, color, column, isLoading, onLoadMore, isDragOver, onDragOverStage, onDropStage, droppable, onDragStartLead, onCardClick, assignableUsers }: StageColumnProps) {
  const leads = column?.leads ?? [];
  const total = column?.total ?? 0;
  const remaining = Math.max(0, total - leads.length);
  // The value of what is on screen, not of the whole stage — the rest has not been fetched.
  const loadedValue = leads.reduce((s, l) => s + (l.dealValue ?? 0), 0);

  const handleDragOver = (e: DragEvent) => {
    if (!droppable) return;
    e.preventDefault();
    onDragOverStage();
  };
  const handleDrop = (e: DragEvent) => {
    if (!droppable) return;
    e.preventDefault();
    onDropStage();
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn('flex h-[calc(100vh-15rem)] w-72 shrink-0 flex-col rounded-xl border bg-surface-subtle transition-colors', isDragOver ? 'border-brand-400 bg-brand-50' : 'border-line')}
    >
      <div className="flex items-center justify-between rounded-t-xl border-b border-line bg-white px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          {title}
          <span className="text-xs font-normal text-ink-faint">({total})</span>
        </span>
      </div>
      <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5" style={{ minHeight: 120 }}>
        {leads.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-ink-faint">{isLoading ? 'Loading...' : 'No leads'}</p>
        ) : (
          leads.map((lead) => {
            const assignee = assignableUsers.find((u) => u.id === lead.assignedUserId);
            return (
              <div
                key={lead.id}
                draggable
                onDragStart={() => onDragStartLead(lead.id)}
                onClick={() => onCardClick(lead.id)}
                className="cursor-pointer rounded-lg border border-line bg-white p-3 shadow-card transition-shadow hover:shadow-popover"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1 truncate text-sm font-medium text-ink">
                    {leadFullName(lead)}
                    {lead.isStarred && <Star size={11} className="shrink-0 fill-warning-500 text-warning-500" />}
                  </p>
                </div>
                <LeadSourceBadge source={lead.source} otherSource={lead.otherSource} />
                {lead.dealValue != null && <p className="mt-1.5 text-xs font-semibold text-ink">{formatCurrency(lead.dealValue)}</p>}
                <div className="mt-2 flex items-center justify-between">
                  {assignee ? (
                    <span className="flex items-center gap-1.5">
                      <Avatar name={assignee.name} size="xs" />
                      <span className="text-xs text-ink-muted">{assignee.name.split(' ')[0]}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-ink-faint">Unassigned</span>
                  )}
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">{lead.priority}</span>
                </div>
              </div>
            );
          })
        )}
        {remaining > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            isLoading={isLoading}
            leftIcon={isLoading ? <Loader2 size={13} className="animate-spin" /> : undefined}
            onClick={onLoadMore}
          >
            Load {Math.min(PAGE_SIZE, remaining)} more
          </Button>
        )}
      </div>
      {leads.length > 0 && (
        <div className="flex items-center justify-between border-t border-line px-3.5 py-2 text-xs font-medium text-ink-muted">
          <span>
            Showing {leads.length} of {total}
          </span>
          <span>{formatCurrency(loadedValue)}</span>
        </div>
      )}
    </div>
  );
}
