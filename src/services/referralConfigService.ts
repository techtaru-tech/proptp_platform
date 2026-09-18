import type { Badge, CommissionType, PlanLevel, ReferralCommissionToggles, ReferralLevelRule } from '../types';
import { api } from './apiClient';

/**
 * Referral commission configuration. Unlike the mock layer, these settings are now live:
 * the `investment` ladder is what the booking engine walks up the sponsor chain to credit
 * referral bonuses with, and the `investmentCommission` toggle switches that off entirely.
 */

export async function getReferralToggles(): Promise<ReferralCommissionToggles> {
  return api.get<ReferralCommissionToggles>('/platform-settings/referral/toggles');
}

export async function updateReferralToggles(patch: Partial<ReferralCommissionToggles>): Promise<ReferralCommissionToggles> {
  return api.patch<ReferralCommissionToggles>('/platform-settings/referral/toggles', patch);
}

export async function getReferralLevelRules(commissionType: CommissionType): Promise<ReferralLevelRule[]> {
  const { rules } = await api.get<{ rules: ReferralLevelRule[] }>(
    `/platform-settings/referral/levels?commissionType=${commissionType}`
  );
  return rules;
}

/** Mirrors the real `referralCommissionStore()` — delete-all + reinsert, per commission type. */
export async function saveReferralLevelRules(commissionType: CommissionType, percents: number[]): Promise<ReferralLevelRule[]> {
  const { rules } = await api.put<{ rules: ReferralLevelRule[] }>('/platform-settings/referral/levels', {
    commissionType,
    percents,
  });
  return rules;
}

export async function listPlanLevels(): Promise<PlanLevel[]> {
  const { levels } = await api.get<{ levels: PlanLevel[] }>('/platform-settings/plan-levels');
  return levels;
}

/**
 * Mirrors the real `planTeamCommissionSave()` — the server validates that no two volume
 * ranges overlap and rejects the whole save if they do, so the ladder can never end up
 * ambiguous.
 */
export async function savePlanLevels(levels: Omit<PlanLevel, 'id'>[]): Promise<{ error?: string; levels?: PlanLevel[] }> {
  try {
    const { levels: saved } = await api.put<{ levels: PlanLevel[] }>('/platform-settings/plan-levels', { levels });
    return { levels: saved };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the incentive ladder.' };
  }
}

export async function listBadges(): Promise<Badge[]> {
  const { badges } = await api.get<{ badges: Badge[] }>('/platform-settings/badges');
  return badges;
}

export async function createBadge(input: Omit<Badge, 'id' | 'sortOrder'>): Promise<Badge> {
  return api.post<Badge>('/platform-settings/badges', input);
}

export async function updateBadge(id: string, patch: Partial<Badge>): Promise<Badge | undefined> {
  return api.patch<Badge>(`/platform-settings/badges/${id}`, patch).catch(() => undefined);
}

export async function reorderBadges(orderedIds: string[]): Promise<void> {
  await api.put('/platform-settings/badges/order', { orderedIds });
}
