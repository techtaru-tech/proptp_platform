/**
 * Day-key handling for attendance.
 *
 * A `@db.Date` column stores a calendar day with no time and no zone, so the day a
 * timestamp belongs to has to be decided explicitly. `toISOString()` cannot make that
 * decision: for anywhere east of UTC it rolls a late-evening local timestamp back to the
 * previous day, which silently files a 9pm check-out under yesterday.
 *
 * Everything here therefore resolves the day in the ORG timezone (IST) and then stores
 * that day as UTC midnight, which is the value Prisma round-trips unchanged for a Date
 * column.
 */

const ORG_TIME_ZONE = process.env.ORG_TIME_ZONE || 'Asia/Kolkata';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORG_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "2026-09-04" for the given instant, as seen in the org's timezone. */
export function dayString(instant: Date = new Date()): string {
  return dayFormatter.format(instant);
}

/** A "YYYY-MM-DD" string as the UTC-midnight Date a `@db.Date` column expects. */
export function dayKeyFromString(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

/** The day-key for an instant, resolved in the org's timezone. */
export function dayKey(instant: Date = new Date()): Date {
  return dayKeyFromString(dayString(instant));
}

/**
 * The day-key for whatever the client sent as `date`. Accepts "YYYY-MM-DD" and full
 * ISO-8601; anything unparseable falls back to today rather than throwing, because an
 * offline-queued mark must never be rejected for a formatting reason.
 */
export function parseDayKey(input: unknown, fallback: Date = new Date()): Date {
  const raw = String(input ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return dayKeyFromString(raw);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? dayKey(fallback) : dayKey(parsed);
}

/** Inclusive [from, to] day-key range; defaults to the current calendar month. */
export function dayRange(from?: unknown, to?: unknown): { gte: Date; lte: Date } {
  const today = dayString();
  const [year, month] = today.split('-').map(Number);
  const defaultFrom = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const defaultTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const normalize = (value: unknown, fallbackDay: string): Date => {
    const raw = String(value ?? '').trim();
    return dayKeyFromString(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallbackDay);
  };
  return { gte: normalize(from, defaultFrom), lte: normalize(to, defaultTo) };
}

/** Minutes past midnight for an "HH:mm" policy string. */
export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

/** Minutes past midnight for an instant, as seen in the org's timezone. */
export function minutesOfDayInOrgZone(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ORG_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
  return minutesOfDay(parts);
}
