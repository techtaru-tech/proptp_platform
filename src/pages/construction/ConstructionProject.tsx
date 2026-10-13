import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatDate } from '../../utils/format';
import {
  addActivity, deleteActivity, getConstructionProject, listConstructionPeople, updateActivity,
  type ConstructionActivity, type Rollup,
} from '../../services/constructionService';
import { BehindBadge, PlanVsActual } from './PlanVsActual';
import { ActivityStatusBadge, STATUS_META, StatusLegend } from './ActivityStatus';
import { cn } from '../../utils/cn';

type Group = 'block' | 'phase';

export function ConstructionProject() {
  const { id = '' } = useParams();
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [group, setGroup] = useState<Group>('block');
  const [editing, setEditing] = useState<ConstructionActivity | 'new' | null>(null);
  const [removing, setRemoving] = useState<ConstructionActivity | null>(null);
  const { data, isLoading, error } = useAsync(() => getConstructionProject(id), [id, reload]);

  if (error) return <ErrorState title="Could not load this project" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;

  const groups = new Map<string, ConstructionActivity[]>();
  for (const a of data.activities) {
    const key = (group === 'block' ? a.block : a.phase) || (group === 'block' ? 'No block' : 'No phase');
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const rollups: Record<string, Rollup> = Object.fromEntries((group === 'block' ? data.blocks : data.phases).map((g) => [g.name || (group === 'block' ? 'No block' : 'No phase'), g]));

  const remove = async () => {
    if (!removing) return;
    try {
      await deleteActivity(removing.id);
      toast({ title: 'Activity removed', variant: 'success' });
      setReload((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not remove it', description: (err as Error).message, variant: 'error' });
    }
    setRemoving(null);
  };

  return (
    <div>
      <PageHeader
        title={data.project.projectName}
        description={data.project.projectLocation}
        breadcrumb={[{ label: 'Construction', to: '/construction' }, { label: data.project.projectName }]}
        actions={
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setEditing('new')}>
            Add activity
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Whole project</p>
            <p className="text-4xl font-semibold tabular-nums text-ink">{data.summary.actual}%</p>
            <p className="text-sm text-ink-muted">complete · plan says {data.summary.planned}%</p>
          </div>
          <div className="text-right">
            <BehindBadge days={data.summary.daysBehind} />
            <p className="text-xs text-ink-muted">{data.summary.activities} activities</p>
          </div>
        </div>
        <PlanVsActual planned={data.summary.planned} actual={data.summary.actual} className="mt-4" />
        <p className="mt-2 text-xs text-ink-faint">Filled bar is approved progress; the tick is where the plan says it should be today.</p>
      </Card>

      {data.activities.length === 0 ? (
        <Card><EmptyState title="No activities yet" description="Add the phases and activities with their planned dates. Site staff report against them from the app." /></Card>
      ) : (
        <>
          <StatusLegend className="mb-3" />
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Group by</span>
            {(['block', 'phase'] as Group[]).map((g) => (
              <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g}
                className={`rounded-lg border px-3 py-1 focus-ring ${group === g ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>
                {g === 'block' ? 'Block' : 'Phase'}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-4">
            {[...groups.entries()].map(([name, items]) => {
              const r = rollups[name];
              return (
                <Card key={name} padded={false}>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                    <h3 className="font-semibold text-ink">{name}</h3>
                    {r && (
                      <div className="flex w-full max-w-sm items-center gap-3 sm:w-auto">
                        <span className="whitespace-nowrap text-sm tabular-nums text-ink-muted">{r.actual}% / plan {r.planned}%</span>
                        <PlanVsActual planned={r.planned} actual={r.actual} className="w-32 shrink-0" />
                        <span className="whitespace-nowrap"><BehindBadge days={r.daysBehind} /></span>
                      </div>
                    )}
                  </div>
                  <ul className="divide-y divide-line">
                    {items.map((a) => (
                      <li key={a.id} className={cn('grid grid-cols-1 gap-2 border-l-4 px-5 py-3 md:grid-cols-[1.5fr_1fr_1.2fr_auto] md:items-center md:gap-4', STATUS_META[a.status].edge)}>
                        <div>
                          <p className="font-medium text-ink">{a.name}</p>
                          <div className="my-0.5"><ActivityStatusBadge status={a.status} pendingBlockers={a.pendingBlockers} /></div>
                          <p className="text-xs text-ink-muted">
                            {formatDate(a.plannedStart)} → {formatDate(a.plannedEnd)}
                            {a.phase && group === 'block' ? ` · ${a.phase}` : ''}
                            {a.block && group === 'phase' ? ` · ${a.block}` : ''}
                          </p>
                        </div>
                        <p className="text-sm text-ink-muted">{a.assigneeName ?? <span className="text-ink-faint">Unassigned</span>}</p>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="tabular-nums text-ink">{a.actual}% <span className="text-ink-faint">/ plan {a.planned}%</span></span>
                            <BehindBadge days={a.daysBehind} />
                          </div>
                          <PlanVsActual planned={a.planned} actual={a.actual} status={a.status} />
                          {a.pendingBlockers > 0 && (
                            <Link to={`/construction/blockers?projectId=${id}`} className="mt-1 block text-xs font-medium text-warning-700">
                              Review the blocker raised on this activity
                            </Link>
                          )}
                          {a.pendingUpdates > 0 && (
                            <Link to={`/construction/reviews?projectId=${id}`} className="mt-1 inline-block text-xs font-medium text-brand-700">
                              {a.pendingUpdates} update{a.pendingUpdates === 1 ? '' : 's'} waiting for review
                            </Link>
                          )}
                        </div>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}><Pencil size={13} /></Button>
                          <Button variant="ghost" size="sm" className="text-danger-600" aria-label={`Remove ${a.name}`} onClick={() => setRemoving(a)}><Trash2 size={13} /></Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {editing && (
        <ActivityModal
          projectId={id}
          activity={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setReload((k) => k + 1); }}
        />
      )}
      <ConfirmationDialog
        isOpen={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Remove this activity?"
        description={removing ? `"${removing.name}" will be removed from the schedule. An activity with site updates cannot be removed.` : undefined}
        confirmLabel="Remove"
        variant="danger"
      />
    </div>
  );
}

const toDay = (iso?: string) => (iso ? iso.slice(0, 10) : '');

function ActivityModal({ projectId, activity, onClose, onSaved }: { projectId: string; activity: ConstructionActivity | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { data: people } = useAsync(() => listConstructionPeople(), []);
  const [form, setForm] = useState({
    name: activity?.name ?? '', phase: activity?.phase ?? '', block: activity?.block ?? '',
    plannedStart: toDay(activity?.plannedStart), plannedEnd: toDay(activity?.plannedEnd),
    weight: String(activity?.weight ?? 1), assigneeId: activity?.assigneeId ?? '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, weight: Number(form.weight) || 1, assigneeId: form.assigneeId || null };
      if (activity) await updateActivity(activity.id, body);
      else await addActivity(projectId, body);
      onSaved();
    } catch (err) {
      toast({ title: 'Could not save the activity', description: (err as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={activity ? 'Edit activity' : 'Add activity'}
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving}>Save</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Input label="Activity" name="activityName" required value={form.name} onChange={set('name')} placeholder="e.g. Road base and kerbing" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Phase" name="activityPhase" value={form.phase} onChange={set('phase')} placeholder="e.g. Infrastructure" />
          <Input label="Block" name="activityBlock" value={form.block} onChange={set('block')} placeholder="e.g. Block A" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DatePicker label="Planned start" name="plannedStart" required value={form.plannedStart} onChange={set('plannedStart')} />
          <DatePicker label="Planned end" name="plannedEnd" required value={form.plannedEnd} onChange={set('plannedEnd')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Responsible on site" name="activityAssignee" value={form.assigneeId} onChange={set('assigneeId')}
            options={[{ value: '', label: 'Unassigned' }, ...(people ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          <Input label="Weight" name="activityWeight" type="number" min={1} max={100} value={form.weight} onChange={set('weight')} hint="How much it counts toward the total." />
        </div>
      </div>
    </Modal>
  );
}
