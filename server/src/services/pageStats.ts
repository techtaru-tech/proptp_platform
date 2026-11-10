import { prisma } from '../prisma';
import { dayKey, dayString } from './dates';
import { paidAmountFromBookings, remainingAmount } from './derive';
import type { Kpi } from './moduleOverview';
import type { ModuleKey } from './permissions';
import type { Access } from './sections';

/**
 * The strip of headline numbers at the top of an inner page — "Leave requests: 2 to decide,
 * 6 approved this month…". One builder per page path, each guarded by the module that page
 * belongs to. Pages that already draw their own stat cards (Attendance Today, Task List, the
 * report pages…) have no entry here, so nothing is shown twice.
 */

const DAY = 86_400_000;
const STAFF = ['employee', 'leader', 'team_leader'] as const;
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const monthStart = () => new Date(`${dayString().slice(0, 7)}-01T00:00:00+05:30`);
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY);
const warn = (n: number) => (n ? 'warn' as const : undefined);
const danger = (n: number) => (n ? 'danger' as const : undefined);

type Builder = (a: Access) => Promise<Kpi[]>;

const attendanceHistory: Builder = async () => {
  const from = dayKey(ago(29));
  const [marks, late, early, failed, hours] = await Promise.all([
    prisma.attendanceRecord.count({ where: { date: { gte: from }, checkInAt: { not: null } } }),
    prisma.attendanceRecord.count({ where: { date: { gte: from }, isLate: true } }),
    prisma.attendanceRecord.count({ where: { date: { gte: from }, isEarlyDeparture: true } }),
    prisma.attendanceRecord.count({ where: { date: { gte: from }, syncStatus: 'failed' } }),
    prisma.attendanceRecord.aggregate({ where: { date: { gte: from }, workingHours: { not: null } }, _avg: { workingHours: true } }),
  ]);
  return [
    { label: 'Check-ins, 30 days', value: marks },
    { label: 'Late marks', value: late, meta: marks ? `${Math.round((late / marks) * 100)}% of check-ins` : undefined, tone: warn(late) },
    { label: 'Left early', value: early },
    { label: 'Average hours', value: Number((hours._avg.workingHours ?? 0).toFixed(1)), meta: 'per day worked' },
    { label: 'Failed to sync', value: failed, tone: danger(failed) },
  ];
};

const corrections: Builder = async () => {
  const [pending, approved, rejected] = await Promise.all([
    prisma.attendanceRecord.count({ where: { correctionRequested: true, correctionStatus: 'pending' } }),
    prisma.attendanceRecord.count({ where: { correctionStatus: 'approved', updatedAt: { gte: ago(30) } } }),
    prisma.attendanceRecord.count({ where: { correctionStatus: 'rejected', updatedAt: { gte: ago(30) } } }),
  ]);
  return [
    { label: 'Waiting for review', value: pending, tone: warn(pending) },
    { label: 'Approved, 30 days', value: approved, tone: 'good' },
    { label: 'Rejected, 30 days', value: rejected },
  ];
};

const holidays: Builder = async () => {
  const today = dayKey();
  const year = dayString().slice(0, 4);
  const [next, upcoming, thisYear] = await Promise.all([
    prisma.holiday.findFirst({ where: { startDate: { gte: today } }, orderBy: { startDate: 'asc' } }),
    prisma.holiday.count({ where: { startDate: { gte: today, lte: dayKey(ahead(90)) } } }),
    prisma.holiday.count({ where: { startDate: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) } } }),
  ]);
  return [
    { label: 'Next holiday', value: next ? Math.round((next.startDate.getTime() - today.getTime()) / DAY) : 0, meta: next ? `${next.name} — days away` : 'None scheduled' },
    { label: 'Next 90 days', value: upcoming },
    { label: `Holidays in ${year}`, value: thisYear },
  ];
};

