import { Router } from 'express';
import type { LeaveStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { countLeaveDays, leaveBalances, overlappingRequest } from '../../services/leave';
import { appLeaveBalance, appLeaveRequest, appLeaveType } from '../../services/appMappers';

/**
 * The partner app's leave screen — my history, and applying for more.
 *
 * Not in the API doc; leave was built for the panel first. Every rule here comes from
 * `services/leave.ts`, the same module the panel's /api/leave routes use, so the day count, the
 * overlap check and the balance arithmetic cannot disagree between the two surfaces. What the
 * app does NOT get is anybody else's requests or the power to decide one: approving is the
 * panel's job, and an endpoint that could do it from a phone would be the whole access model
 * undone.
 */
export const appLeaveRouter = Router();

appLeaveRouter.use(requireAuth);

function fail(res: any, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** A date column holds a date; whatever time the client sends with it is noise. */
function asDate(input: unknown): Date | null {
  const text = String(input ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

const STATUSES: LeaveStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

/**
 * GET /leave — my requests, my balances and the types I may apply under.
 *
 * All three in one response on purpose: the app's leave screen renders the history and opens
 * the apply sheet from the same place, and making it fetch the types separately would only
 * mean a spinner on a list of four rows.
 */
appLeaveRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;
    const year = Number(req.query.year) || new Date().getFullYear();
    const status = String(req.query.status ?? 'all');

    const [requests, balances, types] = await Promise.all([
      prisma.leaveRequest.findMany({
        where: {
          userId,
          ...(STATUSES.includes(status as LeaveStatus) ? { status: status as LeaveStatus } : {}),
          startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
        },
        include: { type: { select: { name: true, code: true, isPaid: true } } },
        orderBy: { startDate: 'desc' },
      }),
      leaveBalances(userId, year),
      prisma.leaveType.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    ]);

    res.json({
      year,
      requests: requests.map(appLeaveRequest),
      balances: balances.map(appLeaveBalance),
      types: types.map(appLeaveType),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /leave — apply.
 *
 * Always lands as `pending`: nothing a phone sends can approve itself. `days` is counted here
 * rather than accepted from the request, for the same reason POST /bookings reads the token
 * amount off the plot — a client that can name its own number eventually will.
 */
appLeaveRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;
    const body = req.body ?? {};

    const leaveTypeId = String(body.leave_type_id ?? '').trim();
    if (!leaveTypeId) return fail(res, 400, 'missing_leave_type', 'Pick a leave type.');

    const type = await prisma.leaveType.findFirst({ where: { id: leaveTypeId, active: true }, select: { id: true } });
    if (!type) return fail(res, 400, 'invalid_leave_type', 'That leave type is not available.');

    const startDate = asDate(body.start_date);
    if (!startDate) return fail(res, 400, 'invalid_start_date', 'Give a start date as YYYY-MM-DD.');
    // A one-day leave may send only a start date, which is how the app's date picker behaves
    // when the toggle is off.
    const endDate = body.end_date ? asDate(body.end_date) : startDate;
    if (!endDate) return fail(res, 400, 'invalid_end_date', 'Give an end date as YYYY-MM-DD.');
    if (endDate < startDate) return fail(res, 400, 'invalid_range', 'The end date cannot be before the start date.');

    const reason = String(body.reason ?? '').trim();
    if (!reason) return fail(res, 400, 'missing_reason', 'A reason is required.');

    const halfDay = body.half_day === true || body.half_day === 'true';
    const days = countLeaveDays(startDate, endDate, halfDay);
    if (days === 0) {
      return fail(res, 400, 'no_working_days', 'Those dates are all non-working days, so there is no leave to take.');
    }

    const clash = await overlappingRequest(userId, startDate, endDate);
    if (clash) {
      return fail(
        res,
        409,
        'overlapping_leave',
        `This overlaps a ${clash.status} leave from ${clash.startDate.toISOString().slice(0, 10)} to ${clash.endDate.toISOString().slice(0, 10)}.`
      );
    }

    const created = await prisma.leaveRequest.create({
      data: { userId, leaveTypeId, startDate, endDate, days, halfDay, reason },
      include: { type: { select: { name: true, code: true, isPaid: true } } },
    });

    res.status(201).json(appLeaveRequest(created));
  } catch (err) {
    next(err);
  }
});
