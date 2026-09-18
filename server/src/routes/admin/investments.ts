import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { adminInvestment } from '../../services/adminMappers';
import { paginateInMemory, parseListQuery } from '../../services/list';

export const adminInvestmentsRouter = Router();

const rowInclude = {
  unit: {
    select: {
      propertyNumber: true, propertyTitle: true, projectId: true, bookingStatus: true, isVerified: true,
      project: { select: { projectName: true } },
    },
  },
  user: { select: { name: true } },
  booking: { select: { reference: true } },
} satisfies Prisma.InvestmentInclude;

type InvestmentRow = Prisma.InvestmentGetPayload<{ include: typeof rowInclude }>;

export type InvestmentBucket = 'running' | 'due' | 'expired' | 'completed';

/**
 * The four buckets the real `InvestmentController::investments()` query produces. None of
 * them is a stored field — they come from `isActive` plus the linked plot's
 * `bookingStatus`/`isVerified` plus `returnDate`, exactly as in the real system.
 */
export function investmentBucket(investment: InvestmentRow): InvestmentBucket {
  if (investment.unit.bookingStatus === 2) return 'completed';
  if (investment.isActive === 0) return 'expired';
  if (investment.returnDate && investment.returnDate <= new Date()) return 'due';
  if (investment.unit.bookingStatus === 1 && investment.unit.isVerified) return 'running';
  return 'running';
}

function investmentRow(investment: InvestmentRow) {
  return {
    ...adminInvestment(investment),
    bucket: investmentBucket(investment),
    projectId: investment.unit.projectId,
    projectName: investment.unit.project.projectName,
    unitLabel: `${investment.unit.propertyNumber} · ${investment.unit.propertyTitle}`,
    userName: investment.user.name,
    bookingReference: investment.booking.reference,
  };
}

/**
 * `bucket` is derived, so it cannot be a SQL filter — the rows are narrowed in SQL by
 * everything that IS a column, then bucketed and paged in memory.
 */
adminInvestmentsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const bucket = String(req.query.bucket ?? 'all');
    const projectId = String(req.query.projectId ?? 'all');
    const userId = String(req.query.userId ?? 'all');

    const where: Prisma.InvestmentWhereInput = {};
    if (projectId !== 'all' && projectId !== '') where.unit = { projectId };
    if (userId !== 'all' && userId !== '') where.userId = userId;

    const all = await prisma.investment.findMany({ where, include: rowInclude, orderBy: { createdAt: 'desc' } });
    const rows = all
      .map(investmentRow)
      .filter((r) => bucket === 'all' || bucket === '' || r.bucket === bucket)
      .filter((r) => {
        if (!query.search) return true;
        const q = query.search.toLowerCase();
        return (
          r.bookingReference.toLowerCase().includes(q) ||
          r.unitLabel.toLowerCase().includes(q) ||
          r.userName.toLowerCase().includes(q)
        );
      });

    res.json(
      paginateInMemory(rows, query, (a, b, sortBy) => {
        if (sortBy === 'amount') return a.amount - b.amount;
        if (sortBy === 'profit') return a.profit - b.profit;
        if (sortBy === 'updatedAt') return a.updatedAt.localeCompare(b.updatedAt);
        return 0;
      })
    );
  } catch (err) {
    next(err);
  }
});

adminInvestmentsRouter.get('/:id', async (req, res, next) => {
  try {
    const investment = await prisma.investment.findUnique({ where: { id: String(req.params.id) }, include: rowInclude });
    if (!investment) return res.status(404).json({ error: 'Investment not found' });
    res.json(investmentRow(investment));
  } catch (err) {
    next(err);
  }
});

adminInvestmentsRouter.get('/property/:propertyId', async (req, res, next) => {
  try {
    const rows = await prisma.investment.findMany({
      where: { propertyId: String(req.params.propertyId) },
      include: rowInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ investments: rows.map(investmentRow) });
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `investDeactive`/`activeMultiple` — deactivation always needs a reason. */
adminInvestmentsRouter.post('/:id/active', async (req: AuthedRequest, res, next) => {
  try {
    const isActive = Number(req.body?.isActive) === 1 ? 1 : 0;
    const reason = req.body?.reason ? String(req.body.reason) : null;
    if (isActive === 0 && !reason) {
      return res.status(400).json({ error: 'A reason is required when deactivating an investment.' });
    }
    const updated = await prisma.investment.update({
      where: { id: String(req.params.id) },
      data: { isActive, deactiveReason: isActive === 0 ? reason : null },
      include: rowInclude,
    });
    await writeAudit(req, {
      module: 'Investments',
      action: isActive === 1 ? 'Activated investment' : 'Deactivated investment',
      recordId: updated.id,
      recordLabel: `Investment ${updated.id}`,
      description: isActive === 0 ? `Investment deactivated: ${reason}` : 'Investment reactivated.',
    });
    res.json(investmentRow(updated));
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `investPaymentSingleUser` — records that a profit return was disbursed. */
adminInvestmentsRouter.post('/:id/return', async (req: AuthedRequest, res, next) => {
  try {
    const updated = await prisma.investment.update({
      where: { id: String(req.params.id) },
      data: { lastReturnDate: new Date() },
      include: rowInclude,
    });
    await writeAudit(req, {
      module: 'Investments',
      action: 'Triggered profit return',
      recordId: updated.id,
      recordLabel: `Investment ${updated.id}`,
      description: `Profit return of ${updated.netProfit} disbursed for investment ${updated.id}.`,
    });
    res.json(investmentRow(updated));
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `investPaymentAllUser` — every running investment on one plot. */
adminInvestmentsRouter.post('/property/:propertyId/return', async (req: AuthedRequest, res, next) => {
  try {
    const propertyId = String(req.params.propertyId);
    const all = await prisma.investment.findMany({ where: { propertyId }, include: rowInclude });
    const targets = all.filter((inv) => investmentBucket(inv) === 'running');
    if (targets.length > 0) {
      await prisma.investment.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: { lastReturnDate: new Date() },
      });
    }
    await writeAudit(req, {
      module: 'Investments',
      action: 'Triggered bulk profit return',
      recordId: propertyId,
      recordLabel: `Property ${propertyId}`,
      description: `Profit return disbursed to ${targets.length} investor(s) on property ${propertyId}.`,
    });
    res.json({ updated: targets.length });
  } catch (err) {
    next(err);
  }
});
