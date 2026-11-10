import { prisma } from '../prisma';
import { dayKey, dayString, minutesOfDayInOrgZone } from './dates';
import { paidAmountFromBookings, remainingAmount } from './derive';
import { SECTIONS, type Access, type SectionKey } from './sections';

/**
 * Section overviews — one shape for every section, so one page renders them all and the section's
 * assistant reads exactly what the page shows. Counting is done with aggregates wherever the
 * tables can grow; a block is only built when the person holds the module behind it.
 */

export type Fmt = 'num' | 'inr' | 'pct';
export interface Kpi { label: string; value: number; format?: Fmt; meta?: string; to?: string; tone?: 'danger' | 'warn' | 'good' }
export interface ChartRow { name: string; value: number; to?: string; target?: number; parts?: { name: string; value: number }[] }
export interface Chart {
  id: string;
  title: string;
  meta?: string;
  /** columns: vertical bars over time · bars: ranked list · ring: share of a whole · split: one stacked bar · progress: actual against a target · stack: one stacked bar per row */
  kind: 'columns' | 'bars' | 'ring' | 'split' | 'progress' | 'stack';
  rows: ChartRow[];
  format?: Fmt;
  /** Shown in the narrow column beside the assistant rather than the main one. */
  side?: boolean;
  to?: string;
}
export interface Attention { title: string; detail: string; to: string; level: 'act' | 'review' | 'info' }
export interface JumpLink { label: string; to: string; meta: string }
export interface SectionOverview { section: SectionKey; label: string; generatedAt: string; kpis: Kpi[]; charts: Chart[]; attention: Attention[]; links: JumpLink[] }

type Part = Pick<SectionOverview, 'kpis' | 'charts' | 'attention' | 'links'>;
const empty = (): Part => ({ kpis: [], charts: [], attention: [], links: [] });

const DAY = 86_400_000;
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const shortDay = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The last `n` calendar months (org time), oldest first, as "YYYY-MM" with a short label. */
function lastMonths(n: number) {
  const [y, m] = dayString().slice(0, 7).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const idx = y * 12 + (m - 1) - (n - 1 - i);
    return { key: `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`, label: MONTH_LABEL[idx % 12] };
  });
}
const monthOf = (d: Date) => dayString(d).slice(0, 7);
/** Start of the oldest of the last `n` months, a day early so the org-time bucketing is exact. */
const monthsStart = (n: number) => new Date(new Date(`${lastMonths(n)[0].key}-01T00:00:00Z`).getTime() - DAY);

function perMonth<T>(rows: T[], n: number, dateOf: (r: T) => Date, valueOf: (r: T) => number = () => 1): ChartRow[] {
  const months = lastMonths(n);
  const sums = new Map(months.map((mo) => [mo.key, 0]));
  for (const r of rows) {
    const k = monthOf(dateOf(r));
    if (sums.has(k)) sums.set(k, sums.get(k)! + valueOf(r));
  }
  return months.map((mo) => ({ name: mo.label, value: sums.get(mo.key)! }));
}

function perDay<T>(rows: T[], days: number, dateOf: (r: T) => Date): ChartRow[] {
  const keys = Array.from({ length: days }, (_, i) => dayString(new Date(Date.now() - (days - 1 - i) * DAY)));
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = dayString(dateOf(r));
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return keys.map((k) => ({ name: shortDay(new Date(`${k}T12:00:00+05:30`)), value: counts.get(k)! }));
}

const STAFF = ['employee', 'leader', 'team_leader'] as const;

// ---------------------------------------------------------------------------------------- HRMS

