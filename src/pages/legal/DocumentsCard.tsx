import { useState } from 'react';
import { Check, FileText, Plus, Trash2, Upload, Wand2, X } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../context/ToastContext';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { formatDate } from '../../utils/format';
import { deleteLegalDoc, generateDoc, label, replaceLegalDoc, reviewLegalDoc, type LegalDoc, type LegalFileDetail } from '../../services/legalService';

const TONE = { verified: 'success', pending: 'warning', rejected: 'danger', missing: 'neutral' } as const;

/** The buyer's documents: what is required and where each stands, review, and a replaced copy keeping the old version. */
export function DocumentsCard({ file, onChanged, onUpload }: { file: LegalFileDetail; onChanged: () => void; onUpload: () => void }) {
  const { toast } = useToast();
  const [rejecting, setRejecting] = useState<LegalDoc | null>(null);
  const [replacing, setReplacing] = useState<LegalDoc | null>(null);
  const [showOld, setShowOld] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: 'success' }); onChanged(); }
    catch (e) { toast({ title: 'That did not work', description: (e as Error).message, variant: 'error' }); }
  };
  const current = file.documents.filter((d) => !d.supersededAt);
  const older = file.documents.filter((d) => d.supersededAt);
  const done = file.checklist.filter((c) => c.state === 'verified').length;

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Documents" subtitle="Generated documents are filled from the booking, never retyped."
        action={<div className="flex flex-wrap gap-2">
          {(['cost_sheet', 'allotment_letter', 'agreement', 'receipt'] as const).map((k) => (
            <Button key={k} variant="outline" size="sm" leftIcon={<Wand2 size={13} />} onClick={() => run(() => generateDoc(file.id, { kind: k }), `${label(k)} generated`)}>{label(k)}</Button>))}
          <Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={onUpload}>Upload</Button></div>} />

      {file.checklist.length > 0 && (
        <div className="mb-4 rounded-lg bg-surface-subtle px-3 py-2.5">
          <p className="mb-1.5 text-xs font-medium text-ink-muted">Required documents · {done} of {file.checklist.length} verified</p>
          <div className="flex flex-wrap gap-1.5">
            {file.checklist.map((c) => <Badge key={c.kind} tone={TONE[c.state]} dot>{label(c.kind)}: {c.state}</Badge>)}
          </div>
        </div>
      )}

      {current.length === 0 ? <p className="text-sm text-ink-muted">No documents yet.</p> : (
        <ul className="divide-y divide-line">{current.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <a href={fileUrl(d.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-medium text-brand-700"><FileText size={14} />{d.title}{d.version > 1 && <span className="text-xs font-normal text-ink-muted">v{d.version}</span>}</a>
              {d.status === 'rejected' && d.reviewNote && <p className="text-xs text-danger-700">Rejected: {d.reviewNote}</p>}
              {d.reviewedByName && d.status !== 'pending' && <p className="text-xs text-ink-faint">{label(d.status)} by {d.reviewedByName}{d.reviewedAt ? ` · ${formatDate(d.reviewedAt)}` : ''}</p>}
            </div>
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{label(d.kind)}</Badge>
              {d.generated ? <Badge tone="info">Generated</Badge> : <Badge tone={TONE[d.status]}>{label(d.status)}</Badge>}
              <span className="text-xs text-ink-faint">{formatDate(d.createdAt)}</span>
              {!d.generated && d.status !== 'verified' && <Button variant="ghost" size="sm" leftIcon={<Check size={13} />} onClick={() => run(() => reviewLegalDoc(d.id, { decision: 'verify' }), 'Document verified')}>Verify</Button>}
              {!d.generated && d.status !== 'rejected' && <Button variant="ghost" size="sm" leftIcon={<X size={13} />} onClick={() => setRejecting(d)}>Reject</Button>}
              {!d.generated && <Button variant="ghost" size="sm" leftIcon={<Upload size={13} />} onClick={() => setReplacing(d)}>New version</Button>}
              <button aria-label={`Delete ${d.title}`} className="rounded text-danger-600 focus-ring" onClick={() => run(() => deleteLegalDoc(d.id), 'Document removed')}><Trash2 size={13} /></button>
            </span>
          </li>))}</ul>)}

      {older.length > 0 && (
        <div className="mt-3">
          <button className="text-xs font-medium text-brand-700 focus-ring rounded" onClick={() => setShowOld((v) => !v)}>{showOld ? 'Hide' : 'Show'} earlier versions ({older.length})</button>
          {showOld && <ul className="mt-2 divide-y divide-line text-sm">{older.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-1.5">
              <a href={fileUrl(d.url)} target="_blank" rel="noreferrer" className="text-ink-muted underline">{d.title} · v{d.version}</a>
              <span className="text-xs text-ink-faint">{label(d.status)}{d.reviewNote ? ` — ${d.reviewNote}` : ''} · replaced {formatDate(d.supersededAt!)}</span>
            </li>))}</ul>}
        </div>
      )}

      {rejecting && <RejectDialog doc={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); onChanged(); }} />}
      {replacing && <ReplaceDialog doc={replacing} onClose={() => setReplacing(null)} onDone={() => { setReplacing(null); onChanged(); }} />}
    </Card>
  );
}

function RejectDialog({ doc, onClose, onDone }: { doc: LegalDoc; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const go = async () => {
    setSaving(true);
    try { await reviewLegalDoc(doc.id, { decision: 'reject', note }); toast({ title: 'Document sent back', variant: 'success' }); onDone(); }
    catch (e) { toast({ title: 'Could not reject it', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Reject: ${doc.title}`} footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="danger" onClick={go} isLoading={saving} disabled={!note.trim()}>Reject</Button></>}>
      <Input label="What is wrong with it?" name="rejectNote" required value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

function ReplaceDialog({ doc, onClose, onDone }: { doc: LegalDoc; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const go = async () => {
    setSaving(true);
    try { await replaceLegalDoc(doc.id, { url: (await uploadFiles([file!]))[0] }); toast({ title: `Version ${doc.version + 1} added`, variant: 'success' }); onDone(); }
    catch (e) { toast({ title: 'Could not replace it', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`New version of ${doc.title}`} footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={go} isLoading={saving} disabled={!file}>Add version</Button></>}>
      <p className="mb-3 text-sm text-ink-muted">The current copy stays in the history. The new one starts as pending and needs verifying.</p>
      <label htmlFor="replaceFile" className="text-sm font-medium text-ink">File</label>
      <input id="replaceFile" name="replaceFile" type="file" accept="image/*,application/pdf" className="mt-1.5 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
    </Modal>
  );
}
