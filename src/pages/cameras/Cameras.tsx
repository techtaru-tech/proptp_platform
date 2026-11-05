import { useMemo, useRef, useState } from 'react';
import { Camera as CameraIcon, Link2, Maximize2, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { getMaterialLookups } from '../../services/vendorService';
import { createCamera, deleteCamera, listCameras, updateCamera, type CameraRow } from '../../services/cameraService';
import { LiveVideo, type LiveState } from '../../components/cameras/LiveVideo';

/**
 * Live view of the cameras at a site. Pick a site and its cameras play side by side (a site has
 * four, which fits two by two). Only the chosen site is played, so opening this page never starts
 * every camera in the company at once.
 */
export function Cameras() {
  const [reload, setReload] = useState(0);
  const [siteId, setSiteId] = useState('');
  const [editing, setEditing] = useState<CameraRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<CameraRow | null>(null);
  const { toast } = useToast();
  const { data, isLoading, error } = useAsync(() => listCameras(), [reload]);

  const sites = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>();
    for (const c of data ?? []) {
      const s = m.get(c.projectId) ?? { id: c.projectId, name: c.projectName, count: 0 };
      s.count += 1;
      m.set(c.projectId, s);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const selected = sites.find((s) => s.id === siteId)?.id ?? sites[0]?.id ?? '';
  const cams = (data ?? []).filter((c) => c.projectId === selected && c.active);

  const remove = async () => {
    if (!removing) return;
    try {
      await deleteCamera(removing.id);
      toast({ title: 'Camera removed', variant: 'success' });
      setReload((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not remove it', description: (err as Error).message, variant: 'error' });
    }
    setRemoving(null);
  };

  return (
    <div>
      <PageHeader
        title="Site cameras"
        description="Watch a site live. Pick the site and its cameras play here."
        breadcrumb={[{ label: 'Site cameras' }]}
        actions={<Button variant="primary" leftIcon={<Plus size={14} />} onClick={() => setEditing('new')}>Add camera</Button>}
      />

      {error ? <ErrorState title="Could not load cameras" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={CameraIcon}
            title="No cameras yet"
            description="Add a camera with the address its live picture is served from. The site gateway gives you that address."
            action={<Button variant="primary" onClick={() => setEditing('new')}>Add the first camera</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-full max-w-xs">
              <Select
                label="Site"
                name="liveSite"
                value={selected}
                onChange={(e) => setSiteId(e.target.value)}
                options={sites.map((s) => ({ value: s.id, label: `${s.name} (${s.count} camera${s.count === 1 ? '' : 's'})` }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {cams.map((c) => (
              <CameraTile key={c.id} cam={c} onEdit={() => setEditing(c)} onRemove={() => setRemoving(c)} />
            ))}
          </div>
        </>
      )}

      {editing && (
        <CameraForm
          camera={editing === 'new' ? null : editing}
          defaultSite={selected}
          onClose={() => setEditing(null)}
          onSaved={(site) => { setEditing(null); if (site) setSiteId(site); setReload((k) => k + 1); }}
        />
      )}
      <ConfirmationDialog
        isOpen={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Remove this camera?"
        description={removing ? `"${removing.name}" will be removed from the live view. The camera itself is not touched.` : undefined}
        confirmLabel="Remove"
        variant="danger"
      />
    </div>
  );
}

function CameraTile({ cam, onEdit, onRemove }: { cam: CameraRow; onEdit: () => void; onRemove: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LiveState>('loading');
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div ref={frame} className="relative aspect-video bg-black">
        {cam.liveUrl ? (
          <LiveVideo url={cam.liveUrl} onState={setState} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/80">
            <CameraIcon size={26} />
            <p>No live address yet</p>
            <Button variant="outline" size="sm" leftIcon={<Link2 size={13} />} onClick={onEdit}>Add live address</Button>
          </div>
        )}
        {cam.liveUrl && state === 'playing' && (
          <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded bg-danger-600 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-surface" /> Live
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{cam.name}</p>
          <p className="truncate text-xs text-ink-muted">{cam.placement ?? cam.projectName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {cam.liveUrl && state === 'error' && <Badge tone="danger" dot>Offline</Badge>}
          {cam.liveUrl && (
            <Button variant="ghost" size="sm" aria-label={`Full screen ${cam.name}`} onClick={() => frame.current?.requestFullscreen?.()}><Maximize2 size={14} /></Button>
          )}
          <Button variant="ghost" size="sm" aria-label={`Edit ${cam.name}`} onClick={onEdit}><Pencil size={14} /></Button>
          <Button variant="ghost" size="sm" className="text-danger-600" aria-label={`Remove ${cam.name}`} onClick={onRemove}><Trash2 size={14} /></Button>
        </div>
      </div>
    </div>
  );
}

function CameraForm({ camera, defaultSite, onClose, onSaved }: { camera: CameraRow | null; defaultSite: string; onClose: () => void; onSaved: (siteId?: string) => void }) {
  const { toast } = useToast();
  const { data: lookups } = useAsync(() => getMaterialLookups(), []);
  const [f, setF] = useState({ name: camera?.name ?? '', projectId: camera?.projectId ?? defaultSite, placement: camera?.placement ?? '', liveUrl: camera?.liveUrl ?? '' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const body = { name: f.name, projectId: f.projectId, placement: f.placement, liveUrl: f.liveUrl };
      if (camera) await updateCamera(camera.id, body);
      else await createCamera(body);
      toast({ title: camera ? 'Camera saved' : 'Camera added', variant: 'success' });
      onSaved(f.projectId);
    } catch (err) {
      toast({ title: 'Could not save the camera', description: (err as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={camera ? 'Edit camera' : 'Add a camera'} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.name.trim() || !f.projectId}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Input label="Camera name" name="camName" required value={f.name} onChange={set('name')} placeholder="e.g. Main gate" />
        <Select label="Site" name="camProject" required value={f.projectId} onChange={set('projectId')} options={[{ value: '', label: 'Choose a project' }, ...(lookups?.projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))]} />
        <Input label="Where it points" name="camPlacement" value={f.placement} onChange={set('placement')} placeholder="e.g. Gate, facing Block A" />
        <Input
          label="Live address"
          name="camLive"
          value={f.liveUrl}
          onChange={set('liveUrl')}
          placeholder="https://site-gateway.example.com/<secret>/stream.html?src=gate&mode=mse"
          hint="The https address the site gateway serves this camera on; the gateway setup prints it. Leave it empty until the gateway is running."
        />
      </div>
    </Modal>
  );
}
