import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Eye, FileText, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Modal } from '../../components/ui/Modal';
import { StatCard } from '../../components/ui/StatCard';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { fileUrl, uploadFiles } from '../../services/apiClient';
import { formatCurrency, formatDate } from '../../utils/format';
import { addVendorDocument, createWorkOrder, deleteVendorDocument, getMaterialLookups, getVendor, updateVendor } from '../../services/vendorService';

const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

export function VendorDetail() {
  const { id = '' } = useParams();
  const { toast } = useToast();
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<'doc' | 'wo' | null>(null);
  const { data: v, isLoading, error } = useAsync(() => getVendor(id), [id, reload]);
  if (error) return <ErrorState title="Could not load this vendor" description={error.message} />;
  if (isLoading || !v) return <CardSkeleton />;
  const refresh = () => setReload((k) => k + 1);
  const p = v.performance;

  const toggle = async () => {
    try { await updateVendor(v.id, { active: !v.active }); refresh(); }
    catch (err) { toast({ title: 'Could not update', description: (err as Error).message, variant: 'error' }); }
  };

  return (
    <div>
      <PageHeader title={v.name} description={`${v.category}${v.contactPerson ? ` · ${v.contactPerson}` : ''}${v.phone ? ` · ${v.phone}` : ''}`}
        breadcrumb={[{ label: 'Vendors', to: '/vendors' }, { label: v.name }]}
        actions={<div className="flex gap-2">
          <Link to={`/vendors/${v.id}/portal`} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-surface-muted focus-ring"><Eye size={14} /> View their portal</Link>
          <Button variant="outline" onClick={toggle}>{v.active ? 'Deactivate' : 'Reactivate'}</Button></div>} />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="On-time delivery" value={pct(p.onTimePct)} tone="success" footer={<span className="text-xs text-ink-muted">{p.deliveries} deliveries</span>} />
        <StatCard label="Entries rejected" value={pct(p.rejectionPct)} tone="warning" />
        <StatCard label="Open issues" value={p.pendingIssues} tone={p.pendingIssues ? 'danger' : 'neutral'} />
        <StatCard label="Update discipline" value={pct(p.updateDisciplinePct)} tone="brand" footer={<span className="text-xs text-ink-muted">weeks with an update, last 4</span>} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <dl className="space-y-2 text-sm">
            {[['Contract value', formatCurrency(v.contractValue)], ['Email', v.email], ['GSTIN', v.gstin], ['Address', v.address], ['Portal login', v.user ? `${v.user.email} (${v.user.status})` : 'None']].map(([k, val]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-ink-muted">{k}</dt><dd className="text-right font-medium text-ink">{val || '—'}</dd></div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Documents" action={<Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setModal('doc')}>Add</Button>} />
          {v.documents.length === 0 ? <p className="text-sm text-ink-muted">No documents yet.</p> : (
            <ul className="divide-y divide-line">
              {v.documents.map((d) => {
                const expired = d.expiresAt && new Date(d.expiresAt) < new Date();
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <a href={fileUrl(d.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-medium text-brand-700"><FileText size={14} />{d.title}</a>
                    <span className="flex items-center gap-2">
                      {d.expiresAt && <Badge tone={expired ? 'danger' : 'neutral'}>{expired ? 'Expired' : 'Valid till'} {formatDate(d.expiresAt)}</Badge>}
                      <button aria-label={`Delete ${d.title}`} className="text-danger-600 focus-ring rounded" onClick={async () => { await deleteVendorDocument(d.id); refresh(); }}><Trash2 size={13} /></button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Work orders" action={<Button variant="outline" size="sm" leftIcon={<Plus size={13} />} onClick={() => setModal('wo')}>New work order</Button>} />
          {v.workOrders.length === 0 ? <p className="text-sm text-ink-muted">No work orders yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint"><th className="py-2 pr-3 font-medium">Number</th><th className="pr-3 font-medium">Work</th><th className="pr-3 font-medium">Site</th><th className="pr-3 text-right font-medium">Amount</th><th className="pr-3 text-right font-medium">Billed</th><th className="text-right font-medium">Paid</th></tr></thead>
                <tbody>
                  {v.workOrders.map((w) => (
                    <tr key={w.id} className="border-t border-line">
                      <td className="py-2 pr-3 font-medium">{w.number}</td><td className="pr-3">{w.description}</td><td className="pr-3 text-ink-muted">{w.projectName}</td>
                      <td className="pr-3 text-right tabular-nums">{formatCurrency(w.amount)}</td><td className="pr-3 text-right tabular-nums">{formatCurrency(w.billed)}</td><td className="text-right tabular-nums">{formatCurrency(w.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {modal === 'doc' && <DocModal vendorId={v.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
      {modal === 'wo' && <WorkOrderModal vendorId={v.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />}
    </div>
  );
}

function DocModal({ vendorId, onClose, onSaved }: { vendorId: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!file) return;
    setSaving(true);
    try {
      const [url] = await uploadFiles([file]);
      await addVendorDocument(vendorId, { title, url, expiresAt: expiresAt || undefined });
      onSaved();
    } catch (err) { toast({ title: 'Could not add the document', description: (err as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Add document" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!title.trim() || !file}>Add</Button></>}>
      <div className="flex flex-col gap-4">
        <Input label="Title" name="docTitle" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Contract agreement" />
        <div><label htmlFor="docFile" className="text-sm font-medium text-ink">File</label><input id="docFile" name="docFile" type="file" accept="image/*,application/pdf" className="mt-1.5 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
        <DatePicker label="Valid until (optional)" name="docExpiry" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </div>
    </Modal>
  );
}

function WorkOrderModal({ vendorId, onClose, onSaved }: { vendorId: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { data: lookups } = useAsync(() => getMaterialLookups(), []);
  const [f, setF] = useState({ projectId: '', description: '', amount: '' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await createWorkOrder(vendorId, { projectId: f.projectId, description: f.description, amount: Number(f.amount) }); onSaved(); }
    catch (err) { toast({ title: 'Could not create the work order', description: (err as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="New work order" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.projectId || !f.description.trim() || !(Number(f.amount) > 0)}>Create</Button></>}>
      <div className="flex flex-col gap-4">
        <Select label="Site" name="woProject" required value={f.projectId} onChange={(e) => setF((x) => ({ ...x, projectId: e.target.value }))} options={[{ value: '', label: 'Choose a project' }, ...(lookups?.projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))]} />
        <Input label="Work" name="woDescription" required value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} />
        <Input label="Amount (₹)" name="woAmount" type="number" min={1} required value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} hint="Bills against it cannot add up to more than this." />
      </div>
    </Modal>
  );
}
