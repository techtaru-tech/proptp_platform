import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';

/**
 * Seeds demo plot maps, so the feature has something to show on a fresh database.
 *
 * Each layout is an SVG **generated from the project's own units** rather than a bundled
 * image. A picture would print sizes that have to match the records forever; generating it
 * means the drawing and the data cannot disagree, and no binary sits in the repo. It prints
 * sizes only — the plot numbers are the map's own overlay, as they would be on a plain plan.
 *
 * Three states are seeded on purpose, so the project picker is not three of the same thing:
 * a live map, a second live map, and a draft with only part of the layout outlined — which is
 * what a map looks like halfway through being set up.
 */

const WIDTH = 1600;
const HEIGHT = 1000;
const UPLOAD_DIR = path.resolve(__dirname, '../uploads');

const PLAN = [
  { projectId: 'PRJ-001', status: 'live', mapped: 1 },
  { projectId: 'PRJ-002', status: 'live', mapped: 1 },
  { projectId: 'PRJ-003', status: 'draft', mapped: 0.6 },
] as const;

type Point = [number, number];

interface Placed {
  unitId: string;
  number: string;
  area: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Two blocks of plots either side of a main road, filled row by row. */
function layOut(units: { id: string; propertyNumber: string; propertyArea: string; propertyMeasurement: string }[]): Placed[] {
  const COLS = 6;
  const MARGIN = 70;
  const GAP = 18;
  const cellW = (WIDTH - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
  const roadTop = 440;
  const roadBottom = 540;
  // The title takes the top 130px, so the upper block gets what is left above the road. Plots
  // shrink with the row count rather than climbing over the title on a bigger project.
  const TITLE_CLEARANCE = 140;

  const half = Math.ceil(units.length / 2);
  const rows = Math.max(1, Math.ceil(half / COLS));
  const cellH = Math.min(150, Math.floor((roadTop - GAP - TITLE_CLEARANCE - (rows - 1) * GAP) / rows));
  const blockHeight = rows * cellH + (rows - 1) * GAP;
  const blocks: [typeof units, number][] = [
    [units.slice(0, half), roadTop - GAP - blockHeight],
    [units.slice(half), roadBottom + GAP * 2],
  ];

  const placed: Placed[] = [];
  for (const [block, top] of blocks) {
    block.forEach((unit, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      placed.push({
        unitId: unit.id,
        number: unit.propertyNumber,
        area: `${unit.propertyArea} ${unit.propertyMeasurement}`.trim(),
        x: MARGIN + col * (cellW + GAP),
        y: top + row * (cellH + GAP),
        w: cellW,
        h: cellH,
      });
    });
  }
  return placed;
}

function layoutSvg(projectName: string, location: string, plots: Placed[]): string {
  const rects = plots
    .map(
      (p) => `
  <g>
    <rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.h}" fill="#e8dfca" stroke="#6b5e4b" stroke-width="3"/>
    <text x="${(p.x + 14).toFixed(1)}" y="${(p.y + p.h - 16).toFixed(1)}" font-family="Arial, Helvetica, sans-serif" font-size="19" fill="#6b5e4b">${escapeXml(p.area)}</text>
  </g>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#f1ede4"/>
  <rect x="40" y="40" width="${WIDTH - 80}" height="${HEIGHT - 80}" fill="none" stroke="#6b5e4b" stroke-width="6"/>
  <rect x="40" y="440" width="${WIDTH - 80}" height="100" fill="#cfc7b6"/>
  <text x="${WIDTH / 2}" y="498" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#7a7060">40 FT WIDE ROAD</text>
  <text x="70" y="82" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="700" fill="#3a2f22">${escapeXml(projectName.toUpperCase())} — LAYOUT PLAN</text>
  <text x="70" y="114" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#6b5e4b">${escapeXml(location)}  ·  Not to scale</text>${rects}
</svg>
`;
}

export async function seedPlotMap(prisma: PrismaClient) {
  if ((await prisma.projectMap.count()) > 0) {
    console.log('  plot maps already present — skipping.');
    return;
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  let made = 0;

  for (const plan of PLAN) {
    const project = await prisma.project.findUnique({
      where: { id: plan.projectId },
      include: { units: { orderBy: { propertyNumber: 'asc' } } },
    });
    if (!project || project.units.length === 0) continue;

    const placed = layOut(project.units);
    const fileName = `demo-layout-${plan.projectId}.svg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), layoutSvg(project.projectName, project.projectLocation, placed));

    const map = await prisma.projectMap.create({
      data: {
        projectId: plan.projectId,
        imageUrl: `/uploads/${fileName}`,
        imageWidth: WIDTH,
        imageHeight: HEIGHT,
        status: plan.status,
      },
    });

    // A draft is outlined only in part, the way a map really sits mid-setup.
    const toOutline = placed.slice(0, Math.max(1, Math.round(placed.length * plan.mapped)));
    await prisma.plotShape.createMany({
      data: toOutline.map((p) => ({
        mapId: map.id,
        unitId: p.unitId,
        points: [
          [p.x / WIDTH, p.y / HEIGHT],
          [(p.x + p.w) / WIDTH, p.y / HEIGHT],
          [(p.x + p.w) / WIDTH, (p.y + p.h) / HEIGHT],
          [p.x / WIDTH, (p.y + p.h) / HEIGHT],
        ] satisfies Point[],
        source: 'manual',
        confirmed: true,
      })),
    });
    made += 1;
  }

  console.log(`  plot maps: ${made} (live, live, and a half-outlined draft)`);
}
