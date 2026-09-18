import { Router } from 'express';
import { Prisma, type TaskPriority, type TaskStatus } from '@prisma/client';
import { prisma } from '../prisma';
import type { AuthedRequest } from '../services/auth';
import { ROLE_ID, adminTask, adminTaskComment } from '../services/adminMappers';
import {
  assignableUsers,
  canAssignTo,
  findTaskInScope,
  resolveTaskScope,
  taskScopeWhere,
  type TaskScope,
} from '../services/taskScope';

/**
 * Task management — /api/tasks.
 *
 * Every read is filtered through `taskScopeWhere` and every write through `canAssignTo`, so
 * what a caller may touch is decided by their role rather than by what the UI chose to send.
 * See services/taskScope.ts for the rule itself.
 */
export const tasksRouter = Router();

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
/** Open statuses, in the order the board shows them. */
export const BOARD_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done'];

const isStatus = (v: unknown): v is TaskStatus => STATUSES.includes(v as TaskStatus);
const isPriority = (v: unknown): v is TaskPriority => PRIORITIES.includes(v as TaskPriority);

const PERSON = { select: { id: true, name: true, role: true, avatarUrl: true } } as const;
const TASK_INCLUDE = {
  assignee: PERSON,
  createdBy: PERSON,
  _count: { select: { comments: true } },
} as const;

/** Scope for the signed-in caller. Every handler starts here. */
function scopeFor(req: AuthedRequest): Promise<TaskScope> {
  return resolveTaskScope(req.auth!.sub);
}

/**
 * The filter half of a list request, shared by the list and the board so a filtered board
 * and a filtered list can never show different tasks.
 */
function buildTaskWhere(query: Record<string, string | undefined>): Prisma.TaskWhereInput {
  const { search, status, priority, assigneeId, createdById, dueFrom, dueTo, overdue } = query;
  const where: Prisma.TaskWhereInput = {};
  const and: Prisma.TaskWhereInput[] = [];

  if (search?.trim()) {
    const term = search.trim();
    and.push({
      OR: [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { assignee: { name: { contains: term, mode: 'insensitive' } } },
      ],
    });
  }
  if (isStatus(status)) where.status = status;
  if (isPriority(priority)) where.priority = priority;
  if (assigneeId && assigneeId !== 'all') where.assigneeId = assigneeId;
  if (createdById && createdById !== 'all') where.createdById = createdById;

  if (dueFrom || dueTo) {
    const range: Prisma.DateTimeFilter = {};
    if (dueFrom) range.gte = new Date(dueFrom);
    if (dueTo) {
      // A date with no time means "to the end of that day", which is what a date picker means.
      const to = new Date(dueTo);
      to.setHours(23, 59, 59, 999);
      range.lte = to;
    }
    where.dueAt = range;
  }

  // Overdue is "past due and still open" — a task finished late is not still overdue.
  if (overdue === 'true') {
    and.push({ dueAt: { lt: new Date() } });
    and.push({ status: { notIn: ['done', 'cancelled'] } });
  }

  if (and.length) where.AND = and;
  return where;
}

/** Scope + filters, combined. Never build a task query without this. */
function scopedWhere(scope: TaskScope, query: Record<string, string | undefined>): Prisma.TaskWhereInput {
  return { AND: [taskScopeWhere(scope), buildTaskWhere(query)] };
}

/**
 * Board and list order: the most urgent thing with the nearest deadline first.
 *
 * Postgres sorts NULLs last on ASC by default, which is exactly right here — a task with no
 * due date is not more urgent than one due tomorrow, it is simply undated.
 */
const TASK_ORDER: Prisma.TaskOrderByWithRelationInput[] = [
  { priority: 'desc' },
  { dueAt: 'asc' },
  { createdAt: 'desc' },
];

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Who the caller may assign to, and how wide their view is — drives the whole UI. */
tasksRouter.get('/assignable', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const users = await assignableUsers(scope);
    res.json({
      scope: scope.kind,
      currentUserId: scope.userId,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        role: ROLE_ID[u.role],
        avatarUrl: u.avatarUrl ?? undefined,
        teamId: u.teamId,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Counters for the stat cards, over the caller's scope and current filters. */
tasksRouter.get('/stats', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const where = scopedWhere(scope, req.query as Record<string, string>);
    const now = new Date();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [total, open, overdue, dueToday, completed] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.count({ where: { AND: [where, { status: { notIn: ['done', 'cancelled'] } }] } }),
      prisma.task.count({
        where: { AND: [where, { status: { notIn: ['done', 'cancelled'] }, dueAt: { lt: now } }] },
      }),
      prisma.task.count({
        where: {
          AND: [where, { status: { notIn: ['done', 'cancelled'] }, dueAt: { gte: now, lte: endOfToday } }],
        },
      }),
      prisma.task.count({ where: { AND: [where, { status: 'done' }] } }),
    ]);

    res.json({ total, open, overdue, dueToday, completed });
  } catch (err) {
    next(err);
  }
});

/**
 * The kanban board: one bucket per status.
 *
 * Each column is capped and reports its own total, so a status holding thousands of tasks
 * renders the top of the pile rather than all of it.
 */
tasksRouter.get('/board', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const query = req.query as Record<string, string>;
    const limit = Math.min(100, Math.max(10, Number(query.limit) || 50));
    // The board draws its own columns, so a status filter would blank all but one of them.
    const { status: _ignored, ...filters } = query;
    const base = scopedWhere(scope, filters);

    const columns = await Promise.all(
      BOARD_STATUSES.map(async (status) => {
        const where: Prisma.TaskWhereInput = { AND: [base, { status }] };
        const [items, total] = await Promise.all([
          prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy: TASK_ORDER, take: limit }),
          prisma.task.count({ where }),
        ]);
        return { status, total, items: items.map(adminTask) };
      })
    );

    res.json({ columns });
  } catch (err) {
    next(err);
  }
});

tasksRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const query = req.query as Record<string, string>;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const where = scopedWhere(scope, query);

    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      query.sortBy === 'dueAt'
        ? [{ dueAt: query.sortDir === 'desc' ? 'desc' : 'asc' }]
        : query.sortBy === 'title'
          ? [{ title: query.sortDir === 'desc' ? 'desc' : 'asc' }]
          : query.sortBy === 'createdAt'
            ? [{ createdAt: query.sortDir === 'asc' ? 'asc' : 'desc' }]
            : TASK_ORDER;

    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.task.count({ where }),
    ]);

    res.json({ items: items.map(adminTask), total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

tasksRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const found = await findTaskInScope(scope, String(req.params.id));
    if (!found) return res.status(404).json({ error: 'Task not found.' });

    const [task, comments] = await Promise.all([
      prisma.task.findUniqueOrThrow({ where: { id: found.id }, include: TASK_INCLUDE }),
      prisma.taskComment.findMany({
        where: { taskId: found.id },
        include: { author: PERSON },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    res.json({ task: adminTask(task), comments: comments.map(adminTaskComment) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

tasksRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const body = req.body ?? {};

    const title = String(body.title ?? '').trim();
    if (!title) return res.status(400).json({ error: 'A title is required.' });

    // Defaulting to the caller is what makes "add a task for myself" a one-field form, and it
    // is the only assignee an employee is allowed to pick anyway.
    const assigneeId = String(body.assigneeId || scope.userId);
    if (!(await canAssignTo(scope, assigneeId))) {
      return res.status(403).json({ error: 'You can only assign tasks to yourself or your team.' });
    }

    const task = await prisma.task.create({
      data: {
        title,
        description: body.description ? String(body.description) : null,
        status: isStatus(body.status) ? body.status : 'todo',
        priority: isPriority(body.priority) ? body.priority : 'normal',
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        assigneeId,
        createdById: scope.userId,
      },
      include: TASK_INCLUDE,
    });

    res.status(201).json(adminTask(task));
  } catch (err) {
    next(err);
  }
});

tasksRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const existing = await findTaskInScope(scope, String(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Task not found.' });

    const body = req.body ?? {};
    const data: Prisma.TaskUpdateInput = {};

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return res.status(400).json({ error: 'A title is required.' });
      data.title = title;
    }
    if (body.description !== undefined) data.description = body.description ? String(body.description) : null;
    if (body.priority !== undefined && isPriority(body.priority)) data.priority = body.priority;
    if (body.dueAt !== undefined) data.dueAt = body.dueAt ? new Date(body.dueAt) : null;

    if (body.assigneeId !== undefined) {
      const assigneeId = String(body.assigneeId);
      if (!(await canAssignTo(scope, assigneeId))) {
        return res.status(403).json({ error: 'You can only assign tasks to yourself or your team.' });
      }
      data.assignee = { connect: { id: assigneeId } };
    }

    if (body.status !== undefined) {
      if (!isStatus(body.status)) return res.status(400).json({ error: 'Unknown status.' });
      data.status = body.status;
      // Stamped on the way in and cleared on the way out, so "completed" counts the completion
      // rather than the last time anybody edited the row.
      if (body.status === 'done' && existing.status !== 'done') data.completedAt = new Date();
      if (body.status !== 'done' && existing.status === 'done') data.completedAt = null;
    }

    const task = await prisma.task.update({ where: { id: existing.id }, data, include: TASK_INCLUDE });
    res.json(adminTask(task));
  } catch (err) {
    next(err);
  }
});

/** The board's drag-and-drop lands here — one field, so a drop cannot rewrite anything else. */
tasksRouter.patch('/:id/status', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const existing = await findTaskInScope(scope, String(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Task not found.' });

    const status = req.body?.status;
    if (!isStatus(status)) return res.status(400).json({ error: 'Unknown status.' });

    const task = await prisma.task.update({
      where: { id: existing.id },
      data: {
        status,
        completedAt:
          status === 'done' && existing.status !== 'done'
            ? new Date()
            : status !== 'done' && existing.status === 'done'
              ? null
              : undefined,
      },
      include: TASK_INCLUDE,
    });

    res.json(adminTask(task));
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/:id/comments', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const existing = await findTaskInScope(scope, String(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Task not found.' });

    const bodyText = String(req.body?.body ?? '').trim();
    if (!bodyText) return res.status(400).json({ error: 'A comment cannot be empty.' });

    const comment = await prisma.taskComment.create({
      data: { taskId: existing.id, authorId: scope.userId, body: bodyText },
      include: { author: PERSON },
    });

    res.status(201).json(adminTaskComment(comment));
  } catch (err) {
    next(err);
  }
});

/**
 * Deleting is deliberately narrower than editing: an admin may remove anything, and everyone
 * else may only remove a task they raised themselves. Being able to see a team-mate's task is
 * not a reason to be able to destroy it.
 */
tasksRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const scope = await scopeFor(req);
    const existing = await findTaskInScope(scope, String(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Task not found.' });
    if (scope.kind !== 'all' && existing.createdById !== scope.userId) {
      return res.status(403).json({ error: 'You can only delete tasks you created.' });
    }

    await prisma.task.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
