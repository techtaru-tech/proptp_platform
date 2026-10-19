import { Router } from 'express';
import { prisma } from '../../prisma';
import type { AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import {
  buildMapPlots,
  clampPolygon,
  countPlots,
  isValidPolygon,
  toPublicPlot,
  type NormalisedPoint,
} from '../../services/plotMap';
import { PlotMapReadError, readAndApply } from '../../services/plotMapReader';

/**
 * Plot map — /api/project-maps.
 *
 * The map holds geometry only. Every status and count on it is derived from the units and
 * their holds on each read (services/plotMap.ts), so there is no second copy of a plot's
 * state to keep in step.
 */
export const adminProjectMapsRouter = Router();

/** The customer-facing map. Mounted outside the admin guard — see index.ts. */
export const publicPlotMapRouter = Router();

async function loadMap(projectId: string) {
  return prisma.projectMap.findUnique({
    where: { projectId },
    include: { shapes: { orderBy: { createdAt: 'asc' } } },
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

adminProjectMapsRouter.get('/:projectId', async (req, res, next) => {
  try {
    const projectId = String(req.params.projectId);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, projectName: true, projectLocation: true, layoutPlanUrl: true, map: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const map = await loadMap(projectId);
    if (!map) {
      // No layout uploaded yet. The editor still needs the project and its units to work with.
      return res.json({ project, map: null, plots: [], counts: null, unmappedUnits: await unmappedUnits(projectId, []) });
    }

    const plots = await buildMapPlots(projectId, map.shapes);
    const mappedUnitIds = map.shapes.map((s) => s.unitId).filter((id): id is string => !!id);

    res.json({
      project,
      map: {
        id: map.id,
        imageUrl: map.imageUrl,
        imageWidth: map.imageWidth,
        imageHeight: map.imageHeight,
        status: map.status,
        version: map.version,
        publicEnabled: map.publicEnabled,
        publicToken: map.publicEnabled ? map.publicToken : null,
        updatedAt: map.updatedAt.toISOString(),
      },
      plots,
      counts: countPlots(plots),
      unmappedUnits: await unmappedUnits(projectId, mappedUnitIds),
    });
  } catch (err) {
    next(err);
  }
});

/** Units in this project that no shape points at yet — what the editor offers to link. */
async function unmappedUnits(projectId: string, mappedUnitIds: string[]) {
  const units = await prisma.propertyUnit.findMany({
    where: { projectId, id: { notIn: mappedUnitIds.length ? mappedUnitIds : ['__none__'] } },
    select: { id: true, propertyNumber: true, propertyArea: true, propertyMeasurement: true },
    orderBy: { propertyNumber: 'asc' },
  });
  return units.map((u) => ({
    id: u.id,
    propertyNumber: u.propertyNumber,
    area: `${u.propertyArea} ${u.propertyMeasurement}`.trim(),
  }));
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Upload or replace the layout.
 *
 * A replacement keeps every shape: points are normalised to the image, so a revised plan at
 * a different resolution leaves them where they were, and the units they point at — with
 * their bookings — are untouched. The map drops back to draft so somebody checks the fit.
 */
adminProjectMapsRouter.post('/:projectId', async (req: AuthedRequest, res, next) => {
  try {
    const projectId = String(req.params.projectId);
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, projectName: true } });
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const imageUrl = String(req.body?.imageUrl ?? '').trim();
    const imageWidth = Number(req.body?.imageWidth);
    const imageHeight = Number(req.body?.imageHeight);
    if (!imageUrl) return res.status(400).json({ error: 'Upload a layout image first.' });
    if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
      return res.status(400).json({ error: 'The layout image size is missing.' });
    }

    const existing = await prisma.projectMap.findUnique({ where: { projectId } });
    const map = existing
      ? await prisma.projectMap.update({
          where: { projectId },
          data: { imageUrl, imageWidth, imageHeight, status: 'draft', version: { increment: 1 } },
        })
      : await prisma.projectMap.create({ data: { projectId, imageUrl, imageWidth, imageHeight } });

    await writeAudit(req, {
      module: 'Properties',
      action: existing ? 'Replaced plot map layout' : 'Uploaded plot map layout',
      recordId: projectId,
      recordLabel: project.projectName,
      description: existing
        ? `Layout replaced (version ${map.version}); ${await prisma.plotShape.count({ where: { mapId: map.id } })} shapes kept.`
        : 'Layout uploaded.',
    });

    res.status(existing ? 200 : 201).json({ id: map.id, version: map.version, status: map.status });
  } catch (err) {
    next(err);
  }
});

/**
 * Replace the whole shape set — what the editor saves.
 *
 * Sent as a set rather than per-shape edits because the editor is a canvas: drawing,
 * moving and deleting happen together, and a partial save would leave the map half-moved.
 */
adminProjectMapsRouter.put('/:projectId/shapes', async (req: AuthedRequest, res, next) => {
  try {
    const projectId = String(req.params.projectId);
    const map = await prisma.projectMap.findUnique({ where: { projectId } });
    if (!map) return res.status(404).json({ error: 'Upload a layout for this project first.' });

    const incoming = Array.isArray(req.body?.shapes) ? req.body.shapes : null;
    if (!incoming) return res.status(400).json({ error: 'shapes must be an array.' });

    // Validated up front, so a bad polygon cannot leave the map half-written.
    const cleaned: { unitId: string | null; points: NormalisedPoint[]; label: string | null; source: string; confirmed: boolean }[] = [];
    const seenUnits = new Set<string>();
    for (const raw of incoming) {
      if (!isValidPolygon(raw?.points)) {
        return res.status(400).json({ error: 'Every shape needs at least three points inside the image.' });
      }
      const unitId = raw?.unitId ? String(raw.unitId) : null;
      if (unitId) {
        if (seenUnits.has(unitId)) {
          return res.status(400).json({ error: 'Two shapes point at the same plot. Each plot can be marked once.' });
        }
        seenUnits.add(unitId);
      }
      cleaned.push({
        unitId,
        points: clampPolygon(raw.points),
        label: raw?.label ? String(raw.label).slice(0, 60) : null,
        source: raw?.source === 'detected' ? 'detected' : 'manual',
        confirmed: !!raw?.confirmed,
      });
    }

    // Every unit must belong to this project — a shape cannot borrow another project's plot.
    if (seenUnits.size) {
      const valid = await prisma.propertyUnit.count({ where: { projectId, id: { in: [...seenUnits] } } });
      if (valid !== seenUnits.size) {
        return res.status(400).json({ error: 'One of those plots does not belong to this project.' });
      }
    }

    await prisma.$transaction([
      prisma.plotShape.deleteMany({ where: { mapId: map.id } }),
      prisma.plotShape.createMany({ data: cleaned.map((s) => ({ ...s, mapId: map.id, points: s.points })) }),
    ]);

    await writeAudit(req, {
      module: 'Properties',
      action: 'Updated plot map',
      recordId: projectId,
      recordLabel: 'Plot map',
      description: `${cleaned.length} plot shape(s) saved, ${seenUnits.size} linked to a plot.`,
    });

    res.json({ saved: cleaned.length, linked: seenUnits.size });
  } catch (err) {
    next(err);
  }
});

/**
 * Read the uploaded layout with the AI: finds every plot, matches it to the project's plot by
 * number, and saves the outlines as unconfirmed shapes for review. With createMissing, a plot the
 * project does not have yet is created from what the layout prints (number, area, sides).
 */
adminProjectMapsRouter.post('/:projectId/read', async (req: AuthedRequest, res, next) => {
  try {
    const projectId = String(req.params.projectId);
    const existing = await prisma.propertyUnit.count({ where: { projectId } });
    // A project with no plots yet is being set up from this layout, so creating them is the point;
    // one that already has its plots is only matched, unless the caller says otherwise.
    const createMissing = req.body?.createMissing === undefined ? existing === 0 : !!req.body.createMissing;
    const result = await readAndApply(projectId, { createMissing });

    await writeAudit(req, {
      module: 'Properties',
      action: 'Read plot map layout with AI',
      recordId: projectId,
      recordLabel: 'Plot map',
      description: `${result.read} plot(s) read, ${result.linked} linked, ${result.created} created.`,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof PlotMapReadError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/** Draft ⇄ live. Only a live map is shown outside the editor. */
adminProjectMapsRouter.post('/:projectId/status', async (req: AuthedRequest, res, next) => {
  try {
    const projectId = String(req.params.projectId);
    const status = req.body?.status === 'live' ? 'live' : 'draft';
    const map = await prisma.projectMap.findUnique({ where: { projectId }, include: { shapes: true } });
    if (!map) return res.status(404).json({ error: 'No layout for this project yet.' });

    if (status === 'live' && !map.shapes.some((s) => s.unitId)) {
      return res.status(400).json({ error: 'Link at least one shape to a plot before going live.' });
    }

    await prisma.projectMap.update({ where: { projectId }, data: { status } });
    await writeAudit(req, {
      module: 'Properties',
      action: status === 'live' ? 'Published plot map' : 'Took plot map off live',
      recordId: projectId,
      recordLabel: 'Plot map',
      description: '',
    });
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

/** Turn the shareable customer view on or off, and rotate the link. */
adminProjectMapsRouter.post('/:projectId/share', async (req: AuthedRequest, res, next) => {
  try {
    const projectId = String(req.params.projectId);
    const map = await prisma.projectMap.findUnique({ where: { projectId } });
    if (!map) return res.status(404).json({ error: 'No layout for this project yet.' });

    const enabled = !!req.body?.enabled;
    const rotate = !!req.body?.rotate;
    const updated = await prisma.projectMap.update({
      where: { projectId },
      data: {
        publicEnabled: enabled,
        // A rotated token makes every link handed out so far stop working, which is the
        // only way to take a shared map back.
        ...(rotate ? { publicToken: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}` } : {}),
      },
    });

    await writeAudit(req, {
      module: 'Properties',
      action: rotate ? 'Rotated plot map share link' : enabled ? 'Enabled plot map sharing' : 'Disabled plot map sharing',
      recordId: projectId,
      recordLabel: 'Plot map',
      description: '',
    });

    res.json({ publicEnabled: updated.publicEnabled, publicToken: updated.publicEnabled ? updated.publicToken : null });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Customer-facing view — public by necessity, so it is deliberately thin
// ---------------------------------------------------------------------------

// Never cached, by the browser or by anything between it and us. The page is live availability
// behind a link that can be switched off, so a stale copy would show a plot as open after it
// sold, or keep a withdrawn map reachable after sharing was turned off.
publicPlotMapRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

publicPlotMapRouter.get('/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token);
    const map = await prisma.projectMap.findUnique({
      where: { publicToken: token },
      include: { shapes: true, project: { select: { id: true, projectName: true, projectLocation: true } } },
    });
    // A disabled or draft map is indistinguishable from one that never existed.
    if (!map || !map.publicEnabled || map.status !== 'live') {
      return res.status(404).json({ error: 'This map is not available.' });
    }

    const plots = await buildMapPlots(map.projectId, map.shapes);
    const counts = countPlots(plots);

    res.json({
      project: { name: map.project.projectName, location: map.project.projectLocation },
      image: { url: map.imageUrl, width: map.imageWidth, height: map.imageHeight },
      plots: plots.filter((p) => p.unitId).map(toPublicPlot),
      summary: { available: counts.available, total: counts.total },
    });
  } catch (err) {
    next(err);
  }
});
