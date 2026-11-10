import type Anthropic from '@anthropic-ai/sdk';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ToolError, obj, out } from './assistantTools';
import { dayKey, dayKeyFromString, dayString } from './dates';
import { paidAmountFromBookings, remainingAmount } from './derive';
import { projectSchedules, sectionOverview } from './moduleOverview';
import type { ModuleKey } from './permissions';
import { SECTION_KEYS, isSection, type Access, type SectionKey } from './sections';

/**
 * Tools for the section assistants. All read-only. Each tool names the module it reads; it runs
 * only when the signed-in person holds that module (Reports may read the sales, money and people
 * figures its own reports already show).
 */

export interface ToolCtx { access: Access; section: SectionKey }
export interface ModTool {
  name: string;
  label: string;
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  module?: ModuleKey;
  run: (ctx: ToolCtx, input: any) => Promise<string>;
}

const DAY = 86_400_000;
const isoDate = { type: 'string', description: 'A date as YYYY-MM-DD (India time).' };
const limit = { type: 'integer', description: 'Rows to return, up to 50. Default 20.' };
const lim = (n: unknown) => Math.min(50, Math.max(1, Number(n) || 20));
const day = (d: Date | null | undefined) => (d ? dayString(d) : null);
const time = (d: Date | null | undefined) => (d ? d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) : null);
const istStart = (s: string) => new Date(`${s}T00:00:00+05:30`);
const istEnd = (s: string) => new Date(`${s}T23:59:59.999+05:30`);
const STAFF = ['employee', 'leader', 'team_leader'] as const;

