import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../prisma';
import { UPLOAD_DIR } from './upload';
import { clampPolygon, isValidPolygon, type NormalisedPoint } from './plotMap';

/**
 * Reads a layout drawing with Claude: which plots are on it, their number, area and sides, and
 * where each one sits. The result lands as unconfirmed shapes (source "detected") — the same
 * review and confirmation as a hand-drawn outline, so nothing reaches sales until a person has
 * looked at it.
 */

const READ_MODEL = process.env.PLOT_MAP_MODEL || process.env.ASSISTANT_MODEL || 'claude-opus-5-5';

export class PlotMapReadError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}

export const isReaderConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export interface ReadPlot {
  /** The plot number printed on the layout, e.g. "12" or "12A". */
  number: string;
  /** Printed area, in the layout's own unit (sq yd on Indian layouts). */
  area: string | null;
  /** Printed side lengths, top to bottom / left to right, as printed ("25'", "47'-3\""). */
  width: string | null;
  length: string | null;
  isCorner: boolean;
  /** How the drawing paints it: yellow, white, … — a hint only, never a booking. */
  fill: string | null;
  points: NormalisedPoint[];
  confidence: 'high' | 'medium' | 'low';
}

export interface ReadResult {
  plots: ReadPlot[];
  /** What the model noticed that a person should know: unreadable plots, odd numbering. */
  notes: string[];
}

const GRID = 1000;

const TOOL: Anthropic.Tool = {
  name: 'record_layout',
  description: 'Record every plot found on the layout drawing.',
  input_schema: {
    type: 'object',
    properties: {
      plots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'string', description: 'The plot number printed on the plot (usually in a circle), exactly as printed.' },
            area: { type: ['string', 'null'], description: 'The printed area of the plot as a plain number, e.g. "187.65". null if not printed.' },
            width: { type: ['string', 'null'], description: 'Printed front/back side length as printed, e.g. "25\'". null if not printed.' },
            length: { type: ['string', 'null'], description: 'Printed left/right side length as printed, e.g. "47\'-3\\"". null if not printed.' },
            is_corner: { type: 'boolean', description: 'True when the plot sits at the corner of a road junction or the end of the row.' },
            fill: { type: ['string', 'null'], description: 'The colour the drawing fills this plot with ("yellow", "white", "green", …). null if none.' },
            polygon: {
              type: 'array',
              description: `The plot's boundary as 4 or more [x, y] corner points on a 0–${GRID} grid: x = 0 is the image's left edge and ${GRID} its right edge, y = 0 is the top edge and ${GRID} the bottom. Follow the plot's own lot lines, not the label.`,
              items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              minItems: 3,
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How sure you are of this plot\'s number and outline.' },
          },
          required: ['number', 'polygon', 'confidence', 'is_corner'],
        },
      },
      notes: { type: 'array', items: { type: 'string' }, description: 'Anything a person should check: unreadable numbers, plots you were unsure of, duplicated numbers.' },
    },
    required: ['plots'],
  },
};

const PROMPT = [
  'This is the layout drawing of a plotted development (land divided into numbered plots), usually from India.',
  'Find EVERY plot and call record_layout once. Do not include roads, parks, trees, the title block or the north arrow.',
  `For each plot give its number as printed, the printed area (usually "SQYDS."), the printed side lengths, whether it is a corner plot, the colour the drawing paints it, and its boundary polygon on a 0–${GRID} grid over the WHOLE image (x from the left edge, y from the top edge).`,
  'The polygon must follow the plot\'s own lot lines and hug the plot: adjacent plots should share edges, never overlap, and the polygon must not cover the printed number of a neighbouring plot.',
  'If a plot\'s number cannot be read, still give its outline, set number to "?" and confidence "low". Never invent a number or an area. List anything doubtful in notes.',
].join('\n');

function mediaTypeFor(file: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

/** A stored layout is a root-relative /uploads/ URL; only that folder is ever read. */
function layoutFile(imageUrl: string): string {
  const name = path.basename(imageUrl.split('?')[0]);
  const full = path.join(UPLOAD_DIR, name);
  if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) throw new PlotMapReadError('The layout image could not be found on the server.', 404);
  return full;
}

