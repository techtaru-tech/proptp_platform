import { Router } from 'express';
import { prisma } from '../prisma';
import { getBusinessHoursSettings, type DaySchedule } from '../services/businessHours';

export const settingsRouter = Router();

const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateSchedule(schedule: unknown): string | null {
  if (!Array.isArray(schedule) || schedule.length !== 7) return 'schedule must have exactly 7 entries, one per day.';
  const days = new Set<number>();
  for (const row of schedule as DaySchedule[]) {
    if (typeof row.day !== 'number' || row.day < 0 || row.day > 6) return 'Each day must be a number from 0 (Sunday) to 6 (Saturday).';
    if (days.has(row.day)) return `Day ${row.day} is listed more than once.`;
    days.add(row.day);
    if (row.isOpen) {
      if (!VALID_TIME.test(row.openTime)) return `Invalid open time for day ${row.day}.`;
      if (!VALID_TIME.test(row.closeTime)) return `Invalid close time for day ${row.day}.`;
      if (row.closeTime <= row.openTime) return `Close time must be after open time for day ${row.day}.`;
    }
  }
  return null;
}

settingsRouter.get('/business-hours', async (_req, res) => {
  const settings = await getBusinessHoursSettings();
  res.json(settings);
});

settingsRouter.put('/business-hours', async (req, res) => {
  const { enabled, timezone, schedule, closedMessage } = req.body as {
    enabled?: boolean;
    timezone?: string;
    schedule?: unknown;
    closedMessage?: string;
  };

  const error = validateSchedule(schedule);
  if (error) return res.status(400).json({ error });

  const updated = await prisma.businessHoursSettings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      enabled: !!enabled,
      timezone: timezone?.trim() || 'Asia/Kolkata',
      schedule: schedule as any,
      closedMessage: closedMessage?.trim() || null,
    },
    update: {
      enabled: !!enabled,
      timezone: timezone?.trim() || 'Asia/Kolkata',
      schedule: schedule as any,
      closedMessage: closedMessage?.trim() || null,
    },
  });
  res.json(updated);
});
