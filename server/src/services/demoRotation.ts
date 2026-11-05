import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Demo data that keeps moving (DEMO_TOOLS=true only — it rewrites dates across the whole database).
 *
 * Every DEMO_ROTATE_HOURS (default 6):
 *   1. the rows the previous run added are deleted, by id — nothing else is touched;
 *   2. every date in the database moves forward so the newest lead is "now" again, which keeps
 *      bookings, payments, attendance, construction and legal current without inventing ledger rows;
 *   3. a fresh batch lands: leads with their first activity, follow-ups, site visits, calls,
 *      tasks and support tickets, timed across the last few hours and the next few days.
 *
 * Bookings are re-dated, not created: a booking writes investment, commission and unit-status rows
 * through services/bookings.ts, and unwinding those six hours later is not worth the risk.
 */

export const enabled = () => process.env.DEMO_TOOLS === 'true';
export const rotateEveryHours = () => Math.max(1, Number(process.env.DEMO_ROTATE_HOURS) || 6);

/* ------------------------------------------------------------------ shifting dates */

// Prisma's bookkeeping, sign-in codes and sessions (their expiry is real time), holidays (fixed
// calendar dates) and the rotation's own log are never shifted.
const SKIP_TABLES = ['_prisma_migrations', 'OtpCode', 'Session', 'Holiday', 'DemoBatch'];
// A client's access ends at the moment they were promised, whatever the demo clock does.
const SKIP_COLUMNS: Record<string, string[]> = { User: ['accessExpiresAt'] };

// Larger than any span the data covers, so the first hop lands every row in an empty range and a
// unique index over a date (one attendance mark per person per day) never sees two rows collide.
const PARK_DAYS = 73000;

const FRESH_LEAD_MINUTES = [2, 9, 17, 34, 58, 95, 140, 210];
const FRESH_BOOKING_MINUTES = [45, 160];
const VISIT_HOURS_AHEAD = [2, 5, 26];

export interface ShiftResult { shiftedByHours: number; tables: number; freshLeads: string[]; freshBookings: number; visitsToday: number }

/**
 * Moves every date forward so the newest lead lands on now. With `freshen`, a few existing leads,
 * bookings and visits are then pulled onto today as well — the manual "before a meeting" button
 * wants that; the rotation does not, because it brings its own new rows.
 */
export async function shiftDemoDates({ freshen }: { freshen: boolean }): Promise<ShiftResult | null> {
  const newest = await prisma.lead.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  if (!newest) return null;

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
    if (SKIP_TABLES.includes(c.table_name) || SKIP_COLUMNS[c.table_name]?.includes(c.column_name)) continue;
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
      if (!freshen) return;

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

  return { shiftedByHours: Math.round(shiftMs / 3_600_000), tables: byTable.size, freshLeads, freshBookings, visitsToday };
}

/* ------------------------------------------------------------------ the batch */

const rand = () => crypto.randomInt(0, 1_000_000) / 1_000_000;
const pick = <T>(items: readonly T[]): T => items[crypto.randomInt(0, items.length)];
const between = (min: number, max: number) => crypto.randomInt(min, max + 1);
const chance = (p: number) => rand() < p;

const FIRST = ['Rohit', 'Sakshi', 'Imran', 'Tanvi', 'Yash', 'Aarti', 'Naveen', 'Payal', 'Harsh', 'Juhi', 'Kunal', 'Sonal', 'Mohit',
  'Rekha', 'Abhay', 'Nisha', 'Varun', 'Geeta', 'Siddharth', 'Bhavna', 'Tarun', 'Komal', 'Devendra', 'Ritika', 'Aakash', 'Sneha',
  'Pranav', 'Alka', 'Jatin', 'Madhu', 'Farhan', 'Ishita', 'Chirag', 'Megha', 'Hardik', 'Pooja', 'Nikhil', 'Divya', 'Ankit', 'Kavya'];
const LAST = ['Shah', 'Trivedi', 'Kulkarni', 'Menon', 'Bansal', 'Saxena', 'Chopra', 'Dutta', 'Ghosh', 'Kaur', 'Rathore', 'Sethi',
  'Jain', 'Khanna', 'Bose', 'Shetty', 'Tiwari', 'Prasad', 'Mishra', 'Goel', 'Patel', 'Desai', 'Mehta', 'Parikh', 'Agarwal'];
