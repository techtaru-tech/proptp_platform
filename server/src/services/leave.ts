import type { LeaveStatus } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Leave, and the arithmetic payroll needs from it.
 *
 * Balances are never stored as a running total. Every figure here is counted from the approved
 * requests themselves, so cancelling or rejecting something that was already approved cannot
 * leave a balance quietly wrong — which is the failure nobody notices until somebody is told
 * they have no leave left.
 */

/** Sunday is the only weekly off. A working-day calendar would be the next thing to add. */
function isWorkingDay(date: Date): boolean {
  return date.getDay() !== 0;
}

/** Every calendar day between two dates, inclusive, in UTC so a date column stays a date. */
function* eachDay(start: Date, end: Date): Generator<Date> {
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last) {
    yield new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

/** Working days a leave spans. A half day is only meaningful on a single-day request. */
export function countLeaveDays(start: Date, end: Date, halfDay: boolean): number {
  let days = 0;
  for (const day of eachDay(start, end)) if (isWorkingDay(day)) days += 1;
  if (halfDay && days === 1) return 0.5;
  return days;
}

/** Working days in a month, which is what a full month's salary is earned against. */
export function workingDaysInMonth(year: number, month: number): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= days; d += 1) if (isWorkingDay(new Date(Date.UTC(year, month - 1, d)))) count += 1;
  return count;
}

export interface LeaveBalanceRow {
  leaveTypeId: string;
  name: string;
  code: string;
  isPaid: boolean;
  allocated: number;
  used: number;
  pending: number;
  remaining: number;
}

/**
 * What one person has left this year, per type.
 *
 * Pending requests are shown separately rather than deducted: they are not spent until someone
 * approves them, but a manager about to approve a sixth day of five needs to see them coming.
 */
export async function leaveBalances(userId: string, year: number): Promise<LeaveBalanceRow[]> {
  const [types, overrides, requests] = await Promise.all([
    prisma.leaveType.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.leaveBalance.findMany({ where: { userId, year } }),
    prisma.leaveRequest.findMany({
      where: {
        userId,
        status: { in: ['approved', 'pending'] },
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      select: { leaveTypeId: true, days: true, status: true },
    }),
  ]);

  return types.map((type) => {
    const override = overrides.find((o) => o.leaveTypeId === type.id);
    const allocated = override?.allocated ?? type.annualQuota;
    const mine = requests.filter((r) => r.leaveTypeId === type.id);
    const used = mine.filter((r) => r.status === 'approved').reduce((sum, r) => sum + r.days, 0);
    const pending = mine.filter((r) => r.status === 'pending').reduce((sum, r) => sum + r.days, 0);

    return {
      leaveTypeId: type.id,
      name: type.name,
      code: type.code,
      isPaid: type.isPaid,
      allocated,
      used,
      pending,
      // Unpaid leave has no quota to run out of, so it never reads as negative.
      remaining: type.annualQuota === 0 && !override ? 0 : Math.max(0, allocated - used),
    };
  });
}

/** Approved leave a person took inside a month, split by whether the company pays for it. */
export async function approvedLeaveInMonth(
  userId: string,
  year: number,
  month: number
): Promise<{ paidDays: number; unpaidDays: number }> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const requests = await prisma.leaveRequest.findMany({
    where: { userId, status: 'approved', startDate: { lte: monthEnd }, endDate: { gte: monthStart } },
    include: { type: { select: { isPaid: true } } },
  });

  let paidDays = 0;
  let unpaidDays = 0;

  for (const request of requests) {
    // A leave can straddle two months; only the part inside this one counts here.
    let daysInMonth = 0;
    for (const day of eachDay(request.startDate, request.endDate)) {
      if (day >= monthStart && day <= monthEnd && isWorkingDay(day)) daysInMonth += 1;
    }
    if (daysInMonth === 0) continue;
    if (request.halfDay && daysInMonth === 1) daysInMonth = 0.5;

    if (request.type.isPaid) paidDays += daysInMonth;
    else unpaidDays += daysInMonth;
  }

  return { paidDays, unpaidDays };
}

/** Days somebody actually checked in, for the month. */
export async function presentDaysInMonth(userId: string, year: number, month: number): Promise<number> {
  return prisma.attendanceRecord.count({
    where: {
      userId,
      checkInAt: { not: null },
      date: { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) },
    },
  });
}

/** Whether a proposed leave collides with one already approved or waiting. */
export async function overlappingRequest(
  userId: string,
  start: Date,
  end: Date,
  ignoreId?: string
): Promise<{ id: string; startDate: Date; endDate: Date; status: LeaveStatus } | null> {
  return prisma.leaveRequest.findFirst({
    where: {
      userId,
      id: ignoreId ? { not: ignoreId } : undefined,
      status: { in: ['approved', 'pending'] },
      startDate: { lte: end },
      endDate: { gte: start },
    },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
}
