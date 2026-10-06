import type { PropertyUnit, User, UserRole } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Every value that the API exposes but the database does not store lives here, and both
 * API surfaces call into it. This is what keeps the app's flatter contract
 * (plot_size_range, available_count, PropertyStatus, BusinessSummary, ...) from becoming
 * a second copy of the same numbers.
 */

// ---------------------------------------------------------------------------
// Money against a unit
// ---------------------------------------------------------------------------

/** Cancelled rows never count toward what a customer has actually paid. */
export function paidAmountFromBookings(bookings: { amount: number; status: string }[]): number {
  return bookings.filter((b) => b.status !== 'cancelled').reduce((sum, b) => sum + b.amount, 0);
}

export function remainingAmount(unitTotal: number, paid: number): number {
  return Math.max(0, unitTotal - paid);
}

export async function paidAmountForUnit(unitId: string): Promise<number> {
  const rows = await prisma.booking.findMany({ where: { propertyId: unitId }, select: { amount: true, status: true } });
  return paidAmountFromBookings(rows);
}

/**
 * Commission is a stored AMOUNT on the unit (`profit`), but both the app and the admin
 * show a RATE, so it is derived here rather than stored a second time.
 */
export function commissionRateForUnit(unit: Pick<PropertyUnit, 'profit' | 'totalInvestmentAmount'>): number {
  if (!unit.totalInvestmentAmount) return 0;
  return Number(((unit.profit / unit.totalInvestmentAmount) * 100).toFixed(2));
}

/** The whole-rupee commission a booking of `amount` earns on this unit. */
export function commissionForBooking(unit: Pick<PropertyUnit, 'profit' | 'totalInvestmentAmount'>, amount: number): number {
  if (!unit.totalInvestmentAmount) return 0;
  return Math.round((unit.profit * amount) / unit.totalInvestmentAmount);
}

// ---------------------------------------------------------------------------
// Unit / project status
// ---------------------------------------------------------------------------

export type AppPropertyStatus = 'available' | 'onHold' | 'booked' | 'soldOut';

/**
 * The app has one status field where the database has two independent concepts:
 * `bookingStatus` (0 available / 1 booked / 2 sold out) and a live PlotHold row.
 * A hold only shows through when the plot is otherwise available.
 */
export function propertyStatus(unit: Pick<PropertyUnit, 'bookingStatus'>, hasActiveHold: boolean): AppPropertyStatus {
  if (unit.bookingStatus === 2) return 'soldOut';
  if (unit.bookingStatus === 1) return 'booked';
  return hasActiveHold ? 'onHold' : 'available';
}

export function isHoldActive(hold: { status: number; holdEnd: Date } | null | undefined): boolean {
  return !!hold && hold.status === 1 && hold.holdEnd > new Date();
}

/**
 * Where a plot is in its life, from first enquiry to registry:
 *   available -> hold -> token -> booked -> agreement -> registered
 * Derived from what is actually recorded — the hold, the booking and its verification, the legal
 * file's agreement steps and registry — so it cannot be set wrong by hand. "Token" is a booking
 * that has taken money but is not yet verified; the sales policy can fold that into "Booked".
 */
export type PlotStage = 'available' | 'hold' | 'token' | 'booked' | 'agreement' | 'registered';
export const PLOT_STAGES: PlotStage[] = ['available', 'hold', 'token', 'booked', 'agreement', 'registered'];

export function plotStage(
  unit: { bookingStatus: number },
  hasActiveHold: boolean,
  booking: { status: string; legalFile?: { stages: unknown[]; registry: { status: string } | null } | null } | null | undefined,
  showTokenStage: boolean
): PlotStage {
  if (unit.bookingStatus === 0 || !booking) return hasActiveHold ? 'hold' : 'available';
  if (booking.legalFile?.registry?.status === 'registered') return 'registered';
  if ((booking.legalFile?.stages.length ?? 0) > 0) return 'agreement';
  if (booking.status === 'pending' && showTokenStage) return 'token';
  return 'booked';
}

export type AppProjectStatus = 'open' | 'onHold' | 'soldOut';

