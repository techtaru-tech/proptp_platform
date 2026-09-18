import { Router } from 'express';
import { prisma } from '../../prisma';
import { adminAttendance, adminBooking, adminTicket, attendanceStatus } from '../../services/adminMappers';
import { dayKey, dayString } from '../../services/dates';
import { paidAmountFromBookings, remainingAmount } from '../../services/derive';

export const adminDashboardRouter = Router();

const TREND_DAYS = 14;

/**
 * The dashboard snapshot. Counting is done with `groupBy`/`count` aggregates rather than by
 * pulling rows and filtering in JS, so the numbers stay correct as the tables grow.
 */
adminDashboardRouter.get('/snapshot', async (_req, res, next) => {
  try {
    const today = dayKey();
    const trendStart = new Date(today.getTime() - (TREND_DAYS - 1) * 86400000);

    const [
      projectsByStatus,
      unitsByBookingStatus,
      bookingsByStatus,
      bookingsByMode,
      bookingsToday,
      usersByRole,
      usersByStatus,
      ticketsByStatus,
      trendRows,
      openUnits,
    ] = await Promise.all([
      prisma.project.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.propertyUnit.groupBy({ by: ['bookingStatus'], _count: { _all: true } }),
      prisma.booking.groupBy({ by: ['status'], where: { isDeposit: 0 }, _count: { _all: true } }),
      prisma.booking.groupBy({ by: ['paymentMode'], _count: { _all: true }, _sum: { amount: true } }),
      prisma.booking.count({ where: { createdAt: { gte: today } } }),
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      prisma.user.groupBy({ by: ['status'], where: { role: { not: 'admin' } }, _count: { _all: true } }),
      prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.booking.findMany({ where: { createdAt: { gte: trendStart } }, select: { createdAt: true } }),
      // "Remaining" is derived per plot, so the plots that still owe money are summed here.
      prisma.propertyUnit.findMany({
        where: { bookingStatus: { not: 0 } },
        select: { totalInvestmentAmount: true, bookings: { select: { amount: true, status: true } } },
      }),
    ]);

    const countBy = <T extends string | number>(rows: { _count: { _all: number } }[], keys: T[], keyOf: (r: any) => T) => {
      const map = new Map<T, number>(keys.map((k) => [k, 0]));
      for (const row of rows) map.set(keyOf(row), (map.get(keyOf(row)) ?? 0) + row._count._all);
      return map;
    };

    const projectCounts = countBy(projectsByStatus, [0, 1], (r) => r.status as 0 | 1);
    const unitCounts = countBy(unitsByBookingStatus, [0, 1, 2], (r) => r.bookingStatus as 0 | 1 | 2);
    const bookingCounts = countBy(
      bookingsByStatus,
      ['pending', 'booked', 'partPaid', 'cancelled'],
      (r) => r.status as 'pending'
    );
    const roleCounts = countBy(usersByRole, ['agent', 'employee', 'leader', 'admin'], (r) => r.role as 'agent');
    const statusCounts = countBy(usersByStatus, ['active', 'inactive', 'suspended'], (r) => r.status as 'active');
    const ticketCounts = countBy(ticketsByStatus, ['open', 'pending', 'resolved', 'closed'], (r) => r.status as 'open');

    const sumByMode = new Map(bookingsByMode.map((r) => [r.paymentMode, r._sum.amount ?? 0]));
    const collected = [...sumByMode.values()].reduce((a, b) => a + b, 0);
    const remainingTotal = openUnits.reduce(
      (sum, unit) => sum + remainingAmount(unit.totalInvestmentAmount, paidAmountFromBookings(unit.bookings)),
      0
    );

    const todayRecords = await prisma.attendanceRecord.findMany({
      where: { date: today },
      select: { checkInAt: true, checkOutAt: true, syncStatus: true, isLate: true },
    });
    const statuses = todayRecords.map(attendanceStatus);
    const attendance = {
      present: statuses.filter((s) => s === 'checked_in' || s === 'checked_out').length,
      checkedIn: statuses.filter((s) => s === 'checked_in').length,
      checkedOut: statuses.filter((s) => s === 'checked_out').length,
      late: todayRecords.filter((r) => r.isLate).length,
      absent: statuses.filter((s) => s === 'not_checked_in').length,
      pendingSync: todayRecords.filter((r) => r.syncStatus === 'pending').length,
    };

    // A dense 14-day series: days with no bookings must still appear, as zero.
    const trendCounts = new Map<string, number>();
    for (let i = 0; i < TREND_DAYS; i += 1) {
      trendCounts.set(dayString(new Date(trendStart.getTime() + i * 86400000)), 0);
    }
    for (const row of trendRows) {
      const key = dayString(row.createdAt);
      if (trendCounts.has(key)) trendCounts.set(key, (trendCounts.get(key) ?? 0) + 1);
    }

    const payments = {
      collected,
      remaining: remainingTotal,
      bankTransfer: sumByMode.get('bankTransfer') ?? 0,
      cash: sumByMode.get('cash') ?? 0,
      cheque: sumByMode.get('cheque') ?? 0,
      other: sumByMode.get('other') ?? 0,
      online: sumByMode.get('online') ?? 0,
    };
    const partners = {
      agents: roleCounts.get('agent') ?? 0,
      employees: roleCounts.get('employee') ?? 0,
      leaders: roleCounts.get('leader') ?? 0,
      active: statusCounts.get('active') ?? 0,
      inactive: (statusCounts.get('inactive') ?? 0) + (statusCounts.get('suspended') ?? 0),
    };
    const units = {
      total: [...unitCounts.values()].reduce((a, b) => a + b, 0),
      available: unitCounts.get(0) ?? 0,
      booked: unitCounts.get(1) ?? 0,
      soldOut: unitCounts.get(2) ?? 0,
    };
    const bookings = {
      today: bookingsToday,
      pending: bookingCounts.get('pending') ?? 0,
      confirmed: (bookingCounts.get('booked') ?? 0) + (bookingCounts.get('partPaid') ?? 0),
    };

    res.json({
      properties: {
        total: [...projectCounts.values()].reduce((a, b) => a + b, 0),
        active: projectCounts.get(1) ?? 0,
        inactive: projectCounts.get(0) ?? 0,
      },
      units,
      bookings,
      payments,
      partners,
      teams: {
        employeeNetwork: partners.employees,
        leaderNetwork: partners.leaders,
        teamMembers: partners.employees + partners.agents,
      },
      attendance,
      support: {
        open: ticketCounts.get('open') ?? 0,
        pendingReplies: ticketCounts.get('pending') ?? 0,
        resolved: (ticketCounts.get('resolved') ?? 0) + (ticketCounts.get('closed') ?? 0),
      },
      bookingTrend: [...trendCounts.entries()].map(([date, count]) => ({ date: date.slice(5), bookings: count })),
      paymentOverview: [
        { name: 'Bank Transfer', value: payments.bankTransfer },
        { name: 'Cash', value: payments.cash },
        { name: 'Cheque', value: payments.cheque },
        { name: 'Online', value: payments.online },
        { name: 'Other', value: payments.other },
      ],
      inventoryBreakdown: [
        { name: 'Available', value: units.available },
        { name: 'Booked', value: units.booked },
        { name: 'Sold Out', value: units.soldOut },
      ],
      userDistribution: [
        { name: 'Agents', value: partners.agents },
        { name: 'Employees', value: partners.employees },
        { name: 'Leaders', value: partners.leaders },
      ],
      attendanceOverview: [
        { name: 'Present', value: attendance.present },
        { name: 'Checked-in', value: attendance.checkedIn },
        { name: 'Checked-out', value: attendance.checkedOut },
        { name: 'Late', value: attendance.late },
        { name: 'Absent', value: attendance.absent },
        { name: 'Pending Sync', value: attendance.pendingSync },
      ],
      bookingStatusBreakdown: [
        { name: 'Pending', value: bookings.pending },
        { name: 'Confirmed', value: bookings.confirmed },
      ],
    });
  } catch (err) {
    next(err);
  }
});

