import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Flag, Trash2, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Textarea';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../context/ToastContext';
import { fileUrl } from '../../services/apiClient';
import { formatDateTime } from '../../utils/format';
import { deletePicture, reviewImage, type CameraImage } from '../../services/cameraService';

/** One picture, large, with the verdict controls. Arrow keys move between pictures. */
export function Lightbox({ images, index, onIndex, onClose, onChanged }: { images: CameraImage[]; index: number; onIndex: (i: number) => void; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const img = images[index];
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState('');
  const [raise, setRaise] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flagging) return;
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, flagging, onIndex, onClose]);

  const act = async (input: Parameters<typeof reviewImage>[1], done: string) => {
    setBusy(true);
    try { await reviewImage(img.id, input); toast({ title: done, variant: 'success' }); setFlagging(false); setNote(''); onChanged(); }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label="Camera picture">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="text-sm"><span className="font-medium">{img.cameraName}</span> · {formatDateTime(img.capturedAt)} <span className="text-white/60">· {index + 1} of {images.length}</span></div>
        <button type="button" aria-label="Close" className="rounded p-1 hover:bg-white/10 focus-ring" onClick={onClose}><X size={20} /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12">
        <button type="button" aria-label="Previous picture" disabled={index === 0} className="absolute left-2 rounded-full bg-white/10 p-2 text-white disabled:opacity-30 focus-ring" onClick={() => onIndex(index - 1)}><ChevronLeft size={22} /></button>
        <img src={fileUrl(img.url)} alt={`${img.cameraName}, ${formatDateTime(img.capturedAt)}`} className="max-h-full max-w-full object-contain" />
        <button type="button" aria-label="Next picture" disabled={index >= images.length - 1} className="absolute right-2 rounded-full bg-white/10 p-2 text-white disabled:opacity-30 focus-ring" onClick={() => onIndex(index + 1)}><ChevronRight size={22} /></button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 bg-black/60 px-4 py-3 text-white">
        <div className="text-sm">
          {img.review === 'flagged' && <span className="flex items-center gap-2"><Badge tone="danger">Flagged</Badge>{img.flagNote}{img.issueId && <span className="text-white/60">· site issue raised</span>}</span>}
          {img.review === 'ok' && <Badge tone="success">Reviewed — fine</Badge>}
          {img.review === 'unreviewed' && <span className="text-white/60">Not reviewed yet</span>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" leftIcon={<Trash2 size={13} />} disabled={busy} onClick={async () => { if (!window.confirm('Delete this picture? This cannot be undone.')) return; setBusy(true); try { await deletePicture(img.id); toast({ title: 'Picture deleted', variant: 'success' }); if (images.length <= 1) onClose(); else if (index >= images.length - 1) onIndex(index - 1); onChanged(); } catch (e) { toast({ title: 'Could not delete it', description: (e as Error).message, variant: 'error' }); } finally { setBusy(false); } }}>Delete</Button>
          {img.review !== 'unreviewed' && <Button variant="outline" size="sm" disabled={busy} onClick={() => act({ decision: 'clear' }, 'Review cleared')}>Clear</Button>}
          {img.review !== 'ok' && <Button variant="outline" size="sm" leftIcon={<Check size={13} />} disabled={busy} onClick={() => act({ decision: 'ok' }, 'Marked fine')}>Looks fine</Button>}
          {img.review !== 'flagged' && <Button variant="primary" size="sm" leftIcon={<Flag size={13} />} disabled={busy} onClick={() => setFlagging(true)}>Flag an issue</Button>}
        </div>
      </div>
      <Modal isOpen={flagging} onClose={() => setFlagging(false)} title="Flag an issue in this picture"
        footer={<><Button variant="outline" onClick={() => setFlagging(false)}>Cancel</Button><Button variant="primary" isLoading={busy} disabled={!note.trim()} onClick={() => act({ decision: 'flag', note, raiseIssue: raise }, raise ? 'Flagged — site issue raised' : 'Flagged')}>Flag it</Button></>}>
        <div className="flex flex-col gap-4">
          <Textarea label="What is wrong" id="flagNote" value={note} onChange={setNote} placeholder="e.g. Cement bags left open in the rain" />
          <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" checked={raise} onChange={(e) => setRaise(e.target.checked)} className="mt-0.5" />
            <span>Raise a site issue with this picture, given to the camera’s responsible person<span className="block text-xs text-ink-muted">So it becomes work somebody owns and closes, not just a note.</span></span></label>
        </div>
      </Modal>
    </div>
  );
}
