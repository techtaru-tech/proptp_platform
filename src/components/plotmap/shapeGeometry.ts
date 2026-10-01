import type { PlotMapPoint } from '../../types';
import { polygonBounds } from '../../services/plotMapService';

/** `x,y x,y …` for an SVG polygon, with the normalised points scaled to the image. */
export function toSvgPoints(points: PlotMapPoint[], width: number, height: number): string {
  return points.map(([x, y]) => `${(x * width).toFixed(1)},${(y * height).toFixed(1)}`).join(' ');
}

/**
 * A label size that fits inside its own plot.
 *
 * Sized from the plot's smaller side and then capped by its width for the label's length, so
 * "A-01" fills a roomy plot sensibly and "Block-C/114" shrinks to fit a narrow one instead of
 * spilling over its neighbours. Never below 8, which is the least that is still readable.
 */
export function labelFontSize(points: PlotMapPoint[], label: string, width: number, height: number): number {
  const box = polygonBounds(points);
  const w = box.width * width;
  const h = box.height * height;
  const byHeight = Math.min(w, h) * 0.26;
  const byWidth = (w * 0.86) / (Math.max(label.length, 2) * 0.62);
  return Math.max(8, Math.min(64, byHeight, byWidth));
}

/** Where to draw a label: the middle of the bounding box, which sits inside any convex plot. */
export function labelAnchor(points: PlotMapPoint[], width: number, height: number): [number, number] {
  const box = polygonBounds(points);
  return [((box.minX + box.maxX) / 2) * width, ((box.minY + box.maxY) / 2) * height];
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
