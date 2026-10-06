import { prisma } from '../prisma';
import { getPolicy, type Policy } from './salesPolicy';

/**
 * Channel partners are the agents already in the system. What this adds is derived from the
 * records they already have: whether brokerage is payable yet, what tax comes off it, and how
 * long a registered lead stays theirs. None of it is stored per row, so a change to the policy
 * applies to everything at once.
 */

const SIGNED = ['signed', 'executed', 'stamped'];

export const brokerageInclude = {
  booking: { select: { id: true, reference: true, bookingName: true, amount: true, status: true, unit: { select: { propertyNumber: true, project: { select: { projectName: true } } } }, legalFile: { select: { stages: { select: { stage: true } }, registry: { select: { status: true } } } } } },
} as const;

type Entry = { id: string; title: string; amount: number; status: string; creditedOn: Date; booking: { id: string; reference: string; bookingName: string; amount: number; status: string; unit: { propertyNumber: string; project: { projectName: string } }; legalFile: { stages: { stage: string }[]; registry: { status: string } | null } | null } | null };

/** Whether the milestone the policy names has been reached for this booking. */
export function milestoneReached(policy: Policy, b: NonNullable<Entry['booking']>): boolean {
  if (b.status === 'cancelled') return false;
  if (policy.brokerageEligibleAt === 'registry') return b.legalFile?.registry?.status === 'registered';
  if (policy.brokerageEligibleAt === 'agreement') return !!b.legalFile?.stages.some((s) => SIGNED.includes(s.stage));
  return b.status === 'booked';
}

/** One brokerage line: what was earned, the tax, what is left, and where it stands. */
export function brokerageLine(policy: Policy, e: Entry) {
  const tds = Math.round((e.amount * policy.brokerageTdsPercent) / 100);
  const reached = e.booking ? milestoneReached(policy, e.booking) : false;
  const state = e.status === 'released' ? 'paid' : e.booking?.status === 'cancelled' ? 'cancelled' : reached ? 'payable' : 'waiting';
  const base = e.booking?.amount ?? 0;
  return {
    id: e.id, title: e.title, reference: e.booking?.reference ?? null, buyerName: e.booking?.bookingName ?? null,
    unit: e.booking?.unit.propertyNumber ?? null, projectName: e.booking?.unit.project.projectName ?? null,
    gross: e.amount, tds, net: e.amount - tds, percent: base > 0 ? Math.round((e.amount / base) * 10000) / 100 : 0,
    state, creditedOn: e.creditedOn.toISOString(),
  };
}

export async function brokerageFor(partnerId: string) {
  const [policy, entries] = await Promise.all([
    getPolicy(),
    prisma.earningEntry.findMany({ where: { userId: partnerId, kind: 'bookingCommission', amount: { gt: 0 } }, include: brokerageInclude, orderBy: { creditedOn: 'desc' } }),
  ]);
  const lines = entries.map((e) => brokerageLine(policy, e as never));
  const sum = (state: string, k: 'gross' | 'tds' | 'net') => lines.filter((l) => l.state === state).reduce((n, l) => n + l[k], 0);
  return {
    lines,
    eligibleAt: policy.brokerageEligibleAt, tdsPercent: policy.brokerageTdsPercent,
    totals: { payableNet: sum('payable', 'net'), waitingNet: sum('waiting', 'net'), paidNet: sum('paid', 'net'), tdsDeducted: lines.filter((l) => l.state !== 'cancelled').reduce((n, l) => n + l.tds, 0) },
  };
}

/** The day a registered lead stops being the partner's own. */
export const protectedUntil = (createdAt: Date, policy: Policy) => new Date(createdAt.getTime() + policy.leadProtectionDays * 86_400_000);

/** The panel role a partner's web login is given: the portal and nothing else. */
export const partnerPortalRole = () =>
  prisma.panelRole.upsert({
    where: { name: 'Channel Partner Portal' },
    update: {},
    create: { name: 'Channel Partner Portal', description: 'A channel partner sees only their own leads, bookings and brokerage.', modules: ['partner_portal'], isSystem: true },
  });
