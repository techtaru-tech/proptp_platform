import { Link } from 'react-router-dom';
import { Inbox, Target, UserCheck, Users } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Badge } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeleton } from '../../components/ui/LoadingSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { buildTeamTree, getTeamView, type TeamNode } from '../../services/crmTeamService';
import { cn } from '../../utils/cn';

/**
 * The Team Leaders section of the CRM: every Team Leader the signed-in person may see, the
 * employees under them, and how many leads each one holds.
 *
 * It reads `/crm-team`, which applies the same hierarchy as the lead list, so a Leader sees
 * their Team Leaders, a Team Leader sees only their own team, and the counts here can never
 * disagree with what the Leads page shows for the same person.
 */

const leadsLink = (userId: string) => `/crm/leads?assignedUserId=${encodeURIComponent(userId)}`;

/** Every node in the tree that is a Team Leader, wherever it sits. */
function collectTeamLeaders(nodes: TeamNode[]): TeamNode[] {
  return nodes.flatMap((n) => [...(n.role === 'team_leader' ? [n] : []), ...collectTeamLeaders(n.children)]);
}

const ROLE: Record<string, string> = { employee: 'Employee', channel_partner: 'Agent', team_leader: 'Team Leader', leader: 'Leader', admin: 'Admin' };
const rate = (won: number, leads: number) => (leads ? `${Math.round((won / leads) * 100)}%` : '—');
/** Zero reads quieter than a real count. */
const num = (n: number) => (n ? n : <span className="text-ink-faint">0</span>);

const TH = 'whitespace-nowrap px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-subtle';

export function TeamLeaders() {
  const { data, isLoading, error } = useAsync(() => getTeamView(), []);

  if (error) return <ErrorState title="Could not load the team" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;

  const leaders = collectTeamLeaders(buildTeamTree(data.members));
  const employees = leaders.reduce((sum, l) => sum + l.children.length, 0);
  const leadsHeld = leaders.reduce((sum, l) => sum + l.leads.team, 0);
  const wonHeld = leaders.reduce((sum, l) => sum + l.leads.won, 0);

  return (
    <div>
      <PageHeader
        title="Team Leaders"
        description="Each Team Leader, the people under them, and the leads they hold."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Team Leaders' }]}
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Team Leaders" value={leaders.length} icon={UserCheck} tone="brand"
          footer={`${leaders.filter((l) => l.children.length === 0).length} without a team yet`} />
        <StatCard label="People under them" value={employees} icon={Users} tone="shell"
          footer={leaders.length ? `${(employees / leaders.length).toFixed(1)} per Team Leader` : undefined} />
        <StatCard label="Leads in their teams" value={leadsHeld} icon={Target} tone="accent"
          footer={leadsHeld ? `${wonHeld} won · ${rate(wonHeld, leadsHeld)}` : undefined} />
        {data.canAssign && data.unassignedLeads > 0 ? (
          <StatCard
            label="Unassigned leads"
            value={data.unassignedLeads}
            icon={Inbox}
            tone="warning"
            footer={
              <Link to="/crm/leads?assignedUserId=none" className="text-xs font-medium text-brand-700 hover:underline">
                Hand them out →
              </Link>
            }
          />
        ) : (
          <StatCard label="Unassigned leads" value={0} icon={Inbox} tone="neutral" />
        )}
      </div>

      {leaders.length === 0 ? (
        <Card>
          <EmptyState
            title="No Team Leaders yet"
            description="Add a user with the Team Leader role and choose a Leader as their manager — they appear here straight away."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
          {leaders.map((leader) => <LeaderCard key={leader.id} leader={leader} />)}
        </div>
      )}
    </div>
  );
}

function LeaderCard({ leader }: { leader: TeamNode }) {
  const team = leader.children;
  const top = Math.max(1, ...team.map((m) => m.leads.team));
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex items-center gap-3 px-4 py-3">
        <Avatar name={leader.name} src={leader.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate font-sans text-[13px] font-semibold tracking-normal text-ink">{leader.name}</h3>
            <Badge tone={leader.status === 'active' ? 'success' : 'neutral'} dot>{leader.status}</Badge>
          </div>
          <p className="truncate text-xs text-ink-subtle">
            Team Leader{leader.managerName ? ` · reports to ${leader.managerName}` : ''}
          </p>
        </div>
        <Link
          to={leadsLink(leader.id)}
          className="shrink-0 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-100 hover:bg-surface-subtle focus-ring"
        >
          View leads
        </Link>
      </header>

      <dl className="grid grid-cols-4 divide-x divide-line border-y border-line bg-surface-subtle">
        <Figure label="Own leads" value={leader.leads.own} />
        <Figure label="Team leads" value={leader.leads.team} />
        <Figure label="Won" value={leader.leads.won} />
        <Figure label="Win rate" value={rate(leader.leads.won, leader.leads.team)} />
      </dl>

      {team.length === 0 ? (
        <p className="px-4 py-5 text-center text-[13px] text-ink-muted">No employees under this Team Leader yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left">
                <th className={cn(TH, 'pl-4')}>Team member <span className="font-normal normal-case tracking-normal text-ink-faint">({team.length})</span></th>
                <th className={TH}>Role</th>
                <th className={cn(TH, 'text-right')}>Leads</th>
                <th className={cn(TH, 'text-right')}>Won</th>
                <th className={cn(TH, 'pr-4')}><span className="sr-only">Links</span></th>
              </tr>
            </thead>
            <tbody>
              {team.map((member) => (
                <tr key={member.id} className="border-b border-line transition-colors duration-100 last:border-0 hover:bg-surface-subtle">
                  <td className="py-1.5 pl-4 pr-3">
                    <span className="flex items-center gap-2">
                      <Avatar name={member.name} src={member.avatarUrl} size="xs" />
                      <span className="truncate font-medium text-ink">{member.name}</span>
                      {member.status !== 'active' && <Badge tone="neutral">{member.status}</Badge>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-ink-muted">{ROLE[member.role] ?? member.role}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center justify-end gap-2">
                      <span className="hidden h-1 w-14 overflow-hidden rounded-sm bg-surface-muted sm:block" aria-hidden="true">
                        <span className="block h-full rounded-sm bg-brand-600" style={{ width: `${(member.leads.team / top) * 100}%` }} />
                      </span>
                      <span className="w-8 text-right tabular-nums">{num(member.leads.team)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num(member.leads.won)}</td>
                  <td className="py-1.5 pl-3 pr-4 text-right">
                    <Link to={leadsLink(member.id)} className="whitespace-nowrap rounded text-xs font-medium text-ink-subtle hover:text-brand-700 focus-ring">
                      View leads →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 px-3 py-2 sm:px-4">
      <dt className="truncate text-2xs text-ink-subtle">{label}</dt>
      <dd className="text-[15px] font-semibold leading-5 tabular-nums text-ink">{value}</dd>
    </div>
  );
}
