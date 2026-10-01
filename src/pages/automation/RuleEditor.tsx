import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { useToast } from '../../context/ToastContext';
import { ACTION_LABEL, saveRule, type ActionKind, type Catalogue, type OpsRuleRow, type RuleStep, type TriggerInfo } from '../../services/opsRuleService';

const blank = (kind: ActionKind): RuleStep => ({
  delayHours: 0,
  action:
    kind === 'notify' ? { kind, recipients: [], channel: 'in_app', title: '', message: '' }
    : kind === 'create_task' ? { kind, recipients: [], title: '', message: '', dueInHours: 24 }
    : kind === 'create_payment_schedule' ? { kind, schedule: [{ name: 'Booking amount', percent: 20, offsetDays: 0 }, { name: 'Balance', percent: 80, offsetDays: 60 }] }
    : { kind },
});

/** Everything a rule can do is chosen here — trigger, timing, recipients, channel and wording. */
export function RuleEditor({ rule, catalogue, onClose, onSaved }: { rule: OpsRuleRow | null; catalogue: Catalogue; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(rule?.name ?? '');
  const [trigger, setTrigger] = useState(rule?.trigger ?? catalogue.triggers[0].key);
  const [config, setConfig] = useState<Record<string, number>>(rule?.config ?? {});
  const [steps, setSteps] = useState<RuleStep[]>(rule?.steps ?? [blank('notify')]);
  const [saving, setSaving] = useState(false);
  const def = catalogue.triggers.find((t) => t.key === trigger)!;

  const pickTrigger = (key: string) => {
    const next = catalogue.triggers.find((t) => t.key === key)!;
    setTrigger(key);
    setConfig({});
    // Steps that do something this trigger cannot are dropped rather than left to fail on save.
    setSteps((s) => { const kept = s.filter((x) => next.actions.includes(x.action.kind)); return kept.length ? kept : [blank(next.actions[0])]; });
  };
  const patch = (i: number, p: Partial<RuleStep>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const patchAction = (i: number, p: Partial<RuleStep['action']>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, action: { ...x.action, ...p } } : x)));

  const save = async () => {
    setSaving(true);
    try {
      const full: Record<string, number> = {};
      def.params.forEach((p) => { full[p.key] = config[p.key] ?? p.default; });
      await saveRule(rule?.id ?? null, { name, trigger, config: full, steps });
      toast({ title: rule ? 'Rule updated' : 'Rule created', description: rule ? undefined : 'It starts switched off — preview it, then turn it on.', variant: 'success' });
      onSaved();
    } catch (e) {
      toast({ title: 'Could not save the rule', description: (e as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="xl" title={rule ? 'Edit rule' : 'New rule'}
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!name.trim()}>Save rule</Button></>}>
      <div className="flex flex-col gap-5">
        <Input label="Rule name" name="ruleName" required value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <Select label="When this happens" name="ruleTrigger" value={trigger} onChange={(e) => pickTrigger(e.target.value)} options={catalogue.triggers.map((t) => ({ value: t.key, label: t.label }))} />
          <p className="mt-1.5 text-xs text-ink-muted">{def.description}</p>
          <p className="mt-1 text-xs text-ink-faint">{def.event ? 'This happens once, so the rule acts only on events after it is switched on.' : 'This is an ongoing condition, so a rule applies to everything that is true when it is switched on.'}</p>
        </div>
        {def.params.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {def.params.map((p) => (
              <Input key={p.key} label={p.label} name={`param-${p.key}`} type="number" min={0} value={config[p.key] ?? p.default} onChange={(e) => setConfig((c) => ({ ...c, [p.key]: Number(e.target.value) }))} hint={p.unit} />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">Then the system does this</h3>
          {steps.map((s, i) => (
            <div key={i} className="rounded-xl border border-line p-4">
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <span className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Step {i + 1}</span>
                <Input label="After (hours)" name={`delay-${i}`} type="number" min={0} wrapperClassName="w-32" value={s.delayHours} onChange={(e) => patch(i, { delayHours: Number(e.target.value) })} />
                <Input label="Repeat every (hours)" name={`repeat-${i}`} type="number" min={1} wrapperClassName="w-40" value={s.repeatEveryHours ?? ''} placeholder="Once" onChange={(e) => patch(i, { repeatEveryHours: e.target.value ? Number(e.target.value) : null })} />
                <Select label="Action" name={`kind-${i}`} wrapperClassName="min-w-[16rem] flex-1" value={s.action.kind}
                  onChange={(e) => patch(i, blank(e.target.value as ActionKind))} options={def.actions.map((a) => ({ value: a, label: ACTION_LABEL[a] }))} />
                {steps.length > 1 && <button type="button" aria-label={`Remove step ${i + 1}`} className="mb-2 rounded text-danger-600 focus-ring" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}
              </div>
              <ActionFields index={i} step={s} def={def} catalogue={catalogue} onChange={(p) => patchAction(i, p)} />
            </div>
          ))}
          {steps.length < 8 && <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setSteps((s) => [...s, blank(def.actions[0])])}>Add a step</Button>}
        </div>
      </div>
    </Modal>
  );
}

function ActionFields({ index, step, def, catalogue, onChange }: { index: number; step: RuleStep; def: TriggerInfo; catalogue: Catalogue; onChange: (p: Partial<RuleStep['action']>) => void }) {
  const a = step.action;
  if (a.kind === 'generate_demand_note') return <p className="text-sm text-ink-muted">Creates the demand note PDF for the instalment from its template and stamps when it was raised.</p>;
  if (a.kind === 'release_hold') return <p className="text-sm text-ink-muted">Ends the hold, so the plot shows as available again.</p>;
  if (a.kind === 'close_file_mark_sold') return <p className="text-sm text-ink-muted">Closes the buyer’s legal file and marks the plot as sold on the inventory and the map.</p>;

  if (a.kind === 'create_payment_schedule') {
    const sch = a.schedule ?? [];
    const total = sch.reduce((s, m) => s + Number(m.percent || 0), 0);
    const set = (i: number, p: Partial<(typeof sch)[number]>) => onChange({ schedule: sch.map((m, j) => (j === i ? { ...m, ...p } : m)) });
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">Creates the payment plan from the agreed value. Skipped if the file already has one.</p>
        {sch.map((m, i) => (
          <div key={i} className="grid grid-cols-[1.4fr_90px_110px_auto] items-end gap-2">
            <Input aria-label={`Milestone ${i + 1} name`} name={`sch-${index}-${i}-n`} value={m.name} onChange={(e) => set(i, { name: e.target.value })} />
            <Input aria-label={`Milestone ${i + 1} percent`} name={`sch-${index}-${i}-p`} type="number" min={1} value={m.percent} onChange={(e) => set(i, { percent: Number(e.target.value) })} hint="%" />
            <Input aria-label={`Milestone ${i + 1} due after days`} name={`sch-${index}-${i}-d`} type="number" min={0} value={m.offsetDays} onChange={(e) => set(i, { offsetDays: Number(e.target.value) })} hint="days after" />
            <button type="button" aria-label={`Remove milestone ${i + 1}`} className="mb-6 rounded text-danger-600 focus-ring" onClick={() => onChange({ schedule: sch.filter((_, j) => j !== i) })}><X size={14} /></button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" leftIcon={<Plus size={12} />} onClick={() => onChange({ schedule: [...sch, { name: '', percent: 10, offsetDays: 30 }] })}>Add milestone</Button>
          <span className={`text-xs ${Math.round(total * 100) === 10000 ? 'text-success-700' : 'text-danger-700'}`}>Total {total}% {Math.round(total * 100) === 10000 ? '' : '— must be 100%'}</span>
        </div>
      </div>
    );
  }

  const recipients = a.recipients ?? [];
  const add = (token: string) => token && !recipients.includes(token) && onChange({ recipients: [...recipients, token] });
  const nameOf = (t: string) =>
    t === 'owner' ? 'The person responsible' : t === 'owner_manager' ? 'Their manager' : t === 'buyer' ? 'The buyer'
    : t.startsWith('module:') ? `Everyone with ${catalogue.modules.find((m) => m.key === t.slice(7))?.label ?? t.slice(7)} access`
    : catalogue.users.find((u) => `user:${u.id}` === t)?.name ?? t;
  const isNotify = a.kind === 'notify';

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">{isNotify ? 'Who is told' : 'Who gets the task'}</p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {recipients.length === 0 && <span className="text-xs text-danger-700">Choose at least one.</span>}
          {recipients.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-700">{nameOf(r)}
              <button type="button" aria-label={`Remove ${nameOf(r)}`} className="rounded focus-ring" onClick={() => onChange({ recipients: recipients.filter((x) => x !== r) })}><X size={11} /></button></span>
          ))}
        </div>
        <Select aria-label={`Add a recipient to step ${index + 1}`} name={`rcpt-${index}`} value="" onChange={(e) => add(e.target.value)} wrapperClassName="max-w-sm"
          options={[
            { value: '', label: 'Add a recipient…' },
            ...(def.hasOwner ? [{ value: 'owner', label: 'The person responsible' }, { value: 'owner_manager', label: 'Their manager' }] : []),
            ...(isNotify && def.hasBuyer ? [{ value: 'buyer', label: 'The buyer' }] : []),
            ...catalogue.modules.map((m) => ({ value: `module:${m.key}`, label: `Everyone with ${m.label} access` })),
            ...catalogue.users.map((u) => ({ value: `user:${u.id}`, label: u.name })),
          ]} />
      </div>
      {isNotify && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Channel" name={`chan-${index}`} value={a.channel ?? 'in_app'} onChange={(e) => onChange({ channel: e.target.value as 'in_app' | 'email' | 'whatsapp' })}
            options={[{ value: 'in_app', label: 'In the app / panel' }, { value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }]} />
          {a.channel === 'whatsapp' && (
            <>
              <Input label="Approved template name" name={`tpl-${index}`} value={a.templateName ?? ''} onChange={(e) => onChange({ templateName: e.target.value })} />
              <Input label="Template values, in order" name={`tplp-${index}`} value={(a.templateParams ?? []).join(', ')} onChange={(e) => onChange({ templateParams: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} hint="e.g. buyer, amount" />
            </>
          )}
        </div>
      )}
      <Input label="Title" name={`title-${index}`} value={a.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} />
      <Textarea label="Message" id={`msg-${index}`} rows={3} value={a.message ?? ''} onChange={(v) => onChange({ message: v })} />
      <p className="text-xs text-ink-muted">
        Fill in details with:{' '}
        {def.placeholders.map((p) => (
          <button key={p} type="button" className="mr-1 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-brand-50 focus-ring" onClick={() => onChange({ message: `${a.message ?? ''}{{${p}}}` })}>{`{{${p}}}`}</button>
        ))}
      </p>
      {a.kind === 'create_task' && <Input label="Task due in (hours)" name={`due-${index}`} type="number" min={1} wrapperClassName="w-48" value={a.dueInHours ?? ''} onChange={(e) => onChange({ dueInHours: Number(e.target.value) || undefined })} />}
    </div>
  );
}
