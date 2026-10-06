import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, FileText, Plus, Trash2, Wand2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { formatCurrency, formatDate } from '../../utils/format';
import {
  REGISTRY_STEPS, STAGES, addLegalDoc, deleteLegalDoc, generateDoc, getLegalFile, label, raiseDemand, recordPayment, recordStage, setPlan, updateRegistry,
  type MilestoneRow,
} from '../../services/legalService';

const today = () => new Date().toISOString().slice(0, 10);
const TONE = { upcoming: 'neutral', due: 'warning', partial: 'info', paid: 'success', overdue: 'danger' } as const;
const DOC_KINDS = ['kyc', 'booking_form', 'allotment_letter', 'agreement', 'receipt', 'demand_note', 'correspondence', 'other'];

type Dialog = null | { t: 'stage' } | { t: 'plan' } | { t: 'pay'; m: MilestoneRow } | { t: 'registry' } | { t: 'upload' };

export function LegalFileDetail() {
  const { id = '' } = useParams();
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const { data: f, isLoading, error } = useAsync(() => getLegalFile(id), [id, reload]);
  if (error) return <ErrorState title="Could not load this file" description={error.message} />;
  if (isLoading || !f) return <CardSkeleton />;
  const refresh = () => { setDialog(null); setReload((k) => k + 1); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: 'success' }); setReload((k) => k + 1); }
    catch (err) { toast({ title: 'That did not work', description: (err as Error).message, variant: 'error' }); }
  };

  return (
    <div>
      <PageHeader title={f.buyerName} description={`${f.projectName} · plot ${f.unit} · ${f.reference} · ${formatCurrency(f.agreedValue)}`}
        breadcrumb={[{ label: 'Legal files', to: '/legal' }, { label: f.buyerName }]}
        {...(f.closedAt ? { description: `${f.projectName} · plot ${f.unit} · ${f.reference} · file closed ${formatDate(f.closedAt)}` } : {})}
        actions={<Link to={`/bookings/${f.bookingId}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium focus-ring">View booking</Link>} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Agreement */}
        <Card>
          <CardHeader title="Agreement" subtitle="Each step is dated and has someone answerable for it."
            action={f.nextStage && <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setDialog({ t: 'stage' })}>Record “{label(f.nextStage)}”</Button>} />
          <ol className="space-y-2.5">
            {STAGES.map((s) => {
              const step = f.stages.find((x) => x.stage === s);
              return (
                <li key={s} className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${step ? 'bg-success-500 text-white' : 'border border-line-strong text-ink-faint'}`}>{step ? <Check size={11} /> : ''}</span>
                  <div className="text-sm"><p className={step ? 'font-medium text-ink' : 'text-ink-faint'}>{label(s)}</p>
                    {step && <p className="text-xs text-ink-muted">{formatDate(step.at)} · {step.responsible}{step.note ? ` — ${step.note}` : ''}</p>}</div>
                </li>);
            })}
          </ol>
        </Card>

        {/* Registry */}
        <Card>
          <CardHeader title="Registry" action={<Button variant="outline" size="sm" onClick={() => setDialog({ t: 'registry' })}>Update</Button>} />
          <div className="mb-3 flex flex-wrap gap-1.5">
            {REGISTRY_STEPS.map((s) => <Badge key={s} tone={REGISTRY_STEPS.indexOf(s) <= REGISTRY_STEPS.indexOf(f.registryStatus) ? 'success' : 'neutral'}>{label(s)}</Badge>)}
          </div>
          <dl className="space-y-1.5 text-sm">
            {[['Appointment', f.registry?.appointmentOn ? formatDate(f.registry.appointmentOn) : null], ['Registry date', f.registry?.registryDate ? formatDate(f.registry.registryDate) : null],
              ['Sub-registrar office', f.registry?.subRegistrar], ['Deed number', f.registry?.deedNumber]].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-3"><dt className="text-ink-muted">{k}</dt><dd className="font-medium text-ink">{v || '—'}</dd></div>))}
            {f.registry?.deedUrl && <a className="text-sm font-medium text-brand-700" href={fileUrl(f.registry.deedUrl)} target="_blank" rel="noreferrer">Scanned deed</a>}
          </dl>
        </Card>

        {/* Payment plan */}
        <Card className="lg:col-span-2" padded={false}>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <CardHeader title="Payment plan" subtitle="Milestones against the agreed value; demand notes go out as each falls due." />
            {f.milestones.every((m) => m.payments.length === 0) && <Button variant="outline" size="sm" onClick={() => setDialog({ t: 'plan' })}>{f.milestones.length ? 'Edit plan' : 'Set plan'}</Button>}
          </div>
          {f.milestones.length === 0 ? <p className="px-5 py-5 text-sm text-ink-muted">No payment plan yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint"><th className="px-5 py-2 font-medium">Milestone</th><th className="px-3 font-medium">Due</th><th className="px-3 text-right font-medium">Amount</th><th className="px-3 text-right font-medium">Paid</th><th className="px-3 font-medium">Status</th><th className="px-5" /></tr></thead>
              <tbody>{f.milestones.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-5 py-2.5 font-medium">{m.name}{m.demandedAt && <span className="block text-xs font-normal text-ink-muted">Demand sent {formatDate(m.demandedAt)}</span>}</td>
                  <td className="px-3">{formatDate(m.dueOn)}</td><td className="px-3 text-right tabular-nums">{formatCurrency(m.amount)}</td><td className="px-3 text-right tabular-nums">{formatCurrency(m.paid)}</td>
                  <td className="px-3"><Badge tone={TONE[m.status]}>{m.status === 'overdue' ? `Overdue ${m.daysOverdue}d` : label(m.status)}</Badge></td>
                  <td className="px-5 text-right">{m.outstanding > 0 && <span className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ t: 'pay', m })}>Record payment</Button>
                    <Button variant="ghost" size="sm" onClick={() => run(() => raiseDemand(m.id), 'Demand note created')}>Demand note</Button></span>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>

        {/* Documents */}
        <Card className="lg:col-span-2">
          <CardHeader title="Documents" subtitle="Generated documents are filled from the booking, never retyped."
            action={<div className="flex flex-wrap gap-2">
              {(['cost_sheet', 'allotment_letter', 'agreement', 'receipt'] as const).map((k) => (
                <Button key={k} variant="outline" size="sm" leftIcon={<Wand2 size={13} />} onClick={() => run(() => generateDoc(f.id, { kind: k }), `${label(k)} generated`)}>{label(k)}</Button>))}
              <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setDialog({ t: 'upload' })}>Upload</Button></div>} />
          {f.documents.length === 0 ? <p className="text-sm text-ink-muted">No documents yet.</p> : (
            <ul className="divide-y divide-line">{f.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <a href={fileUrl(d.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-medium text-brand-700"><FileText size={14} />{d.title}</a>
                <span className="flex items-center gap-2"><Badge tone="neutral">{label(d.kind)}</Badge>{d.generated && <Badge tone="info">Generated</Badge>}<span className="text-xs text-ink-faint">{formatDate(d.createdAt)}</span>
                  <button aria-label={`Delete ${d.title}`} className="rounded text-danger-600 focus-ring" onClick={() => run(() => deleteLegalDoc(d.id), 'Document removed')}><Trash2 size={13} /></button></span>
              </li>))}</ul>)}
        </Card>
      </div>

      {dialog?.t === 'stage' && f.nextStage && <StageDialog file={f} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.t === 'plan' && <PlanDialog file={f} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.t === 'pay' && <PayDialog m={dialog.m} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.t === 'registry' && <RegistryDialog file={f} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.t === 'upload' && <UploadDialog fileId={f.id} onClose={() => setDialog(null)} onSaved={refresh} />}
    </div>
  );
}

