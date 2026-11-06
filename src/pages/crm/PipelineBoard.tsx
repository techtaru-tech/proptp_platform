import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Flag, Star } from 'lucide-react';
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

  const endDrag = () => {
    setDragLeadId(null);
    setDragOverStage(null);
  };

  const handleDrop = async (stageId: string) => {
    const leadId = dragLeadId;
    endDrag();
    if (!leadId || !activePipelineId) return;
    const lead = Object.values(columns).flatMap((c) => c.leads).find((l) => l.id === leadId);
    // Dropped back where it came from: nothing to move.
    if (lead?.pipelineStageId === stageId) return;
    await moveLeadStage(leadId, activePipelineId, stageId);
    const stageName = stages?.find((st) => st.id === stageId)?.name;
    toast({ title: lead && stageName ? `${leadFullName(lead)} moved to ${stageName}` : 'Lead moved', variant: 'success' });
    // Both the column it left and the one it joined have changed, so reload the board.
    setReloadKey((k) => k + 1);
  };

  const unassigned = columns[UNASSIGNED];
  const columnProps = {
    dragLeadId,
    onDragStartLead: setDragLeadId,
    onDragEndLead: endDrag,
    onCardClick: (id: string) => navigate(`/crm/leads/${id}`),
    assignableUsers,
  };

  return (
    <div>
      <PageHeader
        title="Kanban"
        description="Drag leads between stages to move them through the pipeline."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Pipeline', to: '/crm/pipeline' }, { label: 'Kanban' }]}
        actions={
          pipelines && pipelines.length > 0 ? (
            <Select aria-label="Pipeline" value={activePipelineId} onChange={(e) => setPipelineId(e.target.value)} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} wrapperClassName="w-56" />
          ) : undefined
        }
      />

      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
        {/* Leads not on a pipeline yet. Usually there are none, so the empty column folds to a strip. */}
        {unassigned && unassigned.total === 0 ? (
          <div
            className="flex h-[calc(100vh-13rem)] min-h-[420px] w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-dashed border-line py-3"
            title="No leads are waiting to be placed on a stage"
          >
            <span className="rounded-full bg-surface px-1.5 text-2xs font-semibold tabular-nums text-ink-faint ring-1 ring-line">0</span>
            <span className="text-xs font-medium text-ink-faint [writing-mode:vertical-rl]">Unassigned</span>
          </div>
        ) : (
          <StageColumn
            title="Unassigned"
            color="#98a2b3"
            column={unassigned}
            isLoading={loadingKey === UNASSIGNED}
            onLoadMore={() => fetchPage(UNASSIGNED, (unassigned?.page ?? 1) + 1)}
            isDragOver={false}
            onDragOverStage={() => {}}
            onDropStage={() => {}}
            droppable={false}
            {...columnProps}
          />
        )}
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
            {...columnProps}
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
  /** The card being dragged anywhere on the board, if any. */
  dragLeadId: string | null;
  onDragStartLead: (id: string) => void;
  onDragEndLead: () => void;
  onCardClick: (id: string) => void;
  assignableUsers: ReturnType<typeof listAssignableUsers>;
}

