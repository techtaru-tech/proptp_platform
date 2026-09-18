import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { adminFund, adminIncentiveRequest } from '../../services/adminMappers';
import { listResult, parseListQuery } from '../../services/list';

export const adminFundsRouter = Router();
export const adminIncentivesRouter = Router();

// ---------------------------------------------------------------------------
// Wallet deposits (real `funds` table): 2 = pending, 1 = approved, 3 = rejected
// ---------------------------------------------------------------------------

const fundInclude = { user: { select: { name: true, phone: true } } } satisfies Prisma.FundRequestInclude;

adminFundsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const status = String(req.query.status ?? 'all');

    const where: Prisma.FundRequestWhereInput = {};
    if (status !== 'all' && status !== '') where.status = Number(status);
    if (query.search) {
      where.OR = [
        { trxId: { contains: query.search, mode: 'insensitive' } },
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const orderBy: Prisma.FundRequestOrderByWithRelationInput =
      query.sortBy === 'amount' ? { amount: query.sortDir } : { createdAt: query.sortBy === 'createdAt' ? query.sortDir : 'desc' };

    const [rows, total] = await Promise.all([
      prisma.fundRequest.findMany({ where, include: fundInclude, orderBy, skip: query.skip, take: query.take }),
      prisma.fundRequest.count({ where }),
    ]);
    res.json(listResult(rows.map((f) => ({ ...adminFund(f), userName: f.user.name, userPhone: f.user.phone })), total, query));
  } catch (err) {
    next(err);
  }
});

adminFundsRouter.get('/:id', async (req, res, next) => {
  try {
    const fund = await prisma.fundRequest.findUnique({ where: { id: String(req.params.id) }, include: fundInclude });
    if (!fund) return res.status(404).json({ error: 'Fund request not found' });
    res.json({ ...adminFund(fund), userName: fund.user.name, userPhone: fund.user.phone });
  } catch (err) {
    next(err);
  }
});

/**
 * Mirrors the real `PaymentLogController::action()` approve path — credits the partner's
 * wallet balance. Both writes happen in one transaction so an approved deposit can never
 * exist without the matching balance change.
 */
adminFundsRouter.post('/:id/approve', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const fund = await prisma.fundRequest.findUnique({ where: { id }, include: fundInclude });
    if (!fund) return res.status(404).json({ error: 'Fund request not found' });
    if (fund.status !== 2) return res.status(409).json({ error: 'Only a pending deposit can be approved.' });

    const [updated] = await prisma.$transaction([
      prisma.fundRequest.update({
        where: { id },
        data: { status: 1, feedback: req.body?.feedback ? String(req.body.feedback) : null },
        include: fundInclude,
      }),
      prisma.user.update({ where: { id: fund.userId }, data: { walletBalance: { increment: fund.amount } } }),
    ]);

    await writeAudit(req, {
      module: 'Wallet Deposits',
      action: 'Approved wallet deposit',
      recordId: id,
      recordLabel: `Fund ${fund.trxId}`,
      description: `${fund.trxId} approved — ${fund.amount} credited to ${fund.user.name}'s wallet.`,
    });
    res.json({ ...adminFund(updated), userName: updated.user.name, userPhone: updated.user.phone });
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real reject path — no balance change, and feedback is mandatory. */
adminFundsRouter.post('/:id/reject', async (req: AuthedRequest, res, next) => {
  try {
    const feedback = String(req.body?.feedback ?? '').trim();
    if (!feedback) return res.status(400).json({ error: 'Feedback is required when rejecting a deposit.' });

    const id = String(req.params.id);
    const fund = await prisma.fundRequest.findUnique({ where: { id }, select: { status: true, trxId: true } });
    if (!fund) return res.status(404).json({ error: 'Fund request not found' });
    if (fund.status !== 2) return res.status(409).json({ error: 'Only a pending deposit can be rejected.' });

    const updated = await prisma.fundRequest.update({
      where: { id },
      data: { status: 3, feedback },
      include: fundInclude,
    });
    await writeAudit(req, {
      module: 'Wallet Deposits',
      action: 'Rejected wallet deposit',
      recordId: id,
      recordLabel: `Fund ${fund.trxId}`,
      description: `${fund.trxId} rejected: ${feedback}`,
    });
    res.json({ ...adminFund(updated), userName: updated.user.name, userPhone: updated.user.phone });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Incentive requests (real `incentive_reqs`): 0 = pending, 1 = accepted, 2 = rejected
// ---------------------------------------------------------------------------

const incentiveInclude = {
  user: { select: { name: true } },
  unit: { select: { propertyNumber: true, propertyTitle: true, project: { select: { projectName: true } } } },
} satisfies Prisma.IncentiveRequestInclude;

adminIncentivesRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const status = String(req.query.status ?? 'all');

    const where: Prisma.IncentiveRequestWhereInput = {};
    if (status !== 'all' && status !== '') where.status = Number(status);
    if (query.search) where.user = { name: { contains: query.search, mode: 'insensitive' } };

    const [rows, total] = await Promise.all([
      prisma.incentiveRequest.findMany({
        where,
        include: incentiveInclude,
        orderBy: { createdAt: query.sortBy === 'createdAt' ? query.sortDir : 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.incentiveRequest.count({ where }),
    ]);
    res.json(
      listResult(
        rows.map((r) => ({
          ...adminIncentiveRequest(r),
          userName: r.user.name,
          projectName: r.unit.project.projectName,
          unitLabel: `${r.unit.propertyNumber} · ${r.unit.propertyTitle}`,
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
 * Mirrors the real `incentivereqchange()` exactly — a thin status flip. The real handler
 * has no balance or transaction side effect of its own, so neither does this.
 */
adminIncentivesRouter.post('/:id/status', async (req: AuthedRequest, res, next) => {
  try {
    const status = Number(req.body?.status);
    if (status !== 1 && status !== 2) return res.status(400).json({ error: 'status must be 1 (accept) or 2 (reject).' });

    const updated = await prisma.incentiveRequest.update({
      where: { id: String(req.params.id) },
      data: { status },
      include: incentiveInclude,
    });
    await writeAudit(req, {
      module: 'Incentive Requests',
      action: status === 1 ? 'Accepted incentive request' : 'Rejected incentive request',
      recordId: updated.id,
      recordLabel: `Incentive Request ${updated.id}`,
      description: `Request for ${updated.unit.propertyNumber} was ${status === 1 ? 'accepted' : 'rejected'}.`,
    });
    res.json({
      ...adminIncentiveRequest(updated),
      userName: updated.user.name,
      projectName: updated.unit.project.projectName,
      unitLabel: `${updated.unit.propertyNumber} · ${updated.unit.propertyTitle}`,
    });
  } catch (err) {
    next(err);
  }
});