export const MODULE_TOOLS: ModTool[] = [
  // ------------------------------------------------------------------------------- shared
  {
    name: 'section_overview', label: 'Read the overview',
    description: 'The overview page of a section, exactly as the person sees it: headline KPIs, charts (each a list of name/value rows), the "needs attention" list and links. Start here for any "how are we doing / summary / what needs attention" question.',
    input_schema: obj({ section: { type: 'string', enum: [...SECTION_KEYS], description: 'Which section. Default: the one the person is on.' } }),
    run: async (ctx, i) => {
      const section = i.section && isSection(String(i.section)) ? (String(i.section) as SectionKey) : ctx.section;
      if (!ctx.access.canOpen(section)) throw new ToolError(`This person cannot open the ${section} section.`);
      const o = await sectionOverview(section, ctx.access);
      return out({ section: o.section, kpis: o.kpis, charts: o.charts.map(({ title, meta, kind, rows, format }) => ({ title, meta, kind, format, rows })), needs_attention: o.attention, links: o.links }, 24_000);
    },
  },
  {
    name: 'find_people', label: 'Looked up people',
    description: 'People in the panel by name or phone, optionally of one role. Returns id, name, role, status, designation, city and team. Use it to turn a name into an id.',
    input_schema: obj({ search: { type: 'string' }, role: { type: 'string', enum: ['employee', 'leader', 'team_leader', 'channel_partner', 'admin', 'vendor'] }, limit }),
    run: async (_ctx, i) => {
      const where: Prisma.UserWhereInput = {};
      if (i.search) where.OR = [{ name: { contains: String(i.search), mode: 'insensitive' } }, { phone: { contains: String(i.search) } }];
      if (i.role) where.role = i.role;
      const rows = await prisma.user.findMany({ where, take: lim(i.limit), orderBy: { name: 'asc' }, select: { id: true, name: true, role: true, status: true, designation: true, city: true, team: { select: { name: true } } } });
      return out({ people: rows.map((u) => ({ id: u.id, name: u.name, role: u.role, status: u.status, designation: u.designation, city: u.city, team: u.team?.name ?? null })) });
    },
  },

  // --------------------------------------------------------------------------------- HRMS
  {
    name: 'attendance_day', label: 'Checked attendance', module: 'attendance',
    description: 'Every active staff member on one day: checked in or not, check-in and check-out time, late, early departure, hours worked, distance from office, correction requests. Filter to present, late, absent or all.',
    input_schema: obj({ date: isoDate, show: { type: 'string', enum: ['all', 'present', 'late', 'absent'], description: 'Default all.' } }),
    run: async (_ctx, i) => {
      const date = i.date ? dayKeyFromString(String(i.date)) : dayKey();
      const [staff, records] = await Promise.all([
        prisma.user.findMany({ where: { status: 'active', role: { in: [...STAFF] } }, select: { id: true, name: true, designation: true } }),
        prisma.attendanceRecord.findMany({ where: { date } }),
      ]);
      const rec = new Map(records.map((r) => [r.userId, r]));
      let rows = staff.map((s) => {
        const r = rec.get(s.id);
        return { user_id: s.id, name: s.name, designation: s.designation, checked_in: time(r?.checkInAt), checked_out: time(r?.checkOutAt), late: !!r?.isLate, early_departure: !!r?.isEarlyDeparture, hours: r?.workingHours ?? null, metres_from_office: r?.distanceFromOfficeMeters ?? null, sync: r?.syncStatus ?? null, correction: r?.correctionRequested ? r.correctionStatus : null };
      });
      if (i.show === 'present') rows = rows.filter((r) => r.checked_in);
      if (i.show === 'late') rows = rows.filter((r) => r.late);
      if (i.show === 'absent') rows = rows.filter((r) => !r.checked_in);
      return out({ date: dayString(date), staff: staff.length, present: records.filter((r) => r.checkInAt).length, rows });
    },
  },
  {
    name: 'attendance_summary', label: 'Summarised attendance', module: 'attendance',
    description: 'Per person between two dates: days present, days late, early departures, average hours. Default: this month so far.',
    input_schema: obj({ from: isoDate, to: isoDate }),
    run: async (_ctx, i) => {
      const from = i.from ? dayKeyFromString(String(i.from)) : dayKeyFromString(`${dayString().slice(0, 7)}-01`);
      const to = i.to ? dayKeyFromString(String(i.to)) : dayKey();
      const rows = await prisma.attendanceRecord.groupBy({ by: ['userId'], where: { date: { gte: from, lte: to }, checkInAt: { not: null } }, _count: { _all: true }, _avg: { workingHours: true } });
      const [late, early, users] = await Promise.all([
        prisma.attendanceRecord.groupBy({ by: ['userId'], where: { date: { gte: from, lte: to }, isLate: true }, _count: { _all: true } }),
        prisma.attendanceRecord.groupBy({ by: ['userId'], where: { date: { gte: from, lte: to }, isEarlyDeparture: true }, _count: { _all: true } }),
        prisma.user.findMany({ where: { status: 'active', role: { in: [...STAFF] } }, select: { id: true, name: true } }),
      ]);
      const n = (list: { userId: string; _count: { _all: number } }[], id: string) => list.find((x) => x.userId === id)?._count._all ?? 0;
      return out({ from: dayString(from), to: dayString(to), people: users.map((u) => {
        const r = rows.find((x) => x.userId === u.id);
        return { user_id: u.id, name: u.name, days_present: r?._count._all ?? 0, days_late: n(late, u.id), early_departures: n(early, u.id), avg_hours: r?._avg.workingHours ? Number(r._avg.workingHours.toFixed(1)) : null };
      }).sort((a, b) => b.days_late - a.days_late) });
    },
  },
  {
    name: 'leave_requests', label: 'Checked leave', module: 'attendance',
    description: 'Leave requests, newest first: person, type, dates, days, reason, status and decision note.',
    input_schema: obj({ status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] }, user_id: { type: 'string' }, limit }),
    run: async (_ctx, i) => {
      const where: Prisma.LeaveRequestWhereInput = {};
      if (i.status) where.status = i.status;
      if (i.user_id) where.userId = String(i.user_id);
      const [total, rows] = await Promise.all([
        prisma.leaveRequest.count({ where }),
        prisma.leaveRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: lim(i.limit), select: { startDate: true, endDate: true, days: true, reason: true, status: true, decisionNote: true, user: { select: { name: true } }, type: { select: { name: true } } } }),
      ]);
      return out({ total, requests: rows.map((l) => ({ person: l.user.name, type: l.type.name, from: day(l.startDate), to: day(l.endDate), days: l.days, reason: l.reason, status: l.status, note: l.decisionNote })) });
    },
  },
  {
    name: 'payroll', label: 'Checked payroll', module: 'payouts',
    description: 'Payroll runs, newest first, with gross, deductions and net totals; for the newest run (or the given month) the payslip of each person: present days, loss-of-pay days, gross, deductions and net.',
    input_schema: obj({ month: { type: 'integer', description: '1–12.' }, year: { type: 'integer' } }),
    run: async (_ctx, i) => {
      const runs = await prisma.payrollRun.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 6, include: { payslips: { include: { user: { select: { name: true } } } } } });
      const pick = i.month && i.year ? runs.find((r) => r.month === Number(i.month) && r.year === Number(i.year)) : runs[0];
      const sum = (r: (typeof runs)[number], k: 'grossEarnings' | 'totalDeductions' | 'netPay') => r.payslips.reduce((s, p) => s + p[k], 0);
      return out({
        runs: runs.map((r) => ({ month: r.month, year: r.year, status: r.status, payslips: r.payslips.length, gross: sum(r, 'grossEarnings'), deductions: sum(r, 'totalDeductions'), net: sum(r, 'netPay') })),
        payslips: pick ? pick.payslips.map((p) => ({ person: p.user.name, present_days: p.presentDays, paid_leave: p.paidLeaveDays, loss_of_pay_days: p.lopDays, gross: p.grossEarnings, deductions: p.totalDeductions, net: p.netPay })) : [],
      });
    },
  },

  // -------------------------------------------------------------------------------- Tasks
  {
    name: 'search_tasks', label: 'Searched tasks', module: 'tasks',
    description: 'Tasks with filters that combine. Returns the total that match and a page of rows (title, status, priority, due, assignee, creator). overdue=true means open and past due.',
    input_schema: obj({
      search: { type: 'string' }, status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled', 'open'] },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, assignee_id: { type: 'string' },
      overdue: { type: 'boolean' }, due_within_days: { type: 'integer' }, limit,
    }),
    run: async (_ctx, i) => {
      const where: Prisma.TaskWhereInput = {};
      if (i.search) where.title = { contains: String(i.search), mode: 'insensitive' };
      if (i.status === 'open' || i.overdue || i.due_within_days) where.status = { in: ['todo', 'in_progress', 'blocked'] };
      else if (i.status) where.status = i.status;
      if (i.priority) where.priority = i.priority;
      if (i.assignee_id) where.assigneeId = String(i.assignee_id);
      if (i.overdue) where.dueAt = { lt: new Date() };
      else if (i.due_within_days) where.dueAt = { gte: new Date(), lte: new Date(Date.now() + Number(i.due_within_days) * DAY) };
      const [total, rows] = await Promise.all([
        prisma.task.count({ where }),
        prisma.task.findMany({ where, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], take: lim(i.limit), select: { id: true, title: true, status: true, priority: true, dueAt: true, completedAt: true, assignee: { select: { name: true } }, createdBy: { select: { name: true } } } }),
      ]);
      return out({ total, tasks: rows.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due: day(t.dueAt), done: day(t.completedAt), assignee: t.assignee.name, created_by: t.createdBy.name, link: `/tasks/${t.id}` })) });
    },
  },

  // -------------------------------------------------------------------------- Real Estate
  {
    name: 'inventory', label: 'Checked inventory', module: 'properties',
    description: 'Plots per project: available, on hold, booked, sold; and for one project (project_id) the plot list with number, type, area, price and status.',
    input_schema: obj({ project_id: { type: 'string' }, status: { type: 'string', enum: ['available', 'booked', 'sold'], description: 'With project_id: only these plots.' } }),
    run: async (_ctx, i) => {
      const now = new Date();
      const [projects, units, holds] = await Promise.all([
        prisma.project.findMany({ select: { id: true, projectName: true, projectLocation: true, status: true } }),
        prisma.propertyUnit.groupBy({ by: ['projectId', 'bookingStatus'], _count: { _all: true } }),
        prisma.plotHold.findMany({ where: { status: 1, holdEnd: { gt: now } }, select: { unitId: true, unit: { select: { projectId: true } } } }),
      ]);
      const res: Record<string, unknown> = {
        projects: projects.map((p) => {
          const of = (s: number) => units.find((u) => u.projectId === p.id && u.bookingStatus === s)?._count._all ?? 0;
          return { id: p.id, name: p.projectName, location: p.projectLocation, live: p.status === 1, available: of(0), on_hold: holds.filter((h) => h.unit.projectId === p.id).length, booked: of(1), sold: of(2) };
        }),
      };
      if (i.project_id) {
        const where: Prisma.PropertyUnitWhereInput = { projectId: String(i.project_id) };
        if (i.status) where.bookingStatus = { available: 0, booked: 1, sold: 2 }[String(i.status)];
        const held = new Set(holds.map((h) => h.unitId));
        const plots = await prisma.propertyUnit.findMany({ where, orderBy: { propertyNumber: 'asc' }, take: 80, select: { id: true, propertyNumber: true, propertyType: true, propertyArea: true, propertyMeasurement: true, totalInvestmentAmount: true, bookingStatus: true, isCorner: true } });
        res.plots = plots.map((u) => ({ number: u.propertyNumber, type: u.propertyType, area: `${u.propertyArea} ${u.propertyMeasurement}`, price: u.totalInvestmentAmount, corner: u.isCorner, status: held.has(u.id) ? 'on hold' : ['available', 'booked', 'sold'][u.bookingStatus] }));
      }
      return out(res);
    },
  },
  {
    name: 'plot_holds', label: 'Checked holds', module: 'properties',
    description: 'Active plot holds: plot, project, who holds it, when it ends. Optionally only those ending within some hours.',
    input_schema: obj({ ending_within_hours: { type: 'integer' } }),
    run: async (_ctx, i) => {
      const now = new Date();
      const holdEnd: Prisma.DateTimeFilter = { gt: now };
      if (i.ending_within_hours) holdEnd.lte = new Date(now.getTime() + Number(i.ending_within_hours) * 3_600_000);
      const rows = await prisma.plotHold.findMany({ where: { status: 1, holdEnd }, orderBy: { holdEnd: 'asc' }, take: 50, select: { holdStart: true, holdEnd: true, user: { select: { name: true } }, unit: { select: { propertyNumber: true, project: { select: { projectName: true } } } } } });
      return out({ holds: rows.map((h) => ({ plot: h.unit.propertyNumber, project: h.unit.project.projectName, held_by: h.user?.name ?? null, from: h.holdStart, ends: h.holdEnd })) });
    },
  },
  {
    name: 'search_bookings', label: 'Searched bookings', module: 'bookings',
    description: 'Bookings (not deposits), newest first: reference, buyer, plot and project, amount, payment mode, status, partner. Returns the total that match.',
    input_schema: obj({ status: { type: 'string', enum: ['pending', 'booked', 'partPaid', 'cancelled'] }, search: { type: 'string', description: 'Buyer name, phone or reference.' }, from: isoDate, to: isoDate, project_id: { type: 'string' }, limit }),
    run: async (_ctx, i) => {
      const where: Prisma.BookingWhereInput = { isDeposit: 0 };
      if (i.status) where.status = i.status;
      if (i.search) where.OR = [{ bookingName: { contains: String(i.search), mode: 'insensitive' } }, { phone: { contains: String(i.search) } }, { reference: { contains: String(i.search), mode: 'insensitive' } }];
      if (i.from || i.to) where.createdAt = { ...(i.from ? { gte: istStart(String(i.from)) } : {}), ...(i.to ? { lte: istEnd(String(i.to)) } : {}) };
      if (i.project_id) where.unit = { projectId: String(i.project_id) };
      const [total, sum, rows] = await Promise.all([
        prisma.booking.count({ where }),
        prisma.booking.aggregate({ where, _sum: { amount: true } }),
        prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, take: lim(i.limit), select: { id: true, reference: true, bookingName: true, amount: true, paymentMode: true, status: true, createdAt: true, user: { select: { name: true } }, unit: { select: { propertyNumber: true, project: { select: { projectName: true } } } } } }),
      ]);
      return out({ total, total_amount: sum._sum.amount ?? 0, bookings: rows.map((b) => ({ reference: b.reference, buyer: b.bookingName, plot: b.unit.propertyNumber, project: b.unit.project.projectName, amount: b.amount, mode: b.paymentMode, status: b.status, partner: b.user?.name ?? null, on: day(b.createdAt), link: `/bookings/${b.id}` })) });
    },
  },
  {
    name: 'payments_due', label: 'Checked money still to collect', module: 'bookings',
    description: 'Booked plots that still owe money, largest balance first: plot, project, buyer, price, paid so far and balance.',
    input_schema: obj({ limit }),
    run: async (_ctx, i) => {
      const units = await prisma.propertyUnit.findMany({ where: { bookingStatus: { not: 0 } }, select: { propertyNumber: true, totalInvestmentAmount: true, project: { select: { projectName: true } }, bookings: { orderBy: { createdAt: 'asc' }, select: { amount: true, status: true, bookingName: true, createdAt: true } } } });
      const rows = units.map((u) => {
        const paid = paidAmountFromBookings(u.bookings);
        return { plot: u.propertyNumber, project: u.project.projectName, buyer: u.bookings[0]?.bookingName ?? null, booked_on: day(u.bookings[0]?.createdAt), price: u.totalInvestmentAmount, paid, balance: remainingAmount(u.totalInvestmentAmount, paid) };
      }).filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance);
      return out({ plots_owing: rows.length, total_balance: rows.reduce((s, r) => s + r.balance, 0), rows: rows.slice(0, lim(i.limit)) });
    },
  },

  // ------------------------------------------------------------------------------ Finance
  {
    name: 'payments', label: 'Looked at payments', module: 'payments',
    description: 'Money received (booking payments and deposits) between two dates: total, by payment mode, and the rows newest first.',
    input_schema: obj({ from: isoDate, to: isoDate, mode: { type: 'string', enum: ['online', 'bankTransfer', 'cash', 'cheque', 'other'] }, limit }),
    run: async (_ctx, i) => {
      const where: Prisma.BookingWhereInput = {};
      if (i.mode) where.paymentMode = i.mode;
      if (i.from || i.to) where.createdAt = { ...(i.from ? { gte: istStart(String(i.from)) } : {}), ...(i.to ? { lte: istEnd(String(i.to)) } : {}) };
      const [byMode, rows] = await Promise.all([
        prisma.booking.groupBy({ by: ['paymentMode'], where, _sum: { amount: true }, _count: { _all: true } }),
        prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, take: lim(i.limit), select: { reference: true, bookingName: true, amount: true, paymentMode: true, isDeposit: true, status: true, createdAt: true } }),
      ]);
      return out({ total: byMode.reduce((s, m) => s + (m._sum.amount ?? 0), 0), by_mode: byMode.map((m) => ({ mode: m.paymentMode, amount: m._sum.amount ?? 0, payments: m._count._all })), rows: rows.map((b) => ({ reference: b.reference, from: b.bookingName, amount: b.amount, mode: b.paymentMode, deposit: b.isDeposit === 1, status: b.status, on: day(b.createdAt) })) });
    },
  },
  {
    name: 'approval_queue', label: 'Checked approvals', module: 'payments',
    description: 'Everything waiting for a money decision: wallet deposits to approve, partners whose KYC documents are uploaded but not verified, pending incentive requests and pending payout requests — each with person and amount.',
    input_schema: obj({}),
    run: async (ctx) => {
      const [deposits, kyc, incentives, payouts] = await Promise.all([
        prisma.fundRequest.findMany({ where: { status: 2 }, orderBy: { createdAt: 'asc' }, take: 30, select: { amount: true, gatewayName: true, createdAt: true, user: { select: { name: true } } } }),
        prisma.user.findMany({ where: { role: 'channel_partner', kycStatus: 0, kycDocuments: { some: {} } }, take: 30, select: { id: true, name: true, city: true } }),
        ctx.access.has('incentives') ? prisma.incentiveRequest.findMany({ where: { status: 0 }, take: 30, select: { createdAt: true, user: { select: { name: true } }, unit: { select: { propertyNumber: true } } } }) : Promise.resolve(null),
        ctx.access.has('payouts') ? prisma.payoutRequest.findMany({ where: { status: 'pending' }, orderBy: { requestDate: 'asc' }, take: 30, select: { amount: true, requestDate: true, user: { select: { name: true } } } }) : Promise.resolve(null),
      ]);
      return out({
        deposits: deposits.map((d) => ({ partner: d.user.name, amount: d.amount, via: d.gatewayName, since: day(d.createdAt) })),
        kyc_to_verify: kyc.map((u) => ({ partner: u.name, city: u.city, link: `/channel-partners/${u.id}` })),
        incentives: incentives?.map((x) => ({ partner: x.user.name, plot: x.unit.propertyNumber, since: day(x.createdAt) })) ?? 'no access',
        payouts: payouts?.map((x) => ({ partner: x.user.name, amount: x.amount, since: day(x.requestDate) })) ?? 'no access',
      });
    },
  },
  {
    name: 'payouts', label: 'Looked at payouts', module: 'payouts',
    description: 'Partner payout requests, newest first: partner, amount, commission and referral bonus, status, last error.',
    input_schema: obj({ status: { type: 'string', enum: ['pending', 'confirmed', 'released', 'rejected', 'failed'] }, limit }),
    run: async (_ctx, i) => {
      const where: Prisma.PayoutRequestWhereInput = i.status ? { status: i.status } : {};
      const [total, rows] = await Promise.all([
        prisma.payoutRequest.aggregate({ where, _count: { _all: true }, _sum: { amount: true } }),
        prisma.payoutRequest.findMany({ where, orderBy: { requestDate: 'desc' }, take: lim(i.limit), select: { amount: true, commission: true, referralBonus: true, status: true, requestDate: true, lastError: true, user: { select: { name: true } } } }),
      ]);
      return out({ total: total._count._all, total_amount: total._sum.amount ?? 0, payouts: rows.map((p) => ({ partner: p.user.name, amount: p.amount, commission: p.commission, referral_bonus: p.referralBonus, status: p.status, requested: day(p.requestDate), error: p.lastError })) });
    },
  },

  // ---------------------------------------------------------------- Construction & Legal
  {
    name: 'construction_schedule', label: 'Checked construction progress', module: 'construction',
    description: 'Planned vs actual % complete per project (weighted by activity). With project_id, every activity: phase, block, planned dates, planned % by today, latest approved % and whether it is behind.',
    input_schema: obj({ project_id: { type: 'string' } }),
    run: async (_ctx, i) => {
      const res: Record<string, unknown> = { projects: await projectSchedules() };
      if (i.project_id) {
        const now = Date.now();
        const acts = await prisma.constructionActivity.findMany({ where: { projectId: String(i.project_id) }, orderBy: { sortOrder: 'asc' }, select: { phase: true, block: true, name: true, plannedStart: true, plannedEnd: true, weight: true, updates: { where: { status: 'approved' }, orderBy: { capturedAt: 'desc' }, take: 1, select: { percentComplete: true, capturedAt: true } } } });
        res.activities = acts.map((a) => {
          const span = a.plannedEnd.getTime() - a.plannedStart.getTime();
          const planned = Math.round(span <= 0 ? (now >= a.plannedEnd.getTime() ? 100 : 0) : Math.min(100, Math.max(0, ((now - a.plannedStart.getTime()) / span) * 100)));
          const actual = a.updates[0]?.percentComplete ?? 0;
          return { phase: a.phase, block: a.block, activity: a.name, start: day(a.plannedStart), end: day(a.plannedEnd), weight: a.weight, planned_pct: planned, actual_pct: actual, last_update: day(a.updates[0]?.capturedAt), behind: actual < planned - 5 };
        });
      }
      return out(res);
    },
  },
  {
    name: 'site_issues', label: 'Checked site issues', module: 'construction',
    description: 'Site issues: title, project, owner, due date, status, and whether overdue.',
    input_schema: obj({ status: { type: 'string', enum: ['open', 'in_progress', 'closed', 'not_closed'] }, limit }),
    run: async (_ctx, i) => {
      const where: Prisma.SiteIssueWhereInput = i.status === 'not_closed' || !i.status ? { status: { not: 'closed' } } : { status: i.status };
      const rows = await prisma.siteIssue.findMany({ where, orderBy: { createdAt: 'desc' }, take: lim(i.limit), select: { title: true, status: true, dueDate: true, createdAt: true, project: { select: { projectName: true } }, owner: { select: { name: true } } } });
      return out({ issues: rows.map((x) => ({ title: x.title, project: x.project.projectName, owner: x.owner?.name ?? null, raised: day(x.createdAt), due: day(x.dueDate), status: x.status, overdue: !!x.dueDate && x.dueDate < new Date() && x.status !== 'closed' })) });
    },
  },
  {
    name: 'vendor_bills', label: 'Checked vendor bills', module: 'vendors',
    description: 'Vendor bills: vendor, work order, bill number, amount, date, status. Plus each vendor\'s contract value and how much is billed and paid.',
    input_schema: obj({ status: { type: 'string', enum: ['submitted', 'approved', 'rejected', 'paid'] }, limit }),
    run: async (_ctx, i) => {
      const [bills, vendors] = await Promise.all([
        prisma.vendorBill.findMany({ where: i.status ? { status: i.status } : {}, orderBy: { billDate: 'desc' }, take: lim(i.limit), select: { billNumber: true, amount: true, billDate: true, status: true, vendor: { select: { name: true } }, workOrder: { select: { number: true } } } }),
        prisma.vendor.findMany({ select: { name: true, category: true, contractValue: true, active: true, bills: { select: { amount: true, status: true } } } }),
      ]);
      return out({
        bills: bills.map((b) => ({ vendor: b.vendor.name, work_order: b.workOrder.number, bill: b.billNumber, amount: b.amount, date: day(b.billDate), status: b.status })),
        vendors: vendors.map((v) => ({ name: v.name, category: v.category, active: v.active, contract: v.contractValue, billed: v.bills.filter((b) => b.status !== 'rejected').reduce((s, b) => s + b.amount, 0), paid: v.bills.filter((b) => b.status === 'paid').reduce((s, b) => s + b.amount, 0) })),
      });
    },
  },
  {
    name: 'legal_status', label: 'Checked legal and compliance', module: 'legal',
    description: 'Project approvals with validity (lapsed, expiring in 60 days, valid), open court cases with next hearing, and open legal files with their registry stage.',
    input_schema: obj({ limit }),
    run: async (_ctx, i) => {
      const now = new Date();
      const [approvals, cases, files] = await Promise.all([
        prisma.projectApproval.findMany({ orderBy: { validUntil: 'asc' }, select: { kind: true, referenceNo: true, validUntil: true, project: { select: { projectName: true } } } }),
        prisma.legalCase.findMany({ where: { closed: false }, orderBy: { nextHearing: 'asc' }, select: { title: true, counterparty: true, stage: true, nextHearing: true } }),
        prisma.legalFile.findMany({ where: { closedAt: null }, orderBy: { openedAt: 'desc' }, take: lim(i.limit), select: { buyerName: true, agreedValue: true, openedAt: true, registry: { select: { status: true, appointmentOn: true } }, project: { select: { projectName: true } } } }),
      ]);
      return out({
        approvals: approvals.map((x) => ({ project: x.project.projectName, kind: x.kind, ref: x.referenceNo, valid_until: day(x.validUntil), state: !x.validUntil ? 'no expiry' : x.validUntil < now ? 'lapsed' : x.validUntil.getTime() - now.getTime() < 60 * DAY ? 'expiring' : 'valid' })),
        court_cases: cases.map((c) => ({ title: c.title, against: c.counterparty, stage: c.stage, next_hearing: day(c.nextHearing) })),
        open_files: files.map((f) => ({ buyer: f.buyerName, project: f.project.projectName, value: f.agreedValue, opened: day(f.openedAt), registry: f.registry?.status ?? 'pending', appointment: day(f.registry?.appointmentOn) })),
      });
    },
  },

  // ------------------------------------------------------------------- People & Partners
  {
    name: 'search_partners', label: 'Searched partners', module: 'partners',
    description: 'Channel partners (or another role) with filters: name/phone, status, KYC (0 pending, 1 verified, 2 rejected), city. Each with joined date, wallet balance and confirmed booking value. Sort by booking value or newest.',
    input_schema: obj({
      search: { type: 'string' }, role: { type: 'string', enum: ['channel_partner', 'employee', 'leader', 'team_leader'], description: 'Default channel_partner.' },
      status: { type: 'string', enum: ['active', 'inactive', 'suspended'] }, kyc: { type: 'integer', enum: [0, 1, 2] }, city: { type: 'string' },
      sort: { type: 'string', enum: ['booking_value', 'newest'] }, limit,
    }),
    run: async (_ctx, i) => {
      const where: Prisma.UserWhereInput = { role: i.role ?? 'channel_partner' };
      if (i.search) where.OR = [{ name: { contains: String(i.search), mode: 'insensitive' } }, { phone: { contains: String(i.search) } }];
      if (i.status) where.status = i.status;
      if (i.kyc !== undefined) where.kycStatus = Number(i.kyc);
      if (i.city) where.city = { contains: String(i.city), mode: 'insensitive' };
      const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({ where, orderBy: { joinedOn: 'desc' }, take: i.sort === 'booking_value' ? 500 : lim(i.limit), select: { id: true, name: true, phone: true, city: true, status: true, kycStatus: true, joinedOn: true, walletBalance: true, partnerCode: true } }),
      ]);
      const sales = await prisma.booking.groupBy({ by: ['userId'], where: { isDeposit: 0, status: { in: ['booked', 'partPaid'] }, userId: { in: users.map((u) => u.id) } }, _sum: { amount: true }, _count: { _all: true } });
      let rows = users.map((u) => {
        const s = sales.find((x) => x.userId === u.id);
        return { id: u.id, name: u.name, code: u.partnerCode, phone: u.phone, city: u.city, status: u.status, kyc: ['pending', 'verified', 'rejected'][u.kycStatus] ?? u.kycStatus, joined: day(u.joinedOn), wallet: u.walletBalance, bookings: s?._count._all ?? 0, booking_value: s?._sum.amount ?? 0, link: `/channel-partners/${u.id}` };
      });
      if (i.sort === 'booking_value') rows = rows.sort((a, b) => b.booking_value - a.booking_value).slice(0, lim(i.limit));
      return out({ total, partners: rows });
    },
  },
  {
    name: 'teams', label: 'Looked at teams', module: 'teams',
    description: 'Teams with their leader and member count.',
    input_schema: obj({}),
    run: async () => {
      const teams = await prisma.team.findMany({ select: { name: true, leader: { select: { name: true } }, _count: { select: { members: true } } } });
      return out({ teams: teams.map((t) => ({ name: t.name, leader: t.leader?.name ?? null, members: t._count.members })) });
    },
  },
  {
    name: 'partner_disputes', label: 'Checked disputes', module: 'partner_portal',
    description: 'Disputes raised by partners: title, details, partner, status, resolution.',
    input_schema: obj({ status: { type: 'string', enum: ['open', 'resolved', 'rejected'] }, limit }),
    run: async (_ctx, i) => {
      const rows = await prisma.partnerDispute.findMany({ where: i.status ? { status: String(i.status) } : {}, orderBy: { createdAt: 'desc' }, take: lim(i.limit), select: { partnerId: true, title: true, details: true, status: true, resolution: true, raisedByName: true, createdAt: true } });
      const names = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((d) => d.partnerId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      return out({ disputes: rows.map((d) => ({ title: d.title, details: d.details, partner: names.get(d.partnerId) ?? null, raised_by: d.raisedByName, on: day(d.createdAt), status: d.status, resolution: d.resolution })) });
    },
  },

  // --------------------------------------------------------------------- Support & Comms
  {
    name: 'support_tickets', label: 'Checked tickets', module: 'support',
    description: 'Support tickets, oldest open first: subject, who raised it, status, last reply, and the latest message.',
    input_schema: obj({ status: { type: 'string', enum: ['open', 'pending', 'resolved', 'closed', 'unresolved'] }, limit }),
    run: async (_ctx, i) => {
      const where: Prisma.SupportTicketWhereInput = !i.status || i.status === 'unresolved' ? { status: { in: ['open', 'pending'] } } : { status: i.status };
      const rows = await prisma.supportTicket.findMany({ where, orderBy: { createdAt: 'asc' }, take: lim(i.limit), select: { id: true, subject: true, status: true, createdAt: true, lastReplyAt: true, user: { select: { name: true, role: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { message: true } } } });
      return out({ tickets: rows.map((t) => ({ subject: t.subject, from: t.user.name, role: t.user.role, status: t.status, opened: day(t.createdAt), last_reply: day(t.lastReplyAt), latest_message: t.messages[0]?.message.slice(0, 300) ?? null, link: `/support/${t.id}` })) });
    },
  },
  {
    name: 'notifications_sent', label: 'Checked notifications', module: 'notifications',
    description: 'Recent notifications: title, type, delivery status, when sent, recipients, read and failed counts. Plus WhatsApp template sends by template for the last 30 days.',
    input_schema: obj({ limit }),
    run: async (_ctx, i) => {
      const [rows, wa] = await Promise.all([
        prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: lim(i.limit), select: { id: true, title: true, type: true, deliveryStatus: true, sentAt: true, createdAt: true } }),
        prisma.whatsAppTemplateSend.groupBy({ by: ['templateName', 'status'], where: { sentAt: { gte: new Date(Date.now() - 30 * DAY) } }, _count: { _all: true } }),
      ]);
      const counts = await prisma.notificationRecipient.groupBy({ by: ['notificationId', 'read', 'failed'], where: { notificationId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
      const c = (id: string, f: (x: (typeof counts)[number]) => boolean) => counts.filter((x) => x.notificationId === id && f(x)).reduce((s, x) => s + x._count._all, 0);
      return out({
        notifications: rows.map((n) => ({ title: n.title, type: n.type, status: n.deliveryStatus, sent: day(n.sentAt ?? n.createdAt), recipients: c(n.id, () => true), read: c(n.id, (x) => x.read), failed: c(n.id, (x) => x.failed) })),
        whatsapp_30_days: wa.map((w) => ({ template: w.templateName, status: w.status, sends: w._count._all })),
      });
    },
  },

  // ---------------------------------------------------------------------------- Settings
  {
    name: 'ops_rules', label: 'Read the operations rules', module: 'ops_rules',
    description: 'Every operations rule: name, trigger, on/off, its settings and steps, and how many times it ran in the last 30 days by result.',
    input_schema: obj({}),
    run: async () => {
      const [rules, fires] = await Promise.all([
        prisma.opsRule.findMany({ select: { id: true, name: true, trigger: true, enabled: true, config: true, steps: true } }),
        prisma.opsRuleFire.groupBy({ by: ['ruleId', 'status'], where: { firedAt: { gte: new Date(Date.now() - 30 * DAY) } }, _count: { _all: true } }),
      ]);
      return out({ rules: rules.map((r) => ({ name: r.name, trigger: r.trigger, on: r.enabled, config: r.config, steps: r.steps, runs_30_days: Object.fromEntries(fires.filter((f) => f.ruleId === r.id).map((f) => [f.status, f._count._all])) })) });
    },
  },
  {
    name: 'audit_log', label: 'Read the audit log', module: 'settings',
    description: 'Changes recorded in the audit log, newest first: who, what, which module and record. Filter by module name, person or the last N days.',
    input_schema: obj({ module: { type: 'string' }, user_name: { type: 'string' }, days: { type: 'integer', description: 'Default 7.' }, limit }),
    run: async (_ctx, i) => {
      const where: Prisma.AuditEntryWhereInput = { createdAt: { gte: new Date(Date.now() - (Number(i.days) || 7) * DAY) } };
      if (i.module) where.module = { contains: String(i.module), mode: 'insensitive' };
      if (i.user_name) where.userName = { contains: String(i.user_name), mode: 'insensitive' };
      const [total, rows] = await Promise.all([
        prisma.auditEntry.count({ where }),
        prisma.auditEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take: lim(i.limit), select: { userName: true, action: true, module: true, recordLabel: true, description: true, createdAt: true } }),
      ]);
      return out({ total, entries: rows.map((e) => ({ at: e.createdAt, by: e.userName, module: e.module, action: e.action, record: e.recordLabel, detail: e.description })) });
    },
  },
  {
    name: 'roles_and_access', label: 'Read roles and access', module: 'settings',
    description: 'Panel roles with their modules and how many people hold each, and people whose client access ends soon.',
    input_schema: obj({}),
    run: async () => {
      const [roles, expiring] = await Promise.all([
        prisma.panelRole.findMany({ select: { name: true, isFullAccess: true, modules: true, _count: { select: { users: true } } } }),
        prisma.user.findMany({ where: { accessExpiresAt: { gte: new Date() } }, orderBy: { accessExpiresAt: 'asc' }, take: 20, select: { name: true, accessExpiresAt: true } }),
      ]);
      return out({ roles: roles.map((r) => ({ name: r.name, full_access: r.isFullAccess, modules: r.modules, people: r._count.users })), access_ending: expiring.map((u) => ({ name: u.name, ends: day(u.accessExpiresAt) })) });
    },
  },
];

