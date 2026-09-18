import { Router } from 'express';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { businessSummaryFor, downlineFor, earningsSummaryFor, seesFullPhoneNumbers } from '../../services/derive';
import {
  appBankAccount,
  appBusinessSummary,
  appEarningsSummary,
  appNotification,
  appTeamMember,
} from '../../services/appMappers';

/** API docs §5 and §6 — earnings, team, bank accounts, feedback, notifications. */
export const appPartnerRouter = Router();

appPartnerRouter.use(requireAuth);

// §5.1 GET /partner/summary — one endpoint, the full BusinessSummary (see doc open question #1)
appPartnerRouter.get('/summary', async (req: AuthedRequest, res, next) => {
  try {
    res.json(appBusinessSummary(await businessSummaryFor(req.auth!.sub)));
  } catch (err) {
    next(err);
  }
});

// §5.2 GET /partner/earnings
appPartnerRouter.get('/earnings', async (req: AuthedRequest, res, next) => {
  try {
    res.json(appEarningsSummary(await earningsSummaryFor(req.auth!.sub)));
  } catch (err) {
    next(err);
  }
});

// §5.3 GET /partner/team — the downline, with phone numbers masked per role
appPartnerRouter.get('/team', async (req: AuthedRequest, res, next) => {
  try {
    const viewer = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub }, select: { role: true } });
    const members = await downlineFor(req.auth!.sub);
    const showFullPhone = seesFullPhoneNumbers(viewer.role);
    res.json({ team: members.map((m) => appTeamMember(m, showFullPhone)) });
  } catch (err) {
    next(err);
  }
});

// §5.4 GET /partner/bank-accounts
appPartnerRouter.get('/bank-accounts', async (req: AuthedRequest, res, next) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { userId: req.auth!.sub },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ accounts: accounts.map(appBankAccount) });
  } catch (err) {
    next(err);
  }
});

const ACCOUNT_TYPES = ['Savings', 'Current'];

// §5.5 POST /partner/bank-accounts — always created unverified and non-primary
appPartnerRouter.post('/bank-accounts', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    for (const field of ['bank_name', 'holder_name', 'account_number', 'ifsc'] as const) {
      if (!body[field]) {
        return res.status(400).json({ error: { code: 'missing_field', message: `${field} is required.` } });
      }
    }
    const accountType = ACCOUNT_TYPES.includes(String(body.account_type)) ? String(body.account_type) : 'Savings';

    const account = await prisma.bankAccount.create({
      data: {
        userId: req.auth!.sub,
        bankName: String(body.bank_name),
        holderName: String(body.holder_name),
        accountNumber: String(body.account_number).replace(/\s/g, ''),
        ifsc: String(body.ifsc).toUpperCase(),
        accountType,
        state: 'pending',
        isPrimary: false,
      },
    });
    res.status(201).json(appBankAccount(account));
  } catch (err) {
    next(err);
  }
});

/**
 * Not in the doc, which flags both as "placeholder taps" with no endpoint yet (§5.5).
 * Implemented here so the app's existing UI can be wired up without a second round trip
 * to the backend team.
 */
appPartnerRouter.patch('/bank-accounts/:id', async (req: AuthedRequest, res, next) => {
  try {
    const account = await prisma.bankAccount.findFirst({ where: { id: String(req.params.id), userId: req.auth!.sub } });
    if (!account) {
      return res.status(404).json({ error: { code: 'account_not_found', message: 'That bank account could not be found.' } });
    }
    if (req.body?.is_primary === true) {
      if (account.state !== 'verified') {
        return res.status(409).json({ error: { code: 'account_not_verified', message: 'Only a verified account can be made primary.' } });
      }
      // Exactly one primary account per partner.
      await prisma.$transaction([
        prisma.bankAccount.updateMany({ where: { userId: req.auth!.sub }, data: { isPrimary: false } }),
        prisma.bankAccount.update({ where: { id: account.id }, data: { isPrimary: true } }),
      ]);
    }
    const updated = await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } });
    res.json(appBankAccount(updated));
  } catch (err) {
    next(err);
  }
});

appPartnerRouter.delete('/bank-accounts/:id', async (req: AuthedRequest, res, next) => {
  try {
    const account = await prisma.bankAccount.findFirst({ where: { id: String(req.params.id), userId: req.auth!.sub } });
    if (!account) {
      return res.status(404).json({ error: { code: 'account_not_found', message: 'That bank account could not be found.' } });
    }
    await prisma.bankAccount.delete({ where: { id: account.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// §6.1 GET /partner/notifications — newest first
appPartnerRouter.get('/notifications', async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.notificationRecipient.findMany({
      where: { userId: req.auth!.sub },
      include: { notification: true },
      orderBy: { notification: { createdAt: 'desc' } },
      take: 200,
    });
    res.json({ notifications: rows.map(appNotification) });
  } catch (err) {
    next(err);
  }
});

// §6.2 POST /partner/notifications/{id}/read
appPartnerRouter.post('/notifications/:id/read', async (req: AuthedRequest, res, next) => {
  try {
    const result = await prisma.notificationRecipient.updateMany({
      where: { notificationId: String(req.params.id), userId: req.auth!.sub, read: false },
      data: { read: true, readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await prisma.notificationRecipient.findFirst({
        where: { notificationId: String(req.params.id), userId: req.auth!.sub },
        select: { id: true },
      });
      if (!exists) {
        return res.status(404).json({ error: { code: 'notification_not_found', message: 'That notification could not be found.' } });
      }
    }
    res.json({ read: true });
  } catch (err) {
    next(err);
  }
});

// §6.3 POST /partner/notifications/read-all
appPartnerRouter.post('/notifications/read-all', async (req: AuthedRequest, res, next) => {
  try {
    const result = await prisma.notificationRecipient.updateMany({
      where: { userId: req.auth!.sub, read: false },
      data: { read: true, readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});
