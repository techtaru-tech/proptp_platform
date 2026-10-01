import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Textarea } from '../../components/ui/Textarea';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { formatDate } from '../../utils/format';
import { getMaterialLookups } from '../../services/vendorService';
import { createCase, listCases, updateCase } from '../../services/legalService';

export function Disputes() {
  const { toast } = useToast();
  const [status, setStatus] = useState('open');
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const { data } = useAsync(() => listCases(status), [status, reload]);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); setReload((k) => k + 1); } catch (e) { toast({ title: 'Could not update', description: (e as Error).message, variant: 'error' }); } };

  return (
    <div>
      <PageHeader title="Disputes & legal notices" description="Each with the other party, its current stage, the next hearing and the papers." breadcrumb={[{ label: 'Legal & Registry' }, { label: 'Disputes' }]}
        actions={<Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setAdding(true)}>Log a dispute or notice</Button>} />
      <div className="mb-4 flex gap-2" role="tablist">
        {['open', 'closed'].map((s) => <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={`rounded-lg border px-3 py-1.5 text-sm capitalize focus-ring ${status === s ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>{s}</button>)}
      </div>
      {!data ? <CardSkeleton /> : data.length === 0 ? <Card><EmptyState title={`No ${status} matters`} /></Card> : (
        <div className="flex flex-col gap-3">{data.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-semibold text-ink">{c.title}</p><p className="text-xs text-ink-muted">vs {c.counterparty}{c.projectName ? ` · ${c.projectName}` : ''}{c.buyerName ? ` · buyer ${c.buyerName}` : ''}</p>{c.notes && <p className="mt-1 text-sm text-ink">{c.notes}</p>}</div>
              <div className="text-right"><Badge tone="info">{c.stage}</Badge>
                {c.nextHearing && <p className={`mt-1 text-xs ${c.hearingPassed ? 'font-medium text-danger-700' : 'text-ink-muted'}`}>{c.hearingPassed ? 'Hearing date passed · ' : 'Next hearing '}{formatDate(c.nextHearing)}</p>}</div>
            </div>
            {c.documents.length > 0 && <div className="mt-2 flex flex-wrap gap-3 text-sm">{c.documents.map((d, i) => <a key={d} href={fileUrl(d)} target="_blank" rel="noreferrer" className="font-medium text-brand-700">Document {i + 1}</a>)}</div>}
            {!c.closed && <div className="mt-3 flex flex-wrap items-end justify-end gap-2 border-t border-line pt-3">
              <Input aria-label={`Stage, ${c.title}`} name={`stage-${c.id}`} defaultValue={c.stage} wrapperClassName="w-52" onBlur={(e) => e.target.value.trim() && e.target.value !== c.stage && act(() => updateCase(c.id, { stage: e.target.value }))} />
              <DatePicker aria-label={`Next hearing, ${c.title}`} name={`hearing-${c.id}`} defaultValue={c.nextHearing?.slice(0, 10)} wrapperClassName="w-44" onBlur={(e) => e.target.value && act(() => updateCase(c.id, { nextHearing: e.target.value }))} />
              <Button variant="outline" size="sm" onClick={() => act(() => updateCase(c.id, { closed: true }))}>Close matter</Button></div>}
            {c.closed && <div className="mt-3 flex justify-end"><Button variant="ghost" size="sm" onClick={() => act(() => updateCase(c.id, { closed: false }))}>Reopen</Button></div>}
          </Card>))}</div>)}
      {adding && <CaseModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setReload((k) => k + 1); }} />}
    </div>
  );
}

function CaseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { data: lookups } = useAsync(() => getMaterialLookups(), []);
  const [f, setF] = useState({ title: '', counterparty: '', stage: '', nextHearing: '', projectId: '', notes: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try { await createCase({ ...f, nextHearing: f.nextHearing || null, projectId: f.projectId || null, documents: await uploadFiles(files) }); toast({ title: 'Logged', variant: 'success' }); onSaved(); }
    catch (e) { toast({ title: 'Could not log it', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Log a dispute or notice" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" isLoading={saving} disabled={!f.title.trim() || !f.counterparty.trim() || !f.stage.trim()} onClick={save}>Log it</Button></>}>
      <div className="flex flex-col gap-4">
        <Input label="What is it" name="caseTitle" required value={f.title} onChange={set('title')} />
        <Input label="Other party" name="caseParty" required value={f.counterparty} onChange={set('counterparty')} />
        <Input label="Current stage" name="caseStage" required value={f.stage} onChange={set('stage')} placeholder="e.g. Notice received, reply drafted" />
        <div className="grid grid-cols-2 gap-3"><DatePicker label="Next hearing" name="caseHearing" value={f.nextHearing} onChange={set('nextHearing')} />
          <Select label="Project" name="caseProject" value={f.projectId} onChange={set('projectId')} options={[{ value: '', label: 'None' }, ...(lookups?.projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))]} /></div>
        <Textarea label="Notes" id="caseNotes" value={f.notes} onChange={(v) => setF((x) => ({ ...x, notes: v }))} />
        <div><label htmlFor="caseDocs" className="text-sm font-medium text-ink">Documents</label><input id="caseDocs" name="caseDocs" type="file" multiple accept="image/*,application/pdf" className="mt-1.5 block w-full text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></div>
      </div>
    </Modal>
  );
}
