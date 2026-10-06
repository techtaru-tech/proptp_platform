import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { payableEntries } from '../../services/partners';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { adminCommissionStatement, adminPayout } from '../../services/adminMappers';
import { listResult, parseListQuery } from '../../services/list';

export const adminPayoutsRouter = Router();

const payoutInclude = {
  user: { select: { name: true, role: true } },
  history: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.PayoutRequestInclude;

adminPayoutsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const status = String(req.query.status ?? 'all');

    const where: Prisma.PayoutRequestWhereInput = {};
    if (status !== 'all' && status !== '') where.status = status as Prisma.EnumPayoutStatusFilter['equals'];
    if (query.search) where.user = { name: { contains: query.search, mode: 'insensitive' } };

    const orderBy: Prisma.PayoutRequestOrderByWithRelationInput =
      query.sortBy === 'amount'
        ? { amount: query.sortDir }
        : { requestDate: query.sortBy === 'requestDate' ? query.sortDir : 'desc' };

    const [rows, total] = await Promise.all([
      prisma.payoutRequest.findMany({ where, include: payoutInclude, orderBy, skip: query.skip, take: query.take }),
      prisma.payoutRequest.count({ where }),
    ]);
    res.json(listResult(rows.map(adminPayout), total, query));
  } catch (err) {
    next(err);
  }
});

