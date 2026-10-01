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

export function TeamLeaders() {
  const { data, isLoading, error } = useAsync(() => getTeamView(), []);

  if (error) return <ErrorState title="Could not load the team" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;

  const leaders = collectTeamLeaders(buildTeamTree(data.members));
  const employees = leaders.reduce((sum, l) => sum + l.children.length, 0);
  const leadsHeld = leaders.reduce((sum, l) => sum + l.leads.team, 0);

  return (
    <div>
      <PageHeader
        title="Team Leaders"
        description="Each Team Leader, the people under them, and the leads they hold."
        breadcrumb={[{ label: 'CRM', to: '/crm' }, { label: 'Team Leaders' }]}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Team Leaders" value={leaders.length} icon={UserCheck} tone="brand" />
        <StatCard label="People under them" value={employees} icon={Users} tone="shell" />
        <StatCard label="Leads in their teams" value={leadsHeld} icon={Target} tone="accent" />
        {data.canAssign && data.unassignedLeads > 0 ? (
          <StatCard
            label="Unassigned leads"
            value={data.unassignedLeads}
            icon={Inbox}
            tone="warning"
            footer={
              <Link to="/crm/leads?assignedUserId=none" className="text-xs font-medium text-brand-600 hover:text-brand-700">
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
        <div className="flex flex-col gap-4">
          {leaders.map((leader) => (
            <Card key={leader.id} padded={false}>
              <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
                <Avatar name={leader.name} src={leader.avatarUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-ink">{leader.name}</h3>
                    <Badge tone={leader.status === 'active' ? 'success' : 'neutral'} dot>
                      {leader.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-ink-muted">
                    {leader.managerName ? `Reports to ${leader.managerName} · ` : ''}
                    {leader.children.length} {leader.children.length === 1 ? 'person' : 'people'} in the team
                  </p>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <Figure label="Own leads" value={leader.leads.own} />
                  <Figure label="Team leads" value={leader.leads.team} />
                  <Figure label="Won" value={leader.leads.won} />
                </div>
                <Link
                  to={leadsLink(leader.id)}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-brand-300 focus-ring"
                >
                  View leads
                </Link>
              </div>

              {leader.children.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-muted">No employees under this Team Leader yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-faint">
                      <th className="px-5 py-2 font-medium">Team member</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 text-right font-medium">Leads</th>
                      <th className="px-3 py-2 text-right font-medium">Won</th>
                      <th className="px-5 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {leader.children.map((member) => (
                      <tr key={member.id} className="border-t border-line">
                        <td className="px-5 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <Avatar name={member.name} src={member.avatarUrl} size="xs" />
                            <span className="font-medium text-ink">{member.name}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-ink-muted">{member.role === 'employee' ? 'Employee' : 'Agent'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{member.leads.team}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{member.leads.won}</td>
                        <td className="px-5 py-2.5 text-right">
                          <Link to={leadsLink(member.id)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                            View leads
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}
