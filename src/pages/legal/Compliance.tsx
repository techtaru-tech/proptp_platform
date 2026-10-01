import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { formatDate } from '../../utils/format';
import { getMaterialLookups } from '../../services/vendorService';
import {
  createApproval, createLand, deleteApproval, getCompliance, label, listApprovals, listLand, updateLand, type ComplianceStatus,
} from '../../services/legalService';

const BANDS: { key: string; title: string; tone: BadgeTone; statuses: ComplianceStatus[] }[] = [
  { key: 'lapsed', title: 'Lapsed', tone: 'danger', statuses: ['lapsed'] },
  { key: 'expires_30', title: 'Within 30 days', tone: 'danger', statuses: ['expires_30'] },
  { key: 'expires_60', title: 'Within 60 days', tone: 'warning', statuses: ['expires_60'] },
  { key: 'expires_90', title: 'Within 90 days', tone: 'info', statuses: ['expires_90'] },
  { key: 'valid', title: 'Valid', tone: 'success', statuses: ['valid', 'no_expiry'] },
];

export function Compliance() {
  const { toast } = useToast();
  const [tab, setTab] = useState<'board' | 'approvals' | 'land'>('board');
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState<'approval' | 'land' | null>(null);
  const board = useAsync(() => getCompliance(), [reload]);
  const approvals = useAsync(() => listApprovals(), [reload]);
  const land = useAsync(() => listLand(), [reload]);
  const done = () => { setAdding(null); setReload((k) => k + 1); };

  return (
    <div>
      <PageHeader title="Compliance & land" description="Approvals and clearances, what is valid, what is about to lapse, and the land and title records behind each project." breadcrumb={[{ label: 'Legal & Registry' }, { label: 'Compliance' }]}
        actions={<div className="flex gap-2"><Button variant="outline" leftIcon={<Plus size={14} />} onClick={() => setAdding('land')}>Land record</Button><Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setAdding('approval')}>Approval</Button></div>} />
      <div className="mb-4 flex gap-2" role="tablist">
        {([['board', 'Compliance board'], ['approvals', 'Approvals'], ['land', 'Land & title']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg border px-3 py-1.5 text-sm focus-ring ${tab === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>{l}</button>))}
      </div>

      {tab === 'board' && (board.error ? <ErrorState title="Could not load" description={board.error.message} /> : !board.data ? <CardSkeleton /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {BANDS.map((b) => {
            const items = (board.data?.items ?? []).filter((i) => b.statuses.includes(i.status));
            return (
              <Card key={b.key} padded={false}>
                <div className="flex items-center justify-between border-b border-line px-5 py-3"><h3 className="font-semibold text-ink">{b.title}</h3><Badge tone={b.tone}>{items.length}</Badge></div>
                {items.length === 0 ? <p className="px-5 py-4 text-sm text-ink-faint">Nothing here.</p> : (
                  <ul className="divide-y divide-line">{items.map((i) => (
                    <li key={`${i.source}${i.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <span><span className="font-medium text-ink">{i.label}</span><span className="block text-xs text-ink-muted">{i.subject}{i.reference ? ` · ${i.reference}` : ''}{i.source === 'vendor_document' ? ' · vendor document' : ''}</span></span>
                      <span className="text-right text-xs text-ink-muted">{i.validUntil ? formatDate(i.validUntil) : 'No expiry'}{i.daysLeft !== null && <span className={`block font-medium ${i.daysLeft < 0 ? 'text-danger-700' : ''}`}>{i.daysLeft < 0 ? `${-i.daysLeft}d ago` : `${i.daysLeft}d left`}</span>}</span>
                    </li>))}</ul>)}
              </Card>);
          })}
        </div>))}

      {tab === 'approvals' && (!approvals.data ? <CardSkeleton /> : approvals.data.length === 0 ? <Card><EmptyState title="No approvals recorded" /></Card> : (
        <Card padded={false}><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint"><th className="px-5 py-2.5 font-medium">Approval</th><th className="px-3 font-medium">Project</th><th className="px-3 font-medium">Reference</th><th className="px-3 font-medium">Issued</th><th className="px-3 font-medium">Valid until</th><th className="px-3 font-medium">Status</th><th className="px-5" /></tr></thead>
          <tbody>{approvals.data.map((a) => (
            <tr key={a.id} className="border-t border-line">
              <td className="px-5 py-2.5 font-medium">{a.documentUrl ? <a className="text-brand-700" href={fileUrl(a.documentUrl)} target="_blank" rel="noreferrer">{a.kind}</a> : a.kind}</td>
              <td className="px-3 text-ink-muted">{a.projectName}</td><td className="px-3">{a.referenceNo}</td><td className="px-3">{formatDate(a.issuedOn)}</td><td className="px-3">{a.validUntil ? formatDate(a.validUntil) : '—'}</td>
              <td className="px-3"><Badge tone={a.status === 'lapsed' ? 'danger' : a.status.startsWith('expires') ? 'warning' : 'success'}>{label(a.status)}</Badge></td>
              <td className="px-5 text-right"><button aria-label={`Delete ${a.kind}`} className="rounded text-danger-600 focus-ring" onClick={async () => { try { await deleteApproval(a.id); setReload((k) => k + 1); } catch (e) { toast({ title: 'Could not delete', description: (e as Error).message, variant: 'error' }); } }}><Trash2 size={13} /></button></td>
            </tr>))}</tbody></table></div></Card>))}

      {tab === 'land' && (!land.data ? <CardSkeleton /> : land.data.length === 0 ? <Card><EmptyState title="No land records" /></Card> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{land.data.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-ink">{r.khasra}</p><p className="text-xs text-ink-muted">{r.projectName}{r.area ? ` · ${r.area}` : ''}</p></div>
              <Select aria-label={`Mutation status, ${r.khasra}`} name={`mut-${r.id}`} value={r.mutation} wrapperClassName="w-36" onChange={async (e) => { await updateLand(r.id, { mutation: e.target.value }); setReload((k) => k + 1); }}
                options={[{ value: 'pending', label: 'Mutation pending' }, { value: 'applied', label: 'Mutation applied' }, { value: 'completed', label: 'Mutation completed' }]} /></div>
            <dl className="mt-3 space-y-1 text-sm"><div className="flex justify-between"><dt className="text-ink-muted">Conversion order</dt><dd className="font-medium">{r.conversionOrder || '—'}</dd></div>
              {r.titleDocUrl && <a className="font-medium text-brand-700" href={fileUrl(r.titleDocUrl)} target="_blank" rel="noreferrer">Title document</a>}{r.notes && <p className="text-xs text-ink-muted">{r.notes}</p>}</dl>
          </Card>))}</div>))}

      {adding === 'approval' && <ApprovalModal onClose={() => setAdding(null)} onSaved={done} />}
      {adding === 'land' && <LandModal onClose={() => setAdding(null)} onSaved={done} />}
    </div>
  );
}

function useForm(onSaved: () => void, ok: string) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  return { saving, go: async (fn: () => Promise<unknown>) => { setSaving(true); try { await fn(); toast({ title: ok, variant: 'success' }); onSaved(); } catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); } finally { setSaving(false); } } };
}

function ApprovalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: lookups } = useAsync(() => getMaterialLookups(), []);
  const [f, setF] = useState({ projectId: '', kind: '', referenceNo: '', issuedOn: '', validUntil: '' });
  const [doc, setDoc] = useState<File | null>(null);
  const { saving, go } = useForm(onSaved, 'Approval recorded');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal isOpen onClose={onClose} title="Record an approval" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" isLoading={saving} disabled={!f.projectId || !f.kind.trim() || !f.referenceNo.trim() || !f.issuedOn} onClick={() => go(async () => createApproval({ ...f, validUntil: f.validUntil || null, documentUrl: doc ? (await uploadFiles([doc]))[0] : null }))}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Select label="Project" name="apProject" required value={f.projectId} onChange={set('projectId')} options={[{ value: '', label: 'Choose a project' }, ...(lookups?.projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))]} />
        <Input label="Type" name="apKind" required value={f.kind} onChange={set('kind')} placeholder="RERA, ADA, municipal, NOC, fire clearance…" />
        <Input label="Reference number" name="apRef" required value={f.referenceNo} onChange={set('referenceNo')} />
        <div className="grid grid-cols-2 gap-3"><DatePicker label="Issued on" name="apIssued" required value={f.issuedOn} onChange={set('issuedOn')} /><DatePicker label="Valid until" name="apValid" value={f.validUntil} onChange={set('validUntil')} /></div>
        <div><label htmlFor="apDoc" className="text-sm font-medium text-ink">Document copy</label><input id="apDoc" name="apDoc" type="file" accept="image/*,application/pdf" className="mt-1.5 block w-full text-sm" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} /></div>
      </div>
    </Modal>
  );
}

function LandModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: lookups } = useAsync(() => getMaterialLookups(), []);
  const [f, setF] = useState({ projectId: '', khasra: '', area: '', conversionOrder: '', mutation: 'pending', notes: '' });
  const [doc, setDoc] = useState<File | null>(null);
  const { saving, go } = useForm(onSaved, 'Land record added');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal isOpen onClose={onClose} title="Land & title record" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" isLoading={saving} disabled={!f.projectId || !f.khasra.trim()} onClick={() => go(async () => createLand({ ...f, titleDocUrl: doc ? (await uploadFiles([doc]))[0] : null }))}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Select label="Project" name="lrProject" required value={f.projectId} onChange={set('projectId')} options={[{ value: '', label: 'Choose a project' }, ...(lookups?.projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))]} />
        <Input label="Khasra details" name="lrKhasra" required value={f.khasra} onChange={set('khasra')} />
        <div className="grid grid-cols-2 gap-3"><Input label="Area" name="lrArea" value={f.area} onChange={set('area')} /><Input label="Conversion order" name="lrConv" value={f.conversionOrder} onChange={set('conversionOrder')} /></div>
        <Select label="Mutation" name="lrMut" value={f.mutation} onChange={set('mutation')} options={[{ value: 'pending', label: 'Pending' }, { value: 'applied', label: 'Applied' }, { value: 'completed', label: 'Completed' }]} />
        <div><label htmlFor="lrDoc" className="text-sm font-medium text-ink">Title document</label><input id="lrDoc" name="lrDoc" type="file" accept="image/*,application/pdf" className="mt-1.5 block w-full text-sm" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} /></div>
      </div>
    </Modal>
  );
}