function toGridNumber(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/** Calls Claude on the stored layout image and returns plots with 0..1 polygons. */
export async function readLayout(imageUrl: string): Promise<ReadResult> {
  if (!isReaderConfigured()) throw new PlotMapReadError('Reading a layout needs the Anthropic API key (ANTHROPIC_API_KEY) on the server.', 503);
  const file = layoutFile(imageUrl);
  const bytes = fs.readFileSync(file);
  if (bytes.length > 5 * 1024 * 1024) throw new PlotMapReadError('The layout image is over 5 MB. Upload a smaller export (a PNG around 2000 px wide is plenty).', 413);

  const client = new Anthropic();
  let message: Anthropic.Message;
  try {
    // Streamed: a layout with a hundred plots is a long answer, and a plain request would time out.
    message = await client.messages
      .stream({
        model: READ_MODEL,
        max_tokens: 32000,
        tools: [TOOL],
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(file), data: bytes.toString('base64') } },
            { type: 'text', text: PROMPT },
          ],
        }],
      })
      .finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new PlotMapReadError('The Anthropic API key was refused. Check ANTHROPIC_API_KEY.', 503);
    if (err instanceof Anthropic.APIError) throw new PlotMapReadError(`The layout reader failed: ${err.message}`, 502);
    throw err;
  }

  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const raw = block?.input as { plots?: any[]; notes?: unknown[] } | undefined;
  if (!raw || !Array.isArray(raw.plots)) throw new PlotMapReadError('The layout could not be read. Try a clearer image.', 502);
  const notes: string[] = Array.isArray(raw.notes) ? raw.notes.map((n) => String(n)).slice(0, 20) : [];
  if (message.stop_reason === 'max_tokens') notes.push('The reading was cut short, so some plots may be missing.');

  const plots: ReadPlot[] = [];
  for (const p of raw.plots) {
    const points: NormalisedPoint[] = (Array.isArray(p?.polygon) ? p.polygon : [])
      .map((pt: unknown) => (Array.isArray(pt) ? [toGridNumber(pt[0]), toGridNumber(pt[1])] : [null, null]))
      .filter((pt: (number | null)[]): pt is [number, number] => pt[0] !== null && pt[1] !== null)
      .map(([x, y]: [number, number]) => [x / GRID, y / GRID] as NormalisedPoint);
    if (!isValidPolygon(points)) { notes.push(`Plot ${p?.number ?? '?'}: its outline could not be used and was skipped.`); continue; }
    plots.push({
      number: String(p?.number ?? '?').trim() || '?',
      area: p?.area ? String(p.area).replace(/[^\d.]/g, '') || null : null,
      width: p?.width ? String(p.width).trim() : null,
      length: p?.length ? String(p.length).trim() : null,
      isCorner: !!p?.is_corner,
      fill: p?.fill ? String(p.fill).toLowerCase() : null,
      points: clampPolygon(points),
      confidence: p?.confidence === 'low' || p?.confidence === 'medium' ? p.confidence : 'high',
    });
  }
  return { plots, notes };
}

export interface ApplyResult {
  read: number;
  linked: number;
  created: number;
  unmatched: string[];
  notes: string[];
}

const keyOf = (n: string) => n.trim().toLowerCase().replace(/^(plot|no\.?|#)\s*/i, '');

/**
 * Reads the layout and writes the result as the project's shapes, replacing the ones already
 * on the map. Each plot is matched to the project's own unit by its number; a plot with no unit
 * either gets one (createMissing) or stays an unlinked shape for the review step to close.
 */
export async function readAndApply(projectId: string, opts: { createMissing: boolean }): Promise<ApplyResult> {
  const map = await prisma.projectMap.findUnique({ where: { projectId } });
  if (!map) throw new PlotMapReadError('Upload a layout for this project first.', 404);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectName: true } });
  if (!project) throw new PlotMapReadError('Project not found.', 404);

  const { plots, notes } = await readLayout(map.imageUrl);
  if (plots.length === 0) throw new PlotMapReadError('No plots were found on that image.', 422);

  const units = await prisma.propertyUnit.findMany({ where: { projectId }, select: { id: true, propertyNumber: true } });
  const byNumber = new Map(units.map((u) => [keyOf(u.propertyNumber), u.id]));
  const used = new Set<string>();

  let created = 0;
  const unmatched: string[] = [];
  const shapes: { unitId: string | null; points: NormalisedPoint[]; label: string | null }[] = [];

  for (const plot of plots) {
    const key = keyOf(plot.number);
    let unitId = plot.number !== '?' ? byNumber.get(key) ?? null : null;
    if (unitId && used.has(unitId)) {
      notes.push(`Plot ${plot.number} appears twice on the layout; the second outline was left unlinked.`);
      unitId = null;
    }
    if (!unitId && opts.createMissing && plot.number !== '?') {
      const unit = await prisma.propertyUnit.create({
        data: {
          projectId,
          propertyTitle: `${project.projectName} - Plot ${plot.number}`,
          propertyNumber: plot.number,
          propertyType: 'Plot',
          propertyArea: plot.area ?? '',
          propertyMeasurement: 'Sq yard',
          width: plot.width,
          length: plot.length,
          isCorner: plot.isCorner,
        },
        select: { id: true },
      });
      unitId = unit.id;
      byNumber.set(key, unitId);
      created += 1;
    }
    if (unitId) used.add(unitId);
    else unmatched.push(plot.number);
    shapes.push({ unitId, points: plot.points, label: unitId ? null : plot.number });
  }

  await prisma.$transaction([
    prisma.plotShape.deleteMany({ where: { mapId: map.id } }),
    prisma.plotShape.createMany({
      data: shapes.map((s) => ({ mapId: map.id, unitId: s.unitId, points: s.points, label: s.label, source: 'detected', confirmed: false })),
    }),
    // Back to draft: a machine's reading is checked by a person before sales see it.
    prisma.projectMap.update({ where: { id: map.id }, data: { status: 'draft' } }),
  ]);

  return { read: plots.length, linked: used.size, created, unmatched, notes };
}
