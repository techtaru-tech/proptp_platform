import { Router } from 'express';
import type { Prisma, UserAccountStatus, UserRole } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { attendanceStatus, adminAttendance, adminBooking, adminPayout, adminUser } from '../../services/adminMappers';
import { listResult, parseListQuery } from '../../services/list';
import { dayKey } from '../../services/dates';
import { businessSummaryFor, downlineFor } from '../../services/derive';

export const adminUsersRouter = Router();
export const adminKycRouter = Router();

const userInclude = { bankAccounts: true } satisfies Prisma.UserInclude;

/**
 * The per-role extras the frontend's Agent/Employee/Leader types carry. All derived —
 * booking counts, downline sizes and today's attendance are queries, not stored columns.
 */
async function statsFor(users: { id: string; role: UserRole }[]) {
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();

  const [bookingCounts, referralCounts, reportCounts, todayAttendance] = await Promise.all([
    prisma.booking.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, isDeposit: 0, status: { not: 'cancelled' } },
      _count: { _all: true },
    }),
    prisma.user.groupBy({ by: ['sponsorId'], where: { sponsorId: { in: ids } }, _count: { _all: true } }),
    prisma.user.findMany({
      where: { OR: [{ sponsorId: { in: ids } }, { reportingLeaderId: { in: ids } }] },
      select: { role: true, sponsorId: true, reportingLeaderId: true },
    }),
    prisma.attendanceRecord.findMany({
      where: { userId: { in: ids }, date: dayKey() },
      select: { userId: true, checkInAt: true, checkOutAt: true, syncStatus: true },
    }),
  ]);

  const bookingsBy = new Map(bookingCounts.map((r) => [r.userId, r._count._all]));
  const referralsBy = new Map(referralCounts.map((r) => [r.sponsorId, r._count._all]));
  const attendanceBy = new Map(todayAttendance.map((r) => [r.userId, attendanceStatus(r)]));

  const teamTally = new Map<string, { total: number; employees: number; agents: number }>();
  for (const member of reportCounts) {
    for (const parentId of [member.sponsorId, member.reportingLeaderId]) {
      if (!parentId || !ids.includes(parentId)) continue;
      const tally = teamTally.get(parentId) ?? { total: 0, employees: 0, agents: 0 };
      tally.total += 1;
      if (member.role === 'employee') tally.employees += 1;
      if (member.role === 'agent') tally.agents += 1;
      teamTally.set(parentId, tally);
    }
  }

  return new Map(
    users.map((user) => {
      const tally = teamTally.get(user.id) ?? { total: 0, employees: 0, agents: 0 };
      const base: Record<string, unknown> = {};
      if (user.role === 'agent') {
        base.totalBookings = bookingsBy.get(user.id) ?? 0;
        base.totalReferrals = referralsBy.get(user.id) ?? 0;
      }
      if (user.role === 'employee' || user.role === 'leader') {
        base.attendanceStatusToday = attendanceBy.get(user.id) ?? 'not_checked_in';
      }
      if (user.role === 'leader') {
        base.teamSize = tally.total;
        base.employeeCount = tally.employees;
        base.agentCount = tally.agents;
      }
      return [user.id, base];
    })
  );
}

async function listByRole(req: AuthedRequest, role: UserRole) {
  const query = parseListQuery(req);
  const status = String(req.query.status ?? 'all');

  const where: Prisma.UserWhereInput = { role };
  if (status !== 'all' && status) where.status = status as UserAccountStatus;
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search } },
      { referralCode: { contains: query.search, mode: 'insensitive' } },
      { partnerCode: { contains: query.search, mode: 'insensitive' } },
      { designation: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const SORTABLE: Record<string, Prisma.UserOrderByWithRelationInput> = {
    name: { name: query.sortDir },
    createdAt: { createdAt: query.sortDir },
  };
  const orderBy = (query.sortBy && SORTABLE[query.sortBy]) || { createdAt: 'desc' as const };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, include: userInclude, orderBy, skip: query.skip, take: query.take }),
    prisma.user.count({ where }),
  ]);
  const stats = await statsFor(rows);
  return listResult(rows.map((u) => adminUser(u, stats.get(u.id) ?? {})), total, query);
}

