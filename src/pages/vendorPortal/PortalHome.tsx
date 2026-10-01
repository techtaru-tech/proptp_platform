import { useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Modal } from '../../components/ui/Modal';
import { StatCard } from '../../components/ui/StatCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { StampedPhotos, appendStamped, type StampedPhoto } from '../../components/ui/StampedPhotos';
import { PlanVsActual } from '../construction/PlanVsActual';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format';
import type { PortalActivity } from '../../services/vendorService';
import { usePortal } from './PortalContext';

export function PortalHome() {
  const { api: portal, readOnly } = usePortal();
  const [reload, setReload] = useState(0);
  const [posting, setPosting] = useState<PortalActivity | null>(null);
  const me = useAsync(() => portal.me(), [reload]);
  const acts = useAsync(() => portal.activities(), [reload]);
  const ups = useAsync(() => portal.updates(), [reload]);
  if (me.error) return <ErrorState title="Could not load your account" description={me.error.message} />;
  if (!me.data || !acts.data || !ups.data) return <CardSkeleton />;
  const orders = me.data.workOrders;
  const total = orders.reduce((s, w) => s + w.amount, 0);

  return (
    <div>
      <PageHeader title={`Welcome, ${me.data.name}`} description="Your work, daily progress, material and bills." breadcrumb={[{ label: 'My work' }]} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Work orders" value={orders.length} tone="brand" />
        <StatCard label="Ordered value" value={formatCurrency(total)} tone="shell" />
        <StatCard label="Billed" value={formatCurrency(orders.reduce((s, w) => s + w.billed, 0))} tone="accent" />
        <StatCard label="Paid" value={formatCurrency(orders.reduce((s, w) => s + w.paid, 0))} tone="success" />
      </div>

      <Card padded={false} className="mb-5">
        <div className="border-b border-line px-5 py-3"><CardHeader title="Work assigned to you" /></div>
        {acts.data.activities.length === 0 ? <EmptyState title="Nothing assigned yet" description="Activities appear here once the project manager assigns them to you." /> : (
          <ul className="divide-y divide-line">
            {acts.data.activities.map((a) => (
              <li key={a.id} className="grid grid-cols-1 gap-3 px-5 py-3 md:grid-cols-[1.4fr_1.2fr_auto] md:items-center">
                <div><p className="font-medium text-ink">{a.name}</p><p className="text-xs text-ink-muted">{a.project}{a.block ? ` · ${a.block}` : ''} · due {formatDate(a.planned_end)}</p></div>
                <div>
                  <div className="mb-1 flex justify-between text-xs"><span className="tabular-nums">{a.actual_percent}% <span className="text-ink-faint">/ plan {a.planned_percent}%</span></span>
                    <span className={a.days_behind > 0 ? 'font-medium text-danger-700' : 'text-success-700'}>{a.days_behind > 0 ? `${a.days_behind} days behind` : 'On track'}</span></div>
                  <PlanVsActual planned={a.planned_percent} actual={a.actual_percent} />
                </div>
                {!readOnly && <Button variant="primary" size="sm" onClick={() => setPosting(a)}>Post today&apos;s update</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padded={false}>
        <div className="border-b border-line px-5 py-3"><CardHeader title="Your recent updates" /></div>
        {ups.data.updates.length === 0 ? <EmptyState title="No updates yet" /> : (
          <ul className="divide-y divide-line">{ups.data.updates.slice(0, 8).map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <span><span className="font-medium">{u.activity}</span> <span className="text-ink-muted">· {u.percent_complete}% · {formatDateTime(u.captured_at)}</span>
                {u.rejection_reason && <span className="block text-xs text-danger-700">Rejected: {u.rejection_reason}</span>}</span>
              <Badge tone={u.status === 'approved' ? 'success' : u.status === 'rejected' ? 'danger' : 'warning'}>{u.status}</Badge>
            </li>))}</ul>
        )}
      </Card>
      {posting && !readOnly && <UpdateModal activity={posting} onClose={() => setPosting(null)} onSaved={() => { setPosting(null); setReload((k) => k + 1); }} />}
    </div>
  );
}

function UpdateModal({ activity, onClose, onSaved }: { activity: PortalActivity; onClose: () => void; onSaved: () => void }) {
  const { api: portal } = usePortal();
  const { toast } = useToast();
  const [f, setF] = useState({ work_done: '', manpower: '', percent_complete: String(activity.actual_percent), remarks: '' });
  const [photos, setPhotos] = useState<StampedPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      const form = new FormData();
      Object.entries(f).forEach(([k, v]) => v && form.append(k, v));
      form.append('activity_id', activity.id);
      form.append('client_id', crypto.randomUUID());
      form.append('captured_at', new Date().toISOString());
      form.append('photo_meta', JSON.stringify(appendStamped(form, 'photos', photos)));
      await portal.postUpdate(form);
      toast({ title: 'Update sent for approval', variant: 'success' });
      onSaved();
    } catch (err) { toast({ title: 'Could not send the update', description: (err as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Update: ${activity.name}`}
      footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.work_done.trim() || photos.length === 0}>Send update</Button></>}>
      <div className="flex flex-col gap-4">
        <Textarea label="Work done today" id="work_done" value={f.work_done} onChange={(v) => setF((x) => ({ ...x, work_done: v }))} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="People on site" name="manpower" type="number" min={0} value={f.manpower} onChange={set('manpower')} />
          <Input label="Total complete (%)" name="percent_complete" type="number" min={0} max={100} required value={f.percent_complete} onChange={set('percent_complete')} hint="Of the whole activity." />
        </div>
        <Input label="Remarks" name="remarks" value={f.remarks} onChange={set('remarks')} />
        <StampedPhotos label="Site photos *" name="photos" photos={photos} onChange={setPhotos} max={6} />
      </div>
    </Modal>
  );
}
