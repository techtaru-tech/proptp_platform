import { api } from './apiClient';
import type { AccountRole } from '../types';

/**
 * The CRM team as the signed-in person may see it (server/src/routes/crmTeam.ts): themselves
 * and everyone beneath them, or everybody for an administrator, each with their lead counts.
 */

export interface TeamMember {
  id: string;
  name: string;
  role: AccountRole;
  status: 'active' | 'inactive' | 'suspended';
  phone: string;
  email?: string;
  avatarUrl?: string;
  /** Null when the manager is outside what the caller may see, or there is none. */
  managerId: string | null;
  managerName?: string;
  directReports: number;
  /** Everybody beneath them, at any depth. */
  teamSize: number;
  leads: {
    /** Assigned to this person directly. */
    own: number;
    /** Assigned to this person or anyone beneath them. */
    team: number;
    won: number;
  };
}

export interface TeamView {
  me: string;
  scope: 'all' | 'tree' | 'own';
  canAssign: boolean;
  /** Leads with no owner yet — only counted for those who may hand them out. */
  unassignedLeads: number;
  members: TeamMember[];
}

export async function getTeamView(): Promise<TeamView> {
  return api.get<TeamView>('/crm-team');
}

export interface TeamNode extends TeamMember {
  children: TeamNode[];
}

/** Assembles the flat member list into trees: one root per person whose manager is not in view. */
export function buildTeamTree(members: TeamMember[]): TeamNode[] {
  const byId = new Map<string, TeamNode>(members.map((m) => [m.id, { ...m, children: [] }]));
  const roots: TeamNode[] = [];
  for (const node of byId.values()) {
    const parent = node.managerId ? byId.get(node.managerId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // Leaders first, then by name, so the tree reads top-down the same way every time.
  const order: AccountRole[] = ['leader', 'team_leader', 'employee', 'agent', 'admin'];
  const sort = (nodes: TeamNode[]) => {
    nodes.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