export interface ProjectAggregate {
  propertyCount: number;
  availableCount: number;
  plotSizeRange: string;
  startingPrice: number;
  commissionRate: number;
  plotSizes: { areaSqft: number; availablePlots: number; startingPrice: number }[];
  appStatus: AppProjectStatus;
}

const numberFormat = new Intl.NumberFormat('en-IN');

/**
 * All of the app's project-summary numbers, computed from the project's own units.
 * `appStatus`: a deactivated project reads as onHold (that is what `holdReason` is for);
 * an active project with units but none available reads as soldOut.
 */
/**
 * What the app is allowed to see. Deactivating a project in the admin panel hides it from
 * every app endpoint — the list, the detail, its plots, and booking — rather than showing it
 * as `onHold`. The admin panel still sees it; this filter is app-side only.
 */
export const APP_VISIBLE_PROJECT = { status: 1 } as const;

export function aggregateProject(
  project: { status: number; holdReason: string | null },
  units: Pick<PropertyUnit, 'propertyArea' | 'totalInvestmentAmount' | 'bookingStatus' | 'profit' | 'status'>[]
): ProjectAggregate {
  const areas = units.map((u) => Number(u.propertyArea)).filter((n) => Number.isFinite(n) && n > 0);
  const prices = units.map((u) => u.totalInvestmentAmount).filter((n) => n > 0);
  const available = units.filter((u) => u.bookingStatus === 0 && u.status === 1);

  const bySize = new Map<number, { availablePlots: number; startingPrice: number }>();
  for (const unit of units) {
    const area = Math.round(Number(unit.propertyArea));
    if (!Number.isFinite(area) || area <= 0) continue;
    const entry = bySize.get(area) ?? { availablePlots: 0, startingPrice: Number.POSITIVE_INFINITY };
    if (unit.bookingStatus === 0 && unit.status === 1) entry.availablePlots += 1;
    if (unit.totalInvestmentAmount > 0) entry.startingPrice = Math.min(entry.startingPrice, unit.totalInvestmentAmount);
    bySize.set(area, entry);
  }

  const rates = units.map((u) => commissionRateForUnit(u)).filter((r) => r > 0);

  let appStatus: AppProjectStatus = 'open';
  if (project.status === 0) appStatus = 'onHold';
  else if (units.length > 0 && available.length === 0) appStatus = 'soldOut';

  const minArea = areas.length ? Math.min(...areas) : 0;
  const maxArea = areas.length ? Math.max(...areas) : 0;

  return {
    propertyCount: units.length,
    availableCount: available.length,
    plotSizeRange: areas.length
      ? minArea === maxArea
        ? `${numberFormat.format(minArea)} sq.ft`
        : `${numberFormat.format(minArea)} - ${numberFormat.format(maxArea)} sq.ft`
      : '',
    startingPrice: prices.length ? Math.min(...prices) : 0,
    // An average across the project's units — individual plots can differ, and the app
    // shows the per-plot rate on the plot itself.
    commissionRate: rates.length ? Number((rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2)) : 0,
    plotSizes: [...bySize.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([areaSqft, v]) => ({
        areaSqft,
        availablePlots: v.availablePlots,
        startingPrice: Number.isFinite(v.startingPrice) ? v.startingPrice : 0,
      })),
    appStatus,
  };
}

// ---------------------------------------------------------------------------
// Partner money summaries
// ---------------------------------------------------------------------------

export interface BusinessSummary {
  totalEarnings: number;
  totalDeposits: number;
  payoutReleased: number;
  netPayable: number;
  bookings: number;
}

/**
 * `netPayable` is what the partner is still owed: everything earned minus everything
 * already released. It is not stored, so it can never drift from the two ledgers.
 */
export async function businessSummaryFor(userId: string): Promise<BusinessSummary> {
  const [earnings, deposits, released, bookings] = await Promise.all([
    prisma.earningEntry.aggregate({ where: { userId }, _sum: { amount: true } }),
    prisma.investment.aggregate({ where: { userId }, _sum: { amount: true } }),
    prisma.payoutRequest.aggregate({ where: { userId, status: 'released' }, _sum: { amount: true } }),
    prisma.booking.count({ where: { userId, isDeposit: 0, status: { not: 'cancelled' } } }),
  ]);
  const totalEarnings = earnings._sum.amount ?? 0;
  const payoutReleased = released._sum.amount ?? 0;
  return {
    totalEarnings,
    totalDeposits: deposits._sum.amount ?? 0,
    payoutReleased,
    netPayable: Math.max(0, totalEarnings - payoutReleased),
    bookings,
  };
}

