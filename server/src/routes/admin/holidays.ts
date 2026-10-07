import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { asDate, day, holidayDays, isUpcoming, overlappingHoliday, todayIST } from '../../services/holidays';

/**
 * Attendance > Holidays — the company calendar the whole office reads.
 *
 * One row per occasion with an inclusive date range: Diwali is one holiday that runs three
 * days. The app reads the same rows through /api/v1/app/holidays.
 */
export const adminHolidaysRouter = Router();

function serialize(h: {
  id: string; name: string; kind: string; startDate: Date; endDate: Date; description: string | null;
}, today = todayIST()) {
  return {
    id: h.id,
    name: h.name,
    kind: h.kind,
    startDate: day(h.startDate),
    endDate: day(h.endDate),
    days: holidayDays(h.startDate, h.endDate),
    description: h.description,
    upcoming: isUpcoming(h.endDate, today),
  };
}

/** Name, kind and dates off a request body, or the first thing wrong with them. */
function readBody(body: any): { error: string } | { name: string; kind: string; startDate: Date; endDate: Date; description: string | null } {
  const name = String(body?.name ?? '').trim();
  if (!name) return { error: 'A name is required.' };

  const startDate = asDate(body?.startDate);
  if (!startDate) return { error: 'Give a start date as YYYY-MM-DD.' };
  // A one-day holiday may send only a start date, which is what the form does with the
  // multi-day toggle off.
  const endDate = body?.endDate ? asDate(body.endDate) : startDate;
  if (!endDate) return { error: 'Give an end date as YYYY-MM-DD.' };
  if (endDate < startDate) return { error: 'The end date cannot be before the start date.' };

  return {
    name,
    kind: String(body?.kind ?? '').trim() || 'festival',
    startDate,
    endDate,
    description: String(body?.description ?? '').trim() || null,
  };
}

adminHolidaysRouter.get('/', async (req, res, next) => {
  try {
    const year = Number(req.query.year) || undefined;
    const where: Prisma.HolidayWhereInput = year
      ? { startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }
      : {};

    const holidays = await prisma.holiday.findMany({ where, orderBy: { startDate: 'asc' } });
    const today = todayIST();

    res.json({
      year: year ?? null,
      holidays: holidays.map((h) => serialize(h, today)),
      // What the header shows: how many occasions and how many days off they add up to.
      totalDays: holidays.reduce((sum, h) => sum + holidayDays(h.startDate, h.endDate), 0),
    });
  } catch (err) {
    next(err);
  }
});

adminHolidaysRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = readBody(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const clash = await overlappingHoliday(parsed.startDate, parsed.endDate);
    if (clash) {
      return res.status(409).json({
        error: `Those dates overlap "${clash.name}" (${day(clash.startDate)} to ${day(clash.endDate)}).`,
      });
    }

    const created = await prisma.holiday.create({ data: parsed });
    await writeAudit(req, {
      module: 'Attendance',
      action: `Added holiday "${created.name}" (${holidayDays(created.startDate, created.endDate)} day(s))`,
      recordId: created.id,
      recordLabel: created.name,
    });
    res.status(201).json(serialize(created));
  } catch (err) {
    next(err);
  }
});

adminHolidaysRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const parsed = readBody(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const clash = await overlappingHoliday(parsed.startDate, parsed.endDate, id);
    if (clash) {
      return res.status(409).json({
        error: `Those dates overlap "${clash.name}" (${day(clash.startDate)} to ${day(clash.endDate)}).`,
      });
    }

    const updated = await prisma.holiday.update({ where: { id }, data: parsed });
    await writeAudit(req, {
      module: 'Attendance',
      action: `Updated holiday "${updated.name}"`,
      recordId: updated.id,
      recordLabel: updated.name,
    });
    res.json(serialize(updated));
  } catch (err) {
    next(err);
  }
});

adminHolidaysRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const removed = await prisma.holiday.delete({ where: { id: String(req.params.id) } });
    await writeAudit(req, {
      module: 'Attendance',
      action: `Deleted holiday "${removed.name}"`,
      recordId: removed.id,
      recordLabel: removed.name,
    });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
