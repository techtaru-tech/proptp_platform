import { useState } from 'react';
import { Eye, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Toggle } from '../../components/ui/Toggle';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/format';
import {
  ACTION_LABEL, deleteRule, getRuleCatalogue, listRules, previewRule, ruleFires, toggleRule, type OpsRuleRow, type Preview, type FireRow,
} from '../../services/opsRuleService';
import { RuleEditor } from './RuleEditor';

const summary = (r: OpsRuleRow) =>
  r.steps.map((s) => `${s.delayHours ? `after ${s.delayHours}h` : 'at once'}${s.repeatEveryHours ? `, every ${s.repeatEveryHours}h` : ''}: ${ACTION_LABEL[s.action.kind]}`).join(' → ');

export function OpsRules() {
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<OpsRuleRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<OpsRuleRow | null>(null);
  const [view, setView] = useState<{ rule: OpsRuleRow; kind: 'preview' | 'log' } | null>(null);
  const rules = useAsync(() => listRules(), [reload]);
  const cat = useAsync(() => getRuleCatalogue(), []);
  const refresh = () => setReload((k) => k + 1);

  const flip = async (r: OpsRuleRow) => {
    try {
      await toggleRule(r.id);
      toast({ title: r.enabled ? 'Rule switched off' : 'Rule switched on', description: r.enabled ? undefined : 'It acts from now on.', variant: 'success' });
      refresh();
    } catch (e) {
      toast({ title: 'Could not change it', description: (e as Error).message, variant: 'error' });
    }
  };
  const remove = async () => {
    if (!removing) return;
    try {
      await deleteRule(removing.id);
      refresh();
    } catch (e) {
      toast({ title: 'Could not delete', description: (e as Error).message, variant: 'error' });
    }
    setRemoving(null);
  };

  return (
    <div>
      <PageHeader
        title="Operations rules"
        description="When something happens on site, in legal or in sales, what the system should do — who is told, on which channel, after how long. Nothing is fixed in code."
        breadcrumb={[{ label: 'Operations rules' }]}
        actions={<Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setEditing('new')}>New rule</Button>}
      />
      <p className="mb-4 rounded-lg bg-info-50 px-4 py-3 text-sm text-info-700">
        Rules start switched off. Use <strong>Preview</strong> to see exactly what a rule would do right now before you turn it on. Switching one on makes it act on conditions that are already true
        (an overdue payment, a missing update), but never on past events such as old bookings.
      </p>
      {rules.error ? <ErrorState title="Could not load rules" description={rules.error.message} /> : !rules.data || !cat.data ? <CardSkeleton /> : rules.data.length === 0 ? (
        <Card><EmptyState title="No rules yet" description="Create one, choosing what triggers it and what happens next." /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.data.map((r) => {
            const t = cat.data!.triggers.find((x) => x.key === r.trigger);
            return (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-ink">{r.name}</h3>
                      <Badge tone={r.enabled ? 'success' : 'neutral'} dot>{r.enabled ? 'On' : 'Off'}</Badge>
                    </div>
                    <p className="text-xs text-ink-muted">When: {t?.label ?? r.trigger}</p>
                    <p className="mt-1 text-sm text-ink">{summary(r)}</p>
                    <p className="mt-1 text-xs text-ink-faint">{r.fireCount} action{r.fireCount === 1 ? '' : 's'} so far{r.lastFiredAt ? ` · last ${formatDateTime(r.lastFiredAt)}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Toggle label={`${r.name}: ${r.enabled ? 'on' : 'off'}`} showLabel={false} checked={r.enabled} onChange={() => flip(r)} />
                    <Button variant="ghost" size="sm" leftIcon={<Eye size={13} />} onClick={() => setView({ rule: r, kind: 'preview' })}>Preview</Button>
                    <Button variant="ghost" size="sm" leftIcon={<History size={13} />} onClick={() => setView({ rule: r, kind: 'log' })}>Log</Button>
                    <Button variant="ghost" size="sm" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil size={13} /></Button>
                    <Button variant="ghost" size="sm" className="text-danger-600" aria-label={`Delete ${r.name}`} onClick={() => setRemoving(r)}><Trash2 size={13} /></Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editing && cat.data && (
        <RuleEditor rule={editing === 'new' ? null : editing} catalogue={cat.data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
      {view && <ViewModal rule={view.rule} kind={view.kind} onClose={() => setView(null)} />}
      <ConfirmationDialog
        isOpen={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Delete this rule?"
        description={removing ? `“${removing.name}” and its history will be deleted. Nothing it already did is undone.` : undefined}
        confirmLabel="Delete rule"
        variant="danger"
      />
    </div>
  );
}

function ViewModal({ rule, kind, onClose }: { rule: OpsRuleRow; kind: 'preview' | 'log'; onClose: () => void }) {
  const pv = useAsync<Preview | undefined>(() => (kind === 'preview' ? previewRule(rule.id) : Promise.resolve(undefined)), [rule.id, kind]);
  const log = useAsync<FireRow[] | undefined>(() => (kind === 'log' ? ruleFires(rule.id) : Promise.resolve(undefined)), [rule.id, kind]);
  return (
    <Modal isOpen onClose={onClose} size="lg" title={`${kind === 'preview' ? 'Preview' : 'What it has done'}: ${rule.name}`}>
      {kind === 'preview' ? (
        pv.isLoading || !pv.data ? <CardSkeleton /> : (
          <div className="flex flex-col gap-4 text-sm">
            <p className="text-ink-muted">{pv.data.enabled ? 'This rule is on.' : 'This rule is off. This is what it would do the moment you switched it on. Nothing has been sent or changed.'}</p>
            <p>
              <strong>{pv.data.matching}</strong> thing{pv.data.matching === 1 ? '' : 's'} match the trigger right now; <strong>{pv.data.wouldFireNowCount}</strong>{' '}
              action{pv.data.wouldFireNowCount === 1 ? '' : 's'} would happen immediately.
            </p>
            {pv.data.wouldFireNow.length > 0 && (
              <ul className="max-h-48 overflow-auto rounded-lg border border-line">
                {pv.data.wouldFireNow.map((w, i) => (
                  <li key={i} className="border-b border-line px-3 py-1.5 last:border-0">{w.subject} <span className="text-ink-faint">· step {w.step}: {ACTION_LABEL[w.action as keyof typeof ACTION_LABEL] ?? w.action}</span></li>
                ))}
              </ul>
            )}
            {pv.data.upcoming.length > 0 && (
              <>
                <p className="font-medium text-ink">Coming up</p>
                <ul className="max-h-40 overflow-auto rounded-lg border border-line">
                  {pv.data.upcoming.map((w, i) => <li key={i} className="border-b border-line px-3 py-1.5 last:border-0">{formatDateTime(w.at)} — {w.subject} <span className="text-ink-faint">· step {w.step}</span></li>)}
                </ul>
              </>
            )}
          </div>
        )
      ) : log.isLoading || !log.data ? <CardSkeleton /> : log.data.length === 0 ? (
        <EmptyState title="Nothing yet" description="Actions appear here as the rule runs, including the ones that could not be carried out, and why." />
      ) : (
        <ul className="divide-y divide-line text-sm">
          {log.data.map((f) => (
            <li key={f.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{f.subjectLabel}</span>
                <Badge tone={f.status === 'sent' ? 'success' : f.status === 'skipped' ? 'warning' : 'danger'}>{f.status}</Badge>
              </div>
              <p className="text-xs text-ink-muted">Step {f.stepIndex + 1}{f.occurrence ? ` · round ${f.occurrence + 1}` : ''} · {formatDateTime(f.firedAt)} · {f.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
