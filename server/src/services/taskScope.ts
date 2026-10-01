import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../prisma';
import { resolveScope } from './hierarchy';

/**
 * Who may see and assign which tasks.
 *
 * Tasks follow the same reporting tree as leads (services/hierarchy.ts) — this file only maps
 * that scope onto the shape the task routes were written against, so the list, the board, the
 * counters, the assignee dropdown and every write still resolve their scope in exactly one
 * place and cannot disagree about whether a task belongs to the caller.
 *
 *   admin                  every task, and may assign to anybody
 *   leader / team leader   their own plus everyone beneath them, and may assign within that tree
 *   employee / agent       their own only, and may only assign to themselves
 */

export type TaskScopeKind = 'all' | 'team' | 'own';

export interface TaskScope {
  kind: TaskScopeKind;
  userId: string;
  role: UserRole;
  /** The caller plus everyone beneath them. Meaningful for `team`; just the caller for `own`. */
  userIds: string[];
}

export async function resolveTaskScope(userId: string): Promise<TaskScope> {
  const scope = await resolveScope(userId);
  const kind: TaskScopeKind = scope.kind === 'all' ? 'all' : scope.kind === 'tree' ? 'team' : 'own';
  return { kind, userId, role: scope.role, userIds: scope.userIds };
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

  return { OR: [...own, { assigneeId: { in: scope.userIds } }] };
}

/** The users this scope may assign a task to, newest-irrelevant, ordered for a dropdown. */
export async function assignableUsers(scope: TaskScope) {
  const where: Prisma.UserWhereInput =
    scope.kind === 'all'
      ? { status: 'active' }
      : scope.kind === 'team'
        ? { status: 'active', id: { in: scope.userIds } }
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

  return scope.userIds.includes(assigneeId);
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
