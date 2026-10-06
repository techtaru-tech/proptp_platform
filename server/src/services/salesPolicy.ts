import { prisma } from '../prisma';

/**
 * The sales policy: the late-payment penalty, what is kept on a cancellation and who approves the
 * refund, and whether an unverified booking shows as "Token". One row, edited in Settings, read
 * here by everything that applies it — so no rule lives in code.
 */
export const getPolicy = () => prisma.salesPolicy.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
export type Policy = Awaited<ReturnType<typeof getPolicy>>;

export function validatePolicy(b: Record<string, unknown>): { data?: Partial<Policy>; error?: string } {
  const data: Record<string, unknown> = {};
  const num = (k: string, label: string, min: number, max: number, int = false) => {
    if (b[k] === undefined) return null;
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) return `${label} must be ${int ? 'a whole number ' : ''}between ${min} and ${max}.`;
    data[k] = v;
    return null;
  };
  const oneOf = (k: string, label: string, options: string[]) => {
    if (b[k] === undefined) return null;
    if (!options.includes(String(b[k]))) return `${label} must be one of: ${options.join(', ')}.`;
    data[k] = String(b[k]);
    return null;
  };
  const err =
    oneOf('penaltyType', 'Penalty type', ['percent', 'fixed']) ||
    oneOf('penaltyPeriod', 'Penalty period', ['day', 'month']) ||
    oneOf('refundApprover', 'Refund approver', ['admin', 'leader', 'accounts']) ||
    num('penaltyRate', 'The penalty rate', 0, 1_000_000) ||
    num('penaltyGraceDays', 'Grace days', 0, 365, true) ||
    num('penaltyCapPercent', 'The penalty cap', 0, 100) ||
    num('refundDeductionPercent', 'The refund deduction', 0, 100);
  if (err) return { error: err };
  if (b.showTokenStage !== undefined) data.showTokenStage = !!b.showTokenStage;
  // A percentage penalty above 100 per period would be a typo, not a policy.
  const type = (data.penaltyType as string) ?? undefined;
  if (type === 'percent' && data.penaltyRate !== undefined && Number(data.penaltyRate) > 100) return { error: 'A percentage penalty cannot be more than 100.' };
  return { data: data as Partial<Policy> };
}

/**
 * The penalty on an overdue instalment: the policy's rate for every period past the grace days,
 * on what is still outstanding, never more than the cap. Simple, not compounding.
 */
export function penaltyFor(p: Policy, input: { outstanding: number; instalment: number; daysOverdue: number }): number {
  const late = Math.max(0, input.daysOverdue - p.penaltyGraceDays);
  if (late === 0 || input.outstanding <= 0) return 0;
  const periods = p.penaltyPeriod === 'day' ? late : Math.ceil(late / 30);
  const perPeriod = p.penaltyType === 'percent' ? (input.outstanding * p.penaltyRate) / 100 : p.penaltyRate;
  let total = perPeriod * periods;
  if (p.penaltyCapPercent > 0) total = Math.min(total, (input.instalment * p.penaltyCapPercent) / 100);
  return Math.round(total);
}

/** What a cancellation refunds: what was paid, less the policy's deduction. */
export function refundFor(p: Policy, amountPaid: number) {
  const deductionAmount = Math.round((amountPaid * p.refundDeductionPercent) / 100);
  return { deductionPercent: p.refundDeductionPercent, deductionAmount, refundAmount: Math.max(0, amountPaid - deductionAmount) };
}
