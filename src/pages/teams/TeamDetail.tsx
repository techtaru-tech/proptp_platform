import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LayoutList, Network, Search } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { StatCard } from '../../components/ui/StatCard';
import { SearchInput } from '../../components/ui/SearchInput';
import { UserCard } from '../../components/ui/UserCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { Button } from '../../components/ui/Button';
import { useAsync } from '../../hooks/useAsync';
import { getTeam, getTeamTree, getTeamMembers } from '../../services/teamService';
import { roleLabel } from '../../services/userService';
import type { TeamTreeNode } from '../../types';

type ViewMode = 'tree' | 'list';

export function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('tree');
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const { data: team, isLoading, error } = useAsync(() => getTeam(id ?? ''), [id, reloadKey]);
  const { data: tree } = useAsync(() => (team ? getTeamTree(team.leaderId) : Promise.resolve(undefined)), [team?.leaderId]);
  const { data: members } = useAsync(() => (team ? getTeamMembers(team.id) : Promise.resolve([])), [team?.id]);

  const filteredMembers = useMemo(() => {
    const list = members ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m && m.name.toLowerCase().includes(q));
  }, [members, search]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Team Details" breadcrumb={[{ label: 'Teams', to: '/teams' }, { label: id ?? '' }]} />
        <CardSkeleton />
      </div>
    );
  }

  if (error || !team) {
    return (
      <div>
        <PageHeader title="Team Details" breadcrumb={[{ label: 'Teams', to: '/teams' }, { label: id ?? '' }]} />
        <Card>
          {error ? (
            <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <EmptyState
              title="Team not found"
              description="This team does not exist or may have been removed."
              action={
                <Button variant="outline" onClick={() => navigate('/teams')}>
                  Back to Teams
                </Button>
              }
            />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={team.name}
        breadcrumb={[{ label: 'Teams', to: '/teams' }, { label: team.name }]}
        description={
          <Link to={`/users/${team.leaderId}`} className="text-brand-600 hover:text-brand-700 focus-ring rounded">
            View team leader profile →
          </Link>
        }
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-line-strong bg-white p-0.5">
            <button
              type="button"
              onClick={() => setView('tree')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-ring ${
                view === 'tree' ? 'bg-navy-800 text-white' : 'text-ink-faint hover:text-ink'
              }`}
            >
              <Network size={13} /> Tree
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-ring ${
                view === 'list' ? 'bg-navy-800 text-white' : 'text-ink-faint hover:text-ink'
              }`}
            >
              <LayoutList size={13} /> List
            </button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Members" value={team.memberIds.length} tone="navy" />
        <StatCard label="Team Size (Leader)" value={tree?.teamSize ?? '—'} tone="brand" />
        <StatCard label="Direct Reports" value={tree?.children.length ?? '—'} tone="accent" />
        <StatCard label="Created" value={new Date(team.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} tone="neutral" />
      </div>

      {view === 'tree' ? (
        <Card>
          <CardHeader title="Team Hierarchy" subtitle="Leader and downline structure — expand branches to explore" />
          {tree ? (
            <div className="rounded-lg border border-line p-2">
              <TeamNode node={tree} depth={0} />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Loading team structure...</p>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Team Members" subtitle="All members belonging to this team" />
          <div className="mb-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search members..." className="w-64" />
          </div>
          {filteredMembers.length === 0 ? (
            <EmptyState icon={Search} title="No members found" description="Try a different search term." />
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredMembers.map((m) =>
                m ? <UserCard key={m.id} name={m.name} role={m.role} status={m.status} avatarUrl={m.avatarUrl} to={`/users/${m.id}`} /> : null
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function TeamNode({ node, depth }: { node: TeamTreeNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-2.5 rounded-lg py-1.5 pr-2 hover:bg-surface-subtle"
        style={{ paddingLeft: `${depth * 22 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint focus-ring"
          >
            {expanded ? '−' : '+'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Link to={`/users/${node.userId}`} className="flex flex-1 items-center gap-2.5 focus-ring rounded">
          <Avatar name={node.name} size="xs" />
          <span className="text-sm font-medium text-ink">{node.name}</span>
          <span className="text-xs text-ink-faint">{roleLabel(node.role)}</span>
          <StatusBadge kind="account" status={node.status} dot={false} />
          {node.teamSize > 0 && <span className="text-xs text-ink-faint">({node.teamSize})</span>}
        </Link>
      </div>
      {expanded && node.children.map((child) => <TeamNode key={child.userId} node={child} depth={depth + 1} />)}
    </div>
  );
}
