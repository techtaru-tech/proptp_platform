import type { Request } from 'express';
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../prisma';
import { resolveAccess } from './permissions';
import type { AuthedRequest } from './auth';

/**
 * Who may see which CRM data — the one place the rule is written.
 *
 * The CRM is a reporting tree: Leader → Team Leader → Employee → Agent, one edge per user
 * (`User.reportingLeaderId`). Everything a person may read is derived from where they sit in it:
 *
 *   admin / full-access   everything
 *   leader, team leader   their own records and those of everyone beneath them, however deep
 *   employee, agent       their own records only
 *
 * Nothing here is hardcoded to a person or a depth. Add a Team Leader under a Leader, or an
 * Employee under a Team Leader, and they are inside the right people's scope on the next
 * request — there is no copy of the tree to keep in step, because the tree is the users table.
 *
 * Every lead query in the CRM routes through `leadScopeWhere()`, so scoping is a database
 * predicate, not a filter applied to rows already fetched.
 */

export type ScopeKind = 'all' | 'tree' | 'own';

export interface Scope {
  kind: ScopeKind;
  userId: string;
  role: UserRole;
  /** The caller plus everyone beneath them. A single id for `own`; irrelevant for `all`. */
  userIds: string[];
  /**
   * The top of a tree is also where leads land before anybody has claimed them, so a root
   * Leader sees the unassigned pool and hands it out. Nobody else does: an unassigned lead is
   * not part of a Team Leader's or an Employee's hierarchy.
   */
  seesUnassigned: boolean;
  /** Whether this person may hand leads to others. Employees and agents may not. */
  canAssign: boolean;
}

/** What each role may report to — enforced wherever a manager is set. */
export const ALLOWED_MANAGER_ROLES: Record<UserRole, UserRole[]> = {
  admin: [],
  leader: [],
  team_leader: ['leader'],
  // A Leader is accepted for an Employee because that is how every existing Employee is
  // already wired (the app registers them under a Leader); it is not a dead path.
  employee: ['team_leader', 'leader'],
  agent: ['employee', 'team_leader', 'leader'],
  vendor: [],
};

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  leader: 'Leader',
  team_leader: 'Team Leader',
  employee: 'Employee',
  agent: 'Agent',
  vendor: 'Vendor',
};

/** Roles that manage other people, and so may have a tree beneath them. */
const MANAGER_ROLES: UserRole[] = ['leader', 'team_leader'];

/**
 * Everyone beneath `rootId`, at any depth.
 *
 * One recursive query rather than a loop of per-level lookups. `UNION` (not `UNION ALL`)
 * de-duplicates as it goes, which is also what makes a reporting cycle terminate instead of
 * spinning — cycles are rejected on write, but a query that hangs the API is not the place to
 * discover one that got in some other way.
 */