const CITIES = ['Surat', 'Ahmedabad', 'Vadodara', 'Rajkot', 'Mumbai', 'Pune', 'Indore', 'Nagpur', 'Jaipur', 'Nashik'];
const PURPOSES = ['Investment', 'Self Use', 'Resale', 'Rental Income', 'Second Home'];
const PROPERTY_TYPES = ['Plot', 'Villa', 'Flat', 'Office', 'Shop', 'Farm Land'];
const BUDGETS = ['Under ₹25 L', '₹25 L – ₹50 L', '₹50 L – ₹1 Cr', '₹1 Cr – ₹2 Cr', 'Above ₹2 Cr'];
const LOCATIONS = ['Vesu', 'Adajan', 'Bopal', 'SG Highway', 'Alkapuri', 'Race Course', 'Baner', 'Vijay Nagar', 'Manjalpur', 'Gota', 'Wakad'];
// Enum keys from the panel's lead-source map, weighted like a real funnel.
const SOURCES = ['meta', 'meta', 'meta', 'web_form', 'web_form', 'google_ads', 'whatsapp', 'manual', 'referral', 'walk_in'];
const CONTACT_NOTES = [
  'Called — wants the price list and layout on WhatsApp.',
  'Spoke for 6 min, asked about loan tie-ups.',
  'Interested in a corner plot, will visit with family.',
  'Busy, asked to call back in the evening.',
  'Shared brochure and site location pin.',
];
const FOLLOW_UPS = ['Call back with plot availability', 'Send revised cost sheet', 'Confirm site visit timing', 'Share loan eligibility details', 'Check if family visit is fixed'];
const TASKS = [
  'Update price list for the new phase', 'Collect pending KYC documents from buyers', 'Prepare cost sheets for weekend visitors',
  'Call back yesterday’s missed calls', 'Reconcile this week’s cheque deposits', 'Share site progress photos with partners',
  'Follow up on registry appointment', 'Check plot holds expiring this week',
];
const TICKETS: [string, string][] = [
  ['Commission for last booking not visible', 'The booking I closed on Monday does not show in my commission statement yet.'],
  ['Unable to upload KYC document', 'The app keeps failing when I upload my PAN card photo.'],
  ['Wrong plot size shown in app', 'Plot shows 1500 sq ft in the app but the brochure says 1650.'],
  ['Payout request stuck in pending', 'Raised a payout request four days ago, still pending.'],
  ['Site visit slot not getting booked', 'The app shows an error when I try to book a Saturday slot.'],
];

export type BatchRecords = Partial<Record<'lead' | 'callLog' | 'task' | 'supportTicket', string[]>>;