async function hrms(a: Access): Promise<Part> {
  const p = empty();
  const today = dayKey();
  if (a.has('attendance')) {
    const weekStart = new Date(today.getTime() - 6 * DAY);
    const [staff, records, week, pendingLeave, corrections, failed, nextHoliday, leaveByType, teams] = await Promise.all([
      prisma.user.findMany({ where: { status: 'active', role: { in: [...STAFF] } }, select: { id: true, teamId: true, designation: true } }),
      prisma.attendanceRecord.findMany({ where: { date: today }, select: { checkInAt: true, isLate: true, distanceFromOfficeMeters: true, user: { select: { name: true } } } }),
      prisma.attendanceRecord.findMany({ where: { date: { gte: weekStart }, checkInAt: { not: null } }, select: { date: true } }),
      prisma.leaveRequest.findMany({ where: { status: 'pending' }, orderBy: { startDate: 'asc' }, select: { days: true, startDate: true, user: { select: { name: true } }, type: { select: { name: true } } } }),
      prisma.attendanceRecord.count({ where: { correctionRequested: true, correctionStatus: 'pending' } }),
      prisma.attendanceRecord.count({ where: { date: { gte: weekStart }, syncStatus: 'failed' } }),
      prisma.holiday.findFirst({ where: { startDate: { gte: today } }, orderBy: { startDate: 'asc' }, select: { name: true, startDate: true } }),
      prisma.leaveRequest.groupBy({ by: ['leaveTypeId'], where: { startDate: { gte: new Date(today.getTime() - 30 * DAY) }, status: { in: ['approved', 'pending'] } }, _sum: { days: true } }),
      prisma.team.findMany({ select: { id: true, name: true } }),
    ]);
    const present = records.filter((r) => r.checkInAt).length;
    const late = records.filter((r) => r.isLate).length;
    p.kpis.push(
      { label: 'Present today', value: present, meta: `of ${staff.length} staff`, to: '/attendance/today', tone: 'good' },
      { label: 'Late today', value: late, meta: 'checked in after the start time', to: '/attendance/today', tone: late ? 'warn' : undefined },
      { label: 'Not checked in', value: Math.max(0, staff.length - present), meta: 'no mark yet today', to: '/attendance/today' },
      { label: 'Leave to decide', value: pendingLeave.length, meta: `${pendingLeave.reduce((s, l) => s + l.days, 0)} days asked`, to: '/attendance/leave', tone: pendingLeave.length ? 'warn' : undefined },
      { label: 'Corrections to review', value: corrections, to: '/attendance/corrections', tone: corrections ? 'warn' : undefined },
    );

    const buckets = [['Before 9:00', 0, 540], ['9:00–9:15', 540, 555], ['9:15–9:30', 555, 570], ['9:30–10:00', 570, 600], ['10:00–11:00', 600, 660], ['After 11:00', 660, 1440]] as const;
    const minutes = records.filter((r) => r.checkInAt).map((r) => minutesOfDayInOrgZone(r.checkInAt!));
    p.charts.push({ id: 'checkins', title: 'Check-in times today', meta: `${present} checked in`, kind: 'columns', to: '/attendance/today', rows: buckets.map(([name, lo, hi]) => ({ name, value: minutes.filter((m) => m >= lo && m < hi).length })) });
    p.charts.push({ id: 'week', title: 'Present each day', meta: 'last 7 days', kind: 'columns', to: '/attendance/history', rows: perDay(week, 7, (r) => r.date) });

    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const byTeam = new Map<string, number>();
    for (const s of staff) {
      const k = (s.teamId && teamName.get(s.teamId)) || s.designation || 'No team';
      byTeam.set(k, (byTeam.get(k) ?? 0) + 1);
    }
    p.charts.push({ id: 'headcount', title: 'Headcount by team', meta: `${staff.length} active`, kind: 'bars', side: true, to: '/users/employees', rows: [...byTeam].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([name, value]) => ({ name, value })) });

    if (leaveByType.length) {
      const types = await prisma.leaveType.findMany({ where: { id: { in: leaveByType.map((l) => l.leaveTypeId) } }, select: { id: true, name: true } });
      const tName = new Map(types.map((t) => [t.id, t.name]));
      p.charts.push({ id: 'leave', title: 'Leave taken and asked', meta: 'days, last 30 days', kind: 'bars', side: true, to: '/attendance/leave', rows: leaveByType.map((l) => ({ name: tName.get(l.leaveTypeId) ?? 'Leave', value: l._sum.days ?? 0 })).sort((x, y) => y.value - x.value) });
    }

    for (const l of pendingLeave.slice(0, 3)) {
      p.attention.push({ title: `${l.type.name} request from ${l.user.name}`, detail: `${l.days} day${l.days === 1 ? '' : 's'} from ${shortDay(l.startDate)}`, to: '/attendance/leave', level: 'review' });
    }
    if (corrections) p.attention.push({ title: `${plural(corrections, 'attendance correction')} waiting`, detail: 'Staff asked to fix a check-in or check-out', to: '/attendance/corrections', level: 'review' });
    const far = records.filter((r) => (r.distanceFromOfficeMeters ?? 0) > 500);
    if (far.length) p.attention.push({ title: `${plural(far.length, 'check-in')} far from the office today`, detail: far.slice(0, 3).map((r) => r.user.name).join(', ') + (far.length > 3 ? ` and ${far.length - 3} more` : ''), to: '/attendance/today', level: 'review' });
    if (failed) p.attention.push({ title: `${plural(failed, 'mark')} failed to sync this week`, detail: 'The app could not send them; check and mark by hand', to: '/attendance/history', level: 'act' });
    if (nextHoliday) p.attention.push({ title: `${nextHoliday.name} on ${shortDay(nextHoliday.startDate)}`, detail: 'Next holiday on the calendar', to: '/attendance/holidays', level: 'info' });

    p.links.push(
      { label: 'Attendance today', to: '/attendance/today', meta: `${present} present` },
      { label: 'Leave requests', to: '/attendance/leave', meta: `${pendingLeave.length} pending` },
      { label: 'Corrections', to: '/attendance/corrections', meta: `${corrections} to review` },
      { label: 'Holidays', to: '/attendance/holidays', meta: nextHoliday ? `Next: ${nextHoliday.name}` : 'Calendar' },
    );
  }
  if (a.has('payouts')) {
    const run = await prisma.payrollRun.findFirst({ orderBy: [{ year: 'desc' }, { month: 'desc' }], include: { payslips: { select: { netPay: true } } } });
    if (run) {
      const net = run.payslips.reduce((s, x) => s + x.netPay, 0);
      p.kpis.push({ label: `Net payroll, ${MONTH_LABEL[run.month - 1]} ${run.year}`, value: net, format: 'inr', meta: `${run.payslips.length} payslips · ${run.status}`, to: '/payouts/payroll' });
      if (run.status === 'draft') p.attention.push({ title: `${MONTH_LABEL[run.month - 1]} payroll is still a draft`, detail: `${inr(net)} net across ${run.payslips.length} payslips`, to: '/payouts/payroll', level: 'act' });
    }
    p.links.push({ label: 'Payroll', to: '/payouts/payroll', meta: run ? `${MONTH_LABEL[run.month - 1]} · ${run.status}` : 'No run yet' });
  }
  if (a.has('partners')) p.links.push({ label: 'Employees', to: '/users/employees', meta: 'Staff records' });
  return p;
}

// ---------------------------------------------------------------------------------------- Tasks

