import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Handshake } from 'lucide-react';
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
import { Panel, PanelHeader } from '../dashboard/widgets';
import { cn } from '../../utils/cn';

/**
 * The reporting tree, as far down as the signed-in person may see: Leader → Team Leader →
 * Employee → Agent, with each person's lead counts. A Leader sees the whole tree, a Team Leader
 * their own branch, an Employee just themselves.
 *
 * Channel partners nobody manages sit outside the tree; they are listed in their own group under
 * it, closed by default, so the reporting lines stay the thing you read first.
 */

const ROLE_LABEL: Record<AccountRole, string> = {
  admin: 'Admin',
  leader: 'Leader',
  team_leader: 'Team Leader',
  employee: 'Employee',
  channel_partner: 'Channel partner',
};

const ROLE_TONE: Record<AccountRole, BadgeTone> = {
  admin: 'neutral',
  leader: 'brand',
  team_leader: 'accent',
  employee: 'shell',
  channel_partner: 'info',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ids of everyone who has somebody under them, at any depth. */
const withReports = (nodes: TeamNode[]): string[] => nodes.flatMap((n) => (n.children.length ? [n.id, ...withReports(n.children)] : []));

export function TeamHierarchy() {
  const { data, isLoading, error } = useAsync(() => getTeamView(), []);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [partnersOpen, setPartnersOpen] = useState(false);

  if (error) return <ErrorState title="Could not load the team" description={error.message} />;
  if (isLoading || !data) return <CardSkeleton />;

  const roots = buildTeamTree(data.members);
  const loosePartner = (n: TeamNode) => n.role === 'channel_partner' && n.children.length === 0;
  const org = roots.filter((n) => !loosePartner(n));
  const partners = roots.filter(loosePartner);
  const branchIds = withReports(org);

  const count = (role: AccountRole) => data.members.filter((m) => m.role === role).length;
  const composition = (['leader', 'team_leader', 'employee'] as const)
    .map((r) => [r, count(r)] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => plural(n, ROLE_LABEL[r]))
    .join(' · ');

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

      {roots.length === 0 ? (
        <Card>
          <EmptyState title="Nobody to show" description="Once people are placed under a manager they appear here." />
        </Card>
      ) : (
        <>
          {org.length > 0 && (
            <Panel>
              <PanelHeader
                title="Reporting lines"
                meta={composition}
                action={
                  branchIds.length > 0 && (
                    <span className="flex items-center gap-0.5">
                      <TreeAction disabled={collapsed.size === 0} onClick={() => setCollapsed(new Set())}>Expand all</TreeAction>
                      <TreeAction disabled={branchIds.every((id) => collapsed.has(id))} onClick={() => setCollapsed(new Set(branchIds))}>Collapse all</TreeAction>
                    </span>
                  )
                }
              />
              <div className="overflow-x-auto px-4 py-3">
                <ul role="tree" aria-label="Reporting hierarchy" className="flex flex-col gap-2.5">
                  {org.map((node) => (
                    <Branch key={node.id} node={node} depth={0} me={data.me} collapsed={collapsed} onToggle={toggle} />
                  ))}
                </ul>
              </div>
            </Panel>
          )}

          {partners.length > 0 && (
            <section className={cn('overflow-hidden rounded-xl border border-line bg-surface', org.length > 0 && 'mt-3')}>
              <button
                type="button"
                aria-expanded={partnersOpen}
                onClick={() => setPartnersOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors duration-100 hover:bg-surface-subtle focus-ring"
              >
                {partnersOpen ? <ChevronDown size={14} className="shrink-0 text-ink-subtle" /> : <ChevronRight size={14} className="shrink-0 text-ink-subtle" />}
                <Handshake size={14} className="shrink-0 text-info-600" aria-hidden="true" />
                <span className="text-[13px] font-semibold text-ink">Channel partners</span>
                <span className="rounded-sm bg-surface-muted px-1.5 text-2xs font-semibold tabular-nums text-ink-muted">{partners.length}</span>
                <span className="hidden truncate text-xs text-ink-subtle sm:inline">
                  Not placed under a manager
                  {partners.some((p) => p.status !== 'active') && ` · ${partners.filter((p) => p.status !== 'active').length} inactive or suspended`}
                </span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-subtle">
                  {plural(partners.reduce((s, p) => s + p.leads.own, 0), 'lead')}
                </span>
              </button>
              {partnersOpen && (
                <ul className="grid gap-1.5 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {partners.map((p) => (
                    <li key={p.id} className="min-w-0">
                      <Node node={p} me={data.me} className="w-full" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TreeAction({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded px-1.5 py-0.5 text-xs font-medium text-ink-subtle transition-colors duration-100 hover:bg-surface-muted hover:text-ink focus-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/*
 * Connector geometry. A node is 34px tall (24px avatar, 4px padding, hairline border) and sits
 * 6px below the top of its row, so its middle is 23px down. Each row draws its own stretch of
 * the vertical guide (the last row stops at its elbow) and a short arm across to the node; the
 * child list is pulled in 16px so the guide drops from the middle of the parent's avatar.
 */
const ROW = 'relative pl-[22px] pt-1.5';
const GUIDE = "before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-line-strong before:content-[''] last:before:h-[23px]";
const ARM = "after:absolute after:left-0 after:top-[23px] after:h-px after:w-[18px] after:bg-line-strong after:content-['']";

function Branch({ node, depth, me, collapsed, onToggle }: {
  node: TeamNode;
  depth: number;
  me: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}) {
  const hasReports = node.children.length > 0;
  const open = hasReports && !collapsed.has(node.id);
  return (
    <li
      role="treeitem"
      aria-expanded={hasReports ? open : undefined}
      aria-selected={node.id === me}
      className={cn(depth > 0 && cn(ROW, GUIDE, ARM))}
    >
      <Node
        node={node}
        me={me}
        toggle={hasReports ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={`${open ? 'Hide' : 'Show'} ${node.name}'s reports`}
            className="-my-0.5 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-2xs font-medium tabular-nums text-ink-subtle transition-colors duration-100 hover:bg-surface-muted hover:text-ink focus-ring"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {plural(node.children.length, 'report')}
          </button>
        ) : undefined}
      />
      {open && (
        <ul role="group" className="ml-4">
          {node.children.map((child) => (
            <Branch key={child.id} node={child} depth={depth + 1} me={me} collapsed={collapsed} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** "149 leads (19 own) · 20 won": the team's total, what is theirs alone, and how many closed. */
function leadLine(n: TeamNode) {
  if (!n.leads.team) return 'No leads';
  const own = n.children.length > 0 && n.leads.own !== n.leads.team ? ` (${n.leads.own} own)` : '';
  return `${plural(n.leads.team, 'lead')}${own} · ${n.leads.won} won`;
}

/** One person as a compact pill: who they are, their role, and the leads under them. */
function Node({ node, me, toggle, className }: { node: TeamNode; me: string; toggle?: ReactNode; className?: string }) {
  const isMe = node.id === me;
  return (
    <div
      className={cn(
        'inline-flex min-h-[34px] max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-line bg-surface py-1 pl-1 pr-2.5',
        isMe && 'shadow-[inset_0_0_0_1px_var(--c-brand-600)]',
        className
      )}
    >
      <Avatar name={node.name} src={node.avatarUrl} size="xs" />
      <Link
        to={`/crm/leads?assignedUserId=${encodeURIComponent(node.id)}`}
        className="min-w-0 truncate rounded text-[13px] font-medium text-ink hover:text-brand-700 focus-ring"
        title={`${node.name}: view their leads`}
      >
        {node.name}
      </Link>
      {isMe && <span className="text-xs text-ink-faint">(you)</span>}
      <Badge tone={ROLE_TONE[node.role]}>{ROLE_LABEL[node.role]}</Badge>
      {node.status !== 'active' && <Badge tone={node.status === 'suspended' ? 'danger' : 'neutral'}>{node.status.charAt(0).toUpperCase() + node.status.slice(1)}</Badge>}
      <span
        className={cn('whitespace-nowrap text-xs tabular-nums', node.leads.team ? 'text-ink-subtle' : 'text-ink-faint')}
        title={`Own ${node.leads.own} · Team ${node.leads.team} · Won ${node.leads.won}`}
      >
        {leadLine(node)}
      </span>
      {toggle}
    </div>
  );
}
