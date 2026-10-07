import { prisma } from '../prisma';

/**
 * Holidays, and the arithmetic both API surfaces need from them.
 *
 * A holiday is a date RANGE, inclusive on both ends, so every question about one is a range
 * question. Keeping that in one place is what stops the panel and the app disagreeing about
 * whether a holiday that started yesterday and ends tomorrow is "upcoming".
 */

/** A date column holds a date; whatever time a client sends with it is noise. */
export function asDate(input: unknown): Date | null {
  const text = String(input ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `YYYY-MM-DD`, the only shape a holiday date is ever sent or shown in. */
export function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Calendar days a holiday covers, both ends included — "Diwali, 3 days". */
export function holidayDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * Today in IST, as a UTC date at midnight.
 *
 * Production runs on UTC, where a plain `new Date()` rolls over to tomorrow at 5:30am IST.
 * A holiday that ended today would read as past all through the previous evening.
 */
export function todayIST(): Date {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** A holiday already running counts as upcoming — it has not finished yet. */
export function isUpcoming(end: Date, today = todayIST()): boolean {
  return end >= today;
}

/**
 * A holiday whose dates collide with the given range, if there is one.
 *
 * Two holidays on the same day is nearly always a mistake — the same occasion entered twice,
 * or a range typed a month out. Blocking it costs nothing; a duplicate in a calendar the whole
 * company reads costs a phone call.
 */
export function overlappingHoliday(start: Date, end: Date, ignoreId?: string) {
  return prisma.holiday.findFirst({
    where: {
      id: ignoreId ? { not: ignoreId } : undefined,
      startDate: { lte: end },
      endDate: { gte: start },
    },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
}