const leave: Builder = async () => {
  const today = dayKey();
  const [pending, approved, rejected, onLeave] = await Promise.all([
    prisma.leaveRequest.aggregate({ where: { status: 'pending' }, _count: { _all: true }, _sum: { days: true } }),
    prisma.leaveRequest.aggregate({ where: { status: 'approved', startDate: { gte: dayKey(monthStart()) } }, _count: { _all: true }, _sum: { days: true } }),
    prisma.leaveRequest.count({ where: { status: 'rejected', decidedAt: { gte: ago(30) } } }),
    prisma.leaveRequest.count({ where: { status: 'approved', startDate: { lte: today }, endDate: { gte: today } } }),
  ]);
  return [
    { label: 'To decide', value: pending._count._all, meta: `${pending._sum.days ?? 0} days asked`, tone: warn(pending._count._all) },
    { label: 'On leave today', value: onLeave },
    { label: 'Approved this month', value: approved._count._all, meta: `${approved._sum.days ?? 0} days`, tone: 'good' },
    { label: 'Rejected, 30 days', value: rejected },
  ];
};

const leaveTypes: Builder = async () => {
  const [active, paid] = await Promise.all([prisma.leaveType.count({ where: { active: true } }), prisma.leaveType.count({ where: { active: true, isPaid: true } })]);
  return [{ label: 'Active leave types', value: active }, { label: 'Paid types', value: paid }];
};

const payroll: Builder = async () => {
  const [run, structured, staff] = await Promise.all([
    prisma.payrollRun.findFirst({ orderBy: [{ year: 'desc' }, { month: 'desc' }], include: { payslips: { select: { netPay: true, grossEarnings: true, totalDeductions: true } } } }),
    prisma.salaryStructure.count(),
    prisma.user.count({ where: { status: 'active', role: { in: [...STAFF] } } }),
  ]);
  const sum = (k: 'netPay' | 'grossEarnings' | 'totalDeductions') => run?.payslips.reduce((s, p) => s + p[k], 0) ?? 0;
  return [
    { label: 'Latest run', value: run?.payslips.length ?? 0, meta: run ? `${run.month}/${run.year} · ${run.status} · payslips` : 'No run yet', tone: run?.status === 'draft' ? 'warn' : undefined },
    { label: 'Gross', value: sum('grossEarnings'), format: 'inr' },
    { label: 'Deductions', value: sum('totalDeductions'), format: 'inr' },
    { label: 'Net pay', value: sum('netPay'), format: 'inr', tone: 'good' },
    { label: 'Salary set up', value: structured, meta: `of ${staff} active staff`, tone: structured < staff ? 'warn' : undefined },
  ];
};

const tasksBoard: Builder = async () => {
  const open = { status: { in: ['todo', 'in_progress', 'blocked'] as ('todo' | 'in_progress' | 'blocked')[] } };
  const [todo, doing, blocked, overdue] = await Promise.all([
    prisma.task.count({ where: { status: 'todo' } }),
    prisma.task.count({ where: { status: 'in_progress' } }),
    prisma.task.count({ where: { status: 'blocked' } }),
    prisma.task.count({ where: { ...open, dueAt: { lt: new Date() } } }),
  ]);
  return [{ label: 'To do', value: todo }, { label: 'In progress', value: doing }, { label: 'Blocked', value: blocked, tone: warn(blocked) }, { label: 'Overdue', value: overdue, tone: danger(overdue) }];
};

const myTasks: Builder = async (a) => {
  const mine = { assigneeId: a.userId };
  const open = { ...mine, status: { in: ['todo', 'in_progress', 'blocked'] as ('todo' | 'in_progress' | 'blocked')[] } };
  const [openN, overdue, week, done] = await Promise.all([
    prisma.task.count({ where: open }),
    prisma.task.count({ where: { ...open, dueAt: { lt: new Date() } } }),
    prisma.task.count({ where: { ...open, dueAt: { gte: new Date(), lte: ahead(7) } } }),
    prisma.task.count({ where: { ...mine, status: 'done', completedAt: { gte: ago(30) } } }),
  ]);
  return [{ label: 'My open tasks', value: openN }, { label: 'Overdue', value: overdue, tone: danger(overdue) }, { label: 'Due this week', value: week }, { label: 'Done, 30 days', value: done, tone: 'good' }];
};

const projects: Builder = async () => {
  const [live, onHold, units] = await Promise.all([
    prisma.project.count({ where: { status: 1 } }),
    prisma.project.count({ where: { status: 0 } }),
    prisma.propertyUnit.groupBy({ by: ['bookingStatus'], _count: { _all: true } }),
  ]);
  const of = (s: number) => units.find((u) => u.bookingStatus === s)?._count._all ?? 0;
  const total = of(0) + of(1) + of(2);
  return [
    { label: 'Live projects', value: live, meta: onHold ? `${onHold} on hold` : undefined },
    { label: 'Plots', value: total },
    { label: 'Available', value: of(0), tone: 'good' },
    { label: 'Sold through', value: total ? Math.round(((of(1) + of(2)) / total) * 100) : 0, format: 'pct', meta: 'booked or sold' },
  ];
};

