import type { PlotStage, PlotMapBundle, PlotMapPlot, PlotMapPoint, PlotMapStatus, PublicPlotMap } from '../types';
import { api, uploadFiles } from './apiClient';

/**
 * Plot map (server/src/routes/admin/projectMaps.ts).
 *
 * The map stores geometry only. A plot's status and the counts above it come back from the
 * server already derived from the unit and its holds, so nothing here — and nothing a user
 * does on the map — keeps a second copy of a plot's state.
 */

export async function getPlotMap(projectId: string): Promise<PlotMapBundle> {
  return api.get<PlotMapBundle>(`/project-maps/${projectId}`);
}

/** The natural size of an image file, which the editor needs to store alongside the upload. */
function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('That file could not be read as an image. Upload a PNG or JPG of the layout.'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

const MAX_READ_BYTES = 4.5 * 1024 * 1024;
const MAX_LONG_EDGE = 2600;

function canvasToFile(canvas: HTMLCanvasElement, baseName: string): Promise<File> {
  const encode = (type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the layout image.'))), type, quality));
  return (async () => {
    // PNG keeps a drawing's thin lines crisp; JPEG only when the PNG is too big for the reader.
    const png = await encode('image/png');
    if (png.size <= MAX_READ_BYTES) return new File([png], `${baseName}.png`, { type: 'image/png' });
    const jpg = await encode('image/jpeg', 0.92);
    return new File([jpg], `${baseName}.jpg`, { type: 'image/jpeg' });
  })();
}

/** The first page of a PDF layout, drawn to an image — the map is drawn on images, not PDFs. */
async function pdfToImage(file: File): Promise<File> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = MAX_LONG_EDGE / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not draw the PDF.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvasToFile(canvas, file.name.replace(/\.pdf$/i, '') || 'layout');
}

/** A photo or export larger than the reader accepts is re-drawn smaller, keeping its proportions. */
async function shrinkIfLarge(file: File): Promise<File> {
  if (file.size <= MAX_READ_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvasToFile(canvas, file.name.replace(/\.[^.]+$/, '') || 'layout');
}

/**
 * Upload a layout (an image or a PDF), or replace the current one. A replacement keeps every
 * outline — they are stored relative to the image — and drops the map back to draft so somebody
 * checks the fit.
 */
export async function uploadPlotMapLayout(projectId: string, original: File): Promise<void> {
  const file = original.type === 'application/pdf' || /\.pdf$/i.test(original.name) ? await pdfToImage(original) : await shrinkIfLarge(original);
  const { width, height } = await imageSize(file);
  const [imageUrl] = await uploadFiles([file]);
  await api.post(`/project-maps/${projectId}`, { imageUrl, imageWidth: width, imageHeight: height });
}

export interface PlotMapReadResult {
  read: number;
  linked: number;
  created: number;
  unmatched: string[];
  notes: string[];
}

/**
 * Has the AI read the uploaded layout: finds each plot, matches it to the project's plots by
 * number (creating the missing ones when asked) and saves the outlines for review.
 */
export async function readPlotMapLayout(projectId: string, opts: { createMissing?: boolean } = {}): Promise<PlotMapReadResult> {
  return api.post<PlotMapReadResult>(`/project-maps/${projectId}/read`, opts);
}

export interface ShapeInput {
  unitId: string | null;
  points: PlotMapPoint[];
  label?: string | null;
  source?: 'manual' | 'detected';
  confirmed?: boolean;
}

/** Saves the whole outline set at once — the editor is a canvas, so a partial save would half-move it. */
export async function savePlotMapShapes(
  projectId: string,
  shapes: ShapeInput[]
): Promise<{ saved: number; linked: number }> {
  return api.put<{ saved: number; linked: number }>(`/project-maps/${projectId}/shapes`, { shapes });
}

export async function setPlotMapStatus(projectId: string, status: 'draft' | 'live'): Promise<void> {
  await api.post(`/project-maps/${projectId}/status`, { status });
}

export async function setPlotMapSharing(
  projectId: string,
  input: { enabled: boolean; rotate?: boolean }
): Promise<{ publicEnabled: boolean; publicToken: string | null }> {
  return api.post(`/project-maps/${projectId}/share`, input);
}

/** The customer view. Unauthenticated, so it goes to a route outside the admin guard. */
export async function getPublicPlotMap(token: string): Promise<PublicPlotMap> {
  return api.get<PublicPlotMap>(`/plot-map/${token}`);
}

// ---------------------------------------------------------------------------
// Display helpers — one definition, shared by the board, the editor and the public page
// ---------------------------------------------------------------------------

export const PLOT_STATUS_LABEL: Record<PlotMapStatus, string> = {
  available: 'Available',
  onHold: 'Held',
  booked: 'Booked',
  soldOut: 'Sold',
};

export const PLOT_STATUS_ORDER: PlotMapStatus[] = ['available', 'onHold', 'booked', 'soldOut'];

/**
 * Fill / stroke per status. Hex rather than Tailwind classes because they are painted onto an
 * SVG polygon, and chosen so the four stay apart for the common kinds of colour blindness —
 * green and amber differ in lightness as well as hue, and the two dark ones differ in hue.
 */
export const PLOT_STAGES: { key: PlotStage; label: string }[] = [
  { key: 'available', label: 'Available' }, { key: 'hold', label: 'Hold' }, { key: 'token', label: 'Token' },
  { key: 'booked', label: 'Booked' }, { key: 'agreement', label: 'Agreement' }, { key: 'registered', label: 'Registered' },
  { key: 'possession', label: 'Possession' },
];

export const PLOT_STATUS_COLOR: Record<PlotMapStatus, { fill: string; stroke: string; text: string; halo: string }> = {
  available: { fill: '#12b76a', stroke: '#027a48', text: '#05492f', halo: '#ffffff' },
  onHold: { fill: '#f79009', stroke: '#b54708', text: '#6b2e05', halo: '#ffffff' },
  booked: { fill: '#2596BE', stroke: '#1d6581', text: '#0f3f52', halo: '#ffffff' },
  // Light text on a dark fill: the outline has to be dark too, or it reads as a white smear.
  soldOut: { fill: '#2b333f', stroke: '#0f131a', text: '#ffffff', halo: '#0f131a' },
};

/** An outline drawn but not yet matched to a plot has no status to colour it by. */
export const PLOT_UNLINKED_COLOR = { fill: '#98a2b3', stroke: '#667085', text: '#344054', halo: '#ffffff' };

export function polygonCentroid(points: PlotMapPoint[]): PlotMapPoint {
  const n = points.length || 1;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

export function polygonBounds(points: PlotMapPoint[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function plotKey(plot: Pick<PlotMapPlot, 'shapeId'>): string {
  return plot.shapeId;
}