/** Indian financial year (April–March) for a given date, e.g. "FY 2026–27". */
export function financialYearLabel(date = new Date()): string {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `FY ${year}–${String((year + 1) % 100).padStart(2, '0')}`;
}

export interface EarningsSummary {
  financialYear: string;
  totalEarned: number;
  released: number;
  inProcess: number;
  pending: number;
  byKind: Record<string, number>;
  recent: { id: string; title: string; kind: string; amount: number; creditedOn: Date }[];
}

export async function earningsSummaryFor(userId: string): Promise<EarningsSummary> {
  const entries = await prisma.earningEntry.findMany({ where: { userId }, orderBy: { creditedOn: 'desc' } });
  const sumWhere = (predicate: (e: (typeof entries)[number]) => boolean) =>
    entries.filter(predicate).reduce((sum, e) => sum + e.amount, 0);

  const byKind: Record<string, number> = { bookingCommission: 0, referralBonus: 0, joiningBonus: 0 };
  for (const entry of entries) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + entry.amount;

  return {
    financialYear: financialYearLabel(),
    totalEarned: sumWhere(() => true),
    released: sumWhere((e) => e.status === 'released'),
    inProcess: sumWhere((e) => e.status === 'confirmed'),
    pending: sumWhere((e) => e.status === 'pending'),
    byKind,
    recent: entries.slice(0, 10).map((e) => ({ id: e.id, title: e.title, kind: e.kind, amount: e.amount, creditedOn: e.creditedOn })),
  };
}

// ---------------------------------------------------------------------------
// Downline
// ---------------------------------------------------------------------------

export interface DownlineMember {
  user: User;
  level: number;
  bookings: number;
  activity: 'active' | 'idle';
}

/** Leaders (and admins) see real phone numbers; agents and employees see masked ones. */
export function seesFullPhoneNumbers(role: UserRole): boolean {
  return role === 'leader' || role === 'team_leader' || role === 'admin';
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) return '••••';
  return `••••••${phone.slice(-4)}`;
}

const ACTIVE_WINDOW_DAYS = 30;

/**
 * The partner's downline, breadth-first so `level` is the true depth (1 = direct).
 * Two edges make someone "downline": they were referred by this partner (`sponsorId`)
 * or they report to them (`reportingLeaderId`, how Employees hang off a Leader).
 * `activity` is derived from recent bookings — there is no stored activity flag.
 */
export async function downlineFor(rootUserId: string, maxDepth = 5): Promise<DownlineMember[]> {
  const collected: DownlineMember[] = [];
  const seen = new Set<string>([rootUserId]);
  let frontier = [rootUserId];

  for (let level = 1; level <= maxDepth && frontier.length > 0; level += 1) {
    const children = await prisma.user.findMany({
      where: {
        OR: [{ sponsorId: { in: frontier } }, { reportingLeaderId: { in: frontier } }],
        id: { notIn: [...seen] },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (children.length === 0) break;

    const ids = children.map((c) => c.id);
    const [bookingCounts, recentBookings] = await Promise.all([
      prisma.booking.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, isDeposit: 0, status: { not: 'cancelled' } },
        _count: { _all: true },
      }),
      prisma.booking.groupBy({
        by: ['userId'],
        where: {
          userId: { in: ids },
          createdAt: { gte: new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86400000) },
        },
        _count: { _all: true },
      }),
    ]);
    const countByUser = new Map(bookingCounts.map((r) => [r.userId, r._count._all]));
    const activeUsers = new Set(recentBookings.map((r) => r.userId));

    for (const child of children) {
      seen.add(child.id);
      collected.push({
        user: child,
        level,
        bookings: countByUser.get(child.id) ?? 0,
        activity: activeUsers.has(child.id) ? 'active' : 'idle',
      });
    }
    frontier = ids;
  }

  return collected;
}