/** The four "recent activity" panels on the dashboard, in one round trip. */
adminDashboardRouter.get('/recent', async (req, res, next) => {
  try {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 6));
    const rowInclude = {
      unit: { include: { project: { select: { id: true, projectName: true } } } },
      user: { select: { name: true } },
    } as const;

    const [bookings, payments, attendanceRows, tickets] = await Promise.all([
      prisma.booking.findMany({ where: { isDeposit: 0 }, include: rowInclude, orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.booking.findMany({ include: rowInclude, orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.attendanceRecord.findMany({
        where: { date: dayKey() },
        include: { user: { select: { name: true, role: true } } },
        orderBy: { checkInAt: 'desc' },
        take: limit,
      }),
      prisma.supportTicket.findMany({
        include: { user: { select: { name: true, role: true } }, messages: true },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
    ]);

    const enrich = (b: (typeof bookings)[number]) => ({
      ...adminBooking(b),
      projectName: b.unit?.project.projectName ?? '—',
      unitLabel: b.unit ? `${b.unit.propertyNumber} · ${b.unit.propertyTitle}` : b.propertyId,
      partnerName: b.user?.name ?? '—',
    });

    res.json({
      bookings: bookings.map(enrich),
      payments: payments.map(enrich),
      attendance: attendanceRows.map(adminAttendance),
      tickets: tickets.map(adminTicket),
    });
  } catch (err) {
    next(err);
  }
});
