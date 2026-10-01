import { prisma } from '../prisma';

/**
 * Site stock and vendor performance, derived.
 *
 * Stock is never a stored count. It is every *verified* receipt minus everything issued, per
 * project and material, so an entry that was rejected, or not yet checked, cannot inflate it and
 * there is no balance to fall out of step with the entries behind it.
 */

export async function stockPosition(projectId?: string) {
  const [received, issued] = await Promise.all([
    prisma.materialEntry.groupBy({ by: ['projectId', 'materialId'], where: { status: 'verified', ...(projectId ? { projectId } : {}) }, _sum: { quantity: true } }),
    prisma.materialIssue.groupBy({ by: ['projectId', 'materialId'], where: projectId ? { projectId } : {}, _sum: { quantity: true } }),
  ]);
  const key = (p: string, m: string) => `${p}|${m}`;
  const map = new Map<string, { projectId: string; materialId: string; received: number; issued: number }>();
  for (const r of received) map.set(key(r.projectId, r.materialId), { projectId: r.projectId, materialId: r.materialId, received: r._sum.quantity ?? 0, issued: 0 });
  for (const i of issued) {
    const k = key(i.projectId, i.materialId);
    const row = map.get(k) ?? { projectId: i.projectId, materialId: i.materialId, received: 0, issued: 0 };
    row.issued = i._sum.quantity ?? 0;
    map.set(k, row);
  }
  const rows = [...map.values()];
  const [materials, projects] = await Promise.all([
    prisma.materialItem.findMany({ where: { id: { in: rows.map((r) => r.materialId) } } }),
    prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: { id: true, projectName: true } }),
  ]);
  const mat = new Map(materials.map((m) => [m.id, m]));
  const proj = new Map(projects.map((p) => [p.id, p.projectName]));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return rows
    .map((r) => ({
      projectId: r.projectId,
      projectName: proj.get(r.projectId) ?? '',
      materialId: r.materialId,
      material: mat.get(r.materialId)?.name ?? '',
      unit: mat.get(r.materialId)?.unit ?? '',
      received: round(r.received),
      issued: round(r.issued),
      inStock: round(r.received - r.issued),
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.material.localeCompare(b.material));
}

export async function stockOf(projectId: string, materialId: string): Promise<number> {
  const rows = await stockPosition(projectId);
  return rows.find((r) => r.materialId === materialId)?.inStock ?? 0;
}

/** Finds or creates a material by name and unit, ignoring case so "Cement" and "cement" are one. */
export async function materialFor(name: string, unit: string) {
  const n = name.trim();
  const u = unit.trim();
  const existing = await prisma.materialItem.findFirst({ where: { name: { equals: n, mode: 'insensitive' }, unit: { equals: u, mode: 'insensitive' } } });
  return existing ?? prisma.materialItem.create({ data: { name: n, unit: u } });
}

const WEEK = 7 * 86_400_000;

/**
 * How a vendor is doing, from what they actually did.
 *  - on-time delivery: verified entries received on or before the promised date, of those that had one
 *  - rejection rate: rejected entries of all reviewed entries
 *  - pending issues: site issues still open and owned by their login
 *  - update discipline: of the last 4 weeks, in how many did they post a progress update, counted
 *    only while they had work in progress
 */
export async function vendorPerformance(vendor: { id: string; userId: string | null }) {
  const entries = await prisma.materialEntry.findMany({ where: { vendorId: vendor.id }, select: { status: true, receivedOn: true, expectedOn: true } });
  const promised = entries.filter((e) => e.expectedOn && e.status !== 'rejected');
  const onTime = promised.filter((e) => e.receivedOn.getTime() <= e.expectedOn!.getTime()).length;
  const reviewed = entries.filter((e) => e.status !== 'pending');
  const rejected = reviewed.filter((e) => e.status === 'rejected').length;

  let pendingIssues = 0;
  let disciplinePct: number | null = null;
  if (vendor.userId) {
    pendingIssues = await prisma.siteIssue.count({ where: { ownerId: vendor.userId, status: { not: 'closed' } } });
    const now = Date.now();
    const active = await prisma.constructionActivity.findMany({ where: { assigneeId: vendor.userId, plannedStart: { lte: new Date(now) } }, select: { plannedStart: true, plannedEnd: true } });
    if (active.length > 0) {
      const updates = await prisma.progressUpdate.findMany({ where: { authorId: vendor.userId, capturedAt: { gte: new Date(now - 4 * WEEK) } }, select: { capturedAt: true } });
      let due = 0;
      let met = 0;
      for (let w = 0; w < 4; w += 1) {
        const from = now - (w + 1) * WEEK;
        const to = now - w * WEEK;
        // A week counts only if some activity of theirs was running during it.
        if (!active.some((a) => a.plannedStart.getTime() <= to && a.plannedEnd.getTime() >= from)) continue;
        due += 1;
        if (updates.some((u) => u.capturedAt.getTime() >= from && u.capturedAt.getTime() < to)) met += 1;
      }
      disciplinePct = due > 0 ? Math.round((met / due) * 100) : null;
    }
  }
  return {
    deliveries: entries.length,
    onTimePct: promised.length ? Math.round((onTime / promised.length) * 100) : null,
    rejectionPct: reviewed.length ? Math.round((rejected / reviewed.length) * 100) : null,
    pendingIssues,
    updateDisciplinePct: disciplinePct,
  };
}
