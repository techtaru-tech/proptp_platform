import type { ConstructionActivity, ProgressUpdate } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Construction progress, derived.
 *
 * Nothing here is stored on the activity. Actual progress is the latest *approved* update, so
 * what the project manager signed off is the only thing that counts and there is no second number
 * to keep in step. Planned progress is a straight line between the planned dates. Block and
 * project figures are weighted averages of their activities.
 */

const DAY = 86_400_000;

/** Planned completion at `at`, 0-100: linear between the planned start and end. */
export function plannedPercent(a: Pick<ConstructionActivity, 'plannedStart' | 'plannedEnd'>, at = new Date()): number {
  const start = a.plannedStart.getTime();
  const end = a.plannedEnd.getTime();
  if (at.getTime() <= start) return 0;
  if (at.getTime() >= end || end <= start) return 100;
  return Math.round(((at.getTime() - start) / (end - start)) * 100);
}

/**
 * How many days the activity is running behind plan. Past its end date and unfinished, that is
 * the days since the end; mid-way, it is the gap between where it should be and where it is,
 * converted to days of the planned duration. Never negative: being ahead is not "behind by -3".
 */
export function daysBehind(
  a: Pick<ConstructionActivity, 'plannedStart' | 'plannedEnd'>,
  actual: number,
  at = new Date()
): number {
  if (actual >= 100) return 0;
  if (at.getTime() > a.plannedEnd.getTime()) return Math.max(1, Math.ceil((at.getTime() - a.plannedEnd.getTime()) / DAY));
  const gap = plannedPercent(a, at) - actual;
  if (gap <= 0) return 0;
  const duration = Math.max(1, (a.plannedEnd.getTime() - a.plannedStart.getTime()) / DAY);
  return Math.ceil((gap / 100) * duration);
}

export interface ActivityProgress {
  planned: number;
  actual: number;
  daysBehind: number;
  /** The newest approved update, for the "last reported" line. */
  lastApprovedAt: string | null;
  pendingUpdates: number;
}

export function activityProgress(
  a: ConstructionActivity & { updates: Pick<ProgressUpdate, 'status' | 'percentComplete' | 'capturedAt'>[] },
  at = new Date()
): ActivityProgress {
  const approved = a.updates.filter((u) => u.status === 'approved').sort((x, y) => y.capturedAt.getTime() - x.capturedAt.getTime());
  const actual = approved[0]?.percentComplete ?? 0;
  return {
    planned: plannedPercent(a, at),
    actual,
    daysBehind: daysBehind(a, actual, at),
    lastApprovedAt: approved[0]?.capturedAt.toISOString() ?? null,
    pendingUpdates: a.updates.filter((u) => u.status === 'pending').length,
  };
}

export interface Rollup {
  planned: number;
  actual: number;
  /** The worst delay among the activities, which is what "the milestone is running late" means. */
  daysBehind: number;
  activities: number;
}

export function rollup(items: { weight: number; progress: ActivityProgress }[]): Rollup {
  const total = items.reduce((s, i) => s + Math.max(1, i.weight), 0);
  if (total === 0) return { planned: 0, actual: 0, daysBehind: 0, activities: 0 };
  const avg = (pick: (p: ActivityProgress) => number) =>
    Math.round(items.reduce((s, i) => s + Math.max(1, i.weight) * pick(i.progress), 0) / total);
  return {
    planned: avg((p) => p.planned),
    actual: avg((p) => p.actual),
    daysBehind: items.reduce((m, i) => Math.max(m, i.progress.daysBehind), 0),
    activities: items.length,
  };
}

/** Loads a project's activities with their updates and derives everything the screens show. */
export async function projectProgress(projectId: string) {
  const activities = await prisma.constructionActivity.findMany({
    where: { projectId },
    include: {
      updates: { select: { status: true, percentComplete: true, capturedAt: true } },
      assignee: { select: { id: true, name: true } },
    },
    orderBy: [{ block: 'asc' }, { phase: 'asc' }, { sortOrder: 'asc' }, { plannedStart: 'asc' }],
  });
  const now = new Date();
  const rows = activities.map(({ updates, ...a }) => ({ ...a, progress: activityProgress({ ...a, updates }, now) }));

  const groupBy = (key: 'block' | 'phase') => {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) groups.set(r[key], [...(groups.get(r[key]) ?? []), r]);
    return [...groups.entries()].map(([name, items]) => ({ name, ...rollup(items) }));
  };
  return { rows, project: rollup(rows), blocks: groupBy('block'), phases: groupBy('phase') };
}

/** One-line construction status for a buyer: where the project stands against plan. */
export function statusSentence(projectName: string, r: Rollup): string {
  const lead = `${projectName}: construction is ${r.actual}% complete (plan ${r.planned}%).`;
  if (r.activities === 0) return `${projectName}: construction schedule is being prepared.`;
  return r.daysBehind > 0 ? `${lead} Some work is running about ${r.daysBehind} day(s) behind plan.` : `${lead} On schedule.`;
}
