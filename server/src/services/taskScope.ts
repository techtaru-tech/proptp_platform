import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Who may see and assign which tasks.
 *
 * This is the only place the rule is written. The list, the board, the counters, the
 * assignee dropdown and every write all resolve their scope here, so none of them can
 * disagree about whether a given task belongs to the caller.
 *
 * The rule, by `User.role`:
 *
 *   admin     every task, and may assign to anybody
 *   leader    their own plus their team's, and may assign within that team
 *   agent     their own plus their team's, and may assign within that team
 *   employee  their own only, and may only assign to themselves
 *
 * A team is `User.teamId` — the Team row a person belongs to, the same grouping the
 * Teams / Referrals screen shows. Someone with no team sees only their own tasks, which is
 * what "my team" means when you are not in one.
 */

export type TaskScopeKind = 'all' | 'team' | 'own';

export interface TaskScope {
  kind: TaskScopeKind;
  userId: string;
  role: UserRole;
  /** Null for an admin (irrelevant) and for anyone not in a team. */
  teamId: string | null;
}

const TEAM_ROLES: UserRole[] = ['agent', 'leader'];

export async function resolveTaskScope(userId: string): Promise<TaskScope> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, teamId: true },
  });
  if (!user) return { kind: 'own', userId, role: 'employee', teamId: null };

  if (user.role === 'admin') return { kind: 'all', userId, role: user.role, teamId: null };

  // A team role with no team has nobody to see but themselves.
  const kind: TaskScopeKind = TEAM_ROLES.includes(user.role) && user.teamId ? 'team' : 'own';
  return { kind, userId, role: user.role, teamId: user.teamId };
}

/**
 * The `where` fragment that limits a query to what this scope may read.
 *
 * "Own" covers tasks assigned to you *and* tasks you raised. They are normally the same row
 * — an employee can only assign to themselves — but an admin can hand you something, and a
 * task you created and then had reassigned should not vanish from your list.
 */
export function taskScopeWhere(scope: TaskScope): Prisma.TaskWhereInput {
  if (scope.kind === 'all') return {};

  const own: Prisma.TaskWhereInput[] = [{ assigneeId: scope.userId }, { createdById: scope.userId }];
  if (scope.kind === 'own') return { OR: own };

  return { OR: [...own, { assignee: { teamId: scope.teamId } }] };
}

/** The users this scope may assign a task to, newest-irrelevant, ordered for a dropdown. */
export async function assignableUsers(scope: TaskScope) {
  const where: Prisma.UserWhereInput =
    scope.kind === 'all'
      ? { status: 'active' }
      : scope.kind === 'team'
        ? { status: 'active', OR: [{ id: scope.userId }, { teamId: scope.teamId }] }
        : { id: scope.userId };

  return prisma.user.findMany({
    where,
    select: { id: true, name: true, role: true, avatarUrl: true, teamId: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    // An admin picking from thousands of partners needs the search box on the list, not a
    // dropdown that ships the whole table; this is the practical ceiling for a picker.
    take: 500,
  });
}

/** Whether this scope may assign a task to `assigneeId`. Checked on every create and edit. */
export async function canAssignTo(scope: TaskScope, assigneeId: string): Promise<boolean> {
  if (scope.kind === 'all') return true;
  if (assigneeId === scope.userId) return true;
  if (scope.kind === 'own') return false;

  const target = await prisma.user.findUnique({ where: { id: assigneeId }, select: { teamId: true } });
  return !!target?.teamId && target.teamId === scope.teamId;
}

/**
 * Loads a task the caller is allowed to see, or null.
 *
 * Reading it back through the scope filter rather than fetching by id and then checking means
 * a task outside the caller's scope is indistinguishable from one that does not exist.
 */
export async function findTaskInScope(scope: TaskScope, id: string) {
  return prisma.task.findFirst({ where: { AND: [{ id }, taskScopeWhere(scope)] } });
}
