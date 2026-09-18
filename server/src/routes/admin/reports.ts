import { Router } from 'express';
import { prisma } from '../../prisma';
import { PAYMENT_MODE_ID, attendanceStatus } from '../../services/adminMappers';
import { aggregateProject } from '../../services/derive';

export const adminOpsReportsRouter = Router();

/**
 * The eight operational reports under /reports. Each returns a flat row array — the
 * frontend renders it as a table and exports it to CSV from exactly that shape, so a new
 * column here needs no frontend change.
 *
 * These are the ShreeRam operational reports. The CRM's own report centre is separate and
 * already lives on /api/reports (server/src/routes/reports.ts).
 */

const PAYMENT_MODE_LABEL: Record<number, string> = {
  0: 'Bank Transfer',
  1: 'Cash',
  2: 'Cheque',
  3: 'Other',
  4: 'Online',
};

adminOpsReportsRouter.get('/properties', async (_req, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      include: { units: { include: { _count: { select: { bookings: true } } } } },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({
      rows: projects.map((p) => {
        const agg = aggregateProject(p, p.units);
        return {
          id: p.id,
          name: p.projectName,
          location: p.projectLocation,
          status: p.status === 1 ? 'Active' : 'Deactive',
          totalUnits: agg.propertyCount,
          available: agg.availableCount,
          booked: p.units.filter((u) => u.bookingStatus === 1).length,
          sold: p.units.filter((u) => u.bookingStatus === 2).length,
          bookingsCount: p.units.reduce((sum, u) => sum + u._count.bookings, 0),
          startingPrice: agg.startingPrice,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

adminOpsReportsRouter.get('/bookings', async (_req, res, next) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: { isDeposit: 0 },
      include: {
        unit: { select: { propertyNumber: true, project: { select: { projectName: true } } } },
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      rows: bookings.map((b) => ({
        id: b.reference,
        date: b.createdAt.toISOString(),
        project: b.unit?.project.projectName ?? '—',
        plot: b.unit?.propertyNumber ?? '—',
        customer: b.bookingName,
        partner: b.user?.name ?? '—',
        status: b.status,
        amount: b.amount,
        commission: b.commission,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminOpsReportsRouter.get('/payments', async (_req, res, next) => {
  try {
    const bookings = await prisma.booking.findMany({
      include: { unit: { select: { propertyNumber: true, project: { select: { projectName: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      rows: bookings.map((b) => ({
        id: b.reference,
        date: b.createdAt.toISOString(),
        project: b.unit?.project.projectName ?? '—',
        plot: b.unit?.propertyNumber ?? '—',
        paymentMode: PAYMENT_MODE_LABEL[PAYMENT_MODE_ID[b.paymentMode]],
        amount: b.amount,
        status: b.isDeposit === 1 ? 'Installment' : 'Initial Payment',
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminOpsReportsRouter.get('/partners', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { not: 'admin' } },
      include: { team: { select: { name: true } }, _count: { select: { bookings: true } } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.json({
      rows: users.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        partnerCode: u.partnerCode,
        status: u.status,
        team: u.team?.name ?? '—',
        bookings: u._count.bookings,
        walletBalance: u.walletBalance,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminOpsReportsRouter.get('/teams', async (_req, res, next) => {
  try {
    const teams = await prisma.team.findMany({
      include: { leader: { select: { name: true } }, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({
      rows: teams.map((t) => ({
        id: t.id,
        name: t.name,
        leader: t.leader?.name ?? '—',
        members: t._count.members,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminOpsReportsRouter.get('/attendance', async (_req, res, next) => {
  try {
    // Capped: this feeds a screen and a CSV export, not an analytics warehouse.
    const records = await prisma.attendanceRecord.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 2000,
    });
    res.json({
      rows: records.map((r) => ({
        id: r.id,
        user: r.user.name,
        date: r.date.toISOString(),
        status: attendanceStatus(r),
        hours: r.workingHours ?? 0,
        late: r.isLate,
        geoResult: r.geoFenceResult,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminOpsReportsRouter.get('/support', async (_req, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      include: { user: { select: { name: true } }, _count: { select: { messages: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      rows: tickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        user: t.user.name,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        messageCount: t._count.messages,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminOpsReportsRouter.get('/payouts', async (_req, res, next) => {
  try {
    const payouts = await prisma.payoutRequest.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { requestDate: 'desc' },
    });
    res.json({
      rows: payouts.map((p) => ({
        id: p.id,
        user: p.user.name,
        requestDate: p.requestDate.toISOString(),
        amount: p.amount,
        status: p.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});
