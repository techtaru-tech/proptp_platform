import { useState } from 'react';
import { ArrowDown, ArrowUp, GitBranch, Plus, Star, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Drawer } from '../../components/ui/Drawer';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { cn } from '../../utils/cn';
import {
  listPipelines,
  createPipeline,
  updatePipeline,
  deletePipeline,
  listStages,
  listAllStages,
  createStage,
  updateStage,
  deleteStage,
  reorderStages,
  type PipelineWithCounts,
} from '../../services/pipelineService';
import type { PipelineStage } from '../../types';

/*
 * The Propto palette: open stages take these in order (green, indigo, blue, amber, violet, cyan,
 * rose), a won stage is mint and a lost stage is red, so every stage reads differently on the
 * Kanban board. Lower case, because that is how colours are stored.
 */
const OPEN_STAGE_COLORS = ['#18ad74', '#6179ef', '#4b91e9', '#f4b35e', '#7856ee', '#2aa7c9', '#c8569a'];
const STAGE_COLORS = [...OPEN_STAGE_COLORS, '#24c58e', '#e5484d'];

export function PipelineManager() {
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const { data: pipelines, isLoading } = useAsync(() => listPipelines(), [reloadKey]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState<PipelineWithCounts | null>(null);
  // Re-read after the stage editor closes, so the colour strip shows any colour just changed.
  const { data: allStages } = useAsync(() => listAllStages(), [reloadKey, editTarget === null]);
  const [deleteTarget, setDeleteTarget] = useState<PipelineWithCounts | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const openCreate = () => {
    setCreateName('');
    setCreateDescription('');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const pipeline = await createPipeline({ name: createName.trim(), description: createDescription.trim() || undefined });
      toast({ title: 'Pipeline created', description: `"${pipeline.name}" is ready — add stages to start using it.`, variant: 'success' });
      setCreateOpen(false);
      setReloadKey((k) => k + 1);
      setEditTarget({ ...pipeline, _count: { stages: 0, leads: 0 } });
    } finally {
      setCreating(false);
    }
  };

  const handleSetDefault = async (pipeline: PipelineWithCounts) => {
    await updatePipeline(pipeline.id, { isDefault: true });
    toast({ title: 'Default pipeline updated', description: `"${pipeline.name}" is now the default.`, variant: 'success' });
    setReloadKey((k) => k + 1);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await deletePipeline(deleteTarget.id);
    if (error) {
      setDeleteError(error);
      return;
    }
    toast({ title: 'Pipeline deleted', variant: 'success' });
    setDeleteTarget(null);
    setReloadKey((k) => k + 1);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Work leads through these on the Kanban tab.</p>
        <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={openCreate}>
          Add Pipeline
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : !pipelines || pipelines.length === 0 ? (
        <Card>
          <EmptyState icon={GitBranch} title="No pipelines yet" description="Create your first pipeline to start organizing leads into stages." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {pipelines.map((p) => (
            <Card key={p.id}>
              <CardHeader
                title={p.name}
                subtitle={`${p._count?.stages ?? 0} stage(s) · ${p._count?.leads ?? 0} lead(s)`}
                action={p.isDefault && <Badge tone="success">Default</Badge>}
              />
              {p.description && <p className="mb-3 text-sm text-ink-muted">{p.description}</p>}
              <StageStrip stages={(allStages ?? []).filter((st) => st.pipelineId === p.id)} />
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
                {!p.isDefault && (
                  <Button variant="outline" size="sm" leftIcon={<Star size={13} />} onClick={() => handleSetDefault(p)}>
                    Set Default
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setEditTarget(p)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 size={13} />}
                  className="ml-auto text-danger-600"
                  onClick={() => {
                    setDeleteError('');
                    setDeleteTarget(p);
                  }}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Pipeline"
        description="Give it a name — you'll add stages next."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreate} isLoading={creating} disabled={!createName.trim()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Pipeline name" required value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g. Renewals Pipeline" />
          <Input label="Description" value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} placeholder="Optional" />
        </div>
      </Modal>

      {editTarget && (
        <PipelineEditDrawer
          pipeline={editTarget}
          onClose={() => {
            setEditTarget(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      <ConfirmationDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete pipeline"
        description={
          deleteError ||
          (deleteTarget ? `This will permanently delete "${deleteTarget.name}" and all of its stages.` : undefined)
        }
        confirmLabel="Delete"
        variant="danger"
        audited
      />
    </div>
  );
}

function PipelineEditDrawer({ pipeline, onClose }: { pipeline: PipelineWithCounts; onClose: () => void }) {
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [name, setName] = useState(pipeline.name);
  const [description, setDescription] = useState(pipeline.description ?? '');
  const [savingDetails, setSavingDetails] = useState(false);

  const { data: stages } = useAsync(() => listStages(pipeline.id), [pipeline.id, reloadKey]);
  const [stageDeleteTarget, setStageDeleteTarget] = useState<PipelineStage | null>(null);
  const [stageDeleteError, setStageDeleteError] = useState('');

  const refetchStages = () => setReloadKey((k) => k + 1);

  const handleSaveDetails = async () => {
    if (!name.trim()) return;
    setSavingDetails(true);
    try {
      await updatePipeline(pipeline.id, { name: name.trim(), description: description.trim() || undefined });
      toast({ title: 'Pipeline updated', variant: 'success' });
    } finally {
      setSavingDetails(false);
    }
  };

  const handleAddStage = async () => {
    await createStage(pipeline.id, { name: `Stage ${(stages?.length ?? 0) + 1}`, color: OPEN_STAGE_COLORS[(stages?.length ?? 0) % OPEN_STAGE_COLORS.length] });
    refetchStages();
  };

  const handleMove = async (index: number, dir: -1 | 1) => {
    if (!stages) return;
    const target = index + dir;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    await reorderStages(pipeline.id, next.map((s) => s.id));
    refetchStages();
  };

  const handleStageDelete = async () => {
    if (!stageDeleteTarget) return;
    const { error } = await deleteStage(stageDeleteTarget.id);
    if (error) {
      setStageDeleteError(error);
      return;
    }
    setStageDeleteTarget(null);
    refetchStages();
  };

  return (
    <Drawer isOpen onClose={onClose} title={`Edit "${pipeline.name}"`} width="lg">
      <div className="space-y-5">
        <div className="space-y-4">
          <Input label="Pipeline name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          <Button variant="primary" size="sm" onClick={handleSaveDetails} isLoading={savingDetails} disabled={!name.trim()}>
            Save Details
          </Button>
        </div>

        <div className="border-t border-line pt-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Stages</span>
            <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={handleAddStage}>
              Add Stage
            </Button>
          </div>

          {!stages || stages.length === 0 ? (
            <p className="text-xs text-ink-faint">No stages yet — add one to start moving leads through this pipeline.</p>
          ) : (
            <div className="space-y-2.5">
              {stages.map((stage, i) => (
                <StageRow
                  key={stage.id}
                  stage={stage}
                  isFirst={i === 0}
                  isLast={i === stages.length - 1}
                  onMoveUp={() => handleMove(i, -1)}
                  onMoveDown={() => handleMove(i, 1)}
                  onDelete={() => {
                    setStageDeleteError('');
                    setStageDeleteTarget(stage);
                  }}
                  onSaved={refetchStages}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmationDialog
        isOpen={!!stageDeleteTarget}
        onClose={() => setStageDeleteTarget(null)}
        onConfirm={handleStageDelete}
        title="Delete stage"
        description={
          stageDeleteError ||
          (stageDeleteTarget ? `This will permanently delete "${stageDeleteTarget.name}".` : undefined)
        }
        confirmLabel="Delete"
        variant="danger"
        audited
      />
    </Drawer>
  );
}

function StageRow({
  stage,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onDelete,
  onSaved,
}: {
  stage: PipelineStage;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(stage.name);

  const saveName = () => {
    if (name.trim() && name.trim() !== stage.name) updateStage(stage.id, { name: name.trim() }).then(onSaved);
  };

  const setColor = (color: string) => updateStage(stage.id, { color }).then(onSaved);
  const toggleWon = () => updateStage(stage.id, { isWon: !stage.isWon, isLost: stage.isWon ? stage.isLost : false }).then(onSaved);
  const toggleLost = () => updateStage(stage.id, { isLost: !stage.isLost, isWon: stage.isLost ? stage.isWon : false }).then(onSaved);

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={onMoveUp} disabled={isFirst} className="text-ink-faint hover:text-ink disabled:opacity-30" aria-label="Move up">
            <ArrowUp size={13} />
          </button>
          <button type="button" onClick={onMoveDown} disabled={isLast} className="text-ink-faint hover:text-ink disabled:opacity-30" aria-label="Move down">
            <ArrowDown size={13} />
          </button>
        </div>
        <Input
          wrapperClassName="flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <Button variant="ghost" size="icon" aria-label="Delete stage" onClick={onDelete} className="shrink-0 text-danger-600 hover:bg-danger-50">
          <Trash2 size={14} />
        </Button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3 pl-[26px]">
        <div className="flex items-center gap-1">
          {STAGE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Set color ${c}`}
              className={cn('h-5 w-5 rounded-full ring-offset-1', stage.color === c && 'ring-2 ring-ink')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={stage.isWon} onChange={toggleWon} className="h-3.5 w-3.5 rounded border-line-strong text-success-600 focus-ring" />
          Won stage
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={stage.isLost} onChange={toggleLost} className="h-3.5 w-3.5 rounded border-line-strong text-danger-600 focus-ring" />
          Lost stage
        </label>
      </div>
    </div>
  );
}

/** The pipeline's stages as one row of coloured segments; hover a segment for its name. */
function StageStrip({ stages }: { stages: PipelineStage[] }) {
  if (stages.length === 0) return null;
  const ordered = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div className="mb-3.5">
      <div className="flex gap-[3px]" aria-hidden="true">
        {ordered.map((st) => <span key={st.id} title={st.name} className="h-2 flex-1 rounded-full" style={{ backgroundColor: st.color }} />)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {ordered.map((st) => (
          <li key={st.id} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: st.color }} />{st.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