type FileT = NonNullable<ReturnType<typeof useAsync<Awaited<ReturnType<typeof getLegalFile>>>>['data']>;

function useSave(onSaved: () => void, ok: string) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  return { saving, go: async (fn: () => Promise<unknown>) => {
    setSaving(true);
    try { await fn(); toast({ title: ok, variant: 'success' }); onSaved(); }
    catch (err) { toast({ title: 'Could not save', description: (err as Error).message, variant: 'error' }); }
    finally { setSaving(false); } } };
}

function Footer({ onClose, onSave, saving, disabled, label: l = 'Save' }: { onClose: () => void; onSave: () => void; saving: boolean; disabled?: boolean; label?: string }) {
  return <><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={onSave} isLoading={saving} disabled={disabled}>{l}</Button></>;
}

function StageDialog({ file, onClose, onSaved }: { file: FileT; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ at: today(), responsible: '', note: '' });
  const { saving, go } = useSave(onSaved, 'Step recorded');
  return (
    <Modal isOpen onClose={onClose} title={`Agreement: ${label(file.nextStage!)}`} footer={<Footer onClose={onClose} saving={saving} disabled={!f.responsible.trim()} onSave={() => go(() => recordStage(file.id, { stage: file.nextStage!, ...f }))} />}>
      <div className="flex flex-col gap-4">
        <DatePicker label="Date" name="stageAt" value={f.at} onChange={(e) => setF((x) => ({ ...x, at: e.target.value }))} />
        <Input label="Responsible person" name="stageResponsible" required value={f.responsible} onChange={(e) => setF((x) => ({ ...x, responsible: e.target.value }))} />
        <Input label="Note" name="stageNote" value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} />
      </div>
    </Modal>
  );
}

