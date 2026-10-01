import { useState } from 'react';
import { Check, MapPin, Plus, X } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Textarea';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { fileUrl } from '../../services/apiClient';
import { formatDate, formatDateTime } from '../../utils/format';
import {
  createMaterialIssue, getMaterialLookups, getStock, listMaterialEntries, listMaterialIssues, reviewMaterialEntry, type MaterialEntryRow,
} from '../../services/vendorService';
import { MaterialEntryModal } from './MaterialEntryModal';

const TABS = [{ key: 'stock', label: 'Site stock' }, { key: 'pending', label: 'To verify' }, { key: 'verified', label: 'Verified' }, { key: 'rejected', label: 'Rejected' }, { key: 'issues', label: 'Issued' }];

export function Materials() {
  const { session } = useAuth();
  const [tab, setTab] = useState('stock');
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<'entry' | 'issue' | null>(null);
  const done = () => { setModal(null); setReload((k) => k + 1); };
  const { data: lookups } = useAsync(() => getMaterialLookups(), []);

  return (
    <div>
      <PageHeader title="Material" description="What has been received at each site, what has been used, and what is left. Only verified entries count."
        breadcrumb={[{ label: 'Vendors & Material' }, { label: 'Material' }]}
        actions={<div className="flex gap-2"><Button variant="outline" onClick={() => setModal('issue')}>Issue material</Button><Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setModal('entry')}>Record received</Button></div>} />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm focus-ring ${tab === t.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'stock' ? <Stock key={reload} /> : tab === 'issues' ? <Issues key={reload} /> : <Entries key={`${tab}${reload}`} status={tab} onDone={() => setReload((k) => k + 1)} />}

      {modal === 'entry' && lookups && <MaterialEntryModal projects={lookups.projects} vendors={lookups.vendors} defaultReceiver={session?.name} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'issue' && lookups && <IssueModal lookups={lookups} onClose={() => setModal(null)} onSaved={done} />}
    </div>
  );
}

