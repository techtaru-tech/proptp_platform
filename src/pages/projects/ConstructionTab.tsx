import { Link } from 'react-router-dom';
import { ArrowRight, MapPin } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { formatDate, formatDateTime } from '../../utils/format';
import { fileUrl } from '../../services/apiClient';
import { getConstructionProject, listProgressUpdates, listSiteIssues } from '../../services/constructionService';
import { BehindBadge, PlanVsActual } from '../construction/PlanVsActual';
import { ActivityStatusBadge, STATUS_META, StatusLegend } from '../construction/ActivityStatus';
import { cn } from '../../utils/cn';

/**
 * Where a project's construction stands, read-only, on the project page itself: the plan against
 * what the site has reported, who is on which activity, the latest updates with their photos, and
 * open issues. Everything is derived by the construction module; editing the schedule and
 * reviewing updates stay there, one link away.
 */
export function ConstructionTab({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useAsync(
    () => Promise.all([getConstructionProject(projectId), listProgressUpdates('all', projectId), listSiteIssues('open', projectId)]),
    [projectId],
  );

  if (error) return <ErrorState title="Could not load construction progress" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;
  const [bundle, updates, issues] = data;
  const pending = updates.filter((u) => u.status === 'pending').length;

  if (bundle.activities.length === 0) {
    return (
      <EmptyState
        title="No construction schedule yet"
        description="Add the phases and activities with their planned dates, and site staff report progress against them from the app."
        action={<Link to={`/construction/${projectId}`}><Button variant="primary">Set up the schedule</Button></Link>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Whole project</p>
          <p className="text-3xl font-semibold tabular-nums text-ink">{bundle.summary.actual}%</p>
          <p className="text-sm text-ink-muted">complete · plan says {bundle.summary.planned}% · {bundle.summary.activities} activities</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <BehindBadge days={bundle.summary.daysBehind} />
          {pending > 0 && (
            <Link to={`/construction/reviews?projectId=${projectId}`} className="text-xs font-medium text-brand-700">
              {pending} update{pending === 1 ? '' : 's'} waiting for review
            </Link>
          )}
          <Link to={`/construction/${projectId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
            Open the full schedule <ArrowRight size={12} />
          </Link>
        </div>
      </div>
      <PlanVsActual planned={bundle.summary.planned} actual={bundle.summary.actual} />

      {bundle.blocks.length > 1 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">By block</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bundle.blocks.map((b) => (
              <div key={b.name} className="rounded-xl border border-line p-3">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-ink">{b.name || 'No block'}</span>
                  <span className="tabular-nums text-ink-muted">{b.actual}% / plan {b.planned}%</span>
                </div>
                <PlanVsActual planned={b.planned} actual={b.actual} />
                <div className="mt-1"><BehindBadge days={b.daysBehind} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">Activities</h3>
        <StatusLegend className="mb-2" />
        <ul className="divide-y divide-line rounded-xl border border-line">
          {bundle.activities.map((a) => (
            <li key={a.id} className={cn('grid grid-cols-1 gap-2 border-l-4 px-4 py-3 md:grid-cols-[1.5fr_1fr_1.2fr] md:items-center md:gap-4', STATUS_META[a.status].edge)}>
              <div>
                <p className="font-medium text-ink">{a.name}</p>
                <div className="my-0.5"><ActivityStatusBadge status={a.status} pendingBlockers={a.pendingBlockers} /></div>
                <p className="text-xs text-ink-muted">
                  {formatDate(a.plannedStart)} → {formatDate(a.plannedEnd)}
                  {[a.block, a.phase].filter(Boolean).length ? ` · ${[a.block, a.phase].filter(Boolean).join(' · ')}` : ''}
                </p>
              </div>
              <p className="text-sm text-ink-muted">{a.assigneeName ?? <span className="text-ink-faint">Unassigned</span>}</p>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="tabular-nums text-ink">{a.actual}% <span className="text-ink-faint">/ plan {a.planned}%</span></span>
                  <BehindBadge days={a.daysBehind} />
                </div>
                <PlanVsActual planned={a.planned} actual={a.actual} status={a.status} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">Latest updates from site</h3>
        {updates.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing reported from site yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {updates.slice(0, 5).map((u) => (
              <div key={u.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{u.activityName}{u.block ? <span className="font-normal text-ink-muted"> · {u.block}</span> : null}</p>
                    <p className="text-xs text-ink-muted">{u.authorName} · taken {formatDateTime(u.capturedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-semibold tabular-nums">{u.percentComplete}%</span>
                    <Badge tone={u.status === 'approved' ? 'success' : u.status === 'rejected' ? 'danger' : 'warning'}>{u.status}</Badge>
                  </div>
                </div>
                <p className="mt-2 text-sm text-ink">{u.workDone}</p>
                {u.rejectionReason && <p className="mt-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">Rejected: {u.rejectionReason}</p>}
                {u.photos.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {u.photos.map((p) => (
                      <a key={p.id} href={fileUrl(p.url)} target="_blank" rel="noreferrer" title={`${formatDateTime(p.takenAt)} · ${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`}>
                        <img src={fileUrl(p.url)} alt={`Site photo for ${u.activityName}`} className="h-20 w-28 rounded-lg border border-line object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {updates.length > 5 && (
              <Link to={`/construction/reviews?projectId=${projectId}`} className="text-sm font-medium text-brand-700">See all {updates.length} updates</Link>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Open site issues</h3>
          <Link to="/construction/issues" className="text-xs font-medium text-brand-700">All issues</Link>
        </div>
        {issues.length === 0 ? (
          <p className="text-sm text-ink-muted">No open issues.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {issues.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="font-medium text-ink">{i.title}</p>
                  <p className="text-xs text-ink-muted">
                    {i.activityName ? `${i.activityName} · ` : ''}raised by {i.raisedByName} · {i.ownerName ? `with ${i.ownerName}` : 'unassigned'}
                    {i.dueDate ? ` · due ${formatDate(i.dueDate)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {i.overdue && <Badge tone="danger">Overdue</Badge>}
                  <Badge tone={i.status === 'in_progress' ? 'info' : 'warning'}>{i.status === 'in_progress' ? 'In progress' : 'Open'}</Badge>
                  {i.photos.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-ink-faint"><MapPin size={11} />{i.photos.length} photo{i.photos.length === 1 ? '' : 's'}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
