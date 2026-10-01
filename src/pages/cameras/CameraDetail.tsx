import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Flag, KeyRound, Trash2 } from 'lucide-react';
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
import { HEALTH, deleteCamera, listCameras, listImages, rotateCameraKey, updateCamera } from '../../services/cameraService';
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
            <span className="text-ink-muted">Responsible: <strong className="text-ink">{cam.ownerName ?? 'nobody'}</strong></span>
            <span className="font-mono text-xs text-ink-faint">key {cam.keyPrefix}…</span>
          </div>
          {(cam.health === 'offline' || cam.health === 'never') && (
            <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
              {cam.health === 'never' ? 'Nothing has arrived from this camera yet. Set the uploader up on the PC it saves to — use “Rotate key” to get a key and the steps.' : 'Nothing has arrived for a long while. Check that the PC is on and online, and that the scheduled uploader is still running.'}
            </p>)}
        </Card>)}

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {imgs.data.items.map((im, i) => (
              <button key={im.id} type="button" onClick={() => setOpen(i)} className="group overflow-hidden rounded-lg border border-line bg-white text-left focus-ring" aria-label={`Open picture from ${im.cameraName}, ${formatDateTime(im.capturedAt)}`}>
                <div className="relative h-28 bg-surface-muted">
                  <img src={fileUrl(im.url)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  {im.review === 'flagged' && <span className="absolute right-1.5 top-1.5 rounded bg-danger-600 p-1 text-white"><Flag size={11} /></span>}
                  {im.review === 'ok' && <span className="absolute right-1.5 top-1.5 rounded bg-success-600 px-1 text-[10px] text-white">OK</span>}
                </div>
                <p className="px-2 py-1.5 text-[11px] text-ink-muted">{flaggedOnly && <span className="block font-medium text-ink">{im.cameraName}</span>}{formatDateTime(im.capturedAt)}</p>
              </button>))}
          </div>
          <Pagination page={imgs.data.page} pageSize={imgs.data.pageSize} total={imgs.data.total} onPageChange={setPage} />
        </>)}

      {open !== null && imgs.data && <Lightbox images={imgs.data.items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onChanged={refresh} />}
      {secret && cam && <KeyReveal camera={cam} secret={secret} onClose={() => setSecret(null)} />}
      <ConfirmationDialog isOpen={removing} onClose={() => setRemoving(false)} onConfirm={remove} title="Remove this camera?" description={cam ? `“${cam.name}” and its list of pictures will be removed. Site issues already raised from it stay.` : undefined} confirmLabel="Remove camera" variant="danger" />
      {!cam && !flaggedOnly && <Link to="/cameras" />}
    </div>
  );
}
