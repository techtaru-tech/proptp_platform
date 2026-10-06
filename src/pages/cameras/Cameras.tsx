import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera as CameraIcon, Flag, Plus } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { StatCard } from '../../components/ui/StatCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { fileUrl } from '../../services/apiClient';
import { formatDateTime } from '../../utils/format';
import { getMaterialLookups } from '../../services/vendorService';
import { HEALTH, createCamera, listCameras, type CameraRow } from '../../services/cameraService';
import { KeyReveal } from './KeyReveal';

export function Cameras() {
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<(CameraRow & { key: string }) | null>(null);
  const { data, isLoading, error } = useAsync(() => listCameras(), [reload]);
  const count = (h: string) => data?.filter((c) => c.health === h).length ?? 0;

  return (
    <div>
      <PageHeader title="Site cameras" description="Pictures your cameras save on a PC at site are pushed here on a schedule. Review them, and flag anything that needs action."
        breadcrumb={[{ label: 'Site cameras' }]}
        actions={<div className="flex gap-2">
          <Link to="/cameras/flagged" className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-surface-muted focus-ring"><Flag size={14} /> Flagged pictures</Link>
          <Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setAdding(true)}>Add camera</Button></div>} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Cameras" value={data?.length ?? '…'} tone="brand" icon={CameraIcon} />
        <StatCard label="Live" value={count('live')} tone="success" />
        <StatCard label="Late or offline" value={count('stale') + count('offline')} tone={count('offline') ? 'danger' : 'warning'} />
        <StatCard label="Flagged pictures" value={data?.reduce((s, c) => s + c.flagged, 0) ?? '…'} tone="danger" />
      </div>
      {error ? <ErrorState title="Could not load cameras" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : data.length === 0 ? (
        <Card><EmptyState icon={CameraIcon} title="No cameras yet" description="Add a camera to get its key, then set the uploader up on the PC the camera saves to." action={<Button variant="primary" onClick={() => setAdding(true)}>Add the first camera</Button>} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <Link key={c.id} to={`/cameras/${c.id}`} className="overflow-hidden rounded-xl border border-line bg-white shadow-card hover:shadow-popover focus-ring">
              <div className="flex h-44 items-center justify-center bg-surface-muted">
                {c.latestUrl ? <img src={fileUrl(c.latestUrl)} alt={`Latest picture from ${c.name}`} className="h-full w-full object-cover" /> : <CameraIcon className="text-ink-faint" size={36} />}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2"><h3 className="font-semibold text-ink">{c.name}</h3><Badge tone={HEALTH[c.health].tone} dot>{HEALTH[c.health].label}</Badge></div>
                <p className="text-xs text-ink-muted">{c.projectName}{c.placement ? ` · ${c.placement}` : ''}</p>
                <p className="mt-2 text-xs text-ink-muted">{c.lastImageAt ? `Last picture ${formatDateTime(c.lastImageAt)}` : 'No pictures yet'}</p>
                <p className="mt-1 text-xs text-ink-faint">{c.imagesToday} today{c.flagged ? ` · ${c.flagged} flagged` : ''}</p>
              </div>
            </Link>))}
        </div>)}
      {adding && <AddCamera onClose={() => setAdding(false)} onCreated={(c) => { setAdding(false); setCreated(c); setReload((k) => k + 1); }} />}
      {created && <KeyReveal camera={created} secret={created.key} onClose={() => setCreated(null)} />}
    </div>
  );
}

function AddCamera({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CameraRow & { key: string }) => void }) {
  const { toast } = useToast();
  const { data: lookups } = useAsync(() => getMaterialLookups(), []);
  const [f, setF] = useState({ name: '', projectId: '', placement: '', every: '60' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try { onCreated(await createCamera({ name: f.name, projectId: f.projectId, placement: f.placement || undefined, expectedEveryMinutes: Number(f.every) || 60 })); }
    catch (e) { toast({ title: 'Could not add the camera', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Add a camera" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.name.trim() || !f.projectId}>Add camera</Button></>}>
      <div className="flex flex-col gap-4">
        <Input label="Camera name" name="camName" required value={f.name} onChange={set('name')} placeholder="e.g. Main gate" />
        <Select label="Site" name="camProject" required value={f.projectId} onChange={set('projectId')} options={[{ value: '', label: 'Choose a project' }, ...(lookups?.projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))]} />
        <Input label="Where it points" name="camPlacement" value={f.placement} onChange={set('placement')} placeholder="e.g. Gate, facing Block A" />
        <Input label="Pushes a picture set every (minutes)" name="camEvery" type="number" min={1} max={1440} value={f.every} onChange={set('every')} hint="Used to tell a quiet camera from one that is down." />
      </div>
    </Modal>
  );
}