function PlanDialog({ file, onClose, onSaved }: { file: FileT; onClose: () => void; onSaved: () => void }) {
  const standard = () => {
    const parts: [string, number, number][] = [['Booking amount', 20, 0], ['On agreement', 30, 30], ['On plinth completion', 30, 150], ['On possession', 20, 330]];
    let left = file.agreedValue;
    return parts.map(([name, pct, offset], i) => {
      const amount = i === parts.length - 1 ? left : Math.round((file.agreedValue * pct) / 100);
      left -= amount;
      return { name, amount: String(amount), dueOn: new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10) };
    });
  };
  const [rows, setRows] = useState(file.milestones.length ? file.milestones.map((m) => ({ name: m.name, amount: String(m.amount), dueOn: m.dueOn.slice(0, 10) })) : standard());
  const { saving, go } = useSave(onSaved, 'Payment plan saved');
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const set = (i: number, k: 'name' | 'amount' | 'dueOn', v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const ok = total === file.agreedValue && rows.every((r) => r.name.trim() && r.dueOn && Number(r.amount) > 0);
  return (
    <Modal isOpen onClose={onClose} size="lg" title="Payment plan" footer={<Footer onClose={onClose} saving={saving} disabled={!ok} onSave={() => go(() => setPlan(file.id, rows.map((r) => ({ name: r.name, dueOn: r.dueOn, amount: Number(r.amount) }))))} />}>
      <p className="mb-3 text-xs text-ink-muted">A standard 20 / 30 / 30 / 20 split is filled in — change names, dates and amounts as agreed with the buyer.</p>
      <div className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-end gap-2">
            <Input label={i === 0 ? 'Milestone' : undefined} aria-label={`Milestone ${i + 1}`} name={`m-name-${i}`} value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
            <DatePicker aria-label={`Due date ${i + 1}`} name={`m-due-${i}`} value={r.dueOn} onChange={(e) => set(i, 'dueOn', e.target.value)} />
            <Input aria-label={`Amount ${i + 1}`} name={`m-amt-${i}`} type="number" min={1} value={r.amount} onChange={(e) => set(i, 'amount', e.target.value)} />
            <button type="button" aria-label={`Remove milestone ${i + 1}`} className="mb-2 text-danger-600 focus-ring rounded" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
          </div>))}
        <Button variant="ghost" size="sm" leftIcon={<Plus size={13} />} onClick={() => setRows((rs) => [...rs, { name: '', amount: '', dueOn: today() }])}>Add milestone</Button>
        <p className={`text-sm ${total === file.agreedValue ? 'text-success-700' : 'text-danger-700'}`}>Total {formatCurrency(total)} of {formatCurrency(file.agreedValue)} agreed{total !== file.agreedValue ? ` (${total > file.agreedValue ? 'over' : 'short'} by ${formatCurrency(Math.abs(total - file.agreedValue))})` : ''}</p>
      </div>
    </Modal>
  );
}

