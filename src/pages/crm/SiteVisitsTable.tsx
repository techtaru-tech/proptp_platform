import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check, UserX, Users, X } from 'lucide-react';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../context/ToastContext';
import { confirmVisit, markNoShow, OUTCOME_LABEL, type SiteVisit, type VisitStatus } from '../../services/siteVisitService';
import { CancelModal, CompleteModal, RescheduleModal } from '../../components/leads/VisitModals';
import { TemperatureBadge } from '../../components/leads/TemperatureBadge';
import { cn } from '../../utils/cn';

/**
 * The visits screen's own list: one dense row per visit with every action a visit can take.
 * The lead page keeps the shared card list (components/leads/VisitList); this one is a table
 * because here the eye runs down a day's schedule, not through one buyer's history.
 */

const TONE: Record<VisitStatus, BadgeTone> = { scheduled: 'info', confirmed: 'success', done: 'success', cancelled: 'neutral', no_show: 'danger' };
const LABEL: Record<VisitStatus, string> = { scheduled: 'Scheduled', confirmed: 'Confirmed', done: 'Done', cancelled: 'Cancelled', no_show: 'No-show' };

export const visitTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const visitDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });

const TH = 'whitespace-nowrap px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-ink-subtle';

export function SiteVisitsTable({ visits, onChanged, empty }: {
  visits: SiteVisit[];
  onChanged: () => void;
  empty: { title: string; description?: string };
}) {
  const { toast } = useToast();
  const [dlg, setDlg] = useState<{ kind: 'complete' | 'reschedule' | 'cancel'; visit: SiteVisit } | null>(null);
  const close = () => setDlg(null);
  const done = () => { setDlg(null); onChanged(); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, variant: 'success' }); onChanged(); } catch (e) { toast({ title: 'That did not work', description: (e as Error).message, variant: 'error' }); }
  };

  if (visits.length === 0) return <EmptyState icon={CalendarClock} title={empty.title} description={empty.description} />;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line bg-surface-subtle">
              <th className={cn(TH, 'pl-4')}>Lead</th>
              <th className={TH}>Project</th>
              <th className={TH}>When</th>
              <th className={cn(TH, 'text-right')}>Visitors</th>
              <th className={TH}>Host</th>
              <th className={TH}>Status</th>
              <th className={TH}>Outcome</th>
              <th className={cn(TH, 'pr-4 text-right')}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => {
              const open = v.status === 'scheduled' || v.status === 'confirmed';
              return (
                <tr key={v.id} className="border-b border-line align-top transition-colors duration-100 last:border-0 hover:bg-surface-subtle">
                  <td className="py-2 pl-4 pr-3">
                    <Link to={`/crm/leads/${v.leadId}`} className="font-medium text-ink hover:text-brand-700 focus-ring">{v.leadName}</Link>
                    <span className="block text-xs tabular-nums text-ink-faint">{v.leadPhone}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{v.projectName}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="block text-ink">{visitDate(v.scheduledAt)}</span>
                    <span className="block text-xs tabular-nums text-ink-faint">{visitTime(v.scheduledAt)}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    <span className="inline-flex items-center gap-1"><Users size={12} className="text-ink-faint" aria-hidden="true" />{v.visitorCount}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {v.hostName ? (
                      <span className="inline-flex items-center gap-2"><Avatar name={v.hostName} size="xs" /><span className="text-ink">{v.hostName}</span></span>
                    ) : <span className="text-ink-faint">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge tone={TONE[v.status]}>{LABEL[v.status]}</Badge>
                      {v.needsOutcome && <Badge tone="warning">Needs outcome</Badge>}
                    </span>
                  </td>
                  <td className="max-w-[260px] px-3 py-2">
                    <Outcome visit={v} />
                  </td>
                  <td className="py-2 pl-3 pr-4">
                    {open && (
                      <span className="flex items-center justify-end gap-1">
                        {v.status === 'scheduled' && (
                          <Button variant="outline" size="sm" leftIcon={<Check size={12} />} onClick={() => run(() => confirmVisit(v.id), 'Visit confirmed')}>Confirm</Button>
                        )}
                        <Button variant="primary" size="sm" onClick={() => setDlg({ kind: 'complete', visit: v })}>Record outcome</Button>
                        <IconAction label="Reschedule" onClick={() => setDlg({ kind: 'reschedule', visit: v })}><CalendarClock size={14} /></IconAction>
                        <IconAction label="Mark as no-show" onClick={() => run(() => markNoShow(v.id), 'Marked as no-show')}><UserX size={14} /></IconAction>
                        <IconAction label="Cancel visit" danger onClick={() => setDlg({ kind: 'cancel', visit: v })}><X size={14} /></IconAction>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dlg?.kind === 'complete' && <CompleteModal visit={dlg.visit} onClose={close} onSaved={done} />}
      {dlg?.kind === 'reschedule' && <RescheduleModal visit={dlg.visit} onClose={close} onSaved={done} />}
      {dlg?.kind === 'cancel' && <CancelModal visit={dlg.visit} onClose={close} onSaved={done} />}
    </>
  );
}

/** How it went: the outcome and interest for a done visit, the reason for a cancelled one. */
function Outcome({ visit: v }: { visit: SiteVisit }) {
  if (v.status === 'done') {
    return (
      <div className="space-y-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          {v.outcome ? <span className="font-medium text-ink">{OUTCOME_LABEL[v.outcome]}</span> : <span className="text-ink-faint">No outcome noted</span>}
          {v.interest && <TemperatureBadge value={v.interest} />}
        </span>
        {v.feedback && <span className="block truncate text-xs text-ink-muted" title={v.feedback}>“{v.feedback}”</span>}
        {v.nextAction && <span className="block truncate text-xs text-ink-subtle" title={v.nextAction}>Next: {v.nextAction}</span>}
      </div>
    );
  }
  if (v.status === 'cancelled') {
    return v.cancelReason
      ? <span className="block truncate text-xs text-ink-muted" title={v.cancelReason}>{v.cancelReason}</span>
      : <span className="text-ink-faint">—</span>;
  }
  if (v.status === 'no_show') return <span className="text-xs text-ink-muted">Did not turn up</span>;
  return <span className="text-ink-faint">—</span>;
}

function IconAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors duration-100 focus-ring',
        danger ? 'hover:bg-danger-50 hover:text-danger-600' : 'hover:bg-surface-muted hover:text-ink'
      )}
    >
      {children}
    </button>
  );
}
