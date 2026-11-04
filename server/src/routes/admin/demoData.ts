import { Router } from 'express';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { requireFullAccess } from './auth';

export const adminDemoDataRouter = Router();

/**
 * Settings > Demo Data — for the demo box only (DEMO_TOOLS=true in server/.env).
 *
 * The seed writes every date relative to the moment it ran, so a week later the newest lead is a
 * week old and the calendar is half in the past. "Refresh" moves every date in the database
 * forward by the same amount, so the newest lead lands on right now and everything keeps its
 * place relative to it — overdue tasks stay overdue, upcoming visits stay upcoming. Then a few
 * leads, bookings and site visits are pulled onto today, so the pitch has "a lead just came in".
 */

const enabled = () => process.env.DEMO_TOOLS === 'true';

// Never shifted: Prisma's own bookkeeping, sign-in codes and sessions (their expiry is real time),
// and holidays (fixed calendar dates).
const SKIP_TABLES = ['_prisma_migrations', 'OtpCode', 'Session', 'Holiday'];

// Larger than any span the data covers, so the first hop lands every row in an empty range and a
// unique index over a date (one attendance mark per person per day) never sees two rows collide.
const PARK_DAYS = 73000;

const FRESH_LEAD_MINUTES = [2, 9, 17, 34, 58, 95, 140, 210];
const FRESH_BOOKING_MINUTES = [45, 160];
const VISIT_HOURS_AHEAD = [2, 5, 26];

adminDemoDataRouter.get('/status', (_req, res) => {
  res.json({ enabled: enabled() });
});

adminDemoDataRouter.post('/refresh', requireFullAccess, async (req: AuthedRequest, res, next) => {
  if (!enabled()) return res.status(403).json({ error: 'Demo tools are switched off on this server.' });
  try {
    const newest = await prisma.lead.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (!newest) return res.status(409).json({ error: 'There is no demo data to refresh. Run the demo seed first.' });

    const now = Date.now();
    const shiftMs = Math.max(0, now - newest.createdAt.getTime());
    const shiftDays = Math.round(shiftMs / 86_400_000);

    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND data_type IN ('timestamp without time zone', 'timestamp with time zone', 'date')`;
    const byTable = new Map<string, { name: string; isDate: boolean }[]>();
    for (const c of columns) {
      if (SKIP_TABLES.includes(c.table_name)) continue;
      const list = byTable.get(c.table_name) ?? [];
      list.push({ name: c.column_name, isDate: c.data_type === 'date' });
      byTable.set(c.table_name, list);
    }

    const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
    const update = (table: string, cols: { name: string; isDate: boolean }[], days: number, ms: number) =>
      `UPDATE ${q(table)} SET ${cols
        .map((c) => (c.isDate ? `${q(c.name)} = ${q(c.name)} + ${days}` : `${q(c.name)} = ${q(c.name)} + interval '${days} days' + interval '${ms} milliseconds'`))
        .join(', ')}`;

    const freshLeads: string[] = [];
    let freshBookings = 0;
    let visitsToday = 0;

    await prisma.$transaction(
      async (tx) => {
        if (shiftMs > 60_000) {
          for (const [table, cols] of byTable) await tx.$executeRawUnsafe(update(table, cols, PARK_DAYS, 0));
          for (const [table, cols] of byTable) await tx.$executeRawUnsafe(update(table, cols, shiftDays - PARK_DAYS, shiftMs - shiftDays * 86_400_000));
        }

        const leads = await tx.lead.findMany({
          where: { status: 'new', archivedAt: null },
          orderBy: { createdAt: 'desc' },
          take: FRESH_LEAD_MINUTES.length,
          select: { id: true, firstName: true, lastName: true },
        });
        for (const [i, lead] of leads.entries()) {
          const at = new Date(now - FRESH_LEAD_MINUTES[i] * 60_000);
          await tx.lead.update({ where: { id: lead.id }, data: { createdAt: at, updatedAt: at, stageEnteredAt: at } });
          freshLeads.push(`${lead.firstName} ${lead.lastName}`.trim());
        }

        const bookings = await tx.booking.findMany({
          where: { status: { not: 'cancelled' } },
          orderBy: { createdAt: 'desc' },
          take: FRESH_BOOKING_MINUTES.length,
          select: { id: true },
        });
        for (const [i, booking] of bookings.entries()) {
          const at = new Date(now - FRESH_BOOKING_MINUTES[i] * 60_000);
          await tx.booking.update({ where: { id: booking.id }, data: { createdAt: at, updatedAt: at } });
          freshBookings++;
        }

        const visits = await tx.siteVisit.findMany({
          where: { status: 'scheduled' },
          orderBy: { scheduledAt: 'asc' },
          take: VISIT_HOURS_AHEAD.length,
          select: { id: true },
        });
        for (const [i, visit] of visits.entries()) {
          // On the half hour, as a person would book it.
          const at = new Date(Math.ceil((now + VISIT_HOURS_AHEAD[i] * 3_600_000) / 1_800_000) * 1_800_000);
          await tx.siteVisit.update({ where: { id: visit.id }, data: { scheduledAt: at } });
          if (VISIT_HOURS_AHEAD[i] < 24) visitsToday++;
        }
      },
      { timeout: 120_000 }
    );

    await writeAudit(req, {
      module: 'Settings',
      action: 'Refreshed demo data',
      recordId: 'demo-data',
      recordLabel: 'Demo data',
    });

    res.json({
      shiftedByHours: Math.round(shiftMs / 3_600_000),
      tables: byTable.size,
      freshLeads,
      freshBookings,
      visitsToday,
    });
  } catch (err) {
    next(err);
  }
});