async function tasks(a: Access): Promise<Part> {
  const p = empty();
  if (!a.has('tasks')) return p;
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * DAY);
  const open = { status: { in: ['todo', 'in_progress', 'blocked'] as ('todo' | 'in_progress' | 'blocked')[] } };
  const [byStatus, overdue, dueWeek, doneRecent, openByPriority, openByAssignee, overdueList, blockedList] = await Promise.all([
    prisma.task.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.task.count({ where: { ...open, dueAt: { lt: now } } }),
    prisma.task.count({ where: { ...open, dueAt: { gte: now, lte: weekAhead } } }),
    prisma.task.findMany({ where: { status: 'done', completedAt: { gte: new Date(now.getTime() - 14 * DAY) } }, select: { completedAt: true } }),
    prisma.task.groupBy({ by: ['priority'], where: open, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['assigneeId'], where: open, _count: { _all: true }, orderBy: { _count: { assigneeId: 'desc' } }, take: 8 }),
    prisma.task.findMany({ where: { ...open, dueAt: { lt: now } }, orderBy: { dueAt: 'asc' }, take: 5, select: { id: true, title: true, dueAt: true, priority: true, assignee: { select: { name: true } } } }),
    prisma.task.findMany({ where: { status: 'blocked' }, orderBy: { updatedAt: 'asc' }, take: 3, select: { id: true, title: true, assignee: { select: { name: true } } } }),
  ]);
  const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const openCount = count('todo') + count('in_progress') + count('blocked');
  p.kpis.push(
    { label: 'Open tasks', value: openCount, meta: `${count('todo')} to do · ${count('in_progress')} in progress`, to: '/tasks' },
    { label: 'Overdue', value: overdue, meta: 'past their due date', to: '/tasks', tone: overdue ? 'danger' : undefined },
    { label: 'Blocked', value: count('blocked'), to: '/tasks/board', tone: count('blocked') ? 'warn' : undefined },
    { label: 'Due this week', value: dueWeek, meta: 'next 7 days', to: '/tasks' },
    { label: 'Done, last 14 days', value: doneRecent.length, to: '/tasks', tone: 'good' },
  );
  p.charts.push({ id: 'status', title: 'Tasks by status', kind: 'columns', to: '/tasks/board', rows: [['To do', 'todo'], ['In progress', 'in_progress'], ['Blocked', 'blocked'], ['Done', 'done'], ['Cancelled', 'cancelled']].map(([name, s]) => ({ name, value: count(s) })) });
  p.charts.push({ id: 'done', title: 'Finished each day', meta: 'last 14 days', kind: 'columns', rows: perDay(doneRecent, 14, (r) => r.completedAt!) });
  const names = new Map((await prisma.user.findMany({ where: { id: { in: openByAssignee.map((r) => r.assigneeId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  p.charts.push({ id: 'people', title: 'Open tasks per person', kind: 'bars', side: true, rows: openByAssignee.map((r) => ({ name: names.get(r.assigneeId) ?? 'Someone', value: r._count._all })) });
  p.charts.push({ id: 'priority', title: 'Open tasks by priority', kind: 'ring', side: true, rows: ['urgent', 'high', 'normal', 'low'].map((pr) => ({ name: pr[0].toUpperCase() + pr.slice(1), value: openByPriority.find((r) => r.priority === pr)?._count._all ?? 0 })) });
  for (const t of overdueList) p.attention.push({ title: t.title, detail: `${t.assignee.name} · was due ${shortDay(t.dueAt!)} · ${t.priority}`, to: `/tasks/${t.id}`, level: 'act' });
  for (const t of blockedList) p.attention.push({ title: `Blocked: ${t.title}`, detail: t.assignee.name, to: `/tasks/${t.id}`, level: 'review' });
  p.links.push(
    { label: 'Board', to: '/tasks/board', meta: 'Drag to update' },
    { label: 'All tasks', to: '/tasks', meta: `${openCount} open` },
    { label: 'My tasks', to: '/tasks/mine', meta: 'Assigned to you' },
    { label: 'New task', to: '/tasks/new', meta: 'Create one' },
  );
  return p;
}

// ---------------------------------------------------------------------------------- Real Estate

async function realEstate(a: Access): Promise<Part> {
  const p = empty();
  const now = new Date();
  if (a.has('projects') || a.has('properties')) {
    const [projects, units, activeHolds] = await Promise.all([
      prisma.project.findMany({ select: { id: true, projectName: true, status: true } }),
      prisma.propertyUnit.groupBy({ by: ['projectId', 'bookingStatus'], _count: { _all: true } }),
      prisma.plotHold.findMany({ where: { status: 1, holdEnd: { gt: now } }, select: { holdEnd: true, unit: { select: { propertyNumber: true, project: { select: { projectName: true } } } } } }),
    ]);
    const total = (s: number) => units.filter((u) => u.bookingStatus === s).reduce((n, u) => n + u._count._all, 0);
    const available = total(0);
    p.kpis.push(
      { label: 'Available plots', value: Math.max(0, available - activeHolds.length), meta: `${projects.filter((x) => x.status === 1).length} live projects`, to: '/properties' },
      { label: 'On hold', value: activeHolds.length, to: '/properties/holds', tone: activeHolds.length ? 'warn' : undefined },
      { label: 'Booked', value: total(1), to: '/properties/booked' },
      { label: 'Sold out', value: total(2), to: '/properties/sold-out', tone: 'good' },
    );
    p.charts.push({
      id: 'inventory', title: 'Inventory by project', meta: 'available · booked · sold', kind: 'stack', to: '/properties/map',
      rows: projects.map((pr) => {
        const of = (s: number) => units.find((u) => u.projectId === pr.id && u.bookingStatus === s)?._count._all ?? 0;
        return { name: pr.projectName, value: of(0) + of(1) + of(2), to: `/projects/${pr.id}`, parts: [{ name: 'Available', value: of(0) }, { name: 'Booked', value: of(1) }, { name: 'Sold', value: of(2) }] };
      }).filter((r) => r.value).sort((x, y) => y.value - x.value).slice(0, 8),
    });
    p.charts.push({ id: 'split', title: 'All plots', kind: 'ring', side: true, rows: [{ name: 'Available', value: Math.max(0, available - activeHolds.length) }, { name: 'On hold', value: activeHolds.length }, { name: 'Booked', value: total(1) }, { name: 'Sold', value: total(2) }] });
    const soon = activeHolds.filter((h) => h.holdEnd.getTime() - now.getTime() < DAY);
    if (soon.length) p.attention.push({ title: `${plural(soon.length, 'hold')} end in the next 24 hours`, detail: soon.slice(0, 3).map((h) => `${h.unit.project.projectName} ${h.unit.propertyNumber}`).join(', '), to: '/properties/holds', level: 'review' });
    p.links.push({ label: 'Projects', to: '/projects', meta: `${projects.length} projects` }, { label: 'Plot map', to: '/properties/map', meta: 'Live board' });
  }
  if (a.has('bookings')) {
    const monthStart = new Date(`${dayString().slice(0, 7)}-01T00:00:00+05:30`);
    const [pending, recent, cancellations, openUnits] = await Promise.all([
      prisma.booking.findMany({ where: { status: 'pending', isDeposit: 0 }, orderBy: { createdAt: 'asc' }, select: { id: true, reference: true, bookingName: true, amount: true, createdAt: true } }),
      prisma.booking.findMany({ where: { isDeposit: 0, status: { in: ['booked', 'partPaid'] }, createdAt: { gte: monthsStart(6) } }, select: { createdAt: true, amount: true } }),
      prisma.bookingCancellation.count({ where: { status: 'pending' } }),
      prisma.propertyUnit.findMany({ where: { bookingStatus: { not: 0 } }, select: { totalInvestmentAmount: true, bookings: { select: { amount: true, status: true } } } }),
    ]);
    const outstanding = openUnits.reduce((s, u) => s + remainingAmount(u.totalInvestmentAmount, paidAmountFromBookings(u.bookings)), 0);
    const thisMonth = recent.filter((b) => b.createdAt >= monthStart);
    p.kpis.push(
      { label: 'Bookings to confirm', value: pending.length, meta: inr(pending.reduce((s, b) => s + b.amount, 0)), to: '/bookings/pending', tone: pending.length ? 'warn' : undefined },
      { label: 'Confirmed this month', value: thisMonth.length, meta: inr(thisMonth.reduce((s, b) => s + b.amount, 0)), to: '/bookings/booked', tone: 'good' },
      { label: 'Still to collect', value: outstanding, format: 'inr', meta: 'on booked plots', to: '/bookings/remaining' },
    );
    p.charts.push({ id: 'bookings', title: 'Confirmed bookings per month', meta: 'last 6 months', kind: 'columns', to: '/bookings', rows: perMonth(recent, 6, (b) => b.createdAt) });
    const stale = pending.filter((b) => now.getTime() - b.createdAt.getTime() > 3 * DAY);
    if (stale.length) p.attention.push({ title: `${plural(stale.length, 'booking')} pending for over 3 days`, detail: stale.slice(0, 3).map((b) => `${b.reference} ${b.bookingName}`).join(', '), to: '/bookings/pending', level: 'act' });
    if (cancellations) p.attention.push({ title: `${plural(cancellations, 'cancellation request')} to decide`, detail: 'Refund and deduction need approval', to: '/bookings/cancellations', level: 'review' });
    p.links.push({ label: 'Bookings', to: '/bookings', meta: `${pending.length} to confirm` }, { label: 'Payments due', to: '/bookings/remaining', meta: inr(outstanding) });
  }
  if (a.has('investments')) {
    const [active, due] = await Promise.all([
      prisma.investment.aggregate({ where: { isActive: 1 }, _count: { _all: true }, _sum: { amount: true } }),
      prisma.investment.count({ where: { isActive: 1, returnDate: { lte: new Date(now.getTime() + 7 * DAY) } } }),
    ]);
    p.kpis.push({ label: 'Running investments', value: active._sum.amount ?? 0, format: 'inr', meta: plural(active._count._all, 'deposit'), to: '/investments/running' });
    if (due) p.attention.push({ title: `${plural(due, 'investment return')} due within a week`, detail: 'Plan the payout', to: '/investments/due', level: 'review' });
    p.links.push({ label: 'Investments', to: '/investments', meta: `${active._count._all} running` });
  }
  if (a.has('cameras')) {
    const cams = await prisma.camera.count({ where: { active: true } });
    p.links.push({ label: 'Site cameras', to: '/cameras', meta: `${cams} live` });
  }
  return p;
}

// -------------------------------------------------------------------------------------- Finance

async function finance(a: Access): Promise<Part> {
  const p = empty();
  if (a.has('payments')) {
    const monthStart = new Date(`${dayString().slice(0, 7)}-01T00:00:00+05:30`);
    const [byMode, recent, deposits, kycPending] = await Promise.all([
      prisma.booking.groupBy({ by: ['paymentMode'], _sum: { amount: true } }),
      prisma.booking.findMany({ where: { createdAt: { gte: monthsStart(6) } }, select: { createdAt: true, amount: true } }),
      prisma.fundRequest.aggregate({ where: { status: 2 }, _count: { _all: true }, _sum: { amount: true } }),
      prisma.user.count({ where: { role: 'channel_partner', kycStatus: 0, kycDocuments: { some: {} } } }),
    ]);
    const collected = byMode.reduce((s, m) => s + (m._sum.amount ?? 0), 0);
    const thisMonth = recent.filter((b) => b.createdAt >= monthStart).reduce((s, b) => s + b.amount, 0);
    p.kpis.push(
      { label: 'Collected, all time', value: collected, format: 'inr', to: '/transactions', tone: 'good' },
      { label: 'Collected this month', value: thisMonth, format: 'inr', to: '/transactions' },
      { label: 'Deposits to approve', value: deposits._count._all, meta: inr(deposits._sum.amount ?? 0), to: '/wallet/approvals', tone: deposits._count._all ? 'warn' : undefined },
      { label: 'KYC to verify', value: kycPending, meta: 'documents uploaded', to: '/wallet/kyc', tone: kycPending ? 'warn' : undefined },
    );
    p.charts.push({ id: 'collections', title: 'Collections per month', meta: 'last 6 months', kind: 'columns', format: 'inr', to: '/reports/payments', rows: perMonth(recent, 6, (b) => b.createdAt, (b) => b.amount) });
    const MODE: Record<string, string> = { bankTransfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', online: 'Online', other: 'Other' };
    p.charts.push({ id: 'modes', title: 'Collected by mode', kind: 'ring', format: 'inr', side: true, rows: byMode.map((m) => ({ name: MODE[m.paymentMode] ?? m.paymentMode, value: m._sum.amount ?? 0 })).sort((x, y) => y.value - x.value) });
    if (deposits._count._all) p.attention.push({ title: `${plural(deposits._count._all, 'wallet deposit')} waiting`, detail: `${inr(deposits._sum.amount ?? 0)} to approve or reject`, to: '/wallet/approvals', level: 'act' });
    if (kycPending) p.attention.push({ title: `${plural(kycPending, 'partner')} waiting for KYC`, detail: 'Payouts stay blocked until verified', to: '/wallet/kyc', level: 'review' });
    p.links.push({ label: 'All payments', to: '/transactions', meta: 'Receipts' }, { label: 'Wallet approvals', to: '/wallet/approvals', meta: `${deposits._count._all} pending` }, { label: 'KYC', to: '/wallet/kyc', meta: `${kycPending} to verify` });
  }
  if (a.has('payouts')) {
    const byStatus = await prisma.payoutRequest.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } });
    const of = (s: string) => byStatus.find((r) => r.status === s);
    const pending = of('pending');
    p.kpis.push({ label: 'Payouts to approve', value: pending?._sum.amount ?? 0, format: 'inr', meta: plural(pending?._count._all ?? 0, 'request'), to: '/payouts', tone: pending?._count._all ? 'warn' : undefined });
    p.charts.push({ id: 'payouts', title: 'Partner payouts by status', kind: 'bars', format: 'inr', side: true, to: '/payouts', rows: [['Pending', 'pending'], ['Confirmed', 'confirmed'], ['Released', 'released'], ['Rejected', 'rejected'], ['Failed', 'failed']].map(([name, s]) => ({ name, value: of(s)?._sum.amount ?? 0 })) });
    if (pending?._count._all) p.attention.push({ title: `${plural(pending._count._all, 'payout request')} pending`, detail: `${inr(pending._sum.amount ?? 0)} of brokerage`, to: '/payouts', level: 'act' });
    if (of('failed')?._count._all) p.attention.push({ title: `${plural(of('failed')!._count._all, 'payout')} failed`, detail: 'Bank transfer did not go through — retry or fix details', to: '/payouts', level: 'act' });
    p.links.push({ label: 'Partner payouts', to: '/payouts', meta: 'Brokerage' }, { label: 'Statements', to: '/payouts/statements', meta: 'Per partner' });
  }
  if (a.has('incentives')) {
    const pending = await prisma.incentiveRequest.count({ where: { status: 0 } });
    p.kpis.push({ label: 'Incentive requests', value: pending, meta: 'waiting for a decision', to: '/incentive-requests', tone: pending ? 'warn' : undefined });
    if (pending) p.attention.push({ title: `${plural(pending, 'incentive request')} to decide`, detail: 'Raised by partners', to: '/incentive-requests', level: 'review' });
    p.links.push({ label: 'Incentives', to: '/incentive-requests', meta: `${pending} pending` });
  }
  return p;
}

// ----------------------------------------------------------------------- Construction & Legal

/** Planned and actual completion per project, both weighted by activity weight. */
export async function projectSchedules() {
  const activities = await prisma.constructionActivity.findMany({
    select: {
      projectId: true, weight: true, plannedStart: true, plannedEnd: true, project: { select: { projectName: true } },
      updates: { where: { status: 'approved' }, orderBy: { capturedAt: 'desc' }, take: 1, select: { percentComplete: true } },
    },
  });
  const now = Date.now();
  const by = new Map<string, { id: string; name: string; weight: number; planned: number; actual: number }>();
  for (const act of activities) {
    const span = act.plannedEnd.getTime() - act.plannedStart.getTime();
    const planned = span <= 0 ? (now >= act.plannedEnd.getTime() ? 100 : 0) : Math.min(100, Math.max(0, ((now - act.plannedStart.getTime()) / span) * 100));
    const actual = act.updates[0]?.percentComplete ?? 0;
    const row = by.get(act.projectId) ?? { id: act.projectId, name: act.project.projectName, weight: 0, planned: 0, actual: 0 };
    row.weight += act.weight; row.planned += planned * act.weight; row.actual += actual * act.weight;
    by.set(act.projectId, row);
  }
  return [...by.values()].map((r) => ({ id: r.id, name: r.name, planned: r.weight ? Math.round(r.planned / r.weight) : 0, actual: r.weight ? Math.round(r.actual / r.weight) : 0 }));
}

async function constructionLegal(a: Access): Promise<Part> {
  const p = empty();
  const now = new Date();
  if (a.has('construction')) {
    const [schedules, reviews, issues, overdueIssues] = await Promise.all([
      projectSchedules(),
      prisma.progressUpdate.count({ where: { status: 'pending' } }),
      prisma.siteIssue.count({ where: { status: { not: 'closed' } } }),
      prisma.siteIssue.findMany({ where: { status: { not: 'closed' }, dueDate: { lt: now } }, orderBy: { dueDate: 'asc' }, take: 3, select: { title: true, dueDate: true, project: { select: { projectName: true } } } }),
    ]);
    const behind = schedules.filter((s) => s.actual < s.planned - 5);
    p.kpis.push(
      { label: 'Sites behind plan', value: behind.length, meta: `of ${schedules.length} scheduled`, to: '/construction', tone: behind.length ? 'danger' : 'good' },
      { label: 'Updates to review', value: reviews, meta: 'supervisor submissions', to: '/construction/reviews', tone: reviews ? 'warn' : undefined },
      { label: 'Open site issues', value: issues, to: '/construction/issues', tone: issues ? 'warn' : undefined },
    );
    p.charts.push({ id: 'schedule', title: 'Plan vs actual', meta: 'weighted % complete', kind: 'progress', format: 'pct', to: '/construction', rows: schedules.map((s) => ({ name: s.name, value: s.actual, target: s.planned, to: `/projects/${s.id}` })) });
    for (const s of behind.slice(0, 3)) p.attention.push({ title: `${s.name} is behind schedule`, detail: `${s.actual}% done against ${s.planned}% planned by today`, to: '/construction', level: 'act' });
    for (const i of overdueIssues) p.attention.push({ title: i.title, detail: `${i.project.projectName} · was due ${shortDay(i.dueDate!)}`, to: '/construction/issues', level: 'act' });
    if (reviews) p.attention.push({ title: `${plural(reviews, 'progress update')} to approve`, detail: 'Approved updates move the plan-vs-actual numbers', to: '/construction/reviews', level: 'review' });
    p.links.push({ label: 'Progress', to: '/construction', meta: `${behind.length} behind` }, { label: 'Site issues', to: '/construction/issues', meta: `${issues} open` });
  }
  if (a.has('vendors')) {
    const [bills, material, vendors] = await Promise.all([
      prisma.vendorBill.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }),
      prisma.materialEntry.count({ where: { status: 'pending' } }),
      prisma.vendor.count({ where: { active: true } }),
    ]);
    const submitted = bills.find((b) => b.status === 'submitted');
    p.kpis.push({ label: 'Bills to approve', value: submitted?._count._all ?? 0, meta: inr(submitted?._sum.amount ?? 0), to: '/vendors/bills', tone: submitted?._count._all ? 'warn' : undefined });
    p.charts.push({ id: 'bills', title: 'Vendor bills', meta: 'amount by status', kind: 'bars', format: 'inr', side: true, to: '/vendors/bills', rows: [['Submitted', 'submitted'], ['Approved', 'approved'], ['Paid', 'paid'], ['Rejected', 'rejected']].map(([name, s]) => ({ name, value: bills.find((b) => b.status === s)?._sum.amount ?? 0 })) });
    if (material) p.attention.push({ title: `${plural(material, 'material delivery', 'material deliveries')} to verify`, detail: 'Logged at site, not yet checked', to: '/vendors/material', level: 'review' });
    p.links.push({ label: 'Vendors', to: '/vendors', meta: `${vendors} active` }, { label: 'Material', to: '/vendors/material', meta: `${material} to verify` });
  }
  if (a.has('legal')) {
    const soon = new Date(now.getTime() + 60 * DAY);
    const [files, registries, approvals, hearings, openCases] = await Promise.all([
      prisma.legalFile.count({ where: { closedAt: null } }),
      prisma.registry.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.projectApproval.findMany({ where: { validUntil: { lte: soon } }, orderBy: { validUntil: 'asc' }, select: { kind: true, validUntil: true, project: { select: { projectName: true } } } }),
      prisma.legalCase.findMany({ where: { closed: false, nextHearing: { gte: now, lte: new Date(now.getTime() + 14 * DAY) } }, orderBy: { nextHearing: 'asc' }, select: { title: true, nextHearing: true } }),
      prisma.legalCase.count({ where: { closed: false } }),
    ]);
    const lapsed = approvals.filter((x) => x.validUntil! < now);
    p.kpis.push(
      { label: 'Approvals lapsed or expiring', value: approvals.length, meta: `${lapsed.length} already lapsed`, to: '/legal/compliance', tone: lapsed.length ? 'danger' : approvals.length ? 'warn' : undefined },
      { label: 'Open court cases', value: openCases, to: '/legal/disputes' },
    );
    const REG: [string, string][] = [['pending', 'Not started'], ['documents_in_preparation', 'Documents'], ['stamp_duty_paid', 'Stamp duty paid'], ['appointment_booked', 'Appointment'], ['registered', 'Registered']];
    const withRegistry = registries.reduce((s, r) => s + r._count._all, 0);
    p.charts.push({ id: 'registry', title: 'Registry pipeline', meta: `${files} open files`, kind: 'bars', side: true, to: '/legal', rows: REG.map(([s, name]) => ({ name, value: (registries.find((r) => r.status === s)?._count._all ?? 0) + (s === 'pending' ? Math.max(0, files - withRegistry) : 0) })) });
    for (const x of approvals.slice(0, 3)) p.attention.push({ title: `${x.kind} ${x.validUntil! < now ? 'lapsed' : 'expires'} on ${shortDay(x.validUntil!)}`, detail: x.project.projectName, to: '/legal/compliance', level: x.validUntil! < now ? 'act' : 'review' });
    for (const h of hearings) p.attention.push({ title: `Hearing: ${h.title}`, detail: `On ${shortDay(h.nextHearing!)}`, to: '/legal/disputes', level: 'info' });
    p.links.push({ label: 'Legal files', to: '/legal', meta: `${files} open` }, { label: 'Compliance', to: '/legal/compliance', meta: `${approvals.length} to watch` });
  }
  return p;
}

// ----------------------------------------------------------------------------- People & Partners

async function people(a: Access): Promise<Part> {
  const p = empty();
  if (a.has('partners')) {
    const [byRole, partnerStatus, kyc, joined, cities, sales] = await Promise.all([
      prisma.user.groupBy({ by: ['role'], where: { status: 'active' }, _count: { _all: true } }),
      prisma.user.groupBy({ by: ['status'], where: { role: 'channel_partner' }, _count: { _all: true } }),
      prisma.user.groupBy({ by: ['kycStatus'], where: { role: 'channel_partner' }, _count: { _all: true } }),
      prisma.user.findMany({ where: { role: 'channel_partner', joinedOn: { gte: monthsStart(6) } }, select: { joinedOn: true } }),
      prisma.user.groupBy({ by: ['city'], where: { role: 'channel_partner', city: { not: null } }, _count: { _all: true }, orderBy: { _count: { city: 'desc' } }, take: 6 }),
      prisma.booking.groupBy({ by: ['userId'], where: { isDeposit: 0, status: { in: ['booked', 'partPaid'] }, user: { role: 'channel_partner' } }, _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: 7 }),
    ]);
    const role = (r: string) => byRole.find((x) => x.role === r)?._count._all ?? 0;
    const st = (s: string) => partnerStatus.find((x) => x.status === s)?._count._all ?? 0;
    const k = (s: number) => kyc.find((x) => x.kycStatus === s)?._count._all ?? 0;
    const partners = partnerStatus.reduce((s, x) => s + x._count._all, 0);
    p.kpis.push(
      { label: 'Channel partners', value: partners, meta: `${st('active')} active`, to: '/channel-partners' },
      { label: 'Joined this month', value: joined.filter((u) => monthOf(u.joinedOn) === dayString().slice(0, 7)).length, to: '/channel-partners', tone: 'good' },
      { label: 'KYC pending', value: k(0), to: '/wallet/kyc', tone: k(0) ? 'warn' : undefined },
      { label: 'Leaders', value: role('leader') + role('team_leader'), meta: `${role('employee')} employees`, to: '/users/leaders' },
    );
    const names = new Map((await prisma.user.findMany({ where: { id: { in: sales.map((s) => s.userId!).filter(Boolean) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    p.charts.push({ id: 'top', title: 'Top partners', meta: 'confirmed booking value', kind: 'bars', format: 'inr', to: '/reports/partners', rows: sales.filter((s) => s.userId).map((s) => ({ name: names.get(s.userId!) ?? 'Partner', value: s._sum.amount ?? 0, to: `/channel-partners/${s.userId}` })) });
    p.charts.push({ id: 'joined', title: 'New partners per month', meta: 'last 6 months', kind: 'columns', rows: perMonth(joined, 6, (u) => u.joinedOn) });
    p.charts.push({ id: 'kyc', title: 'Partner KYC', kind: 'ring', side: true, to: '/wallet/kyc', rows: [{ name: 'Verified', value: k(1) }, { name: 'Pending', value: k(0) }, { name: 'Rejected', value: k(2) }] });
    p.charts.push({ id: 'cities', title: 'Partners by city', kind: 'bars', side: true, rows: cities.map((c) => ({ name: c.city ?? '—', value: c._count._all })) });
    if (k(0)) p.attention.push({ title: `${plural(k(0), 'partner')} waiting for KYC`, detail: 'Verify to enable their payouts', to: '/wallet/kyc', level: 'review' });
    if (st('inactive') + st('suspended')) p.attention.push({ title: `${plural(st('inactive') + st('suspended'), 'partner')} inactive or suspended`, detail: 'Consider a re-engagement message', to: '/channel-partners', level: 'info' });
    p.links.push({ label: 'Channel partners', to: '/channel-partners', meta: `${partners} partners` }, { label: 'Leaders', to: '/users/leaders', meta: 'Field leaders' }, { label: 'Employees', to: '/users/employees', meta: `${role('employee')} active` });
  }
  if (a.has('teams')) {
    const teams = await prisma.team.count();
    p.links.push({ label: 'Teams / referrals', to: '/teams', meta: `${teams} teams` });
  }
  if (a.has('partner_portal')) {
    const disputes = await prisma.partnerDispute.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'asc' }, select: { title: true, raisedByName: true } });
    p.kpis.push({ label: 'Open disputes', value: disputes.length, to: '/partner-portal/disputes', tone: disputes.length ? 'warn' : undefined });
    for (const d of disputes.slice(0, 3)) p.attention.push({ title: d.title, detail: `Raised by ${d.raisedByName}`, to: '/partner-portal/disputes', level: 'act' });
    p.links.push({ label: 'Partner portal', to: '/partner-portal', meta: 'What partners see' });
  }
  return p;
}

// ------------------------------------------------------------------------------ Support & Comms

async function support(a: Access): Promise<Part> {
  const p = empty();
  const monthAgo = new Date(Date.now() - 30 * DAY);
  if (a.has('support')) {
    const [byStatus, oldest, resolved] = await Promise.all([
      prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.supportTicket.findMany({ where: { status: { in: ['open', 'pending'] } }, orderBy: { createdAt: 'asc' }, take: 4, select: { id: true, subject: true, status: true, createdAt: true, user: { select: { name: true } } } }),
      prisma.supportTicket.count({ where: { status: { in: ['resolved', 'closed'] }, updatedAt: { gte: monthAgo } } }),
    ]);
    const of = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    p.kpis.push(
      { label: 'Open tickets', value: of('open'), to: '/support', tone: of('open') ? 'warn' : undefined },
      { label: 'Waiting on us', value: of('pending'), meta: 'reply pending', to: '/support' },
      { label: 'Resolved, 30 days', value: resolved, to: '/support', tone: 'good' },
    );
    p.charts.push({ id: 'tickets', title: 'Tickets by status', kind: 'ring', side: true, to: '/support', rows: [['Open', 'open'], ['Pending', 'pending'], ['Resolved', 'resolved'], ['Closed', 'closed']].map(([name, s]) => ({ name, value: of(s) })) });
    for (const t of oldest) p.attention.push({ title: t.subject, detail: `${t.user.name} · ${t.status} since ${shortDay(t.createdAt)}`, to: `/support/${t.id}`, level: t.status === 'open' ? 'act' : 'review' });
    p.links.push({ label: 'Support tickets', to: '/support', meta: `${of('open') + of('pending')} open` });
  }
  if (a.has('notifications')) {
    const [sent, recipients, read, wa] = await Promise.all([
      prisma.notification.groupBy({ by: ['type'], where: { createdAt: { gte: monthAgo } }, _count: { _all: true } }),
      prisma.notificationRecipient.count({ where: { notification: { createdAt: { gte: monthAgo } } } }),
      prisma.notificationRecipient.count({ where: { read: true, notification: { createdAt: { gte: monthAgo } } } }),
      prisma.whatsAppTemplateSend.findMany({ where: { sentAt: { gte: new Date(Date.now() - 14 * DAY) } }, select: { sentAt: true, status: true } }),
    ]);
    const failed = wa.filter((w) => w.status === 'failed').length;
    p.kpis.push(
      { label: 'Notifications, 30 days', value: sent.reduce((s, x) => s + x._count._all, 0), meta: `${recipients} recipients`, to: '/notifications' },
      { label: 'Read rate', value: recipients ? Math.round((read / recipients) * 100) : 0, format: 'pct', meta: `${read} opened`, to: '/notifications' },
      { label: 'WhatsApp sends, 14 days', value: wa.length, meta: `${failed} failed`, to: '/notifications/whatsapp', tone: failed ? 'warn' : undefined },
    );
    p.charts.push({ id: 'wa', title: 'WhatsApp template sends', meta: 'last 14 days', kind: 'columns', to: '/notifications/whatsapp', rows: perDay(wa, 14, (w) => w.sentAt) });
    p.charts.push({ id: 'types', title: 'Notifications by type', meta: '30 days', kind: 'bars', side: true, rows: sent.map((s) => ({ name: s.type[0].toUpperCase() + s.type.slice(1), value: s._count._all })) });
    if (failed) p.attention.push({ title: `${plural(failed, 'WhatsApp message')} failed in 14 days`, detail: 'Check the template status and the numbers', to: '/notifications/whatsapp', level: 'review' });
    p.links.push({ label: 'Notifications', to: '/notifications', meta: 'Sent and scheduled' }, { label: 'WhatsApp templates', to: '/notifications/whatsapp/templates', meta: 'Approved by Meta' });
  }
  if (a.has('assistant')) p.links.push({ label: 'Assistant', to: '/assistant', meta: 'Full page' });
  return p;
}

// -------------------------------------------------------------------------------------- Reports

async function reports(a: Access): Promise<Part> {
  const p = empty();
  if (!a.has('reports')) return p;
  const today = dayKey();
  const monthStart = new Date(`${dayString().slice(0, 7)}-01T00:00:00+05:30`);
  const [bookings, payments, partners, staff, presentToday, openTickets, payouts] = await Promise.all([
    prisma.booking.findMany({ where: { isDeposit: 0, status: { in: ['booked', 'partPaid'] }, createdAt: { gte: monthsStart(6) } }, select: { createdAt: true, amount: true } }),
    prisma.booking.findMany({ where: { createdAt: { gte: monthsStart(6) } }, select: { createdAt: true, amount: true } }),
    prisma.user.count({ where: { role: 'channel_partner', status: 'active' } }),
    prisma.user.count({ where: { status: 'active', role: { in: [...STAFF] } } }),
    prisma.attendanceRecord.count({ where: { date: today, checkInAt: { not: null } } }),
    prisma.supportTicket.count({ where: { status: { in: ['open', 'pending'] } } }),
    prisma.payoutRequest.findMany({ where: { status: 'released', updatedAt: { gte: monthsStart(6) } }, select: { updatedAt: true, amount: true } }),
  ]);
  const bThis = bookings.filter((b) => b.createdAt >= monthStart);
  p.kpis.push(
    { label: 'Bookings this month', value: bThis.length, meta: inr(bThis.reduce((s, b) => s + b.amount, 0)), to: '/reports/bookings' },
    { label: 'Collected this month', value: payments.filter((b) => b.createdAt >= monthStart).reduce((s, b) => s + b.amount, 0), format: 'inr', to: '/reports/payments', tone: 'good' },
    { label: 'Active partners', value: partners, to: '/reports/partners' },
    { label: 'Attendance today', value: staff ? Math.round((presentToday / staff) * 100) : 0, format: 'pct', meta: `${presentToday} of ${staff}`, to: '/reports/attendance' },
    { label: 'Open tickets', value: openTickets, to: '/reports/support' },
  );
  p.charts.push({ id: 'bookings', title: 'Confirmed bookings per month', meta: 'last 6 months', kind: 'columns', to: '/reports/bookings', rows: perMonth(bookings, 6, (b) => b.createdAt) });
  p.charts.push({ id: 'collections', title: 'Collections per month', meta: 'last 6 months', kind: 'columns', format: 'inr', to: '/reports/payments', rows: perMonth(payments, 6, (b) => b.createdAt, (b) => b.amount) });
  p.charts.push({ id: 'payouts', title: 'Payouts released', meta: 'last 6 months', kind: 'bars', format: 'inr', side: true, to: '/reports/payouts', rows: perMonth(payouts, 6, (x) => x.updatedAt, (x) => x.amount) });
  p.links.push(
    { label: 'Properties', to: '/reports/properties', meta: 'Inventory' }, { label: 'Bookings', to: '/reports/bookings', meta: 'Sales' },
    { label: 'Payments', to: '/reports/payments', meta: 'Collections' }, { label: 'Partners', to: '/reports/partners', meta: 'Performance' },
    { label: 'Teams', to: '/reports/teams', meta: 'Leaders' }, { label: 'Attendance', to: '/reports/attendance', meta: 'Presence' },
    { label: 'Support', to: '/reports/support', meta: 'Tickets' }, { label: 'Payouts', to: '/reports/payouts', meta: 'Brokerage' },
  );
  return p;
}

// ------------------------------------------------------------------------------------- Settings

async function settings(a: Access): Promise<Part> {
  const p = empty();
  const weekAgo = new Date(Date.now() - 7 * DAY);
  if (a.has('ops_rules')) {
    const [rules, fires] = await Promise.all([
      prisma.opsRule.findMany({ select: { name: true, enabled: true } }),
      prisma.opsRuleFire.groupBy({ by: ['status'], where: { firedAt: { gte: new Date(Date.now() - 30 * DAY) } }, _count: { _all: true } }),
    ]);
    const on = rules.filter((r) => r.enabled).length;
    p.kpis.push({ label: 'Operations rules on', value: on, meta: `of ${rules.length}`, to: '/ops-rules', tone: on ? 'good' : undefined });
    p.charts.push({ id: 'fires', title: 'Rule runs', meta: 'last 30 days, by result', kind: 'bars', side: true, to: '/ops-rules', rows: fires.map((f) => ({ name: f.status[0].toUpperCase() + f.status.slice(1), value: f._count._all })) });
    if (rules.length && !on) p.attention.push({ title: 'Every operations rule is switched off', detail: 'Hold expiry, overdue reminders and escalations will not run on their own', to: '/ops-rules', level: 'review' });
    p.links.push({ label: 'Operations rules', to: '/ops-rules', meta: `${on} on` });
  }
  if (a.has('settings')) {
    const [roles, panelUsers, audit, expiring, auditByModule] = await Promise.all([
      prisma.panelRole.count(),
      prisma.user.count({ where: { panelRoleId: { not: null } } }),
      prisma.auditEntry.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.findMany({ where: { accessExpiresAt: { gte: new Date(), lte: new Date(Date.now() + 7 * DAY) } }, select: { name: true, accessExpiresAt: true } }),
      prisma.auditEntry.groupBy({ by: ['module'], where: { createdAt: { gte: weekAgo } }, _count: { _all: true }, orderBy: { _count: { module: 'desc' } }, take: 8 }),
    ]);
    p.kpis.push(
      { label: 'Roles', value: roles, meta: `${panelUsers} panel users`, to: '/settings/roles' },
      { label: 'Changes this week', value: audit, meta: 'recorded in the audit log', to: '/settings/audit-log' },
    );
    p.charts.push({ id: 'audit', title: 'Where changes were made', meta: 'last 7 days', kind: 'bars', to: '/settings/audit-log', rows: auditByModule.map((m) => ({ name: m.module, value: m._count._all })) });
    for (const u of expiring) p.attention.push({ title: `${u.name}'s access ends ${shortDay(u.accessExpiresAt!)}`, detail: 'Client access set to expire', to: '/settings/client-access', level: 'info' });
    p.links.push(
      { label: 'Organization', to: '/settings/organization', meta: 'Name, logo, contact' }, { label: 'Roles & permissions', to: '/settings/roles', meta: `${roles} roles` },
      { label: 'Attendance policy', to: '/settings/attendance', meta: 'Hours, geo-fence' }, { label: 'Sales policy', to: '/settings/sales-policy', meta: 'Holds, cancellations' },
      { label: 'AI Assistant', to: '/settings/ai-assistant', meta: 'API key' }, { label: 'Audit log', to: '/settings/audit-log', meta: `${audit} this week` },
    );
  }
  return p;
}

const BUILDERS: Record<SectionKey, (a: Access) => Promise<Part>> = {
  hrms, tasks, 'real-estate': realEstate, finance, 'construction-legal': constructionLegal, people, support, reports, settings,
};

export async function sectionOverview(section: SectionKey, access: Access): Promise<SectionOverview> {
  const part = await BUILDERS[section](access);
  return { section, label: SECTIONS[section].label, generatedAt: new Date().toISOString(), ...part };
}