/** The Commission Statements screen, reading the shared EarningEntry ledger. */
adminPayoutsRouter.get('/statements', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const dateFrom = String(req.query.dateFrom ?? '');
    const dateTo = String(req.query.dateTo ?? '');

    const where: Prisma.EarningEntryWhereInput = {};
    if (dateFrom || dateTo) {
      where.creditedOn = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
      };
    }
    if (query.search) where.user = { name: { contains: query.search, mode: 'insensitive' } };

    const orderBy: Prisma.EarningEntryOrderByWithRelationInput =
      query.sortBy === 'commission' ? { amount: query.sortDir } : { creditedOn: query.sortBy === 'date' ? query.sortDir : 'desc' };

    const [rows, total] = await Promise.all([
      prisma.earningEntry.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy,
        skip: query.skip,
        take: query.take,
      }),
      prisma.earningEntry.count({ where }),
    ]);

    // Referral rows name the downline partner they came from; resolved in one query.
    const referralIds = [...new Set(rows.map((r) => r.referralUserId).filter((id): id is string => !!id))];
    const referralNames = referralIds.length
      ? await prisma.user.findMany({ where: { id: { in: referralIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(referralNames.map((u) => [u.id, u.name]));

    res.json(
      listResult(
        rows.map((r) => adminCommissionStatement({ ...r, referralUserName: r.referralUserId ? nameById.get(r.referralUserId) : null })),
        total,
        query
      )
    );
  } catch (err) {
    next(err);
  }
});

adminPayoutsRouter.get('/:id', async (req, res, next) => {
  try {
    const payout = await prisma.payoutRequest.findUnique({ where: { id: String(req.params.id) }, include: payoutInclude });
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    res.json(adminPayout(payout));
  } catch (err) {
    next(err);
  }
});

/**
 * Applies a status change and records the matching history event. The event is written
 * BEFORE the row is read back, so the response's `statusHistory` includes the transition
 * that was just made rather than lagging one entry behind it.
 */
async function transition(
  req: AuthedRequest,
  id: string,
  next: 'confirmed' | 'released' | 'rejected' | 'failed',
  note: string
) {
  return prisma.$transaction(async (tx) => {
    await tx.payoutRequest.update({
      where: { id },
      data: { status: next, processor: req.auth ? undefined : 'System' },
    });
    await tx.payoutStatusEvent.create({ data: { payoutId: id, status: next, note } });
    return tx.payoutRequest.findUniqueOrThrow({ where: { id }, include: payoutInclude });
  });
}

/** Mirrors the real `payoutConfirm()` — valid only from `pending`. */
adminPayoutsRouter.post('/:id/confirm', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const payout = await prisma.payoutRequest.findUnique({ where: { id }, select: { status: true } });
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    if (payout.status !== 'pending') return res.status(409).json({ error: 'Only a pending payout can be confirmed.' });

    const updated = await transition(req, id, 'confirmed', 'Confirmed by finance / gateway');
    await writeAudit(req, {
      module: 'Payouts',
      action: 'Confirmed payout',
      recordId: id,
      recordLabel: `Payout ${id} — ${updated.user.name}`,
    });
    res.json(adminPayout(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * Mirrors the real `payoutRelease()` — valid only from `confirmed`, and BLOCKED when the
 * partner's wallet balance is insufficient (the real system checks the balance before
 * debiting). The debit, the status change and the ledger update are one transaction.
 */
adminPayoutsRouter.post('/:id/release', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const payout = await prisma.payoutRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, walletBalance: true } } },
    });
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    if (payout.status !== 'confirmed') return res.status(409).json({ error: 'Only a confirmed payout can be released.' });
    if (payout.user.walletBalance < payout.amount) {
      return res.status(409).json({
        error: `Insufficient wallet balance (${payout.user.walletBalance} available, ${payout.amount} required).`,
      });
    }

    // Brokerage is paid only once its milestone is reached (Settings > Sales policy).
    const payable = await payableEntries(payout.user.id);
    if (payout.amount > payable.total) {
      return res.status(409).json({ error: `Only ₹${payable.total.toLocaleString('en-IN')} of this partner's earnings has reached its milestone${payable.waitingTotal ? ` (₹${payable.waitingTotal.toLocaleString('en-IN')} is still waiting for it)` : ''}. The payout of ₹${payout.amount.toLocaleString('en-IN')} cannot be released yet.` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.payoutRequest.update({ where: { id }, data: { status: 'released' } });
      await tx.payoutStatusEvent.create({
        data: { payoutId: id, status: 'released', note: 'Amount debited and credited to bank account' },
      });
      await tx.user.update({ where: { id: payout.user.id }, data: { walletBalance: { decrement: payout.amount } } });
      // Everything this partner had pending is now paid out, which is what makes the app's
      // released/in_process/pending earnings split move.
      await tx.earningEntry.updateMany({
        where: { id: { in: payable.ids } },
        data: { status: 'released' },
      });
      return tx.payoutRequest.findUniqueOrThrow({ where: { id }, include: payoutInclude });
    });

    await writeAudit(req, {
      module: 'Payouts',
      action: 'Released payout',
      recordId: id,
      recordLabel: `Payout ${id} — ${updated.user.name}`,
      description: `${payout.amount} released to ${updated.user.name}.`,
    });
    res.json(adminPayout(updated));
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `payoutCancel()` — only from `pending`, and feedback is required. */
adminPayoutsRouter.post('/:id/reject', async (req: AuthedRequest, res, next) => {
  try {
    const note = String(req.body?.note ?? '').trim();
    if (!note) return res.status(400).json({ error: 'A note is required when rejecting a payout.' });

    const id = String(req.params.id);
    const payout = await prisma.payoutRequest.findUnique({ where: { id }, select: { status: true } });
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    if (payout.status !== 'pending') return res.status(409).json({ error: 'Only a pending payout can be rejected.' });

    const updated = await transition(req, id, 'rejected', note);
    await writeAudit(req, {
      module: 'Payouts',
      action: 'Rejected payout',
      recordId: id,
      recordLabel: `Payout ${id} — ${updated.user.name}`,
      description: note,
    });
    res.json(adminPayout(updated));
  } catch (err) {
    next(err);
  }
});

/** An automatic-gateway payout failure — refunds the wallet if it was already debited. */
adminPayoutsRouter.post('/:id/fail', async (req: AuthedRequest, res, next) => {
  try {
    const error = String(req.body?.error ?? '').trim() || 'Gateway payout failed';
    const id = String(req.params.id);
    const payout = await prisma.payoutRequest.findUnique({ where: { id }, select: { status: true, userId: true, amount: true } });
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    if (payout.status !== 'confirmed' && payout.status !== 'released') {
      return res.status(409).json({ error: 'Only a confirmed or released payout can fail.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.payoutRequest.update({ where: { id }, data: { status: 'failed', lastError: error } });
      await tx.payoutStatusEvent.create({ data: { payoutId: id, status: 'failed', note: error } });
      if (payout.status === 'released') {
        await tx.user.update({ where: { id: payout.userId }, data: { walletBalance: { increment: payout.amount } } });
      }
      return tx.payoutRequest.findUniqueOrThrow({ where: { id }, include: payoutInclude });
    });

    await writeAudit(req, {
      module: 'Payouts',
      action: 'Payout failed via gateway webhook',
      recordId: id,
      recordLabel: `Payout ${id} — ${updated.user.name}`,
      description: error,
    });
    res.json(adminPayout(updated));
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `PayoutRecordController::store()` — a manual payout on a partner's behalf. */
adminPayoutsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = String(req.body?.userId ?? '');
    const amount = Math.round(Number(req.body?.amount) || 0);
    const status = String(req.body?.status ?? 'confirmed');
    if (!['confirmed', 'released'].includes(status)) {
      return res.status(400).json({ error: 'status must be confirmed or released.' });
    }
    if (amount <= 0) return res.status(400).json({ error: 'amount must be greater than zero.' });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { bankAccounts: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (status === 'released' && user.walletBalance < amount) {
      return res.status(409).json({ error: `Insufficient wallet balance (${user.walletBalance} available).` });
    }

    const primary = user.bankAccounts.find((a) => a.isPrimary) ?? user.bankAccounts[0];
    const actor = req.auth ? await prisma.user.findUnique({ where: { id: req.auth.sub }, select: { name: true } }) : null;

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.payoutRequest.create({
        data: {
          userId,
          amount,
          status: status as 'confirmed' | 'released',
          processor: actor?.name ?? 'Admin',
          bankAccountMasked: primary ? `•••• •••• ${primary.accountNumber.slice(-4)}` : '',
          bankIfsc: primary?.ifsc ?? '',
          referralBonus: amount,
          commission: 0,
          isAutomaticMethod: false,
          history: {
            create: [
              { status: 'pending', note: 'Created manually by admin' },
              { status: 'confirmed', note: 'Confirmed on manual creation' },
              ...(status === 'released' ? [{ status: 'released' as const, note: 'Released immediately by admin' }] : []),
            ],
          },
        },
        include: payoutInclude,
      });
      if (status === 'released') {
        await tx.user.update({ where: { id: userId }, data: { walletBalance: { decrement: amount } } });
      }
      return row;
    });

    await writeAudit(req, {
      module: 'Payouts',
      action: 'Created manual payout',
      recordId: created.id,
      recordLabel: `Payout ${created.id} — ${user.name}`,
      description: `Manual payout of ${amount} created for ${user.name}.`,
    });
    res.status(201).json(adminPayout(created));
  } catch (err) {
    next(err);
  }
});
