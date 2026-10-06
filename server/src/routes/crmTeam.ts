import { Router } from 'express';
import type { UserRole } from '@prisma/client';
import { prisma } from '../prisma';
import { scopeOf } from '../services/hierarchy';

/**
 * The CRM team view — /api/crm-team.
 *
 * Returns the people the caller may see in the reporting tree, each with their lead counts,
 * so the Team Leaders page and the hierarchy view are one query and cannot disagree with the
 * lead list about who owns what. The caller's own scope decides who appears:
 *
 *   administrator          everybody in the tree, plus anyone not yet placed under a manager
 *   leader / team leader   themselves and everyone beneath them
 *   employee / agent       themselves
 *
 * It is returned flat, with `managerId` on each row, and the page assembles the tree — a
 * flat list is what lets one component render both the Team Leaders table and the hierarchy.
 */
export const crmTeamRouter = Router();

const TREE_ROLES: UserRole[] = ['leader', 'team_leader', 'employee', 'channel_partner'];

crmTeamRouter.get('/', async (req, res, next) => {
  try {
    const scope = await scopeOf(req);

    const users = await prisma.user.findMany({
      where: scope.kind === 'all' ? { role: { in: TREE_ROLES } } : { id: { in: scope.userIds } },
      select: { id: true, name: true, role: true, status: true, reportingLeaderId: true, phone: true, email: true, avatarUrl: true },
      orderBy: [{ name: 'asc' }],
    });
    const ids = users.map((u) => u.id);

    // Lead counts per owner, in two grouped queries however large the team is.
    const [byOwner, wonByOwner, unassigned] = await Promise.all([
      prisma.lead.groupBy({ by: ['assignedUserId'], where: { assignedUserId: { in: ids } }, _count: { _all: true } }),
      prisma.lead.groupBy({ by: ['assignedUserId'], where: { assignedUserId: { in: ids }, status: 'won' }, _count: { _all: true } }),
      scope.seesUnassigned ? prisma.lead.count({ where: { assignedUserId: null } }) : Promise.resolve(0),
    ]);
    const own = new Map(byOwner.map((g) => [g.assignedUserId as string, g._count._all]));
    const won = new Map(wonByOwner.map((g) => [g.assignedUserId as string, g._count._all]));

    // Roll each person's count up through everyone beneath them.
    const children = new Map<string, string[]>();
    for (const u of users) {
      if (u.reportingLeaderId) children.set(u.reportingLeaderId, [...(children.get(u.reportingLeaderId) ?? []), u.id]);
    }
    const subtree = (id: string, seen = new Set<string>()): { leads: number; won: number; members: number } => {
      if (seen.has(id)) return { leads: 0, won: 0, members: 0 };
      seen.add(id);
      let leads = own.get(id) ?? 0;
      let wonCount = won.get(id) ?? 0;
      let members = 0;
      for (const child of children.get(id) ?? []) {
        const sub = subtree(child, seen);
        leads += sub.leads;
        wonCount += sub.won;
        members += 1 + sub.members;
      }
      return { leads, won: wonCount, members };
    };

    const byId = new Map(users.map((u) => [u.id, u]));
    res.json({
      me: scope.userId,
      scope: scope.kind,
      canAssign: scope.canAssign,
      unassignedLeads: unassigned,
      members: users.map((u) => {
        const rolled = subtree(u.id);
        return {
          id: u.id,
          name: u.name,
          role: u.role,
          status: u.status,
          phone: u.phone,
          email: u.email ?? undefined,
          avatarUrl: u.avatarUrl ?? undefined,
          // Hidden when the manager is outside what the caller may see: a Team Leader's own
          // row would otherwise point at a parent they have no business with.
          managerId: u.reportingLeaderId && byId.has(u.reportingLeaderId) ? u.reportingLeaderId : null,
          managerName: u.reportingLeaderId ? byId.get(u.reportingLeaderId)?.name : undefined,
          directReports: (children.get(u.id) ?? []).length,
          teamSize: rolled.members,
          leads: { own: own.get(u.id) ?? 0, team: rolled.leads, won: rolled.won },
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});
