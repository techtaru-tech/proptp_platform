import type { PlotMapBundle, PlotMapPlot, PlotMapPoint, PlotMapStatus, PublicPlotMap } from '../types';
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

/**
 * Upload a layout, or replace the current one. A replacement keeps every outline — they are
 * stored relative to the image — and drops the map back to draft so somebody checks the fit.
 */
export async function uploadPlotMapLayout(projectId: string, file: File): Promise<void> {
  if (file.type === 'application/pdf') {
    throw new Error('Export the layout as a PNG or JPG first — PDF layouts cannot be drawn on yet.');
  }
  const { width, height } = await imageSize(file);
  const [imageUrl] = await uploadFiles([file]);
  await api.post(`/project-maps/${projectId}`, { imageUrl, imageWidth: width, imageHeight: height });
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
export const PLOT_STATUS_COLOR: Record<PlotMapStatus, { fill: string; stroke: string; text: string; halo: string }> = {
  available: { fill: '#12b76a', stroke: '#027a48', text: '#05492f', halo: '#ffffff' },
  onHold: { fill: '#f79009', stroke: '#b54708', text: '#6b2e05', halo: '#ffffff' },
  booked: { fill: '#2596BE', stroke: '#1d6581', text: '#0f3f52', halo: '#ffffff' },
  // Light text on a dark fill: the outline has to be dark too, or it reads as a white smear.
  soldOut: { fill: '#652251', stroke: '#411534', text: '#ffffff', halo: '#411534' },
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
