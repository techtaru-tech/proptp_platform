import { Router } from 'express';
import type { LeaveStatus, Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { countLeaveDays, leaveBalances, overlappingRequest } from '../../services/leave';
import { notify } from '../../services/notify';

export const adminLeaveRouter = Router();

/** A date column holds a date; the time a browser sends with it is noise. */
function asDate(input: unknown): Date | null {
  const text = String(input ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const STAFF_ROLES = ['employee', 'leader', 'team_leader', 'admin'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

adminLeaveRouter.get('/types', async (_req, res, next) => {
  try {
    res.json({ types: await prisma.leaveType.findMany({ orderBy: { name: 'asc' } }) });
  } catch (err) {
    next(err);
  }
});

function typeBody(body: any) {
  return {
    name: String(body?.name ?? '').trim(),
    code: String(body?.code ?? '').trim().toUpperCase(),
    annualQuota: Number(body?.annualQuota) || 0,
    isPaid: body?.isPaid === undefined ? true : !!body.isPaid,
    carryForward: !!body?.carryForward,
    active: body?.active === undefined ? true : !!body.active,
  };
}

adminLeaveRouter.post('/types', async (req: AuthedRequest, res, next) => {
  try {
    const data = typeBody(req.body);
    if (!data.name || !data.code) return res.status(400).json({ error: 'A name and a short code are both required.' });
    const clash = await prisma.leaveType.findUnique({ where: { code: data.code } });
    if (clash) return res.status(409).json({ error: `The code ${data.code} is already used by "${clash.name}".` });

    const created = await prisma.leaveType.create({ data });
    await writeAudit(req, { module: 'Attendance', action: 'Added leave type', recordId: created.id, recordLabel: created.name });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminLeaveRouter.patch('/types/:id', async (req: AuthedRequest, res, next) => {
  try {
    const data = typeBody(req.body);
    if (!data.name || !data.code) return res.status(400).json({ error: 'A name and a short code are both required.' });
    const updated = await prisma.leaveType.update({ where: { id: String(req.params.id) }, data });
    await writeAudit(req, { module: 'Attendance', action: 'Updated leave type', recordId: updated.id, recordLabel: updated.name });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

adminLeaveRouter.delete('/types/:id', async (req: AuthedRequest, res, next) => {
  try {
    const used = await prisma.leaveRequest.count({ where: { leaveTypeId: String(req.params.id) } });
    if (used > 0) {
      // Deleting would take the history with it. Switching it off keeps the record and stops
      // anyone choosing it again, which is what "delete" is nearly always meant to achieve.
      const off = await prisma.leaveType.update({ where: { id: String(req.params.id) }, data: { active: false } });
      return res.json({ ok: true, deactivated: true, message: `${used} request(s) use this type, so it was switched off instead of deleted.`, type: off });
    }
    const removed = await prisma.leaveType.delete({ where: { id: String(req.params.id) } });
    await writeAudit(req, { module: 'Attendance', action: 'Deleted leave type', recordId: removed.id, recordLabel: removed.name });
    res.json({ ok: true, deactivated: false });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

adminLeaveRouter.get('/balances', async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const userId = String(req.query.userId ?? '');

    if (userId) return res.json({ year, balances: await leaveBalances(userId, year) });

    const staff = await prisma.user.findMany({
      where: { status: 'active', role: { in: STAFF_ROLES as unknown as Prisma.Enumerable<any> } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const rows = await Promise.all(
      staff.map(async (u) => ({ userId: u.id, name: u.name, balances: await leaveBalances(u.id, year) }))
    );
    res.json({ year, staff: rows });
  } catch (err) {
    next(err);
  }
});

/** Overrides one person's allocation — a mid-year joiner does not get the full year. */
adminLeaveRouter.put('/balances', async (req: AuthedRequest, res, next) => {
  try {
    const userId = String(req.body?.userId ?? '');
    const leaveTypeId = String(req.body?.leaveTypeId ?? '');
    const year = Number(req.body?.year) || new Date().getFullYear();
    const allocated = Number(req.body?.allocated);
    if (!userId || !leaveTypeId || Number.isNaN(allocated)) {
      return res.status(400).json({ error: 'A person, a leave type and a number of days are all required.' });
    }

    const saved = await prisma.leaveBalance.upsert({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId, year } },
      update: { allocated },
      create: { userId, leaveTypeId, year, allocated },
    });
    await writeAudit(req, { module: 'Attendance', action: `Set leave allocation to ${allocated}`, recordId: userId, recordLabel: 'Leave balance' });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

adminLeaveRouter.get('/requests', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? 'all');
    const userId = String(req.query.userId ?? 'all');
    const year = Number(req.query.year) || undefined;

    const where: Prisma.LeaveRequestWhereInput = {};
    if (status !== 'all' && status) where.status = status as LeaveStatus;
    if (userId !== 'all' && userId) where.userId = userId;
    if (year) {
      where.startDate = { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) };
    }

    const requests = await prisma.leaveRequest.findMany({
      where,
      include: { user: { select: { name: true } }, type: { select: { name: true, code: true, isPaid: true } } },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      take: 300,
    });

    res.json({
      requests: requests.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.user.name,
        leaveTypeId: r.leaveTypeId,
        typeName: r.type.name,
        typeCode: r.type.code,
        isPaid: r.type.isPaid,
        startDate: r.startDate.toISOString().slice(0, 10),
        endDate: r.endDate.toISOString().slice(0, 10),
        days: r.days,
        halfDay: r.halfDay,
        reason: r.reason,
        status: r.status,
        decisionNote: r.decisionNote ?? undefined,
        decidedAt: r.decidedAt?.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminLeaveRouter.post('/requests', async (req: AuthedRequest, res, next) => {
  try {
    const userId = String(req.body?.userId ?? '');
    const leaveTypeId = String(req.body?.leaveTypeId ?? '');
    const startDate = asDate(req.body?.startDate);
    const endDate = asDate(req.body?.endDate) ?? startDate;
    const halfDay = !!req.body?.halfDay;
    const reason = String(req.body?.reason ?? '').trim();

    if (!userId || !leaveTypeId) return res.status(400).json({ error: 'A person and a leave type are required.' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'Give a valid start and end date.' });
    if (endDate < startDate) return res.status(400).json({ error: 'The end date cannot be before the start date.' });
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });

    const days = countLeaveDays(startDate, endDate, halfDay);
    if (days === 0) return res.status(400).json({ error: 'Those dates are all non-working days, so there is no leave to take.' });

    const clash = await overlappingRequest(userId, startDate, endDate);
    if (clash) {
      return res.status(409).json({
        error: `This overlaps a ${clash.status} leave from ${clash.startDate.toISOString().slice(0, 10)} to ${clash.endDate.toISOString().slice(0, 10)}.`,
      });
    }

    const created = await prisma.leaveRequest.create({
      data: { userId, leaveTypeId, startDate, endDate, days, halfDay, reason },
      include: { user: { select: { name: true } }, type: { select: { name: true } } },
    });

    await writeAudit(req, {
      module: 'Attendance',
      action: `Applied for ${days} day(s) of ${created.type.name}`,
      recordId: created.id,
      recordLabel: created.user.name,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

/** Approve or reject. Either way the person is told, because a decision they miss is no decision. */
adminLeaveRouter.post('/requests/:id/decide', async (req: AuthedRequest, res, next) => {
  try {
    const decision = String(req.body?.decision ?? '');
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'The decision must be approve or reject.' });
    }
    const note = String(req.body?.note ?? '').trim() || null;

    const request = await prisma.leaveRequest.findUnique({
      where: { id: String(req.params.id) },
      include: { user: { select: { id: true, name: true } }, type: { select: { name: true } } },
    });
    if (!request) return res.status(404).json({ error: 'That leave request no longer exists.' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `This request was already ${request.status}.` });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: decision as LeaveStatus,
        decidedBy: req.auth?.sub ?? null,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });

    await notify({
      title: decision === 'approved' ? 'Leave approved' : 'Leave rejected',
      body:
        `${request.type.name}, ${request.startDate.toISOString().slice(0, 10)} to ${request.endDate.toISOString().slice(0, 10)}` +
        (note ? ` — ${note}` : '.'),
      userIds: [request.userId],
      type: 'system',
      data: { leaveRequestId: request.id },
    }).catch((err) => console.error('[leave] could not notify about the decision:', err));

    await writeAudit(req, {
      module: 'Attendance',
      action: `${decision === 'approved' ? 'Approved' : 'Rejected'} leave`,
      recordId: request.id,
      recordLabel: request.user.name,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

adminLeaveRouter.post('/requests/:id/cancel', async (req: AuthedRequest, res, next) => {
  try {
    const request = await prisma.leaveRequest.findUnique({ where: { id: String(req.params.id) } });
    if (!request) return res.status(404).json({ error: 'That leave request no longer exists.' });
    if (request.status === 'cancelled') return res.json(request);

    const updated = await prisma.leaveRequest.update({
      where: { id: request.id },
      data: { status: 'cancelled', decidedBy: req.auth?.sub ?? null, decidedAt: new Date() },
    });
    await writeAudit(req, { module: 'Attendance', action: 'Cancelled leave', recordId: request.id, recordLabel: 'Leave request' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
