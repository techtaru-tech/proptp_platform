import type { PlotShape, PropertyUnit } from '@prisma/client';
import { prisma } from '../prisma';
import { PLOT_STAGES, isHoldActive, plotStage, propertyStatus, type AppPropertyStatus, type PlotStage } from './derive';
import { getPolicy } from './salesPolicy';

/**
 * The plot map's read model.
 *
 * A shape says only where a plot sits on the layout. Its colour comes from
 * `propertyStatus()` in derive.ts — the same function the app, the property list and the
 * project summary already use — so the map cannot drift from the rest of the system and
 * nobody has to "update the map" after taking a booking.
 */

/** A point as [x, y], each 0..1 of the image's width and height. */
export type NormalisedPoint = [number, number];

export function isValidPolygon(points: unknown): points is NormalisedPoint[] {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= -0.05 && n <= 1.05)
    )
  );
}

/** Clamps into the image, so a shape dragged past the edge cannot be stored off-canvas. */
export function clampPolygon(points: NormalisedPoint[]): NormalisedPoint[] {
  const clamp = (n: number) => Math.min(1, Math.max(0, Number(n.toFixed(5))));
  return points.map(([x, y]) => [clamp(x), clamp(y)] as NormalisedPoint);
}

type UnitForMap = PropertyUnit & { facings?: { key: string; value: string }[] };

/** The facing / road-width pairs are stored as rows; the map wants them as fields. */
function facingFields(unit: UnitForMap) {
  const byKey = new Map((unit.facings ?? []).map((f) => [f.key.toLowerCase(), f.value]));
  return {
    facing: byKey.get('facing') ?? byKey.get('direction') ?? null,
    roadWidth: byKey.get('road') ?? byKey.get('roadwidth') ?? byKey.get('road width') ?? null,
  };
}

export interface MapPlot {
  shapeId: string;
  unitId: string | null;
  points: NormalisedPoint[];
  source: string;
  confirmed: boolean;
  /** Null for a shape not yet linked to a unit — it has no status to show. */
  status: AppPropertyStatus | null;
  /** The fuller life-cycle stage (token, agreement, registered…). `status` stays the four-way split the app uses. */
  stage: PlotStage | null;
  label: string;
  plotNumber: string | null;
  area: string | null;
  areaValue: number | null;
  facing: string | null;
  roadWidth: string | null;
  isCorner: boolean;
  price: number;
  holdUntil: string | null;
}

/**
 * Everything the map needs, in one read.
 *
 * Holds are fetched for the whole project in a single query rather than per plot: a layout
 * with four hundred plots would otherwise issue four hundred of them to colour one screen.
 */
export async function buildMapPlots(projectId: string, shapes: PlotShape[]): Promise<MapPlot[]> {
  const unitIds = shapes.map((s) => s.unitId).filter((id): id is string => !!id);

  const [units, holds, bookings, policy] = await Promise.all([
    unitIds.length
      ? prisma.propertyUnit.findMany({
          where: { id: { in: unitIds } },
          include: { facings: { select: { key: true, value: true } } },
        })
      : Promise.resolve([] as UnitForMap[]),
    unitIds.length
      ? prisma.plotHold.findMany({
          where: { unitId: { in: unitIds }, status: 1 },
          orderBy: { holdEnd: 'desc' },
        })
      : Promise.resolve([]),
    unitIds.length
      ? prisma.booking.findMany({
          where: { propertyId: { in: unitIds }, isDeposit: 0, status: { not: 'cancelled' } },
          include: { legalFile: { include: { stages: { select: { id: true } }, registry: { select: { status: true } } } } },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
    getPolicy(),
  ]);
  // The unit's live booking: the earliest one that has not been cancelled.
  const bookingByUnit = new Map<string, (typeof bookings)[number]>();
  for (const b of bookings) if (!bookingByUnit.has(b.propertyId)) bookingByUnit.set(b.propertyId, b);

  const unitById = new Map(units.map((u) => [u.id, u as UnitForMap]));
  // Newest live hold per unit; `isHoldActive` still decides whether it counts.
  const holdByUnit = new Map<string, (typeof holds)[number]>();
  for (const hold of holds) if (!holdByUnit.has(hold.unitId)) holdByUnit.set(hold.unitId, hold);

  return shapes.map((shape) => {
    const unit = shape.unitId ? unitById.get(shape.unitId) : undefined;
    const hold = shape.unitId ? holdByUnit.get(shape.unitId) : undefined;
    const held = isHoldActive(hold);

    if (!unit) {
      return {
        shapeId: shape.id,
        unitId: null,
        points: shape.points as NormalisedPoint[],
        source: shape.source,
        confirmed: shape.confirmed,
        status: null,
        stage: null,
        label: shape.label ?? '',
        plotNumber: null,
        area: null,
        areaValue: null,
        facing: null,
        roadWidth: null,
        isCorner: false,
        price: 0,
        holdUntil: null,
      };
    }

    const { facing, roadWidth } = facingFields(unit);
    return {
      shapeId: shape.id,
      unitId: unit.id,
      points: shape.points as NormalisedPoint[],
      source: shape.source,
      confirmed: shape.confirmed,
      status: propertyStatus(unit, held),
      stage: plotStage(unit, held, bookingByUnit.get(unit.id), policy.showTokenStage),
      label: shape.label || unit.propertyNumber,
      plotNumber: unit.propertyNumber,
      area: `${unit.propertyArea} ${unit.propertyMeasurement}`.trim(),
      // Parsed for the size filter; the display string keeps whatever unit was typed.
      areaValue: Number.parseFloat(unit.propertyArea) || null,
      facing,
      roadWidth,
      isCorner: unit.isCorner,
      price: unit.totalInvestmentAmount,
      holdUntil: held && hold ? hold.holdEnd.toISOString() : null,
    };
  });
}

export interface MapCounts {
  available: number;
  onHold: number;
  booked: number;
  soldOut: number;
  unmapped: number;
  total: number;
  value: { available: number; onHold: number; booked: number; soldOut: number; total: number };
  /** The same plots counted by life-cycle stage. */
  stages: Record<PlotStage, number>;
}

/** The live counts and value managers read straight off the map. */
export function countPlots(plots: MapPlot[]): MapCounts {
  const counts: MapCounts = {
    available: 0,
    onHold: 0,
    booked: 0,
    soldOut: 0,
    unmapped: 0,
    total: 0,
    value: { available: 0, onHold: 0, booked: 0, soldOut: 0, total: 0 },
    stages: Object.fromEntries(PLOT_STAGES.map((s) => [s, 0])) as Record<PlotStage, number>,
  };

  for (const plot of plots) {
    if (!plot.status) {
      counts.unmapped += 1;
      continue;
    }
    counts[plot.status] += 1;
    if (plot.stage) counts.stages[plot.stage] += 1;
    counts.total += 1;
    counts.value[plot.status] += plot.price;
    counts.value.total += plot.price;
  }
  return counts;
}

/**
 * The customer-facing shape of a plot: where it is, how big, which way it faces, and
 * whether it can be bought. No price, no buyer, no hold detail — a shared link must not
 * leak what the internal board shows.
 */
export function toPublicPlot(plot: MapPlot) {
  return {
    id: plot.shapeId,
    points: plot.points,
    label: plot.label,
    area: plot.area,
    facing: plot.facing,
    roadWidth: plot.roadWidth,
    isCorner: plot.isCorner,
    // Held plots read as unavailable outside: a customer does not need to know it is in
    // somebody else's negotiation, only that it is not open right now.
    available: plot.status === 'available',
  };
}
