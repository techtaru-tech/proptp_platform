import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Flag, KeyRound, Link2, Pencil, Radio, Trash2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { getMaterialLookups } from '../../services/vendorService';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { fileUrl } from '../../services/apiClient';
import { formatDateTime } from '../../utils/format';
import { HEALTH, deleteAllPictures, deleteCamera, deletePictures, listCameras, listImages, rotateCameraKey, updateCamera, type CameraRow } from '../../services/cameraService';
import { Lightbox } from './Lightbox';
import { KeyReveal } from './KeyReveal';

/** Gallery for one camera, or (with no camera id) every flagged picture across cameras. */
export function CameraDetail({ flaggedOnly = false }: { flaggedOnly?: boolean }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast } = useToast();
  const [review, setReview] = useState(flaggedOnly ? 'flagged' : 'all');
  const [date, setDate] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [secret, setSecret] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [live, setLive] = useState<null | 'view' | 'set' | 'edit'>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [purge, setPurge] = useState<null | 'chosen' | 'all'>(null);
  const [liveUrl, setLiveUrl] = useState('');
  const cams = useAsync(() => listCameras(), [reload]);
  const cam = cams.data?.find((c) => c.id === id);
  const imgs = useAsync(() => listImages({ cameraId: id, review: flaggedOnly ? 'flagged' : review, date, page }), [id, review, date, page, reload, flaggedOnly]);
  const refresh = () => setReload((k) => k + 1);

  if (!flaggedOnly && cams.data && !cam) return <ErrorState title="Camera not found" description="It may have been removed." />;

  const rotate = async () => {
    try { setSecret((await rotateCameraKey(cam!.id)).key); refresh(); } catch (e) { toast({ title: 'Could not rotate the key', description: (e as Error).message, variant: 'error' }); }
  };
  const remove = async () => {
    try { await deleteCamera(cam!.id); nav('/cameras'); } catch (e) { toast({ title: 'Could not remove it', description: (e as Error).message, variant: 'error' }); }
  };

  return (
    <div>
      <PageHeader
        title={flaggedOnly ? 'Flagged pictures' : cam?.name ?? 'Camera'}
        description={flaggedOnly ? 'Every picture someone has flagged, across all cameras.' : cam ? `${cam.projectName}${cam.placement ? ` · ${cam.placement}` : ''}` : undefined}
        breadcrumb={[{ label: 'Site cameras', to: '/cameras' }, { label: flaggedOnly ? 'Flagged' : cam?.name ?? '…' }]}
        actions={cam && (
          <div className="flex gap-2">
            {cam.liveUrl && <Button variant="primary" leftIcon={<Radio size={14} />} onClick={() => setLive('view')}>Live view</Button>}
            <Button variant="outline" leftIcon={<Pencil size={14} />} onClick={() => setLive('edit')}>Edit camera</Button>
            <Button variant="outline" leftIcon={<Link2 size={14} />} onClick={() => { setLiveUrl(cam.liveUrl ?? ''); setLive('set'); }}>{cam.liveUrl ? 'Live address' : 'Add live address'}</Button>
            <Button variant="outline" leftIcon={<KeyRound size={14} />} onClick={rotate}>Rotate key</Button>
            <Button variant="outline" onClick={async () => { await updateCamera(cam.id, { active: !cam.active }); refresh(); }}>{cam.active ? 'Switch off' : 'Switch on'}</Button>
            <Button variant="ghost" className="text-danger-600" aria-label="Remove camera" onClick={() => setRemoving(true)}><Trash2 size={14} /></Button>
          </div>)} />

      {cam && (
        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <Badge tone={HEALTH[cam.health].tone} dot>{HEALTH[cam.health].label}</Badge>
            <span className="text-ink-muted">Last picture: <strong className="text-ink">{cam.lastImageAt ? formatDateTime(cam.lastImageAt) : 'none yet'}</strong></span>
            <span className="text-ink-muted">Last contact: <strong className="text-ink">{cam.lastSeenAt ? formatDateTime(cam.lastSeenAt) : 'never'}</strong></span>
            <span className="text-ink-muted">Expected every <strong className="text-ink">{cam.expectedEveryMinutes} min</strong></span>
            <span className="font-mono text-xs text-ink-faint">key {cam.keyPrefix}…</span>
          </div>
          {(cam.health === 'offline' || cam.health === 'never') && (
            <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
              {cam.health === 'never' ? 'Nothing has arrived from this camera yet. Set the uploader up on the PC it saves to — use “Rotate key” to get a key and the steps.' : 'Nothing has arrived for a long while. Check that the PC is on and online, and that the scheduled uploader is still running.'}
            </p>)}
        </Card>)}

      {cam && live === 'view' && cam.liveUrl && (
        <Modal isOpen onClose={() => setLive(null)} size="lg" title={`Live: ${cam.name}`}>
          <LiveFrame url={cam.liveUrl} />
        </Modal>
      )}
      {cam && live === 'edit' && <EditCamera cam={cam} onClose={() => setLive(null)} onSaved={() => { setLive(null); refresh(); }} />}
      {cam && live === 'set' && (
        <Modal isOpen onClose={() => setLive(null)} title="Live address" footer={<><Button variant="outline" onClick={() => setLive(null)}>Cancel</Button>
          <Button variant="primary" onClick={async () => { try { await updateCamera(cam.id, { liveUrl }); setLive(null); refresh(); } catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); } }}>Save</Button></>}>
          <Input label="Where can this camera be watched live?" name="camLive" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} hint="An https:// address: a video stream (HLS .m3u8 or MP4), an MJPEG feed, or the camera app's web page. Leave empty to remove it." />
        </Modal>
      )}

      {!flaggedOnly && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <DatePicker label="Day" name="camDay" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} wrapperClassName="w-44" />
          <Select label="Review" name="camReview" value={review} onChange={(e) => { setReview(e.target.value); setPage(1); }} wrapperClassName="w-44"
            options={[{ value: 'all', label: 'All pictures' }, { value: 'unreviewed', label: 'Not reviewed' }, { value: 'ok', label: 'Fine' }, { value: 'flagged', label: 'Flagged' }]} />
          {date && <Button variant="ghost" size="sm" onClick={() => setDate('')}>Clear day</Button>}
        </div>)}

      {imgs.error ? <ErrorState title="Could not load pictures" description={imgs.error.message} /> : imgs.isLoading || !imgs.data ? <CardSkeleton /> : imgs.data.items.length === 0 ? (
        <Card><EmptyState icon={Flag} title={flaggedOnly ? 'Nothing flagged' : 'No pictures'} description={flaggedOnly ? undefined : 'Pictures appear here as the PC pushes them.'} /></Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPicked(picked.size === imgs.data!.items.length ? new Set() : new Set(imgs.data!.items.map((x) => x.id)))}>{picked.size === imgs.data.items.length ? 'Clear selection' : 'Select this page'}</Button>
            {picked.size > 0 && <Button variant="danger" size="sm" leftIcon={<Trash2 size={13} />} onClick={() => setPurge('chosen')}>Delete {picked.size} selected</Button>}
            {!flaggedOnly && cam && <Button variant="ghost" size="sm" className="text-danger-600" onClick={() => setPurge('all')}>Delete all pictures</Button>}
            <span className="text-xs text-ink-faint">{imgs.data.total} picture{imgs.data.total === 1 ? '' : 's'}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {imgs.data.items.map((im, i) => (
              <div key={im.id} className="relative">
                <label className="absolute left-1.5 top-1.5 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-white/90 shadow-card" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select picture from ${formatDateTime(im.capturedAt)}`} className="h-4 w-4 rounded border-line-strong focus-ring" checked={picked.has(im.id)}
                    onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(im.id); else n.delete(im.id); return n; })} />
                </label>
              <button type="button" onClick={() => setOpen(i)} className="group block w-full overflow-hidden rounded-lg border border-line bg-white text-left focus-ring" aria-label={`Open picture from ${im.cameraName}, ${formatDateTime(im.capturedAt)}`}>
                <div className="relative h-28 bg-surface-muted">
                  <img src={fileUrl(im.url)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {im.review === 'flagged' && <span className="absolute right-1.5 top-1.5 rounded bg-danger-600 p-1 text-white"><Flag size={11} /></span>}
                  {im.review === 'ok' && <span className="absolute right-1.5 top-1.5 rounded bg-success-600 px-1 text-[10px] text-white">OK</span>}
                </div>
                <p className="px-2 py-1.5 text-[11px] text-ink-muted">{flaggedOnly && <span className="block font-medium text-ink">{im.cameraName}</span>}{formatDateTime(im.capturedAt)}</p>
              </button>
              </div>))}
          </div>
          <Pagination page={imgs.data.page} pageSize={imgs.data.pageSize} total={imgs.data.total} onPageChange={setPage} />
        </>)}

      {open !== null && imgs.data && <Lightbox images={imgs.data.items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onChanged={refresh} />}
      {secret && cam && <KeyReveal camera={cam} secret={secret} onClose={() => setSecret(null)} />}
      <ConfirmationDialog isOpen={purge !== null} onClose={() => setPurge(null)} variant="danger" confirmLabel="Delete"
        title={purge === 'all' ? 'Delete every picture of this camera?' : `Delete ${picked.size} picture${picked.size === 1 ? '' : 's'}?`}
        description={purge === 'all' ? `All ${imgs.data?.total ?? ''} pictures of “${cam?.name}” will be deleted for good. The camera and its key stay, so new pictures keep arriving.` : 'The chosen pictures will be deleted for good.'}
        onConfirm={async () => {
          try {
            const r = purge === 'all' ? await deleteAllPictures(cam!.id) : await deletePictures([...picked]);
            toast({ title: `${r.deleted} picture${r.deleted === 1 ? '' : 's'} deleted`, variant: 'success' }); setPicked(new Set()); setPage(1); refresh();
          } catch (e) { toast({ title: 'Could not delete', description: (e as Error).message, variant: 'error' }); }
          setPurge(null);
        }} />
      <ConfirmationDialog isOpen={removing} onClose={() => setRemoving(false)} onConfirm={remove} title="Remove this camera?" description={cam ? `“${cam.name}” and its list of pictures will be removed. Site issues already raised from it stay.` : undefined} confirmLabel="Remove camera" variant="danger" />
      {!cam && !flaggedOnly && <Link to="/cameras" />}
    </div>
  );
}

/** Shows whatever the address serves: a video stream, a still/MJPEG feed, or a web page. */
function LiveFrame({ url }: { url: string }) {
  const path = url.split('?')[0].toLowerCase();
  if (/\.(mp4|webm|m3u8)$/.test(path)) return <video src={url} controls autoPlay muted playsInline className="aspect-video w-full rounded-lg bg-black" />;
  if (/\.(jpg|jpeg|png|mjpg|mjpeg|cgi)$/.test(path) || /mjpe?g|snapshot/.test(path)) return <img src={url} alt="Live view" className="w-full rounded-lg bg-black" />;
  return (
    <div>
      <iframe src={url} title="Live view" className="aspect-video w-full rounded-lg border border-line bg-black" allow="autoplay; fullscreen" />
      <p className="mt-2 text-xs text-ink-muted">If this stays blank, the camera's page does not allow being shown here. <a className="font-medium text-brand-700" href={url} target="_blank" rel="noreferrer">Open it in a new tab</a>.</p>
    </div>
  );
}

/** Change a camera's name, site, where it points, how often it pushes, and its live address. */
function EditCamera({ cam, onClose, onSaved }: { cam: CameraRow; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { data: lookups } = useAsync(() => getMaterialLookups(), []);
  const [f, setF] = useState({ name: cam.name, projectId: cam.projectId, placement: cam.placement ?? '', every: String(cam.expectedEveryMinutes), liveUrl: cam.liveUrl ?? '' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try { await updateCamera(cam.id, { name: f.name, projectId: f.projectId, placement: f.placement, expectedEveryMinutes: Number(f.every), liveUrl: f.liveUrl }); toast({ title: 'Camera updated', variant: 'success' }); onSaved(); }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); }
    finally { setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Edit camera" footer={<><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} isLoading={saving} disabled={!f.name.trim() || !(Number(f.every) >= 1)}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Input label="Camera name" name="editCamName" required value={f.name} onChange={set('name')} />
        <Select label="Site" name="editCamProject" value={f.projectId} onChange={set('projectId')} options={(lookups?.projects ?? []).map((p) => ({ value: p.id, label: p.projectName }))} />
        <Input label="Where it points" name="editCamPlacement" value={f.placement} onChange={set('placement')} />
        <Input label="Pushes a picture set every (minutes)" name="editCamEvery" type="number" min={1} max={1440} value={f.every} onChange={set('every')} hint="Used to tell a quiet camera from one that is down. 60 is every hour." />
        <Input label="Live address" name="editCamLive" value={f.liveUrl} onChange={set('liveUrl')} hint="Optional. An https:// address to watch the camera live." />
      </div>
    </Modal>
  );
}