const properties: Builder = async () => {
  const [units, holds] = await Promise.all([
    prisma.propertyUnit.groupBy({ by: ['bookingStatus'], _count: { _all: true }, _sum: { totalInvestmentAmount: true } }),
    prisma.plotHold.count({ where: { status: 1, holdEnd: { gt: new Date() } } }),
  ]);
  const of = (s: number) => units.find((u) => u.bookingStatus === s);
  return [
    { label: 'Available', value: Math.max(0, (of(0)?._count._all ?? 0) - holds), meta: inr(of(0)?._sum.totalInvestmentAmount ?? 0), tone: 'good' },
    { label: 'On hold', value: holds, tone: warn(holds) },
    { label: 'Booked', value: of(1)?._count._all ?? 0 },
    { label: 'Sold out', value: of(2)?._count._all ?? 0 },
  ];
};

const holds: Builder = async () => {
  const now = new Date();
  const [active, ending, made] = await Promise.all([
    prisma.plotHold.count({ where: { status: 1, holdEnd: { gt: now } } }),
    prisma.plotHold.count({ where: { status: 1, holdEnd: { gt: now, lte: new Date(now.getTime() + DAY) } } }),
    prisma.plotHold.count({ where: { createdAt: { gte: ago(30) } } }),
  ]);
  return [{ label: 'Active holds', value: active }, { label: 'Ending in 24 hours', value: ending, tone: warn(ending) }, { label: 'Holds placed, 30 days', value: made }];
};

