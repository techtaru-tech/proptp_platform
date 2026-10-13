import { Link } from 'react-router-dom';
import { AlertTriangle, ClipboardCheck, Flag, HardHat } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { listConstructionProjects } from '../../services/constructionService';
import { BehindBadge, PlanVsActual } from './PlanVsActual';

export function ConstructionHome() {
  const { data, isLoading, error } = useAsync(() => listConstructionProjects(), []);
  if (error) return <ErrorState title="Could not load construction" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;

  return (
    <div>
      <PageHeader title="Construction" description="Planned against actual progress for every project. Only approved site updates count." breadcrumb={[{ label: 'Construction' }]} />
      {data.length === 0 ? (
        <Card><EmptyState icon={HardHat} title="No projects yet" description="Add a project first, then set up its construction schedule." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <Link key={p.id} to={`/construction/${p.id}`} className="rounded-xl border border-line bg-white p-5 shadow-card transition-shadow hover:shadow-popover focus-ring">
              <h3 className="text-base font-semibold text-ink">{p.projectName}</h3>
              <p className="text-xs text-ink-muted">{p.projectLocation}</p>
              {p.activities === 0 ? (
                <p className="mt-5 text-sm text-ink-muted">No schedule set up yet.</p>
              ) : (
                <>
                  <div className="mt-5 flex items-end justify-between">
                    <div>
                      <p className="text-3xl font-semibold tabular-nums text-ink">{p.actual}%</p>
                      <p className="text-xs text-ink-muted">complete · plan {p.planned}%</p>
                    </div>
                    <BehindBadge days={p.daysBehind} />
                  </div>
                  <PlanVsActual planned={p.planned} actual={p.actual} className="mt-3" />
                </>
              )}
              <div className="mt-4 flex gap-4 text-xs text-ink-muted">
                <span className={p.pendingReviews ? 'flex items-center gap-1 font-medium text-brand-700' : 'flex items-center gap-1'}>
                  <ClipboardCheck size={13} /> {p.pendingReviews} to review
                </span>
                <span className={p.blockedActivities || p.pendingBlockers ? 'flex items-center gap-1 font-medium text-danger-700' : 'flex items-center gap-1'}>
                  <Flag size={13} /> {p.blockedActivities} blocked{p.pendingBlockers ? ` · ${p.pendingBlockers} to approve` : ''}
                </span>
                <span className={p.openIssues ? 'flex items-center gap-1 font-medium text-danger-700' : 'flex items-center gap-1'}>
                  <AlertTriangle size={13} /> {p.openIssues} open issue{p.openIssues === 1 ? '' : 's'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
