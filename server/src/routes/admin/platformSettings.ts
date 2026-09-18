import { Router } from 'express';
import type { CommissionType, Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import { hashPassword, type AuthedRequest } from '../../services/auth';

export const adminSettingsRouter = Router();

/**
 * Settings > Organization / Notifications / Profile / Schedules / Referral Commission /
 * Badges. The three singleton settings rows are upserted so a fresh database serves
 * defaults on the very first read instead of 404ing.
 */

// ---------------------------------------------------------------------------
// Organization & notification preferences
// ---------------------------------------------------------------------------

adminSettingsRouter.get('/organization', async (_req, res, next) => {
  try {
    const row = await prisma.organizationSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
    const { id: _id, updatedAt: _u, ...settings } = row;
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.patch('/organization', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const data: Prisma.OrganizationSettingsUncheckedUpdateInput = {};
    for (const key of ['companyName', 'logoUrl', 'contactEmail', 'contactPhone', 'address'] as const) {
      if (body[key] !== undefined) data[key] = String(body[key]);
    }
    const row = await prisma.organizationSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...(data as Prisma.OrganizationSettingsUncheckedCreateInput) },
    });
    await writeAudit(req, {
      module: 'Settings',
      action: 'Updated organization settings',
      recordId: 'organization',
      recordLabel: 'Organization',
    });
    const { id: _id, updatedAt: _u, ...settings } = row;
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.get('/notifications', async (_req, res, next) => {
  try {
    const row = await prisma.notificationSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
    const { id: _id, updatedAt: _u, ...settings } = row;
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.patch('/notifications', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const data: Prisma.NotificationSettingsUncheckedUpdateInput = {};
    for (const key of ['emailAlerts', 'pushAlerts', 'dailySummary', 'ticketAlerts'] as const) {
      if (body[key] !== undefined) data[key] = !!body[key];
    }
    const row = await prisma.notificationSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...(data as Prisma.NotificationSettingsUncheckedCreateInput) },
    });
    const { id: _id, updatedAt: _u, ...settings } = row;
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The signed-in admin's own profile
// ---------------------------------------------------------------------------

adminSettingsRouter.get('/profile', async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    res.json({ name: user.name, email: user.email ?? '', phone: user.phone, avatarUrl: user.avatarUrl ?? undefined });
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.patch('/profile', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name);
    if (body.email !== undefined) data.email = String(body.email);
    if (body.avatarUrl !== undefined) data.avatarUrl = String(body.avatarUrl);
    // `phone` is the login identity for partners and is unique, so a change is validated
    // against the rest of the table rather than trusted.
    if (body.phone !== undefined) {
      const phone = String(body.phone).replace(/\D/g, '').slice(-10);
      if (phone.length !== 10) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
      const clash = await prisma.user.findFirst({ where: { phone, id: { not: req.auth!.sub } }, select: { id: true } });
      if (clash) return res.status(409).json({ error: 'That mobile number is already in use.' });
      data.phone = phone;
    }
    if (body.password) {
      if (String(body.password).length < 8) return res.status(400).json({ error: 'The password must be at least 8 characters.' });
      data.passwordHash = await hashPassword(String(body.password));
    }
    const user = await prisma.user.update({ where: { id: req.auth!.sub }, data });
    res.json({ name: user.name, email: user.email ?? '', phone: user.phone, avatarUrl: user.avatarUrl ?? undefined });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Return-schedule options (real `manage_times`)
// ---------------------------------------------------------------------------

const TIME_TYPES = ['Days', 'Months', 'Years'];

adminSettingsRouter.get('/schedules', async (_req, res, next) => {
  try {
    const rows = await prisma.manageTime.findMany({ orderBy: [{ timeType: 'asc' }, { time: 'asc' }] });
    res.json({ schedules: rows });
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.post('/schedules', async (req: AuthedRequest, res, next) => {
  try {
    const time = Math.round(Number(req.body?.time) || 0);
    const timeType = String(req.body?.timeType ?? '');
    if (time <= 0) return res.status(400).json({ error: 'time must be greater than zero.' });
    if (!TIME_TYPES.includes(timeType)) return res.status(400).json({ error: 'timeType must be Days, Months or Years.' });

    const created = await prisma.manageTime.create({ data: { time, timeType, status: 1 } });
    await writeAudit(req, {
      module: 'Settings',
      action: 'Created return schedule',
      recordId: created.id,
      recordLabel: `${time} ${timeType}`,
      description: `Added return-schedule option: ${time} ${timeType}.`,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.patch('/schedules/:id', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const data: Prisma.ManageTimeUncheckedUpdateInput = {};
    if (body.time !== undefined) data.time = Math.round(Number(body.time) || 0);
    if (body.timeType !== undefined && TIME_TYPES.includes(String(body.timeType))) data.timeType = String(body.timeType);
    if (body.status !== undefined) data.status = Number(body.status) === 1 ? 1 : 0;
    res.json(await prisma.manageTime.update({ where: { id: String(req.params.id) }, data }));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Referral commission configuration
// ---------------------------------------------------------------------------

adminSettingsRouter.get('/referral/toggles', async (_req, res, next) => {
  try {
    const row = await prisma.referralToggleSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
    const { id: _id, updatedAt: _u, ...toggles } = row;
    res.json(toggles);
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.patch('/referral/toggles', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const data: Prisma.ReferralToggleSettingsUncheckedUpdateInput = {};
    for (const key of ['depositCommission', 'investmentCommission', 'profitCommission'] as const) {
      if (body[key] !== undefined) data[key] = !!body[key];
    }
    const row = await prisma.referralToggleSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...(data as Prisma.ReferralToggleSettingsUncheckedCreateInput) },
    });
    await writeAudit(req, {
      module: 'Settings',
      action: 'Updated referral commission toggles',
      recordId: 'referral-toggles',
      recordLabel: 'Referral Commission',
    });
    const { id: _id, updatedAt: _u, ...toggles } = row;
    res.json(toggles);
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.get('/referral/levels', async (req, res, next) => {
  try {
    const commissionType = String(req.query.commissionType ?? 'deposit') as CommissionType;
    const rules = await prisma.referralLevelRule.findMany({ where: { commissionType }, orderBy: { level: 'asc' } });
    res.json({ rules: rules.map((r) => ({ commissionType: r.commissionType, level: r.level, percent: r.percent })) });
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `referralCommissionStore()` — delete-all + reinsert, per commission type. */
adminSettingsRouter.put('/referral/levels', async (req: AuthedRequest, res, next) => {
  try {
    const commissionType = String(req.body?.commissionType ?? '') as CommissionType;
    if (!['deposit', 'investment', 'profit'].includes(commissionType)) {
      return res.status(400).json({ error: 'commissionType must be deposit, investment or profit.' });
    }
    const percents = Array.isArray(req.body?.percents) ? req.body.percents.map((p: unknown) => Number(p) || 0) : [];

    const rules = await prisma.$transaction(async (tx) => {
      await tx.referralLevelRule.deleteMany({ where: { commissionType } });
      if (percents.length > 0) {
        await tx.referralLevelRule.createMany({
          data: percents.map((percent: number, i: number) => ({ commissionType, level: i + 1, percent })),
        });
      }
      return tx.referralLevelRule.findMany({ where: { commissionType }, orderBy: { level: 'asc' } });
    });

    await writeAudit(req, {
      module: 'Settings',
      action: `Updated ${commissionType} commission levels`,
      recordId: `referral-${commissionType}`,
      recordLabel: 'Referral Commission',
    });
    res.json({ rules: rules.map((r) => ({ commissionType: r.commissionType, level: r.level, percent: r.percent })) });
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.get('/plan-levels', async (_req, res, next) => {
  try {
    res.json({ levels: await prisma.planLevel.findMany({ orderBy: { rangeFrom: 'asc' } }) });
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real `planTeamCommissionSave()` — validates no range overlap, then replaces the ladder. */
adminSettingsRouter.put('/plan-levels', async (req: AuthedRequest, res, next) => {
  try {
    const incoming = Array.isArray(req.body?.levels) ? req.body.levels : [];
    const sorted = [...incoming]
      .map((l: any) => ({
        levelTitle: String(l.levelTitle ?? ''),
        rangeFrom: Math.round(Number(l.rangeFrom) || 0),
        rangeTo: Math.round(Number(l.rangeTo) || 0),
        incentive: Number(l.incentive) || 0,
      }))
      .sort((a, b) => a.rangeFrom - b.rangeFrom);

    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].rangeFrom <= sorted[i - 1].rangeTo) {
        return res.status(400).json({ error: `Range overlap between "${sorted[i - 1].levelTitle}" and "${sorted[i].levelTitle}".` });
      }
    }

    const levels = await prisma.$transaction(async (tx) => {
      await tx.planLevel.deleteMany({});
      if (sorted.length > 0) await tx.planLevel.createMany({ data: sorted });
      return tx.planLevel.findMany({ orderBy: { rangeFrom: 'asc' } });
    });
    await writeAudit(req, {
      module: 'Settings',
      action: 'Updated team incentive ladder',
      recordId: 'plan-levels',
      recordLabel: 'Team Incentive Ladder',
    });
    res.json({ levels });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Badges / ranks
// ---------------------------------------------------------------------------

function badgeWritable(body: Record<string, any>): Prisma.BadgeUncheckedUpdateInput {
  const data: Prisma.BadgeUncheckedUpdateInput = {};
  if (body.rankName !== undefined) data.rankName = String(body.rankName);
  if (body.description !== undefined) data.description = body.description ? String(body.description) : null;
  for (const key of ['rankLevel', 'minInvest', 'minDeposit', 'minEarning', 'bonus', 'sortOrder'] as const) {
    if (body[key] !== undefined) (data as any)[key] = Math.round(Number(body[key]) || 0);
  }
  if (body.status !== undefined) data.status = Number(body.status) === 1 ? 1 : 0;
  return data;
}

adminSettingsRouter.get('/badges', async (_req, res, next) => {
  try {
    res.json({ badges: await prisma.badge.findMany({ orderBy: { sortOrder: 'asc' } }) });
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.post('/badges', async (req: AuthedRequest, res, next) => {
  try {
    if (!req.body?.rankName) return res.status(400).json({ error: 'rankName is required.' });
    const count = await prisma.badge.count();
    const created = await prisma.badge.create({
      data: {
        ...(badgeWritable(req.body) as Prisma.BadgeUncheckedCreateInput),
        rankName: String(req.body.rankName),
        rankLevel: Math.round(Number(req.body.rankLevel) || count + 1),
        sortOrder: count + 1,
      },
    });
    await writeAudit(req, {
      module: 'Settings',
      action: 'Created badge',
      recordId: created.id,
      recordLabel: created.rankName,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.patch('/badges/:id', async (req, res, next) => {
  try {
    res.json(await prisma.badge.update({ where: { id: String(req.params.id) }, data: badgeWritable(req.body ?? {}) }));
  } catch (err) {
    next(err);
  }
});

adminSettingsRouter.put('/badges/order', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map(String) : [];
    await prisma.$transaction(
      ids.map((id: string, i: number) => prisma.badge.update({ where: { id }, data: { sortOrder: i + 1 } }))
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
