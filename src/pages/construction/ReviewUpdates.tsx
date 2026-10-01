import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, MapPin, X } from 'lucide-react';
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
import { listProgressUpdates, reviewProgressUpdate, type ProgressUpdateRow } from '../../services/constructionService';

const TABS = [
  { key: 'pending', label: 'To review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

export function ReviewUpdates() {
  const { toast } = useToast();
  const [params] = useSearchParams();
  const projectId = params.get('projectId') ?? undefined;
  const [tab, setTab] = useState('pending');
  const [reload, setReload] = useState(0);
  const [rejecting, setRejecting] = useState<ProgressUpdateRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error } = useAsync(() => listProgressUpdates(tab, projectId), [tab, projectId, reload]);

  const decide = async (u: ProgressUpdateRow, decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await reviewProgressUpdate(u.id, decision, reason);
      toast({ title: decision === 'approve' ? 'Update approved — it now counts toward progress' : 'Update rejected', variant: 'success' });
      setRejecting(null);
      setReason('');
      setReload((k) => k + 1);
    } catch (err) {
      toast({ title: 'Could not save the decision', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Review updates" description="Site updates count toward progress only once approved." breadcrumb={[{ label: 'Construction', to: '/construction' }, { label: 'Review updates' }]} />
      <div className="mb-4 flex gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm focus-ring ${tab === t.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-muted'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error ? <ErrorState title="Could not load updates" description={error.message} /> : isLoading || !data ? <CardSkeleton /> : data.length === 0 ? (
        <Card><EmptyState title={tab === 'pending' ? 'Nothing waiting' : 'Nothing here'} description={tab === 'pending' ? 'Updates posted from site appear here for approval.' : undefined} /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {data.map((u) => (
            <Card key={u.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{u.activityName} <span className="font-normal text-ink-muted">· {u.projectName}{u.block ? ` · ${u.block}` : ''}</span></p>
                  <p className="text-xs text-ink-muted">{u.authorName} · taken {formatDateTime(u.capturedAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-semibold tabular-nums">{u.percentComplete}%</span>
                  {u.status !== 'pending' && <Badge tone={u.status === 'approved' ? 'success' : 'danger'}>{u.status}</Badge>}
                </div>
              </div>
              <p className="mt-3 text-sm text-ink">{u.workDone}</p>
              <p className="mt-1 text-xs text-ink-muted">{u.manpower} people on site{u.remarks ? ` · ${u.remarks}` : ''}</p>
              {u.rejectionReason && <p className="mt-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">Rejected: {u.rejectionReason}</p>}

              <div className="mt-3 flex flex-wrap gap-3">
                {u.photos.map((p) => (
                  <figure key={p.id} className="w-36">
                    <a href={fileUrl(p.url)} target="_blank" rel="noreferrer">
                      <img src={fileUrl(p.url)} alt={`Site photo for ${u.activityName}`} className="h-24 w-36 rounded-lg border border-line object-cover" />
                    </a>
                    <figcaption className="mt-1 text-[11px] leading-tight text-ink-muted">
                      {formatDateTime(p.takenAt)}
                      <a className="mt-0.5 flex items-center gap-1 text-brand-700" target="_blank" rel="noreferrer"
                        href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}>
                        <MapPin size={11} /> {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                      </a>
                    </figcaption>
                  </figure>
                ))}
              </div>

              {u.status === 'pending' && (
                <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
                  <Button variant="outline" leftIcon={<X size={14} />} onClick={() => { setRejecting(u); setReason(''); }}>Reject</Button>
                  <Button variant="primary" leftIcon={<Check size={14} />} isLoading={busy} onClick={() => decide(u, 'approve')}>Approve</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={!!rejecting} onClose={() => setRejecting(null)} title="Reject this update"
        footer={<><Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
          <Button variant="primary" disabled={!reason.trim()} isLoading={busy} onClick={() => rejecting && decide(rejecting, 'reject')}>Reject update</Button></>}>
        <Textarea label="Reason" id="rejectReason" value={reason} onChange={setReason} placeholder="What needs to be fixed or re-photographed?" />
      </Modal>
    </div>
  );
}