adminUsersRouter.get('/agents', async (req, res, next) => {
  try {
    res.json(await listByRole(req, 'agent'));
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.get('/employees', async (req, res, next) => {
  try {
    res.json(await listByRole(req, 'employee'));
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.get('/leaders', async (req, res, next) => {
  try {
    res.json(await listByRole(req, 'leader'));
  } catch (err) {
    next(err);
  }
});

/**
 * Every partner in one flat list. Used for the assignable-user and filter dropdowns that
 * are scattered across the admin panel (lead assignment, booking filters, plot holds),
 * which all previously read the mock user arrays directly.
 */
adminUsersRouter.get('/', async (req, res, next) => {
  try {
    const roleParam = String(req.query.role ?? '').trim();
    const where: Prisma.UserWhereInput = {};
    if (['agent', 'employee', 'leader', 'admin'].includes(roleParam)) where.role = roleParam as UserRole;
    const users = await prisma.user.findMany({ where, include: userInclude, orderBy: { name: 'asc' } });
    const stats = await statsFor(users);
    res.json({ users: users.map((u) => adminUser(u, stats.get(u.id) ?? {})) });
  } catch (err) {
    next(err);
  }
});

/**
 * Everything the User Detail page shows, in one round trip. The mock layer faked this with
 * synchronous cross-collection lookups (bookingsByPartner, payoutsByUser, attendanceByUser);
 * this is the eager-load those were standing in for.
 */
adminUsersRouter.get('/:id/detail', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const user = await prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [bookings, payouts, attendance, downline, summary, stats] = await Promise.all([
      prisma.booking.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.payoutRequest.findMany({
        where: { userId: id },
        include: { user: { select: { name: true, role: true } }, history: { orderBy: { createdAt: 'asc' } } },
        orderBy: { requestDate: 'desc' },
        take: 50,
      }),
      prisma.attendanceRecord.findMany({
        where: { userId: id },
        include: { user: { select: { name: true, role: true } } },
        orderBy: { date: 'desc' },
        take: 60,
      }),
      downlineFor(id, 3),
      businessSummaryFor(id),
      statsFor([user]),
    ]);

    res.json({
      user: adminUser(user, stats.get(user.id) ?? {}),
      bookings: bookings.map(adminBooking),
      payouts: payouts.map(adminPayout),
      attendance: attendance.map(adminAttendance),
      downline: downline.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        role: m.user.role,
        level: m.level,
        bookings: m.bookings,
        activity: m.activity,
      })),
      summary,
    });
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.get('/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: String(req.params.id) }, include: userInclude });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const stats = await statsFor([user]);
    res.json(adminUser(user, stats.get(user.id) ?? {}));
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.patch('/:id/status', async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'status must be active, inactive or suspended.' });
    }
    const user = await prisma.user.update({
      where: { id: String(req.params.id) },
      data: { status: status as UserAccountStatus },
      include: userInclude,
    });
    await writeAudit(req, {
      module: 'Users',
      action: `Set account status to ${status}`,
      recordId: user.id,
      recordLabel: user.name,
      description: `${user.name}'s account was marked ${status}.`,
    });
    const stats = await statsFor([user]);
    res.json(adminUser(user, stats.get(user.id) ?? {}));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// KYC approvals
// ---------------------------------------------------------------------------

adminKycRouter.get('/', async (req, res, next) => {
  try {
    const query = parseListQuery(req);
    const status = String(req.query.status ?? 'all');

    const where: Prisma.UserWhereInput = { role: { not: 'admin' } };
    if (status !== 'all' && status !== '') where.kycStatus = Number(status);
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        { partnerCode: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { ...userInclude, kycDocuments: true },
        orderBy: { createdAt: query.sortBy === 'createdAt' ? query.sortDir : 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.user.count({ where }),
    ]);
    const stats = await statsFor(rows);
    res.json(
      listResult(
        rows.map((u) => ({
          ...adminUser(u, stats.get(u.id) ?? {}),
          kycDocuments: u.kycDocuments.map((d) => ({ kind: d.kind, fileUrl: d.fileUrl })),
        })),
        total,
        query
      )
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Mirrors the real `UsersController::kycAction()` exactly: only two outcomes, no
 * rejection-reason field, and a rejection ALSO deactivates the account.
 */
adminKycRouter.post('/:id/approve', async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: String(req.params.id) },
      data: { kycStatus: 1 },
      include: userInclude,
    });
    await writeAudit(req, {
      module: 'KYC',
      action: 'Approved KYC',
      recordId: user.id,
      recordLabel: user.name,
      description: `${user.name}'s KYC submission was verified.`,
    });
    res.json(adminUser(user));
  } catch (err) {
    next(err);
  }
});

adminKycRouter.post('/:id/reject', async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: String(req.params.id) },
      data: { kycStatus: 2, status: 'suspended' },
      include: userInclude,
    });
    await writeAudit(req, {
      module: 'KYC',
      action: 'Rejected KYC',
      recordId: user.id,
      recordLabel: user.name,
      description: `${user.name}'s KYC submission was rejected; the account has been deactivated.`,
    });
    res.json(adminUser(user));
  } catch (err) {
    next(err);
  }
});