const bookings: Builder = async () => {
  const [byStatus, thisMonth] = await Promise.all([
    prisma.booking.groupBy({ by: ['status'], where: { isDeposit: 0 }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.booking.aggregate({ where: { isDeposit: 0, status: { in: ['booked', 'partPaid'] }, createdAt: { gte: monthStart() } }, _count: { _all: true }, _sum: { amount: true } }),
  ]);
  const of = (s: string) => byStatus.find((b) => b.status === s);
  const confirmed = (of('booked')?._count._all ?? 0) + (of('partPaid')?._count._all ?? 0);
  return [
    { label: 'To confirm', value: of('pending')?._count._all ?? 0, meta: inr(of('pending')?._sum.amount ?? 0), tone: warn(of('pending')?._count._all ?? 0) },
    { label: 'Confirmed', value: confirmed, meta: `${of('partPaid')?._count._all ?? 0} part paid` },
    { label: 'This month', value: thisMonth._count._all, meta: inr(thisMonth._sum.amount ?? 0), tone: 'good' },
    { label: 'Cancelled', value: of('cancelled')?._count._all ?? 0 },
  ];
};

const remaining: Builder = async () => {
  const units = await prisma.propertyUnit.findMany({ where: { bookingStatus: { not: 0 } }, select: { totalInvestmentAmount: true, bookings: { select: { amount: true, status: true } } } });
  const rows = units.map((u) => { const paid = paidAmountFromBookings(u.bookings); return { paid, balance: remainingAmount(u.totalInvestmentAmount, paid), price: u.totalInvestmentAmount }; });
  const owing = rows.filter((r) => r.balance > 0);
  const price = rows.reduce((s, r) => s + r.price, 0);
  const paid = rows.reduce((s, r) => s + r.paid, 0);
  return [
    { label: 'Plots still owing', value: owing.length, meta: `of ${rows.length} booked`, tone: warn(owing.length) },
    { label: 'Still to collect', value: owing.reduce((s, r) => s + r.balance, 0), format: 'inr', tone: 'warn' },
    { label: 'Collected so far', value: paid, format: 'inr', tone: 'good' },
    { label: 'Collected', value: price ? Math.round((paid / price) * 100) : 0, format: 'pct', meta: 'of booked value' },
  ];
};

const cancellations: Builder = async () => {
  const [rows, refunded, toRefund] = await Promise.all([
    prisma.bookingCancellation.groupBy({ by: ['status'], _count: { _all: true }, _sum: { deductionAmount: true } }),
    prisma.bookingCancellation.aggregate({ where: { refundedAt: { not: null } }, _sum: { refundAmount: true } }),
    prisma.bookingCancellation.aggregate({ where: { status: 'approved', refundedAt: null }, _count: { _all: true }, _sum: { refundAmount: true } }),
  ]);
  const of = (s: string) => rows.find((r) => r.status === s);
  return [
    { label: 'To decide', value: of('pending')?._count._all ?? 0, tone: warn(of('pending')?._count._all ?? 0) },
    { label: 'Approved, refund due', value: toRefund._sum.refundAmount ?? 0, format: 'inr', meta: `${toRefund._count._all} cancellations`, tone: warn(toRefund._count._all) },
    { label: 'Refunded', value: refunded._sum.refundAmount ?? 0, format: 'inr' },
    { label: 'Deductions kept', value: of('approved')?._sum.deductionAmount ?? 0, format: 'inr' },
  ];
};

const investments: Builder = async () => {
  const [running, due, expired] = await Promise.all([
    prisma.investment.aggregate({ where: { isActive: 1 }, _count: { _all: true }, _sum: { amount: true, netProfit: true } }),
    prisma.investment.count({ where: { isActive: 1, returnDate: { lte: ahead(7) } } }),
    prisma.investment.count({ where: { isActive: 0 } }),
  ]);
  return [
    { label: 'Running', value: running._sum.amount ?? 0, format: 'inr', meta: `${running._count._all} deposits` },
    { label: 'Returns promised', value: running._sum.netProfit ?? 0, format: 'inr' },
    { label: 'Due within a week', value: due, tone: warn(due) },
    { label: 'Closed', value: expired },
  ];
};

const cameras: Builder = async () => {
  const [live, all, projects] = await Promise.all([prisma.camera.count({ where: { active: true } }), prisma.camera.count(), prisma.camera.groupBy({ by: ['projectId'], where: { active: true } })]);
  return [{ label: 'Cameras live', value: live, meta: `of ${all}` }, { label: 'Sites covered', value: projects.length }];
};

const MODE: Record<string, string> = { bankTransfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', online: 'Online', other: 'Other' };

const transactions: Builder = async () => {
  const [all, month, byMode] = await Promise.all([
    prisma.booking.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
    prisma.booking.aggregate({ where: { createdAt: { gte: monthStart() } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ['paymentMode'], where: { createdAt: { gte: monthStart() } }, _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: 1 }),
  ]);
  const top = byMode[0];
  return [
    { label: 'Collected this month', value: month._sum.amount ?? 0, format: 'inr', meta: `${month._count._all} payments`, tone: 'good' },
    { label: 'Collected, all time', value: all._sum.amount ?? 0, format: 'inr', meta: `${all._count._all} payments` },
    { label: 'Top mode this month', value: top?._sum.amount ?? 0, format: 'inr', meta: top ? MODE[top.paymentMode] ?? top.paymentMode : '—' },
  ];
};

const walletApprovals: Builder = async () => {
  const [pending, approved, rejected] = await Promise.all([
    prisma.fundRequest.aggregate({ where: { status: 2 }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.fundRequest.aggregate({ where: { status: 1, updatedAt: { gte: ago(30) } }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.fundRequest.count({ where: { status: 3, updatedAt: { gte: ago(30) } } }),
  ]);
  return [
    { label: 'Waiting', value: pending._count._all, meta: inr(pending._sum.amount ?? 0), tone: warn(pending._count._all) },
    { label: 'Approved, 30 days', value: approved._sum.amount ?? 0, format: 'inr', meta: `${approved._count._all} deposits`, tone: 'good' },
    { label: 'Rejected, 30 days', value: rejected },
  ];
};

const kyc: Builder = async () => {
  const [rows, waiting] = await Promise.all([
    prisma.user.groupBy({ by: ['kycStatus'], where: { role: 'channel_partner' }, _count: { _all: true } }),
    prisma.user.count({ where: { role: 'channel_partner', kycStatus: 0, kycDocuments: { some: {} } } }),
  ]);
  const of = (s: number) => rows.find((r) => r.kycStatus === s)?._count._all ?? 0;
  return [
    { label: 'Documents to check', value: waiting, tone: warn(waiting) },
    { label: 'Not verified yet', value: of(0) },
    { label: 'Verified', value: of(1), tone: 'good' },
    { label: 'Rejected', value: of(2) },
  ];
};

const payouts: Builder = async () => {
  const [byStatus, released] = await Promise.all([
    prisma.payoutRequest.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }),
    prisma.payoutRequest.aggregate({ where: { status: 'released', updatedAt: { gte: monthStart() } }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const of = (s: string) => byStatus.find((r) => r.status === s);
  return [
    { label: 'To approve', value: of('pending')?._sum.amount ?? 0, format: 'inr', meta: `${of('pending')?._count._all ?? 0} requests`, tone: warn(of('pending')?._count._all ?? 0) },
    { label: 'Confirmed, not sent', value: of('confirmed')?._sum.amount ?? 0, format: 'inr' },
    { label: 'Released this month', value: released._sum.amount ?? 0, format: 'inr', meta: `${released._count._all} payouts`, tone: 'good' },
    { label: 'Failed', value: of('failed')?._count._all ?? 0, tone: danger(of('failed')?._count._all ?? 0) },
  ];
};

const statements: Builder = async () => {
  const [released, partners, earnings] = await Promise.all([
    prisma.payoutRequest.aggregate({ where: { status: 'released' }, _sum: { amount: true } }),
    prisma.payoutRequest.groupBy({ by: ['userId'], where: { status: 'released' } }),
    prisma.earningEntry.aggregate({ where: { creditedOn: { gte: monthStart() } }, _sum: { amount: true } }),
  ]);
  return [
    { label: 'Paid out, all time', value: released._sum.amount ?? 0, format: 'inr' },
    { label: 'Partners paid', value: partners.length },
    { label: 'Earned this month', value: earnings._sum.amount ?? 0, format: 'inr', tone: 'good' },
  ];
};

const incentives: Builder = async () => {
  const rows = await prisma.incentiveRequest.groupBy({ by: ['status'], _count: { _all: true } });
  const of = (s: number) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return [{ label: 'Waiting', value: of(0), tone: warn(of(0)) }, { label: 'Accepted', value: of(1), tone: 'good' }, { label: 'Rejected', value: of(2) }];
};

const construction: Builder = async () => {
  const [reviews, issues, blockers] = await Promise.all([
    prisma.progressUpdate.count({ where: { status: 'pending' } }),
    prisma.siteIssue.count({ where: { status: { not: 'closed' } } }),
    prisma.activityBlocker.count({ where: { status: 'approved', resolvedAt: null } }),
  ]);
  return [{ label: 'Updates to review', value: reviews, tone: warn(reviews) }, { label: 'Blocked activities', value: blockers, tone: danger(blockers) }, { label: 'Open site issues', value: issues, tone: warn(issues) }];
};

const reviews: Builder = async () => {
  const [pending, approved, rejected] = await Promise.all([
    prisma.progressUpdate.count({ where: { status: 'pending' } }),
    prisma.progressUpdate.count({ where: { status: 'approved', reviewedAt: { gte: ago(7) } } }),
    prisma.progressUpdate.count({ where: { status: 'rejected', reviewedAt: { gte: ago(7) } } }),
  ]);
  return [{ label: 'Waiting', value: pending, tone: warn(pending) }, { label: 'Approved, 7 days', value: approved, tone: 'good' }, { label: 'Rejected, 7 days', value: rejected }];
};

const blockers: Builder = async () => {
  const [pending, active, resolved] = await Promise.all([
    prisma.activityBlocker.count({ where: { status: 'pending' } }),
    prisma.activityBlocker.count({ where: { status: 'approved', resolvedAt: null } }),
    prisma.activityBlocker.count({ where: { resolvedAt: { gte: ago(30) } } }),
  ]);
  return [{ label: 'Raised, to review', value: pending, tone: warn(pending) }, { label: 'Blocking now', value: active, tone: danger(active) }, { label: 'Resolved, 30 days', value: resolved, tone: 'good' }];
};

const issues: Builder = async () => {
  const [open, doing, overdue, closed] = await Promise.all([
    prisma.siteIssue.count({ where: { status: 'open' } }),
    prisma.siteIssue.count({ where: { status: 'in_progress' } }),
    prisma.siteIssue.count({ where: { status: { not: 'closed' }, dueDate: { lt: new Date() } } }),
    prisma.siteIssue.count({ where: { status: 'closed', closedAt: { gte: ago(30) } } }),
  ]);
  return [{ label: 'Open', value: open, tone: warn(open) }, { label: 'In progress', value: doing }, { label: 'Overdue', value: overdue, tone: danger(overdue) }, { label: 'Closed, 30 days', value: closed, tone: 'good' }];
};

const vendors: Builder = async () => {
  const [active, contract, bills] = await Promise.all([
    prisma.vendor.count({ where: { active: true } }),
    prisma.vendor.aggregate({ where: { active: true }, _sum: { contractValue: true } }),
    prisma.vendorBill.groupBy({ by: ['status'], _sum: { amount: true } }),
  ]);
  const of = (s: string) => bills.find((b) => b.status === s)?._sum.amount ?? 0;
  return [
    { label: 'Active vendors', value: active },
    { label: 'Contract value', value: contract._sum.contractValue ?? 0, format: 'inr' },
    { label: 'Billed', value: of('submitted') + of('approved') + of('paid'), format: 'inr' },
    { label: 'Paid', value: of('paid'), format: 'inr', tone: 'good' },
  ];
};

const material: Builder = async () => {
  const [pending, month, rejected] = await Promise.all([
    prisma.materialEntry.count({ where: { status: 'pending' } }),
    prisma.materialEntry.count({ where: { receivedOn: { gte: monthStart() } } }),
    prisma.materialEntry.count({ where: { status: 'rejected', createdAt: { gte: ago(30) } } }),
  ]);
  return [{ label: 'To verify', value: pending, tone: warn(pending) }, { label: 'Deliveries this month', value: month }, { label: 'Rejected, 30 days', value: rejected }];
};

const bills: Builder = async () => {
  const rows = await prisma.vendorBill.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } });
  const of = (s: string) => rows.find((r) => r.status === s);
  return [
    { label: 'To approve', value: of('submitted')?._sum.amount ?? 0, format: 'inr', meta: `${of('submitted')?._count._all ?? 0} bills`, tone: warn(of('submitted')?._count._all ?? 0) },
    { label: 'Approved, unpaid', value: of('approved')?._sum.amount ?? 0, format: 'inr' },
    { label: 'Paid', value: of('paid')?._sum.amount ?? 0, format: 'inr', tone: 'good' },
    { label: 'Rejected', value: of('rejected')?._count._all ?? 0 },
  ];
};

const compliance: Builder = async () => {
  const now = new Date();
  const [lapsed, expiring, valid] = await Promise.all([
    prisma.projectApproval.count({ where: { validUntil: { lt: now } } }),
    prisma.projectApproval.count({ where: { validUntil: { gte: now, lte: ahead(60) } } }),
    prisma.projectApproval.count({ where: { OR: [{ validUntil: null }, { validUntil: { gt: ahead(60) } }] } }),
  ]);
  return [{ label: 'Lapsed', value: lapsed, tone: danger(lapsed) }, { label: 'Expiring in 60 days', value: expiring, tone: warn(expiring) }, { label: 'Valid', value: valid, tone: 'good' }];
};

const disputes: Builder = async () => {
  const [open, hearings, closed] = await Promise.all([
    prisma.legalCase.count({ where: { closed: false } }),
    prisma.legalCase.count({ where: { closed: false, nextHearing: { gte: new Date(), lte: ahead(14) } } }),
    prisma.legalCase.count({ where: { closed: true } }),
  ]);
  return [{ label: 'Open cases', value: open, tone: warn(open) }, { label: 'Hearings in 14 days', value: hearings }, { label: 'Closed', value: closed }];
};

const partners: Builder = async () => {
  const [byStatus, kycPending, joined] = await Promise.all([
    prisma.user.groupBy({ by: ['status'], where: { role: 'channel_partner' }, _count: { _all: true } }),
    prisma.user.count({ where: { role: 'channel_partner', kycStatus: 0 } }),
    prisma.user.count({ where: { role: 'channel_partner', joinedOn: { gte: monthStart() } } }),
  ]);
  const of = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  return [
    { label: 'Partners', value: byStatus.reduce((s, r) => s + r._count._all, 0) },
    { label: 'Active', value: of('active'), tone: 'good' },
    { label: 'Inactive or suspended', value: of('inactive') + of('suspended') },
    { label: 'KYC pending', value: kycPending, tone: warn(kycPending) },
    { label: 'Joined this month', value: joined },
  ];
};

const roleCount = (roles: ('employee' | 'leader' | 'team_leader' | 'channel_partner')[], label: string): Builder => async () => {
  const [active, inactive] = await Promise.all([
    prisma.user.count({ where: { role: { in: roles }, status: 'active' } }),
    prisma.user.count({ where: { role: { in: roles }, status: { not: 'active' } } }),
  ]);
  return [{ label, value: active, meta: 'active' }, { label: 'Inactive', value: inactive }];
};

const employees: Builder = async (a) => {
  const base = await roleCount(['employee'], 'Employees')(a);
  const present = await prisma.attendanceRecord.count({ where: { date: dayKey(), checkInAt: { not: null }, user: { role: 'employee' } } });
  return [...base, { label: 'Present today', value: present, tone: 'good' }];
};

const teams: Builder = async () => {
  const [count, members, noTeam] = await Promise.all([
    prisma.team.count(),
    prisma.user.count({ where: { teamId: { not: null }, status: 'active' } }),
    prisma.user.count({ where: { teamId: null, status: 'active', role: { in: [...STAFF] } } }),
  ]);
  return [{ label: 'Teams', value: count }, { label: 'People in a team', value: members }, { label: 'Staff without a team', value: noTeam, tone: warn(noTeam) }];
};

const partnerDisputes: Builder = async () => {
  const rows = await prisma.partnerDispute.groupBy({ by: ['status'], _count: { _all: true } });
  const of = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return [{ label: 'Open', value: of('open'), tone: warn(of('open')) }, { label: 'Resolved', value: of('resolved'), tone: 'good' }, { label: 'Rejected', value: of('rejected') }];
};

const support: Builder = async () => {
  const [rows, resolved, stale] = await Promise.all([
    prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.supportTicket.count({ where: { status: { in: ['resolved', 'closed'] }, updatedAt: { gte: ago(30) } } }),
    prisma.supportTicket.count({ where: { status: { in: ['open', 'pending'] }, createdAt: { lt: ago(3) } } }),
  ]);
  const of = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return [
    { label: 'Open', value: of('open'), tone: warn(of('open')) },
    { label: 'Waiting on us', value: of('pending') },
    { label: 'Older than 3 days', value: stale, tone: danger(stale) },
    { label: 'Resolved, 30 days', value: resolved, tone: 'good' },
  ];
};

const notifications: Builder = async () => {
  const since = ago(30);
  const [sent, recipients, read, failed, scheduled] = await Promise.all([
    prisma.notification.count({ where: { createdAt: { gte: since } } }),
    prisma.notificationRecipient.count({ where: { notification: { createdAt: { gte: since } } } }),
    prisma.notificationRecipient.count({ where: { read: true, notification: { createdAt: { gte: since } } } }),
    prisma.notificationRecipient.count({ where: { failed: true, notification: { createdAt: { gte: since } } } }),
    prisma.notification.count({ where: { deliveryStatus: 'scheduled' } }),
  ]);
  return [
    { label: 'Sent, 30 days', value: sent, meta: `${recipients} recipients` },
    { label: 'Read rate', value: recipients ? Math.round((read / recipients) * 100) : 0, format: 'pct', tone: 'good' },
    { label: 'Failed', value: failed, tone: danger(failed) },
    { label: 'Scheduled', value: scheduled },
  ];
};

const whatsapp: Builder = async () => {
  const rows = await prisma.whatsAppTemplateSend.groupBy({ by: ['status'], where: { sentAt: { gte: ago(30) } }, _count: { _all: true } });
  const total = rows.reduce((s, r) => s + r._count._all, 0);
  const failed = rows.find((r) => r.status === 'failed')?._count._all ?? 0;
  return [{ label: 'Sent, 30 days', value: total }, { label: 'Failed', value: failed, tone: danger(failed) }, { label: 'Delivered', value: total ? Math.round(((total - failed) / total) * 100) : 0, format: 'pct', tone: 'good' }];
};

const opsRules: Builder = async () => {
  const [on, all, fires] = await Promise.all([
    prisma.opsRule.count({ where: { enabled: true } }),
    prisma.opsRule.count(),
    prisma.opsRuleFire.groupBy({ by: ['status'], where: { firedAt: { gte: ago(30) } }, _count: { _all: true } }),
  ]);
  const failed = fires.filter((f) => f.status === 'failed').reduce((s, f) => s + f._count._all, 0);
  return [{ label: 'Rules on', value: on, meta: `of ${all}` }, { label: 'Runs, 30 days', value: fires.reduce((s, f) => s + f._count._all, 0) }, { label: 'Failed runs', value: failed, tone: danger(failed) }];
};

const audit: Builder = async () => {
  const [week, people, modules] = await Promise.all([
    prisma.auditEntry.count({ where: { createdAt: { gte: ago(7) } } }),
    prisma.auditEntry.groupBy({ by: ['userId'], where: { createdAt: { gte: ago(7) } } }),
    prisma.auditEntry.groupBy({ by: ['module'], where: { createdAt: { gte: ago(7) } } }),
  ]);
  return [{ label: 'Changes, 7 days', value: week }, { label: 'People who made them', value: people.length }, { label: 'Modules touched', value: modules.length }];
};

const roles: Builder = async () => {
  const [count, full, users] = await Promise.all([prisma.panelRole.count(), prisma.panelRole.count({ where: { isFullAccess: true } }), prisma.user.count({ where: { panelRoleId: { not: null } } })]);
  return [{ label: 'Roles', value: count, meta: `${full} with full access` }, { label: 'Panel users', value: users }];
};

/** path -> [module it needs, builder]. Exact paths only; detail and form pages have none. */
const PAGES: Record<string, [ModuleKey, Builder]> = {
  '/attendance/history': ['attendance', attendanceHistory],
  '/attendance/corrections': ['attendance', corrections],
  '/attendance/holidays': ['attendance', holidays],
  '/attendance/leave': ['attendance', leave],
  '/attendance/leave-types': ['attendance', leaveTypes],
  '/payouts/payroll': ['payouts', payroll],
  '/tasks/board': ['tasks', tasksBoard],
  '/tasks/mine': ['tasks', myTasks],
  '/projects': ['projects', projects],
  '/properties': ['properties', properties],
  '/properties/running': ['properties', properties],
  '/properties/booked': ['properties', properties],
  '/properties/sold-out': ['properties', properties],
  '/properties/holds': ['properties', holds],
  '/bookings': ['bookings', bookings],
  '/bookings/pending': ['bookings', bookings],
  '/bookings/booked': ['bookings', bookings],
  '/bookings/remaining': ['bookings', remaining],
  '/bookings/cancellations': ['bookings', cancellations],
  '/investments': ['investments', investments],
  '/investments/running': ['investments', investments],
  '/investments/due': ['investments', investments],
  '/investments/expired': ['investments', investments],
  '/investments/completed': ['investments', investments],
  '/cameras': ['cameras', cameras],
  '/transactions': ['payments', transactions],
  '/wallet/approvals': ['payments', walletApprovals],
  '/wallet/kyc': ['payments', kyc],
  '/payouts': ['payouts', payouts],
  '/payouts/statements': ['payouts', statements],
  '/incentive-requests': ['incentives', incentives],
  '/construction': ['construction', construction],
  '/construction/reviews': ['construction', reviews],
  '/construction/blockers': ['construction', blockers],
  '/construction/issues': ['construction', issues],
  '/vendors': ['vendors', vendors],
  '/vendors/material': ['vendors', material],
  '/vendors/bills': ['vendors', bills],
  '/legal/compliance': ['legal', compliance],
  '/legal/disputes': ['legal', disputes],
  '/channel-partners': ['partners', partners],
  '/users/agents': ['partners', partners],
  '/users/employees': ['partners', employees],
  '/users/leaders': ['partners', roleCount(['leader'], 'Leaders')],
  '/users/team-leaders': ['partners', roleCount(['team_leader'], 'Team leaders')],
  '/teams': ['teams', teams],
  '/partner-portal/disputes': ['partner_portal', partnerDisputes],
  '/support': ['support', support],
  '/notifications': ['notifications', notifications],
  '/notifications/whatsapp': ['notifications', whatsapp],
  '/ops-rules': ['ops_rules', opsRules],
  '/settings/audit-log': ['settings', audit],
  '/settings/roles': ['settings', roles],
  '/settings/panel-users': ['settings', roles],
};

/** The KPI strip for a page, or none when the page has no entry or the person lacks its module. */
export async function pageStats(path: string, access: Access): Promise<Kpi[]> {
  const entry = PAGES[path.replace(/\/+$/, '') || '/'];
  if (!entry || !access.has(entry[0])) return [];
  return entry[1](access);
}