function StageColumn({
  title, color, column, isLoading, onLoadMore, isDragOver, onDragOverStage, onDropStage, droppable,
  dragLeadId, onDragStartLead, onDragEndLead, onCardClick, assignableUsers,
}: StageColumnProps) {
  const leads = column?.leads ?? [];
  const total = column?.total ?? 0;
  const remaining = Math.max(0, total - leads.length);
  // The value of what is on screen, not of the whole stage — the rest has not been fetched.
  const loadedValue = leads.reduce((s, l) => s + (l.dealValue ?? 0), 0);

  const handleDragOver = (e: DragEvent) => {
    if (!droppable) return;
    e.preventDefault();
    if (!isDragOver) onDragOverStage();
  };
  const handleDrop = (e: DragEvent) => {
    if (!droppable) return;
    e.preventDefault();
    onDropStage();
  };

  return (
    <section
      aria-label={`${title}, ${total} leads`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex h-[calc(100vh-13rem)] min-h-[420px] w-[17.5rem] shrink-0 flex-col overflow-hidden rounded-xl border border-line transition-[background-color,box-shadow] duration-100"
      // Each column is lightly tinted with its stage colour; a drop target is outlined in it.
      style={{
        backgroundColor: `color-mix(in oklab, ${color} ${isDragOver ? 12 : 5}%, var(--c-surface-subtle))`,
        boxShadow: isDragOver ? `inset 0 0 0 2px ${color}` : undefined,
      }}
    >
      <div className="h-[3px] shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />
      <header className="flex items-center gap-2 px-3 pb-2 pt-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{title}</h2>
        <span className="shrink-0 rounded-full bg-surface px-2 py-px text-2xs font-semibold tabular-nums text-ink-muted ring-1 ring-line">
          {column ? total : '–'}
        </span>
      </header>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
        {!column ? (
          Array.from({ length: 3 }, (_, i) => <div key={i} className="h-[62px] animate-pulse rounded-lg bg-surface/70" />)
        ) : leads.length === 0 ? (
          <div
            className={cn('flex h-24 items-center justify-center rounded-lg border border-dashed text-xs transition-colors duration-100', isDragOver ? 'text-ink-muted' : 'border-line text-ink-faint')}
            style={isDragOver ? { borderColor: color } : undefined}
          >
            {dragLeadId && droppable ? 'Drop here' : 'No leads'}
          </div>
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              color={color}
              isDragged={dragLeadId === lead.id}
              assignee={assignableUsers.find((u) => u.id === lead.assignedUserId)}
              onDragStart={() => onDragStartLead(lead.id)}
              onDragEnd={onDragEndLead}
              onOpen={() => onCardClick(lead.id)}
            />
          ))
        )}
        {remaining > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full border border-dashed border-line-strong bg-surface/60 text-ink-muted hover:bg-surface"
            isLoading={isLoading}
            onClick={onLoadMore}
          >
            Load {Math.min(PAGE_SIZE, remaining)} more
          </Button>
        )}
      </div>

      {total > 0 && (
        <footer className="flex items-center justify-between gap-2 border-t border-line bg-surface/70 px-3 py-1.5 text-xs">
          <span className="tabular-nums text-ink-subtle">{leads.length} of {total}</span>
          <span className="font-semibold tabular-nums text-ink" title="Deal value of the cards shown">{loadedValue ? formatCurrency(loadedValue) : '—'}</span>
        </footer>
      )}
    </section>
  );
}

const PRIORITY_FLAG: Partial<Record<Lead['priority'], { label: string; Icon: typeof Flag; cls: string }>> = {
  urgent: { label: 'Urgent', Icon: Flag, cls: 'text-danger-700' },
  high: { label: 'High', Icon: ArrowUp, cls: 'text-warning-700' },
};

/**
 * One lead: who, from where, how much, whose. Normal and low priority say nothing; only the
 * leads to act on first carry a flag.
 */
function LeadCard({ lead, color, isDragged, assignee, onDragStart, onDragEnd, onOpen }: {
  lead: Lead;
  color: string;
  isDragged: boolean;
  assignee?: { id: string; name: string };
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const flag = PRIORITY_FLAG[lead.priority];
  const owner = assignee?.name ?? lead.assignedTo ?? null;
  return (
    <article
      draggable
      tabIndex={0}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className={cn(
        'group cursor-grab rounded-lg border border-line bg-surface px-2.5 py-2 transition-[border-color,box-shadow,opacity] duration-100 hover:border-line-strong hover:shadow-[0_2px_8px_-4px_rgba(16,24,40,0.18)] focus-ring active:cursor-grabbing',
        isDragged && 'opacity-40'
      )}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-1 text-[13px] font-medium text-ink">
          <span className="truncate group-hover:text-brand-700">{leadFullName(lead)}</span>
          {lead.isStarred && <Star size={11} className="shrink-0 fill-warning-500 text-warning-500" aria-label="Starred" />}
        </p>
        {owner ? (
          <span title={owner} className="shrink-0"><Avatar name={owner} size="xs" /></span>
        ) : (
          <span title="Unassigned" className="h-6 w-6 shrink-0 rounded-full border border-dashed border-line-strong" />
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <LeadSourceBadge source={lead.source} otherSource={lead.otherSource} />
        {flag && (
          <span className={cn('inline-flex items-center gap-0.5 text-2xs font-medium', flag.cls)}>
            <flag.Icon size={10} aria-hidden="true" />
            {flag.label}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-ink">
          {lead.dealValue != null ? formatCurrency(lead.dealValue) : <span className="font-normal text-ink-faint">—</span>}
        </span>
      </div>
    </article>
  );
}
