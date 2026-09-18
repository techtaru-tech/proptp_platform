import { Router } from 'express';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';

export const appAccountRouter = Router();

appAccountRouter.use(requireAuth);

/**
 * §7 DELETE /account — the partner closes their own account.
 *
 * Deactivate-and-retain, not a row delete: bookings, credited commissions and the sponsor
 * chain below this partner all reference it, and erasing the row would silently rewrite
 * other people's earnings. Setting the status to `inactive` is enough to end access —
 * `requireAuth` reads the account's status on every request — and it is reversible from
 * the admin panel, which a delete would not be.
 */
appAccountRouter.delete('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth!.sub;

    const owed = await prisma.payoutRequest.findFirst({
      where: { userId, status: { in: ['pending', 'confirmed'] } },
      select: { id: true },
    });
    if (owed) {
      return res.status(409).json({
        error: {
          code: 'payout_pending',
          message: 'You have a payout still being processed. Please wait for it to complete before closing your account.',
        },
      });
    }

    const user = await prisma.user.update({ where: { id: userId }, data: { status: 'inactive' } });
    await writeAudit(req, {
      module: 'Users',
      action: 'Account closed by partner',
      recordId: user.id,
      recordLabel: user.name,
      description: `${user.name} (${user.partnerCode}) closed their own account from the app.`,
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