async function createBatch(): Promise<{ records: BatchRecords; summary: Record<string, number> }> {
  const hours = rotateEveryHours();
  const now = Date.now();
  const inWindow = () => new Date(now - between(1, hours * 60) * 60_000);
  const ahead = (minH: number, maxH: number) => new Date(Math.ceil((now + between(minH * 60, maxH * 60) * 60_000) / 1_800_000) * 1_800_000);

  const [pipeline, owners, admin, projects, partners] = await Promise.all([
    prisma.pipeline.findFirst({ orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { sortOrder: 'asc' } } } }),
    prisma.user.findMany({ where: { status: 'active', role: { in: ['employee', 'leader', 'team_leader'] } }, select: { id: true, name: true, phone: true }, take: 40 }),
    prisma.user.findFirst({ where: { role: 'admin', status: 'active', accessExpiresAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { status: 1 }, select: { id: true, projectName: true }, take: 20 }),
    prisma.user.findMany({ where: { status: 'active', role: 'channel_partner' }, select: { id: true, name: true }, take: 40 }),
  ]);
  if (!admin) throw new Error('No active administrator to attribute demo records to.');
  const staff = owners.length ? owners : [{ id: admin.id, name: admin.name, phone: '' }];

  const open = pipeline?.stages.filter((s) => !s.isWon && !s.isLost) ?? [];
  const stageNamed = (needle: string, fallback: number) => open.find((s) => s.name.toLowerCase().includes(needle)) ?? open[fallback] ?? open[0];

  const records: Required<BatchRecords> = { lead: [], callLog: [], task: [], supportTicket: [] };
  let followUps = 0;
  let visits = 0;

  const leadCount = between(10, 16);
  for (let i = 0; i < leadCount; i += 1) {
    const firstName = pick(FIRST);
    const lastName = pick(LAST);
    const source = pick(SOURCES);
    const createdAt = inWindow();
    const owner = pick(staff);
    const roll = rand();
    const status = roll < 0.6 ? 'new' : roll < 0.85 ? 'contacted' : 'qualified';
    const stage = status === 'new' ? stageNamed('new', 0) : status === 'contacted' ? stageNamed('contact', 1) : stageNamed('qualif', 2);
    const project = projects.length ? pick(projects) : null;
    const hour = Number(createdAt.toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: process.env.ORG_TIME_ZONE || 'Asia/Kolkata' }));
    const contactedAt = status === 'new' ? null : new Date(Math.min(now, createdAt.getTime() + between(5, 90) * 60_000));

    const lead = await prisma.lead.create({
      data: {
        firstName,
        lastName,
        email: chance(0.8) ? `${firstName}.${lastName}${between(10, 99)}`.toLowerCase() + '@example.com' : null,
        phone: `${pick(['9', '8', '7'])}${between(100_000_000, 999_999_999)}`,
        city: pick(CITIES),
        purpose: pick(PURPOSES),
        propertyType: pick(PROPERTY_TYPES),
        budgetRange: pick(BUDGETS),
        preferredLocations: [pick(LOCATIONS)],
        source,
        originalSource: source,
        utmSource: source === 'meta' ? 'facebook' : source === 'google_ads' ? 'google' : null,
        utmMedium: source === 'meta' || source === 'google_ads' ? 'cpc' : null,
        interestedProjectId: project?.id ?? null,
        temperature: status === 'new' ? null : (pick(['hot', 'warm', 'warm', 'cold']) as never),
        status: status as never,
        priority: (chance(0.15) ? 'high' : 'normal') as never,
        leadScore: between(15, 92),
        receivedOutsideBusinessHours: hour < 9 || hour >= 19,
        pipelineId: pipeline?.id ?? null,
        pipelineStageId: stage?.id ?? null,
        stageEnteredAt: contactedAt ?? createdAt,
        dealValue: between(12, 95) * 100_000,
        dealCurrency: 'INR',
        expectedCloseDate: new Date(now + between(10, 60) * 86_400_000),
        assignedUserId: owner.id,
        assignedTo: owner.name,
        contactedAt,
        createdAt,
        updatedAt: contactedAt ?? createdAt,
        activities: {
          create: [
            { type: 'created', description: `Lead created from ${source.replace(/_/g, ' ')}.`, userId: admin.id, userName: admin.name, createdAt },
            ...(contactedAt ? [{ type: 'call', description: pick(CONTACT_NOTES), userId: owner.id, userName: owner.name, createdAt: contactedAt }] : []),
          ],
        },
      },
    });
    records.lead.push(lead.id);

    if (chance(0.45)) {
      // No reminderAt: a demo follow-up must never send anyone a real reminder.
      await prisma.leadFollowUp.create({
        data: { leadId: lead.id, title: pick(FOLLOW_UPS), dueAt: ahead(1, 48), status: 'pending', assignedUserId: owner.id, priority: (chance(0.2) ? 'high' : 'normal') as never },
      });
      followUps++;
    }
    if (status !== 'new' && project && chance(0.5)) {
      await prisma.siteVisit.create({
        data: {
          leadId: lead.id, projectId: project.id, scheduledAt: ahead(2, 72), status: (chance(0.4) ? 'confirmed' : 'scheduled') as never,
          hostId: owner.id, createdById: owner.id, visitorCount: between(1, 4),
        },
      });
      visits++;
    }

    // Calls: most new leads get one (some missed), contacted leads carry the answered call.
    if (contactedAt || chance(0.5)) {
      const answered = !!contactedAt || chance(0.4);
      const startedAt = contactedAt ?? new Date(Math.min(now, createdAt.getTime() + between(2, 60) * 60_000));
      const duration = answered ? between(45, 540) : 0;
      const call = await prisma.callLog.create({
        data: {
          requestId: `demo-${crypto.randomUUID()}`,
          direction: contactedAt ? 'outgoing' : pick(['incoming', 'outgoing']),
          status: answered ? 'completed' : pick(['missed', 'no_answer']),
          callerNumber: lead.phone,
          agentNumber: owner.phone || null,
          virtualNumber: '918048123456',
          leadId: lead.id,
          agentUserId: owner.id,
          durationSeconds: duration,
          startedAt,
          endedAt: new Date(startedAt.getTime() + duration * 1000 + 20_000),
          createdAt: startedAt,
        },
      });
      records.callLog.push(call.id);
    }
  }

  for (let i = 0, n = between(3, 5); i < n; i += 1) {
    const task = await prisma.task.create({
      data: {
        title: pick(TASKS),
        status: (chance(0.3) ? 'in_progress' : 'todo') as never,
        priority: (chance(0.2) ? 'high' : 'normal') as never,
        dueAt: ahead(3, 96),
        assigneeId: pick(staff).id,
        createdById: admin.id,
        createdAt: inWindow(),
      },
    });
    records.task.push(task.id);
  }

  if (partners.length) {
    for (let i = 0, n = between(1, 2); i < n; i += 1) {
      const partner = pick(partners);
      const [subject, message] = pick(TICKETS);
      const at = inWindow();
      const ticket = await prisma.supportTicket.create({
        data: {
          userId: partner.id, subject, status: 'open', lastReplyAt: at, createdAt: at,
          messages: { create: { authorId: partner.id, authorName: partner.name, authorRole: 'channel_partner', message, createdAt: at } },
        },
      });
      records.supportTicket.push(ticket.id);
    }
  }

  return {
    records,
    summary: { leads: records.lead.length, followUps, siteVisits: visits, calls: records.callLog.length, tasks: records.task.length, tickets: records.supportTicket.length },
  };
}

