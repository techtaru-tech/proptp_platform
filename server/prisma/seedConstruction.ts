import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';

/**
 * Demo construction schedules, relative to today so the planned-vs-actual picture is always
 * mid-flight: some activities done, some on track, one behind, one not started. Photos are
 * generated placeholders (a labelled SVG) written beside the other demo uploads.
 * Skipped if any activity exists, so a re-seed never overwrites a real schedule.
 */
const UPLOAD_DIR = path.resolve(__dirname, '../uploads');
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY);

const PLAN = [
  { phase: 'Land & approvals', block: 'Whole site', name: 'Boundary wall', start: -120, end: -40, done: 100 },
  { phase: 'Infrastructure', block: 'Block A', name: 'Road base and kerbing', start: -60, end: 20, done: 55 },
  { phase: 'Infrastructure', block: 'Block A', name: 'Drainage lines', start: -45, end: 10, done: 90 },
  { phase: 'Infrastructure', block: 'Block B', name: 'Road base and kerbing', start: -20, end: 60, done: 10 },
  { phase: 'Utilities', block: 'Block B', name: 'Electrical cabling and poles', start: 5, end: 80, done: 0 },
  { phase: 'Amenities', block: 'Whole site', name: 'Entrance gate and landscaping', start: 30, end: 120, done: 0 },
];

function photo(file: string, label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#d9d2c3"/><rect y="300" width="640" height="180" fill="#b9ad96"/><text x="320" y="230" font-family="Arial" font-size="30" text-anchor="middle" fill="#5b5140">${label}</text><text x="320" y="270" font-family="Arial" font-size="18" text-anchor="middle" fill="#7a7060">demo site photo</text></svg>`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), svg);
  return `/uploads/${file}`;
}

export async function seedConstruction(prisma: PrismaClient) {
  if ((await prisma.constructionActivity.count()) > 0) {
    console.log('  construction already present — skipping.');
    return;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const worker =
    (await prisma.user.findFirst({ where: { email: 'gaurav@proptocrm.com' } })) ??
    (await prisma.user.findFirst({ where: { role: 'employee', status: 'active' } }));
  const reviewer = await prisma.user.findFirst({ where: { role: 'admin' } });
  const projects = await prisma.project.findMany({ orderBy: { id: 'asc' }, take: 3 });
  if (!worker || !reviewer || projects.length === 0) return;

  let activities = 0;
  let updates = 0;
  for (const [pi, project] of projects.entries()) {
    // The first project has the fullest schedule; later ones are shorter, as projects at
    // earlier stages would be.
    const plan = PLAN.slice(0, pi === 0 ? 6 : pi === 1 ? 4 : 2);
    for (const [i, p] of plan.entries()) {
      const a = await prisma.constructionActivity.create({
        data: {
          projectId: project.id, phase: p.phase, block: p.block, name: p.name,
          plannedStart: day(p.start), plannedEnd: day(p.end), weight: p.name.startsWith('Road') ? 3 : 1,
          sortOrder: i, assigneeId: worker.id,
        },
      });
      activities += 1;
      if (p.done === 0) continue;

      // An approved history that climbs to the current figure, plus one waiting for review on
      // the activity that is running behind.
      const steps = [Math.round(p.done / 2), p.done];
      for (const [si, pct] of steps.entries()) {
        const at = day(-(steps.length - si) * 6);
        await prisma.progressUpdate.create({
          data: {
            activityId: a.id, authorId: worker.id, workDone: `${p.name}: ${pct}% of the work done to date.`,
            manpower: 8 + si * 4, percentComplete: pct, capturedAt: at, status: 'approved',
            reviewerId: reviewer.id, reviewedAt: at,
            photos: { create: [{ url: photo(`demo-cons-${a.id}-${si}.svg`, p.name), takenAt: at, latitude: 26.85 + pi * 0.01, longitude: 75.8 + pi * 0.01 }] },
          },
        });
        updates += 1;
      }
      if (p.name === 'Road base and kerbing' && p.block === 'Block A') {
        const at = day(-1);
        await prisma.progressUpdate.create({
          data: {
            activityId: a.id, authorId: worker.id, workDone: 'Kerbing completed on the east side; base layer rolled.', manpower: 14,
            percentComplete: 65, capturedAt: at, remarks: 'Rain delayed the afternoon shift.',
            photos: { create: [{ url: photo(`demo-cons-${a.id}-p.svg`, 'Kerbing east side'), takenAt: at, latitude: 26.85, longitude: 75.8 }] },
          },
        });
        await prisma.progressUpdate.create({
          data: {
            activityId: a.id, authorId: worker.id, workDone: 'Base layer done.', manpower: 10, percentComplete: 80,
            capturedAt: day(-3), status: 'rejected', rejectionReason: 'Photos do not show the stretch claimed. Re-shoot with the chainage board visible.',
            reviewerId: reviewer.id, reviewedAt: day(-2),
            photos: { create: [{ url: photo(`demo-cons-${a.id}-r.svg`, 'Unclear photo'), takenAt: day(-3), latitude: 26.85, longitude: 75.8 }] },
          },
        });
        updates += 2;
      }
    }

    if (pi < 2) {
      await prisma.siteIssue.create({
        data: {
          projectId: project.id, title: pi === 0 ? 'Water logging near the Block A drain outlet' : 'Cracked kerb stones in first delivery',
          description: 'Raised on the site walk. Needs a fix before the next stage can start.',
          photos: [photo(`demo-issue-${project.id}.svg`, 'Issue photo')], raisedById: reviewer.id, ownerId: worker.id, dueDate: day(pi === 0 ? -2 : 6),
        },
      });
    }
  }
  console.log(`  construction: ${activities} activities, ${updates} updates, issues for the first two projects`);
}
