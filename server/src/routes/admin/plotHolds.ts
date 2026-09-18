import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { adminPlotHold } from '../../services/adminMappers';
import { listResult, parseListQuery } from '../../services/list';

export const adminPlotHoldsRouter = Router();

const rowInclude = {
  unit: { select: { propertyNumber: true, propertyTitle: true, projectId: true, project: { select: { projectName: true } } } },
  user: { select: { name: true } },
} satisfies Prisma.PlotHoldInclude;

type HoldRow = Prisma.PlotHoldGetPayload<{ include: typeof rowInclude }>;

/** Pre-joined with plot, project and partner names — the same enrichment bookings get. */
function holdRow(hold: HoldRow) {
  return {
    ...adminPlotHold(hold),
    projectId: hold.unit.projectId,
    projectName: hold.unit.project.projectName,
    unitLabel: `${hold.unit.propertyNumber} · ${hold.unit.propertyTitle}`,
    userName: hold.user?.name ?? '—',
  };
}

adminPlotHoldsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const status = String(req.query.status ?? 'all');
    const projectId = String(req.query.projectId ?? 'all');

    const where: Prisma.PlotHoldWhereInput = {};
    if (status !== 'all' && status !== '') where.status = Number(status);
    if (projectId !== 'all' && projectId !== '') where.unit = { projectId };
    if (query.search) {
      where.OR = [
        { unit: { propertyNumber: { contains: query.search, mode: 'insensitive' } } },
        { unit: { propertyTitle: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const orderBy: Prisma.PlotHoldOrderByWithRelationInput =
      query.sortBy === 'holdEnd' ? { holdEnd: query.sortDir } : { createdAt: 'desc' };

    const [rows, total] = await Promise.all([
      prisma.plotHold.findMany({ where, include: rowInclude, orderBy, skip: query.skip, take: query.take }),
      prisma.plotHold.count({ where }),
    ]);
    res.json(listResult(rows.map(holdRow), total, query));
  } catch (err) {
    next(err);
  }
});

adminPlotHoldsRouter.get('/unit/:unitId/active', async (req, res, next) => {
  try {
    const hold = await prisma.plotHold.findFirst({
      where: { unitId: String(req.params.unitId), status: 1, holdEnd: { gt: new Date() } },
      include: rowInclude,
    });
    res.json(hold ? holdRow(hold) : null);
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `propertyholdsave()` — the admin, not the customer, places the hold. */
adminPlotHoldsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const unitId = String(body.unitId ?? '');
    const unit = await prisma.propertyUnit.findUnique({ where: { id: unitId } });
    if (!unit) return res.status(404).json({ error: 'Property not found' });
    if (unit.bookedById) return res.status(409).json({ error: 'Cannot hold a property that is already booked' });

    const existing = await prisma.plotHold.findFirst({
      where: { unitId, status: 1, holdEnd: { gt: new Date() } },
      select: { id: true },
    });
    if (existing) return res.status(409).json({ error: 'This property already has an active hold' });

    const holdStart = new Date(String(body.holdStart));
    const holdEnd = new Date(String(body.holdEnd));
    if (Number.isNaN(holdStart.getTime()) || Number.isNaN(holdEnd.getTime()) || holdEnd <= holdStart) {
      return res.status(400).json({ error: 'holdEnd must be a valid date after holdStart.' });
    }

    const created = await prisma.plotHold.create({
      data: { unitId, userId: body.userId ? String(body.userId) : null, holdStart, holdEnd, status: 1 },
      include: rowInclude,
    });
    await writeAudit(req, {
      module: 'Plot Holds',
      action: 'Created plot hold',
      recordId: created.id,
      recordLabel: `Hold on ${created.unit.propertyNumber}`,
      description: `Hold placed on ${created.unit.propertyNumber} until ${holdEnd.toISOString()}.`,
    });
    res.status(201).json(holdRow(created));
  } catch (err) {
    next(err);
  }
});

adminPlotHoldsRouter.post('/:id/release', async (req: AuthedRequest, res, next) => {
  try {
    const released = await prisma.plotHold.update({
      where: { id: String(req.params.id) },
      data: { status: 0 },
      include: rowInclude,
    });
    await writeAudit(req, {
      module: 'Plot Holds',
      action: 'Released plot hold',
      recordId: released.id,
      recordLabel: `Hold on ${released.unit.propertyNumber}`,
      description: `Hold on ${released.unit.propertyNumber} was released early by admin.`,
    });
    res.json(holdRow(released));
  } catch (err) {
    next(err);
  }
});