/** Deletes exactly what a batch created. Leads take their activities, follow-ups and visits with them. */
async function clearBatch(records: BatchRecords): Promise<void> {
  await prisma.$transaction([
    prisma.callLog.deleteMany({ where: { id: { in: records.callLog ?? [] } } }),
    prisma.task.deleteMany({ where: { id: { in: records.task ?? [] } } }),
    prisma.supportTicket.deleteMany({ where: { id: { in: records.supportTicket ?? [] } } }),
    prisma.lead.deleteMany({ where: { id: { in: records.lead ?? [] } } }),
  ]);
}

/* ------------------------------------------------------------------ the rotation */

let running = false;

export async function rotateDemoData(): Promise<{ batchId: string; summary: Record<string, number>; shiftedByHours: number } | null> {
  if (running) return null;
  running = true;
  try {
    const previous = await prisma.demoBatch.findMany({ where: { clearedAt: null } });
    for (const batch of previous) {
      await clearBatch(batch.records as BatchRecords);
      await prisma.demoBatch.update({ where: { id: batch.id }, data: { clearedAt: new Date() } });
    }
    const shift = await shiftDemoDates({ freshen: false });
    const { records, summary } = await createBatch();
    const batch = await prisma.demoBatch.create({ data: { records: records as Prisma.InputJsonValue, summary } });
    console.log(`[demo] rotated: ${Object.entries(summary).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    return { batchId: batch.id, summary, shiftedByHours: shift?.shiftedByHours ?? 0 };
  } finally {
    running = false;
  }
}

export async function rotationStatus() {
  const last = await prisma.demoBatch.findFirst({ orderBy: { createdAt: 'desc' } });
  const every = rotateEveryHours();
  return {
    everyHours: every,
    lastRunAt: last?.createdAt.toISOString() ?? null,
    nextRunAt: last ? new Date(last.createdAt.getTime() + every * 3_600_000).toISOString() : null,
    lastSummary: (last?.summary as Record<string, number> | null) ?? null,
  };
}

const CHECK_EVERY_MS = 10 * 60_000;

/**
 * Checks every ten minutes whether a rotation is due, rather than sleeping six hours: a restart
 * (deploys, pm2) would otherwise reset the clock and the demo would quietly stop moving.
 */
export function startDemoRotation(): void {
  if (!enabled()) return;
  const tick = async () => {
    try {
      const last = await prisma.demoBatch.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (!last || Date.now() - last.createdAt.getTime() >= rotateEveryHours() * 3_600_000) await rotateDemoData();
    } catch (err) {
      console.error('[demo] rotation failed:', err);
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, CHECK_EVERY_MS);
}
