import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { buildTeamTree, getTeamView, type TeamNode } from '../../services/crmTeamService';
import type { AccountRole } from '../../types';

/**
 * The reporting tree, as far down as the signed-in person may see: Leader → Team Leader →
 * Employee → Agent, with each person's lead counts. A Leader sees the whole tree, a Team Leader
 * their own branch, an Employee just themselves.
 */

const ROLE_LABEL: Record<AccountRole, string> = {
  admin: 'Admin',
  leader: 'Leader',
  team_leader: 'Team Leader',
  employee: 'Employee',
  agent: 'Agent',
};

const ROLE_TONE: Record<AccountRole, BadgeTone> = {
  admin: 'neutral',
  leader: 'brand',
  team_leader: 'accent',
  employee: 'shell',
  agent: 'info',
};

export function TeamHierarchy() {
  const { data, isLoading, error } = useAsync(() => getTeamView(), []);

  if (error) return <ErrorState title="Could not load the team" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;

  const roots = buildTeamTree(data.members);

  return (
    <div>
      <PageHeader
        title="Team Hierarchy"
        description={
          data.scope === 'all'
            ? 'Everybody, from each Leader down. Whoever is not placed under a manager yet appears at the top level.'
            : data.scope === 'tree'
              ? 'You and everyone who reports to you, directly or through someone else.'
              : 'Where you sit in the team.'
        }
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Team Hierarchy' }]}
      />

      <Card padded={false}>
        {roots.length === 0 ? (
          <EmptyState title="Nobody to show" description="Once people are placed under a manager they appear here." />
        ) : (
          <div role="tree" aria-label="Reporting hierarchy" className="divide-y divide-line">
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
              <span>Person</span>
              <span className="w-16 text-right">Own</span>
              <span className="w-16 text-right">Team</span>
              <span className="w-16 text-right">Won</span>
            </div>
            {roots.map((node) => (
              <Branch key={node.id} node={node} depth={0} me={data.me} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Branch({ node, depth, me }: { node: TeamNode; depth: number; me: string }) {
  return (
    <div role="treeitem" aria-expanded={node.children.length > 0 ? true : undefined} aria-selected={node.id === me}>
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-2.5 hover:bg-surface-subtle">
        <span className="flex min-w-0 items-center gap-2.5" style={{ paddingLeft: `${depth * 28}px` }}>
          {depth > 0 && <span aria-hidden className="text-ink-faint">└</span>}
          <Avatar name={node.name} src={node.avatarUrl} size="sm" />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <Link to={`/crm/leads?assignedUserId=${encodeURIComponent(node.id)}`} className="truncate font-medium text-ink hover:text-brand-700">
                {node.name}
              </Link>
              {node.id === me && <span className="text-xs text-ink-faint">(you)</span>}
              <Badge tone={ROLE_TONE[node.role]}>{ROLE_LABEL[node.role]}</Badge>
              {node.status !== 'active' && <Badge tone="neutral">{node.status}</Badge>}
            </span>
            {node.children.length > 0 && (
              <span className="text-xs text-ink-muted">
                {node.children.length} direct {node.children.length === 1 ? 'report' : 'reports'}
              </span>
            )}
          </span>
        </span>
        <span className="w-16 text-right text-sm tabular-nums">{node.leads.own}</span>
        <span className="w-16 text-right text-sm font-medium tabular-nums">{node.leads.team}</span>
        <span className="w-16 text-right text-sm tabular-nums">{node.leads.won}</span>
      </div>
      {node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <Branch key={child.id} node={child} depth={depth + 1} me={me} />
          ))}
        </div>
      )}
    </div>
  );
}