function PayDialog({ m, onClose, onSaved }: { m: MilestoneRow; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amount: String(m.outstanding), paidOn: today(), reference: '' });
  const { saving, go } = useSave(onSaved, 'Payment recorded');
  return (
    <Modal isOpen onClose={onClose} title={`Payment: ${m.name}`} footer={<Footer onClose={onClose} saving={saving} disabled={!(Number(f.amount) > 0)} onSave={() => go(() => recordPayment(m.id, { amount: Number(f.amount), paidOn: f.paidOn, reference: f.reference || undefined }))} />}>
      <div className="flex flex-col gap-4">
        <Input label="Amount (₹)" name="payAmount" type="number" min={1} max={m.outstanding} value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} hint={`${formatCurrency(m.outstanding)} outstanding`} />
        <DatePicker label="Paid on" name="payDate" value={f.paidOn} onChange={(e) => setF((x) => ({ ...x, paidOn: e.target.value }))} />
        <Input label="Reference" name="payRef" value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} placeholder="UTR / cheque no." />
      </div>
    </Modal>
  );
}

function RegistryDialog({ file, onClose, onSaved }: { file: FileT; onClose: () => void; onSaved: () => void }) {
  const r = file.registry;
  const [f, setF] = useState({ status: file.registryStatus as string, appointmentOn: r?.appointmentOn?.slice(0, 10) ?? '', registryDate: r?.registryDate?.slice(0, 10) ?? '', subRegistrar: r?.subRegistrar ?? '', deedNumber: r?.deedNumber ?? '', deedUrl: r?.deedUrl ?? '' });
  const [deed, setDeed] = useState<File | null>(null);
  const { saving, go } = useSave(onSaved, 'Registry updated');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const startAt = REGISTRY_STEPS.indexOf(file.registryStatus);
  return (
    <Modal isOpen onClose={onClose} title="Registry status" size="lg" footer={<Footer onClose={onClose} saving={saving} onSave={() => go(async () => {
      const deedUrl = deed ? (await uploadFiles([deed]))[0] : f.deedUrl;
      return updateRegistry(file.id, { ...f, deedUrl: deedUrl || null });
    })} />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Status" name="regStatus" value={f.status} onChange={set('status')} options={REGISTRY_STEPS.map((s, i) => ({ value: s, label: label(s) + (i < startAt ? ' (earlier)' : '') }))} hint="Progress only moves forward." />
        <DatePicker label="Appointment date" name="regAppt" value={f.appointmentOn} onChange={set('appointmentOn')} />
        <DatePicker label="Registry date" name="regDate" value={f.registryDate} onChange={set('registryDate')} />
        <Input label="Sub-registrar office" name="regOffice" value={f.subRegistrar} onChange={set('subRegistrar')} />
        <Input label="Deed number" name="regDeed" value={f.deedNumber} onChange={set('deedNumber')} />
        <div><label htmlFor="deedFile" className="text-sm font-medium text-ink">Scanned deed</label><input id="deedFile" name="deedFile" type="file" accept="image/*,application/pdf" className="mt-1.5 block w-full text-sm" onChange={(e) => setDeed(e.target.files?.[0] ?? null)} /></div>
      </div>
      <p className="mt-3 text-xs text-ink-faint">“Registered” needs the registry date, the sub-registrar office and the deed number.</p>
    </Modal>
  );
}

function UploadDialog({ fileId, onClose, onSaved }: { fileId: string; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState('correspondence');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const { saving, go } = useSave(onSaved, 'Document added');
  return (
    <Modal isOpen onClose={onClose} title="Upload a document" footer={<Footer onClose={onClose} saving={saving} disabled={!title.trim() || !file} onSave={() => go(async () => addLegalDoc(fileId, { kind, title, url: (await uploadFiles([file!]))[0] }))} />}>
      <div className="flex flex-col gap-4">
        <Select label="Kind" name="docKind" value={kind} onChange={(e) => setKind(e.target.value)} options={DOC_KINDS.map((k) => ({ value: k, label: label(k) }))} />
        <Input label="Title" name="legalDocTitle" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <div><label htmlFor="legalDocFile" className="text-sm font-medium text-ink">File</label><input id="legalDocFile" name="legalDocFile" type="file" accept="image/*,application/pdf" className="mt-1.5 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
      </div>
    </Modal>
  );
}
