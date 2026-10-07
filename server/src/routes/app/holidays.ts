import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { day, holidayDays, isUpcoming, todayIST } from '../../services/holidays';

/**
 * The company holiday calendar, read-only.
 *
 * The same rows the panel manages at /api/holidays. Holidays are not per-person — everybody
 * gets the same list — so there is no scoping here and nothing to filter by who is asking.
 */
export const appHolidaysRouter = Router();

appHolidaysRouter.use(requireAuth);

appHolidaysRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const upcomingOnly = String(req.query.upcoming ?? '') === 'true';
    const today = todayIST();

    const where: Prisma.HolidayWhereInput = {
      startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      // A holiday that has already started but not finished is still ahead of you, so the
      // filter is on the end date rather than the start.
      ...(upcomingOnly ? { endDate: { gte: today } } : {}),
    };

    const holidays = await prisma.holiday.findMany({ where, orderBy: { startDate: 'asc' } });

    res.json({
      year,
      holidays: holidays.map((h) => ({
        id: h.id,
        name: h.name,
        kind: h.kind,
        start_date: day(h.startDate),
        end_date: day(h.endDate),
        days: holidayDays(h.startDate, h.endDate),
        description: h.description,
        upcoming: isUpcoming(h.endDate, today),
      })),
      total_days: holidays.reduce((sum, h) => sum + holidayDays(h.startDate, h.endDate), 0),
    });
  } catch (err) {
    next(err);
  }
});
