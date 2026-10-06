import { prisma } from '../prisma';

export interface DaySchedule {
  day: number; // 0 = Sunday .. 6 = Saturday, matches Date#getDay()
  isOpen: boolean;
  openTime: string; // "HH:mm"
  closeTime: string; // "HH:mm"
}

const DEFAULT_SCHEDULE: DaySchedule[] = Array.from({ length: 7 }, (_, day) => ({
  day,
  isOpen: day >= 1 && day <= 5, // Mon–Fri by default, matching the typical office week
  openTime: '09:30',
  closeTime: '18:30',
}));

/** Reads the singleton row, creating it with sensible defaults on first access. */
export async function getBusinessHoursSettings() {
  const existing = await prisma.businessHoursSettings.findUnique({ where: { id: 'singleton' } });
  if (existing) return existing;
  return prisma.businessHoursSettings.create({
    data: { id: 'singleton', enabled: false, timezone: 'Asia/Kolkata', schedule: DEFAULT_SCHEDULE as any },
  });
}

/**
 * Whether `at` (server-local wall clock) falls inside a configured open window. Returns `true`
 * whenever hours are disabled or unconfigured — the flag is opt-in, so "no restriction" is the
 * only safe default. See the schema comment for why this compares local time directly rather than
 * doing a real per-timezone conversion.
 */
export async function isWithinBusinessHours(at: Date = new Date()): Promise<boolean> {
  const settings = await getBusinessHoursSettings();
  if (!settings.enabled) return true;

  // A schedule that is not the per-weekday list (older data) is treated as unconfigured, not as a crash.
  if (!Array.isArray(settings.schedule)) return true;
  const schedule = settings.schedule as unknown as DaySchedule[];
  const today = schedule.find((d) => d.day === at.getDay());
  if (!today || !today.isOpen) return false;

  const minutesNow = at.getHours() * 60 + at.getMinutes();
  const [openH, openM] = today.openTime.split(':').map(Number);
  const [closeH, closeM] = today.closeTime.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return minutesNow >= openMinutes && minutesNow < closeMinutes;
}

/** Convenience for every lead-creation call site: one flag to spread into `prisma.lead.create({ data: {...} })`. */
export async function outsideBusinessHoursFlag(): Promise<boolean> {
  return !(await isWithinBusinessHours());
}
