import { Router } from 'express';
import { prisma } from '../../prisma';
import { adminAttendance, adminBooking, adminTicket, attendanceStatus } from '../../services/adminMappers';
import { dayKey, dayString } from '../../services/dates';
import { paidAmountFromBookings, remainingAmount } from '../../services/derive';
import type { AuthedRequest } from '../../services/auth';
import { resolveAccess } from '../../services/permissions';
import { leadScopeWhere, scopeOf } from '../../services/hierarchy';
import { milestoneState } from '../../services/legal';

export const adminDashboardRouter = Router();

const TREND_DAYS = 14;
/** Months in the collection chart (its widest view is two years) plus a year before, for "last year". */
const COLLECTION_MONTHS = 24;
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11" for the month `back` months before the given "YYYY-MM". */
function monthBefore(month: string, back: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) - back;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/**
 * The dashboard snapshot. Counting is done with `groupBy`/`count` aggregates rather than by
 * pulling rows and filtering in JS, so the numbers stay correct as the tables grow.
 */
adminDashboardRouter.get('/snapshot', async (_req, res, next) => {
  try {
    const today = dayKey();
    const trendStart = new Date(today.getTime() - (TREND_DAYS - 1) * 86400000);
    // Months are the org's calendar months; a margin of a few days is fetched and then bucketed exactly.
    const thisMonth = dayString().slice(0, 7);
    const firstMonth = monthBefore(thisMonth, COLLECTION_MONTHS + 11);
    const collectionStart = new Date(`${firstMonth}-01T00:00:00Z`);
    collectionStart.setUTCDate(collectionStart.getUTCDate() - 1);

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
      collectionRows,
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
      // Same basis as `collected` below (every booking and deposit payment), bucketed by month.
      prisma.booking.findMany({
        where: { createdAt: { gte: collectionStart } },
        select: { createdAt: true, amount: true, isDeposit: true, status: true },
      }),
    ]);

    const byMonth = new Map<string, { collected: number; bookings: number }>();
    // Month-to-date against the same days of last month, so the 5th of a month isn't measured
    // against all thirty days of the one before it.
    const lastMonth = monthBefore(thisMonth, 1);
    const todayOfMonth = dayString().slice(8, 10);
    const lastMonthToDate = { collected: 0, bookings: 0 };
    for (const row of collectionRows) {
      const day = dayString(row.createdAt);
      const key = day.slice(0, 7);
      if (key === lastMonth && day.slice(8, 10) <= todayOfMonth) {
        lastMonthToDate.collected += row.amount;
        if (row.isDeposit === 0 && (row.status === 'booked' || row.status === 'partPaid')) lastMonthToDate.bookings += 1;
      }
      const m = byMonth.get(key) ?? { collected: 0, bookings: 0 };
      m.collected += row.amount;
      if (row.isDeposit === 0 && (row.status === 'booked' || row.status === 'partPaid')) m.bookings += 1;
      byMonth.set(key, m);
    }
    const collectionTrend = Array.from({ length: COLLECTION_MONTHS }, (_, i) => {
      const key = monthBefore(thisMonth, COLLECTION_MONTHS - 1 - i);
      return {
        key,
        month: MONTH_LABEL[Number(key.slice(5)) - 1],
        year: Number(key.slice(0, 4)),
        collection: byMonth.get(key)?.collected ?? 0,
        bookings: byMonth.get(key)?.bookings ?? 0,
        lastYear: byMonth.get(monthBefore(key, 12))?.collected ?? 0,
      };
    });
    const monthCompare = {
      collectedThisMonth: byMonth.get(thisMonth)?.collected ?? 0,
      collectedLastMonth: byMonth.get(lastMonth)?.collected ?? 0,
      collectedLastMonthToDate: lastMonthToDate.collected,
      confirmedThisMonth: byMonth.get(thisMonth)?.bookings ?? 0,
      confirmedLastMonth: byMonth.get(lastMonth)?.bookings ?? 0,
      confirmedLastMonthToDate: lastMonthToDate.bookings,
    };

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
    const roleCounts = countBy(usersByRole, ['channel_partner', 'employee', 'leader', 'admin'], (r) => r.role as 'channel_partner');
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
      agents: roleCounts.get('channel_partner') ?? 0,
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
      collectionTrend,
      monthCompare,
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

/**
 * The management view: the sales pipeline, bookings, collections, post-sales and partner business,
 * each figure with the page that lists the records behind it. A section appears only for someone
 * who may open the module it comes from, and leads are counted within the person's own scope.
 */
adminDashboardRouter.get('/management', async (req: AuthedRequest, res, next) => {
  try {
    const access = await resolveAccess(req.auth!.sub);
    const has = (m: string) => access.isFullAccess || (access.modules as string[]).includes(m);
    const out: Record<string, unknown> = {};

    if (has('crm')) {
      const where = { ...leadScopeWhere(await scopeOf(req)) };
      const [byStage, bySource, open] = await Promise.all([
        prisma.lead.groupBy({ by: ['pipelineStageId'], where: { ...where, pipelineStageId: { not: null } }, _count: { _all: true }, _sum: { dealValue: true } }),
        prisma.lead.groupBy({ by: ['originalSource'], where, _count: { _all: true } }),
        prisma.lead.aggregate({ where: { ...where, dealValue: { not: null }, stage: { is: { isWon: false, isLost: false } } }, _count: { _all: true }, _sum: { dealValue: true } }),
      ]);
      const stages = await prisma.pipelineStage.findMany({ where: { id: { in: byStage.map((s) => s.pipelineStageId!) } }, select: { id: true, name: true, pipelineId: true, sortOrder: true, isWon: true, isLost: true } });
      const sid = new Map(stages.map((s) => [s.id, s]));
      // One pipeline at a time reads sensibly: the one that holds most of the leads.
      const perPipeline = new Map<string, number>();
      for (const r of byStage) perPipeline.set(sid.get(r.pipelineStageId!)?.pipelineId ?? '', (perPipeline.get(sid.get(r.pipelineStageId!)?.pipelineId ?? '') ?? 0) + r._count._all);
      const main = [...perPipeline.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      out.pipeline = byStage
        .filter((r) => sid.get(r.pipelineStageId!)?.pipelineId === main)
        .sort((a, b) => sid.get(a.pipelineStageId!)!.sortOrder - sid.get(b.pipelineStageId!)!.sortOrder)
        .map((r) => ({ stageId: r.pipelineStageId, name: sid.get(r.pipelineStageId!)!.name, isWon: sid.get(r.pipelineStageId!)!.isWon, isLost: sid.get(r.pipelineStageId!)!.isLost, leads: r._count._all, value: r._sum.dealValue ?? 0, to: `/crm/leads?stageId=${r.pipelineStageId}` }));
      out.expectedBusiness = { leads: open._count._all, value: open._sum.dealValue ?? 0, to: '/crm/leads' };
      out.sources = bySource.map((r) => ({ source: r.originalSource ?? 'unknown', leads: r._count._all, to: r.originalSource ? `/crm/leads?source=${r.originalSource}` : '/crm/leads' })).sort((a, b) => b.leads - a.leads).slice(0, 8);
    }

    if (has('bookings')) {
      const rows = await prisma.booking.groupBy({ by: ['status'], where: { isDeposit: 0 }, _count: { _all: true }, _sum: { amount: true } });
      const pick = (...s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => ({ count: a.count + r._count._all, amount: a.amount + (r._sum.amount ?? 0) }), { count: 0, amount: 0 });
      out.bookings = { pending: { ...pick('pending'), to: '/bookings/pending' }, confirmed: { ...pick('booked', 'partPaid'), to: '/bookings/booked' } };
    }

    if (has('legal')) {
      const [milestones, files, registries, loans] = await Promise.all([
        prisma.paymentMilestone.findMany({ where: { file: { closedAt: null } }, include: { payments: true } }),
        prisma.legalFile.findMany({ select: { closedAt: true, stages: { select: { id: true } } } }),
        prisma.registry.findMany({ select: { status: true, possessionOn: true } }),
        prisma.bankLoan.count({ where: { status: 'applied' } }),
      ]);
      let outstanding = 0, overdue = 0, overdueCount = 0;
      for (const m of milestones) { const s = milestoneState(m); outstanding += s.outstanding; if (s.status === 'overdue') { overdue += s.outstanding; overdueCount += 1; } }
      out.collections = { outstanding, overdue, overdueCount, to: '/legal?overdue=1' };
      const registered = registries.filter((r) => r.status === 'registered');
      out.postSales = {
        openFiles: files.filter((f) => !f.closedAt).length,
        agreementNotStarted: { count: files.filter((f) => f.stages.length === 0).length, to: '/legal?stage=none' },
        registryInProgress: { count: files.length - registered.length, to: '/legal?registry=in_progress' },
        possessionPending: { count: registered.filter((r) => !r.possessionOn).length, to: '/legal?registry=possession_pending' },
        possessed: { count: registered.filter((r) => r.possessionOn).length, to: '/legal?registry=possessed' },
        loansAwaitingBank: loans,
      };
    }

    if (has('partners')) {
      const rows = await prisma.booking.groupBy({ by: ['userId'], where: { isDeposit: 0, status: { not: 'cancelled' }, user: { is: { role: 'channel_partner' } } }, _count: { _all: true }, _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: 5 });
      const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId!) } }, select: { id: true, name: true } });
      const name = new Map(users.map((u) => [u.id, u.name]));
      out.partners = rows.map((r) => ({ id: r.userId, name: name.get(r.userId!) ?? 'Partner', bookings: r._count._all, value: r._sum.amount ?? 0, to: `/channel-partners/${r.userId}` }));
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});
