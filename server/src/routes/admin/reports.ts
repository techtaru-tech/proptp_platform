import { Router } from 'express';
import { prisma } from '../../prisma';
import { PAYMENT_MODE_ID, attendanceStatus } from '../../services/adminMappers';
import { aggregateProject } from '../../services/derive';
import ExcelJS from 'exceljs';
import { REPORT_CATALOGUE, buildReport, hasReport } from '../../services/projectReports';

export const adminOpsReportsRouter = Router();

/**
 * The eight operational reports under /reports. Each returns a flat row array — the
 * frontend renders it as a table and exports it to CSV from exactly that shape, so a new
 * column here needs no frontend change.
 *
 * These are the operational reports. The CRM's own report centre is separate and
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

// ---------------------------------------------------------------------------
// Project & operations reports — one definition each (services/projectReports.ts), rendered by
// the screen, the Excel export and the PDF export alike.
// ---------------------------------------------------------------------------

adminOpsReportsRouter.get('/suite', (_req, res) => {
  res.json(REPORT_CATALOGUE);
});

adminOpsReportsRouter.get('/suite/:key', async (req, res, next) => {
  try {
    const key = String(req.params.key);
    if (!hasReport(key)) return res.status(404).json({ error: 'No such report.' });
    res.json(await buildReport(key, { projectId: req.query.projectId ? String(req.query.projectId) : undefined }));
  } catch (err) {
    next(err);
  }
});

adminOpsReportsRouter.get('/suite/:key/export.xlsx', async (req, res, next) => {
  try {
    const key = String(req.params.key);
    if (!hasReport(key)) return res.status(404).json({ error: 'No such report.' });
    const report = await buildReport(key, { projectId: req.query.projectId ? String(req.query.projectId) : undefined });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Propto CRM';
    const used = new Set<string>();
    for (const t of report.tables) {
      // Sheet names are capped at 31 characters and must be unique.
      let name = t.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
      while (used.has(name)) name = `${name.slice(0, 28)}_${used.size}`;
      used.add(name);
      const ws = wb.addWorksheet(name);
      ws.addRow([report.title]).font = { bold: true, size: 13 };
      ws.addRow([report.summary.map((s) => `${s.label}: ${s.value}`).join('   ·   ')]);
      ws.addRow([]);
      const head = ws.addRow(t.columns);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF652251' } }; });
      t.rows.forEach((r) => ws.addRow(r));
      t.columns.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        col.width = Math.min(40, Math.max(c.length + 2, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2)));
        if (t.money?.includes(i)) col.numFmt = '"₹"#,##,##0';
      });
    }
    if (report.tables.length === 0) wb.addWorksheet('Report');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${key}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});