export async function descendantIds(rootId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT "id" FROM "User" WHERE "reportingLeaderId" = ${rootId}
      UNION
      SELECT u."id" FROM "User" u JOIN tree t ON u."reportingLeaderId" = t."id"
    )
    SELECT "id" FROM tree
  `;
  return rows.map((r) => r.id).filter((id) => id !== rootId);
}

export async function resolveScope(userId: string): Promise<Scope> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, reportingLeaderId: true },
  });
  // A token for a deleted user never reaches here (requireAuth rejects it); the safe answer
  // for anything else unexpected is the narrowest one.
  if (!user) return { kind: 'own', userId, role: 'employee', userIds: [userId], seesUnassigned: false, canAssign: false };

  // Full-access panel users are administrators whatever their account role says: they can
  // already rewrite roles and reporting lines, so a narrower view would be a fiction.
  const access = await resolveAccess(user.id);
  if (user.role === 'admin' || access.isFullAccess) {
    return { kind: 'all', userId, role: user.role, userIds: [userId], seesUnassigned: true, canAssign: true };
  }

  if (MANAGER_ROLES.includes(user.role)) {
    const below = await descendantIds(user.id);
    return {
      kind: 'tree',
      userId,
      role: user.role,
      userIds: [user.id, ...below],
      seesUnassigned: user.role === 'leader' && !user.reportingLeaderId,
      canAssign: true,
    };
  }

  return { kind: 'own', userId, role: user.role, userIds: [user.id], seesUnassigned: false, canAssign: false };
}

/**
 * The caller's scope, resolved once per request. A page that asks for a list, a count and a
 * report in one go should not walk the tree three times.
 */
export async function scopeOf(req: Request): Promise<Scope> {
  const carrier = req as Request & { _crmScope?: Promise<Scope> };
  if (!carrier._crmScope) {
    const userId = (req as AuthedRequest).auth?.sub;
    if (!userId) throw new Error('scopeOf() needs an authenticated request.');
    carrier._crmScope = resolveScope(userId);
  }
  return carrier._crmScope;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** The `where` that limits a lead query to what this scope may read. */
export function leadScopeWhere(scope: Scope): Prisma.LeadWhereInput {
  if (scope.kind === 'all') return {};
  if (scope.seesUnassigned) {
    return { OR: [{ assignedUserId: { in: scope.userIds } }, { assignedUserId: null }] };
  }
  return { assignedUserId: { in: scope.userIds } };
}

/** Adds the scope to an existing lead filter without disturbing its own `OR`/`AND`. */
export function inLeadScope(where: Prisma.LeadWhereInput, scope: Scope): Prisma.LeadWhereInput {
  if (scope.kind === 'all') return where;
  return { AND: [where, leadScopeWhere(scope)] };
}

/** For tables that hang off a lead (activities, notes, follow-ups, history…). */
export function viaLead(scope: Scope): { lead: Prisma.LeadWhereInput } | Record<string, never> {
  return scope.kind === 'all' ? {} : { lead: leadScopeWhere(scope) };
}

/**
 * A follow-up is visible when its lead is, or when it was handed to somebody in the scope —
 * the second half is what keeps "my follow-ups" intact when a lead has since moved on but
 * the task is still mine.
 */
export function followUpScopeWhere(scope: Scope): Prisma.LeadFollowUpWhereInput {
  if (scope.kind === 'all') return {};
  return { OR: [{ lead: leadScopeWhere(scope) }, { assignedUserId: { in: scope.userIds } }] };
}

/**
 * The ids of every lead in scope, for the few tables that carry a lead id as a plain string
 * (automation runs) and so cannot be filtered through a relation.
 */
export async function visibleLeadIds(scope: Scope): Promise<string[] | null> {
  if (scope.kind === 'all') return null;
  const rows = await prisma.lead.findMany({ where: leadScopeWhere(scope), select: { id: true } });
  return rows.map((r) => r.id);
}

/** A lead by id, but only if this scope may see it — otherwise it simply does not exist. */
export async function findLeadInScope(scope: Scope, id: string) {
  return prisma.lead.findFirst({ where: inLeadScope({ id }, scope) });
}

/** Ids from a request, narrowed to the leads this scope may touch. Bulk actions go through it. */
export async function leadIdsInScope(scope: Scope, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const wanted = ids.map(String);
  if (scope.kind === 'all') return wanted;
  const rows = await prisma.lead.findMany({ where: inLeadScope({ id: { in: wanted } }, scope), select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Whether this scope may take a lead's owner away. Only where the lead lands somewhere the
 * caller can still see it — an administrator, or the root Leader who sees the unassigned pool.
 * Anyone else would be making their own lead disappear.
 */
export function canUnassign(scope: Scope): boolean {
  return scope.kind === 'all' || scope.seesUnassigned;
}

/** Whether `userId` is somebody this scope may hand a lead to. */
export async function canAssignTo(scope: Scope, userId: string): Promise<boolean> {
  if (!scope.canAssign) return false;
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, role: true } });
  if (!target || target.status !== 'active') return false;
  if (scope.kind === 'all') return true;
  return scope.userIds.includes(userId);
}

/** People this scope may assign to, shaped for a dropdown. */
export async function assignableUsers(scope: Scope) {
  const where: Prisma.UserWhereInput = { status: 'active' };
  if (scope.kind === 'all') {
    // Staff, administrators included (a lead may be owned by whoever runs the CRM), plus any
    // Agent who has been placed under a manager. The thousands of referral partners who have
    // not are not people a sales lead gets handed to, and would drown the picker.
    where.OR = [{ role: { in: ['admin', 'leader', 'team_leader', 'employee'] } }, { role: 'agent', reportingLeaderId: { not: null } }];
  } else if (!scope.canAssign) where.id = scope.userId;
  else where.id = { in: scope.userIds };

  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, role: true, reportingLeaderId: true, avatarUrl: true },
    orderBy: [{ name: 'asc' }],
    // A picker, not an export — and the search box on the list is the way to a name past this.
    take: 500,
  });
  return users;
}

/**
 * A user a scope may *read about* but not necessarily assign to: used for filter dropdowns,
 * where an Employee still needs to see their own name.
 */
export const scopeUserIds = (scope: Scope) => (scope.kind === 'all' ? null : scope.userIds);

// ---------------------------------------------------------------------------
// Writes that change the tree
// ---------------------------------------------------------------------------

/**
 * Checks a proposed placement in the tree: `role` reporting to `managerId`.
 *
 * Three ways it can be wrong, and each one would quietly break somebody's visibility:
 *   - the wrong kind of manager (an Employee reporting to an Agent),
 *   - a loop (placing somebody under one of their own reports takes both out of every scope),
 *   - a role change that strands the people already reporting to them.
 *
 * Returns an error message, or null when the placement is fine.
 */
export async function validateReporting(userId: string | null, role: UserRole, managerId: string | null): Promise<string | null> {
  if (managerId) {
    const allowed = ALLOWED_MANAGER_ROLES[role];
    if (allowed.length === 0) return `A ${ROLE_LABEL[role]} does not report to anyone.`;
    if (userId && managerId === userId) return 'Somebody cannot report to themselves.';

    const manager = await prisma.user.findUnique({ where: { id: managerId }, select: { role: true, status: true } });
    if (!manager) return 'That reporting manager no longer exists.';
    if (!allowed.includes(manager.role)) {
      return `A ${ROLE_LABEL[role]} reports to a ${allowed.map((r) => ROLE_LABEL[r]).join(' or ')}.`;
    }
    if (manager.status !== 'active') return 'That reporting manager is not active.';

    if (userId) {
      const below = await descendantIds(userId);
      if (below.includes(managerId)) return 'That manager already reports to this person, so it would make a loop.';
    }
  }

  if (userId) {
    // Whoever already reports to this person must still be a valid report for the new role.
    const reports = await prisma.user.findMany({ where: { reportingLeaderId: userId }, select: { name: true, role: true } });
    const stranded = reports.find((r) => !ALLOWED_MANAGER_ROLES[r.role].includes(role));
    if (stranded) {
      return `${stranded.name} (${ROLE_LABEL[stranded.role]}) reports to this person, and a ${ROLE_LABEL[stranded.role]} cannot report to a ${ROLE_LABEL[role]}. Move them first.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Who did it
// ---------------------------------------------------------------------------

/**
 * The signed-in user's name, for the "by whom" on history, notes and activity rows. These used
 * to be stamped with one hardcoded name, which was invisible while a single person used the
 * CRM and is plainly wrong the moment a team does.
 */
export async function actorNameOf(req: Request): Promise<string> {
  const carrier = req as Request & { _actorName?: Promise<string> };
  if (!carrier._actorName) {
    const userId = (req as AuthedRequest).auth?.sub;
    carrier._actorName = userId
      ? prisma.user.findUnique({ where: { id: userId }, select: { name: true } }).then((u) => u?.name ?? 'Unknown user')
      : Promise.resolve('System');
  }
  return carrier._actorName;
}
