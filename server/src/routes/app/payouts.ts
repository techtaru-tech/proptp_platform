import { Router } from 'express';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { businessSummaryFor } from '../../services/derive';

/**
 * Partner-initiated payout requests. The amount is never sent by the client — it is derived
 * server-side from what the partner has actually earned, the same reasoning that makes
 * POST /bookings read the token amount off the plot instead of trusting the request.
 */
export const appPayoutsRouter = Router();

appPayoutsRouter.use(requireAuth);

function fail(res: any, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** A request already in flight covers the same earnings, so a second one would double-pay. */
const IN_FLIGHT = ['pending', 'confirmed'] as const;

appPayoutsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;

    const inFlight = await prisma.payoutRequest.findFirst({
      where: { userId, status: { in: [...IN_FLIGHT] } },
      select: { id: true },
    });
    if (inFlight) {
      return fail(res, 409, 'payout_in_progress', 'You already have a payout request being processed.');
    }

    const primary = await prisma.bankAccount.findFirst({ where: { userId, isPrimary: true } });
    if (!primary) {
      return fail(res, 400, 'no_primary_bank_account', 'Add a bank account and mark it primary before requesting a payout.');
    }
    if (primary.state !== 'verified') {
      return fail(res, 400, 'bank_account_not_verified', 'Your primary bank account is still being verified.');
    }

    const { netPayable } = await businessSummaryFor(userId);
    if (netPayable <= 0) {
      return fail(res, 400, 'nothing_payable', 'You have nothing available to withdraw right now.');
    }

    // The admin payout list breaks the amount down by where it came from, so split it the
    // same way the earnings ledger does rather than storing the total twice.
    const byKind = await prisma.earningEntry.groupBy({
      by: ['kind'],
      where: { userId, status: 'pending' },
      _sum: { amount: true },
    });
    const sumOf = (kind: string) => byKind.find((row) => row.kind === kind)?._sum.amount ?? 0;

    const created = await prisma.$transaction(async (tx) => {
      const payout = await tx.payoutRequest.create({
        data: {
          userId,
          amount: netPayable,
          status: 'pending',
          bankAccountMasked: `•••• •••• ${primary.accountNumber.slice(-4)}`,
          bankIfsc: primary.ifsc,
          referralBonus: sumOf('referralBonus'),
          commission: sumOf('bookingCommission'),
          isAutomaticMethod: false,
          history: { create: [{ status: 'pending', note: 'Requested by partner from the app' }] },
        },
      });
      const notification = await tx.notification.create({
        data: {
          title: 'Payout requested',
          body: `Your payout request of ₹${netPayable.toLocaleString('en-IN')} has been received and is pending approval.`,
          type: 'payout',
          audience: 'all',
        },
      });
      await tx.notificationRecipient.create({ data: { notificationId: notification.id, userId } });
      return payout;
    });

    res.status(201).json({
      id: created.id,
      amount: created.amount,
      status: created.status,
      requested_on: created.requestDate.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
