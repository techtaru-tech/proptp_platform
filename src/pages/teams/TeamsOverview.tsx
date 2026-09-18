import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutList, Network, Search, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { SearchInput } from '../../components/ui/SearchInput';
import { Avatar } from '../../components/ui/Avatar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { UserCard } from '../../components/ui/UserCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useDebounce } from '../../hooks/useDebounce';
import { listTeams, getTeamTree } from '../../services/teamService';
import { roleLabel } from '../../services/userService';
import { refUsers } from '../../data/referenceData';
import type { TeamTreeNode } from '../../types';

type ViewMode = 'tree' | 'list';

export function TeamsOverview() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('tree');
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const debouncedSearch = useDebounce(search, 250);

  const { data: teams, isLoading, error } = useAsync(() => listTeams(), [reloadKey]);

  const filteredTeams = useMemo(() => {
    if (!teams) return [];
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => t.name.toLowerCase().includes(q));
  }, [teams, debouncedSearch]);

  const filteredMembers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return refUsers;
    return refUsers.filter((u) => u.name.toLowerCase().includes(q));
  }, [debouncedSearch]);

  return (
    <div>
      <PageHeader
        title="Teams / Referrals"
        description="Leader-led teams, employee networks and agent referral structures."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-line-strong bg-white p-0.5">
            <button
              type="button"
              onClick={() => setView('tree')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-ring ${
                view === 'tree' ? 'bg-shell-800 text-white' : 'text-ink-faint hover:text-ink'
              }`}
            >
              <Network size={13} /> Tree View
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-ring ${
                view === 'list' ? 'bg-shell-800 text-white' : 'text-ink-faint hover:text-ink'
              }`}
            >
              <LayoutList size={13} /> List View
            </button>
          </div>
        }
      />

      <div className="mb-5">
        <SearchInput value={search} onChange={setSearch} placeholder="Search teams or members..." className="w-72" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <Card>
          <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />
        </Card>
      ) : view === 'list' ? (
        filteredMembers.length === 0 ? (
          <Card>
            <EmptyState icon={Search} title="No members found" description="Try a different search term." />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredMembers.map((u) => (
              <UserCard key={u.id} name={u.name} role={u.role} status={u.status} avatarUrl={u.avatarUrl} to={`/users/${u.id}`} />
            ))}
          </div>
        )
      ) : filteredTeams.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No teams found" description="Try a different search term." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredTeams.map((team) => (
            <TeamCard key={team.id} teamId={team.id} teamName={team.name} leaderId={team.leaderId} memberCount={team.memberIds.length} onOpen={() => navigate(`/teams/${team.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamCard({
  teamId,
  teamName,
  leaderId,
  memberCount,
  onOpen,
}: {
  teamId: string;
  teamName: string;
  leaderId: string;
  memberCount: number;
  onOpen: () => void;
}) {
  const { data: tree } = useAsync(() => getTeamTree(leaderId), [leaderId]);

  return (
    <Card>
      <CardHeader
        title={
          <button onClick={onOpen} className="text-left hover:text-brand-600 focus-ring rounded">
            {teamName}
          </button>
        }
        subtitle={`${memberCount} member${memberCount === 1 ? '' : 's'}`}
        action={
          <button onClick={onOpen} className="text-xs font-medium text-brand-600 hover:text-brand-700 focus-ring rounded">
            Open →
          </button>
        }
      />
      {tree ? (
        <div className="space-y-1">
          <TreeRoot node={tree} teamId={teamId} />
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Loading team structure...</p>
      )}
    </Card>
  );
}

function TreeRoot({ node }: { node: TeamTreeNode; teamId: string }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 text-left hover:bg-surface-subtle focus-ring"
      >
        <Avatar name={node.name} size="xs" />
        <span className="text-sm font-medium text-ink">{node.name}</span>
        <span className="text-xs text-ink-faint">{roleLabel(node.role)}</span>
        <StatusBadge kind="account" status={node.status} dot={false} />
        {node.children.length > 0 && <span className="ml-auto text-xs text-ink-faint">{expanded ? '−' : '+'}</span>}
      </button>
      {expanded && node.children.slice(0, 6).map((child) => <TreeChild key={child.userId} node={child} depth={1} />)}
      {expanded && node.children.length > 6 && (
        <p className="ml-8 text-xs text-ink-faint">+ {node.children.length - 6} more</p>
      )}
    </div>
  );
}

function TreeChild({ node, depth }: { node: TeamTreeNode; depth: number }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 rounded-lg py-1.5 pr-2 hover:bg-surface-subtle" style={{ paddingLeft: `${depth * 22 + 8}px` }}>
        <Avatar name={node.name} size="xs" />
        <span className="text-sm text-ink">{node.name}</span>
        <span className="text-xs text-ink-faint">{roleLabel(node.role)}</span>
        <StatusBadge kind="account" status={node.status} dot={false} />
      </div>
    </div>
  );
}