function Stock() {
  const { data, isLoading, error } = useAsync(() => getStock(), []);
  if (error) return <ErrorState title="Could not load stock" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;
  if (data.length === 0) return <Card><EmptyState title="No stock yet" description="Stock appears once a received entry is verified." /></Card>;
  const bySite = new Map<string, typeof data>();
  data.forEach((r) => bySite.set(r.projectName, [...(bySite.get(r.projectName) ?? []), r]));
  return (
    <div className="flex flex-col gap-4">
      {[...bySite.entries()].map(([site, rows]) => (
        <Card key={site} padded={false}>
          <h3 className="border-b border-line px-5 py-3 font-semibold text-ink">{site}</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-faint"><th className="px-5 py-2 font-medium">Material</th><th className="px-3 text-right font-medium">Received</th><th className="px-3 text-right font-medium">Issued</th><th className="px-5 text-right font-medium">In stock</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.materialId} className="border-t border-line">
                <td className="px-5 py-2.5 font-medium">{r.material}</td>
                <td className="px-3 text-right tabular-nums">{r.received} {r.unit}</td><td className="px-3 text-right tabular-nums">{r.issued} {r.unit}</td>
                <td className={`px-5 text-right font-semibold tabular-nums ${r.inStock <= 0 ? 'text-danger-700' : 'text-ink'}`}>{r.inStock} {r.unit}</td>
              </tr>))}</tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function Issues() {
  const { data, isLoading, error } = useAsync(() => listMaterialIssues(), []);
  if (error) return <ErrorState title="Could not load" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;
  if (data.length === 0) return <Card><EmptyState title="Nothing issued yet" /></Card>;
  return (
    <Card padded={false}><ul className="divide-y divide-line">{data.map((i) => (
      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
        <span><span className="font-medium">{i.quantity} {i.unit} {i.material}</span> <span className="text-ink-muted">· {i.projectName} · {i.purpose}{i.issuedTo ? ` · to ${i.issuedTo}` : ''}</span></span>
        <span className="text-xs text-ink-muted">{formatDate(i.issuedOn)} · {i.issuedBy}</span>
      </li>))}</ul></Card>
  );
}

function Entries({ status, onDone }: { status: string; onDone: () => void }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useAsync(() => listMaterialEntries(status), [status]);
  const [rejecting, setRejecting] = useState<MaterialEntryRow | null>(null);
  const [reason, setReason] = useState('');
  const decide = async (e: MaterialEntryRow, decision: 'verify' | 'reject') => {
    try {
      await reviewMaterialEntry(e.id, decision, reason);
      toast({ title: decision === 'verify' ? 'Verified — added to site stock' : 'Entry rejected', variant: 'success' });
      setRejecting(null); setReason(''); onDone();
    } catch (err) { toast({ title: 'Could not save the decision', description: (err as Error).message, variant: 'error' }); }
  };
  if (error) return <ErrorState title="Could not load entries" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;
  if (data.length === 0) return <Card><EmptyState title={status === 'pending' ? 'Nothing waiting' : 'Nothing here'} /></Card>;
  return (
    <div className="flex flex-col gap-4">
      {data.map((e) => (
        <Card key={e.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-ink">{e.quantity} {e.unit} {e.material} <span className="font-normal text-ink-muted">· {e.projectName}</span></p>
              <p className="text-xs text-ink-muted">{e.vendorName ?? 'Vendor not listed'} · challan {e.challanNo} · vehicle {e.vehicleNo}</p>
              <p className="text-xs text-ink-muted">Received {formatDate(e.receivedOn)} by {e.receivedBy} · entered by {e.enteredBy}{e.expectedOn ? ` · promised ${formatDate(e.expectedOn)}` : ''}</p>
            </div>
            {e.status !== 'pending' && <Badge tone={e.status === 'verified' ? 'success' : 'danger'}>{e.status}</Badge>}
          </div>
          {e.rejectionReason && <p className="mt-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">Rejected: {e.rejectionReason}</p>}
          <div className="mt-3 flex flex-wrap gap-3">
            {e.photos.map((p) => (
              <figure key={p.id} className="w-32">
                <a href={fileUrl(p.url)} target="_blank" rel="noreferrer"><img src={fileUrl(p.url)} alt={`${p.kind} photo, ${e.material}`} className="h-20 w-32 rounded-lg border border-line object-cover" /></a>
                <figcaption className="mt-1 text-[11px] leading-tight text-ink-muted"><span className="font-medium capitalize text-ink">{p.kind}</span> · {formatDateTime(p.takenAt)}
                  <a className="flex items-center gap-1 text-brand-700" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}><MapPin size={10} />{p.latitude.toFixed(3)}, {p.longitude.toFixed(3)}</a></figcaption>
              </figure>
            ))}
          </div>
          {e.status === 'pending' && (
            <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="outline" leftIcon={<X size={14} />} onClick={() => { setRejecting(e); setReason(''); }}>Reject</Button>
              <Button variant="primary" leftIcon={<Check size={14} />} onClick={() => decide(e, 'verify')}>Verify</Button>
            </div>
          )}
        </Card>
      ))}
      <Modal isOpen={!!rejecting} onClose={() => setRejecting(null)} title="Reject this entry"
        footer={<><Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="primary" disabled={!reason.trim()} onClick={() => rejecting && decide(rejecting, 'reject')}>Reject entry</Button></>}>
        <Textarea label="Reason" id="rejectEntryReason" value={reason} onChange={setReason} placeholder="What was wrong with the delivery or the entry?" />
      </Modal>
    </div>
  );
}

function IssueModal({ lookups, onClose, onSaved }: { lookups: NonNullable<Awaited<ReturnType<typeof getMaterialLookups>>>; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ projectId: lookups.projects[0]?.id ?? '', materialId: '', quantity: '', purpose: '', issuedTo: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try { await createMaterialIssue({ ...f, quantity: Number(f.quantity), issuedTo: f.issuedTo || undefined }); toast({ title: 'Material issued', variant: 'success' }); onSaved(); }
    catch (err) { toast({ title: 'Could not issue it', description: (err as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Issue material for work"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.materialId || !(Number(f.quantity) > 0) || !f.purpose.trim()}>Issue</Button></>}>
      <div className="flex flex-col gap-4">
        <Select label="Site" name="issueProject" value={f.projectId} onChange={set('projectId')} options={lookups.projects.map((p) => ({ value: p.id, label: p.projectName }))} />
        <Select label="Material" name="issueMaterial" required value={f.materialId} onChange={set('materialId')} options={[{ value: '', label: 'Choose material' }, ...lookups.materials.map((m) => ({ value: m.id, label: `${m.name} (${m.unit})` }))]} />
        <Input label="Quantity" name="issueQty" type="number" min={0} step="any" required value={f.quantity} onChange={set('quantity')} hint="Cannot be more than the verified stock at this site." />
        <Input label="Used for" name="issuePurpose" required value={f.purpose} onChange={set('purpose')} placeholder="e.g. Block A kerbing" />
        <Input label="Issued to" name="issueTo" value={f.issuedTo} onChange={set('issuedTo')} />
      </div>
    </Modal>
  );
}