/** Which tools each section's assistant gets — its own area only. */
const SECTION_TOOLS: Record<SectionKey, string[]> = {
  hrms: ['attendance_day', 'attendance_summary', 'leave_requests', 'payroll'],
  tasks: ['search_tasks'],
  'real-estate': ['inventory', 'plot_holds', 'search_bookings', 'payments_due'],
  finance: ['payments', 'approval_queue', 'payouts', 'payments_due'],
  'construction-legal': ['construction_schedule', 'site_issues', 'vendor_bills', 'legal_status'],
  people: ['search_partners', 'teams', 'partner_disputes'],
  support: ['support_tickets', 'notifications_sent'],
  reports: ['search_bookings', 'payments', 'search_partners', 'attendance_summary', 'payouts', 'support_tickets'],
  settings: ['ops_rules', 'audit_log', 'roles_and_access'],
};

export const toolsFor = (section: SectionKey) => MODULE_TOOLS.filter((t) => ['section_overview', 'find_people', ...SECTION_TOOLS[section]].includes(t.name));
export const moduleToolByName = (name: string) => MODULE_TOOLS.find((t) => t.name === name);

/** Reports may read what its reports already show; every other section needs the tool's module. */
export function mayRun(tool: ModTool, ctx: ToolCtx) {
  return !tool.module || ctx.access.has(tool.module) || (ctx.section === 'reports' && ctx.access.has('reports'));
}

export const moduleToolSpecs = (section: SectionKey): Anthropic.Beta.BetaTool[] =>
  toolsFor(section).map(({ name, description, input_schema }) => ({ name, description, input_schema, eager_input_streaming: true }) as Anthropic.Beta.BetaTool);
