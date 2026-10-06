import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check, Users, X } from 'lucide-react';
import { Badge, type BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/format';
import { confirmVisit, markNoShow, OUTCOME_LABEL, type SiteVisit, type VisitStatus } from '../../services/siteVisitService';
import { CancelModal, CompleteModal, RescheduleModal } from './VisitModals';
import { TemperatureBadge } from './TemperatureBadge';

const TONE: Record<VisitStatus, BadgeTone> = { scheduled: 'info', confirmed: 'success', done: 'success', cancelled: 'neutral', no_show: 'danger' };
const LABEL: Record<VisitStatus, string> = { scheduled: 'Scheduled', confirmed: 'Confirmed', done: 'Done', cancelled: 'Cancelled', no_show: 'No-show' };

/** A list of visits with every action a visit can take. Shared by the visits screen and a lead's own page. */
export function VisitList({ visits, showLead = true, onChanged, empty }: { visits: SiteVisit[]; showLead?: boolean; onChanged: () => void; empty?: string }) {
  const { toast } = useToast();
  const [dlg, setDlg] = useState<{ kind: 'complete' | 'reschedule' | 'cancel'; visit: SiteVisit } | null>(null);
  const close = () => setDlg(null);
  const done = () => { setDlg(null); onChanged(); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: 'success' }); onChanged(); } catch (e) { toast({ title: 'That did not work', description: (e as Error).message, variant: 'error' }); }
  };

  if (visits.length === 0) return <EmptyState icon={CalendarClock} title={empty ?? 'No site visits'} />;
  return (
    <>
      <ul className="divide-y divide-line">
        {visits.map((v) => {
          const open = v.status === 'scheduled' || v.status === 'confirmed';
          return (
            <li key={v.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {showLead ? <Link to={`/crm/leads/${v.leadId}`} className="hover:text-brand-700">{v.leadName}</Link> : <span>{v.projectName}</span>}
                  <Badge tone={TONE[v.status]}>{LABEL[v.status]}</Badge>
                  {v.needsOutcome && <Badge tone="warning">Needs outcome</Badge>}
                </p>
                <p className="text-sm text-ink-muted">{showLead ? `${v.projectName} · ` : ''}{formatDateTime(v.scheduledAt)} · <Users size={12} className="mb-0.5 inline" /> {v.visitorCount} · host {v.hostName ?? 'unassigned'}{showLead ? ` · ${v.leadPhone}` : ''}</p>
                {v.status === 'done' && (
                  <p className="mt-1 text-sm text-ink">
                    {v.outcome && <strong>{OUTCOME_LABEL[v.outcome]}</strong>} {v.interest && <TemperatureBadge value={v.interest} />}
                    {v.feedback && <span className="block text-ink-muted">“{v.feedback}”</span>}
                    {v.nextAction && <span className="block text-xs text-ink-muted">Next: {v.nextAction}</span>}
                  </p>
                )}
                {v.status === 'cancelled' && v.cancelReason && <p className="mt-1 text-sm text-ink-muted">Cancelled: {v.cancelReason}</p>}
              </div>
              {open && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {v.status === 'scheduled' && <Button variant="outline" size="sm" leftIcon={<Check size={12} />} onClick={() => run(() => confirmVisit(v.id), 'Visit confirmed')}>Confirm</Button>}
                  <Button variant="primary" size="sm" onClick={() => setDlg({ kind: 'complete', visit: v })}>Record outcome</Button>
                  <Button variant="ghost" size="sm" onClick={() => setDlg({ kind: 'reschedule', visit: v })}>Reschedule</Button>
                  <Button variant="ghost" size="sm" onClick={() => run(() => markNoShow(v.id), 'Marked as no-show')}>No-show</Button>
                  <Button variant="ghost" size="sm" className="text-danger-600" leftIcon={<X size={12} />} onClick={() => setDlg({ kind: 'cancel', visit: v })}>Cancel</Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {dlg?.kind === 'complete' && <CompleteModal visit={dlg.visit} onClose={close} onSaved={done} />}
      {dlg?.kind === 'reschedule' && <RescheduleModal visit={dlg.visit} onClose={close} onSaved={done} />}
      {dlg?.kind === 'cancel' && <CancelModal visit={dlg.visit} onClose={close} onSaved={done} />}
    </>
  );
}
