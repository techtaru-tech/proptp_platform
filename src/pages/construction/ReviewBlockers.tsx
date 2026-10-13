import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, CircleCheck, MapPin, X } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Textarea';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../context/ToastContext';
import { fileUrl } from '../../services/apiClient';
import { formatDateTime } from '../../utils/format';
import { listBlockers, resolveBlocker, reviewBlocker, type BlockerRow } from '../../services/constructionService';

const TABS = [
  { key: 'pending', label: 'To review' },
  { key: 'approved', label: 'Blocking now' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'rejected', label: 'Rejected' },
];

const TONE = { pending: 'warning', approved: 'danger', resolved: 'success', rejected: 'neutral' } as const;
const LABEL = { pending: 'Waiting for approval', approved: 'Blocking', resolved: 'Resolved', rejected: 'Rejected' } as const;

/** Blockers raised from site. Approving one is what turns the activity red on the construction screens. */
export function ReviewBlockers() {
  const { toast } = useToast();
  const [params] = useSearchParams();
  const projectId = params.get('projectId') ?? undefined;
  const [tab, setTab] = useState('pending');
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<{ blocker: BlockerRow; kind: 'reject' | 'resolve' } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error } = useAsync(() => listBlockers(tab, projectId), [tab, projectId, reload]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: done, variant: 'success' });
      setDialog(null);
      setText('');
      setReload((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not save that', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Blockers"
        description="Problems raised from site that stop work finishing on plan. An approved blocker marks the activity as blocked until it is resolved."
        breadcrumb={[{ label: 'Construction', to: '/construction' }, { label: 'Blockers' }]}
      />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm focus-ring ${tab === t.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error ? <ErrorState title="Could not load blockers" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : data.length === 0 ? (
        <Card><EmptyState title={tab === 'pending' ? 'Nothing waiting' : 'Nothing here'} description={tab === 'pending' ? 'Blockers raised from the app appear here for approval.' : undefined} /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {data.map((b) => (
            <Card key={b.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{b.activityName} <span className="font-normal text-ink-muted">· {b.projectName}{b.block ? ` · ${b.block}` : ''}</span></p>
                  <p className="text-xs text-ink-muted">Raised by {b.raisedByName} · {formatDateTime(b.createdAt)}</p>
                </div>
                <Badge tone={TONE[b.status]}>{LABEL[b.status]}</Badge>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm text-ink">{b.description}</p>
              {b.rejectionReason && <p className="mt-2 rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-muted">Rejected: {b.rejectionReason}</p>}
              {b.resolvedNote && <p className="mt-2 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">Resolved: {b.resolvedNote}</p>}

              {b.photos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-3">
                  {b.photos.map((p, i) => (
                    <figure key={`${p.url}-${i}`} className="w-36">
                      <a href={fileUrl(p.url)} target="_blank" rel="noreferrer">
                        <img src={fileUrl(p.url)} alt={`Photo for ${b.activityName}`} className="h-24 w-36 rounded-lg border border-line object-cover" />
                      </a>
                      <figcaption className="mt-1 text-[11px] leading-tight text-ink-muted">
                        {formatDateTime(p.takenAt)}
                        <a className="mt-0.5 flex items-center gap-1 text-brand-700" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}>
                          <MapPin size={11} /> {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                        </a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}

              {b.status === 'pending' && (
                <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
                  <Button variant="outline" leftIcon={<X size={14} />} onClick={() => { setDialog({ blocker: b, kind: 'reject' }); setText(''); }}>Reject</Button>
                  <Button variant="primary" leftIcon={<Check size={14} />} isLoading={busy} onClick={() => run(() => reviewBlocker(b.id, 'approve'), 'Approved. The activity now shows as blocked')}>Approve</Button>
                </div>
              )}
              {b.status === 'approved' && (
                <div className="mt-4 flex justify-end border-t border-line pt-3">
                  <Button variant="outline" leftIcon={<CircleCheck size={14} />} onClick={() => { setDialog({ blocker: b, kind: 'resolve' }); setText(''); }}>Mark resolved</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.kind === 'reject' ? 'Reject this blocker' : 'Mark this blocker resolved'}
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={dialog?.kind === 'reject' && !text.trim()}
              isLoading={busy}
              onClick={() => dialog && run(
                () => (dialog.kind === 'reject' ? reviewBlocker(dialog.blocker.id, 'reject', text) : resolveBlocker(dialog.blocker.id, text)),
                dialog.kind === 'reject' ? 'Blocker rejected' : 'Resolved. The activity is no longer blocked',
              )}
            >
              {dialog?.kind === 'reject' ? 'Reject blocker' : 'Mark resolved'}
            </Button>
          </>
        }
      >
        <Textarea
          label={dialog?.kind === 'reject' ? 'Reason' : 'Note (optional)'}
          id="blockerNote"
          value={text}
          onChange={setText}
          placeholder={dialog?.kind === 'reject' ? 'Why is this not a blocker?' : 'What fixed it?'}
        />
      </Modal>
    </div>
  );
}
