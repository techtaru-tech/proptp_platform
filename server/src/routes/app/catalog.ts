import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { requireAuth } from '../../services/auth';
import { appProjectDetail, appProjectSummary, appProperty } from '../../services/appMappers';
import { APP_VISIBLE_PROJECT, aggregateProject } from '../../services/derive';

/** API docs §3 — projects (land layouts) and properties (plots). */
export const appProjectsRouter = Router();
export const appPropertiesRouter = Router();

appProjectsRouter.use(requireAuth);
appPropertiesRouter.use(requireAuth);

/**
 * The unit fields both project shapes need. Holds and facings are included because the
 * app's `status` and `facing` are derived from them (see services/derive.ts).
 */
const unitInclude = {
  facings: true,
  holds: { where: { status: 1 }, select: { status: true, holdEnd: true } },
} satisfies Prisma.PropertyUnitInclude;

// §3.1 GET /projects?category=&status=
appProjectsRouter.get('/', async (req, res, next) => {
  try {
    const category = String(req.query.category ?? '').trim();
    const status = String(req.query.status ?? '').trim();

    const where: Prisma.ProjectWhereInput = { ...APP_VISIBLE_PROJECT };
    if (category === 'residential' || category === 'commercial' || category === 'agricultural') {
      where.category = category;
    }
    // The remaining statuses (`open` / `soldOut`) are derived from the project's units, so
    // they cannot be a SQL filter and are applied after aggregation. `status=onHold` now
    // matches nothing, because a deactivated project is hidden rather than flagged.

    const projects = await prisma.project.findMany({
      where,
      include: { units: { include: unitInclude } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    const summaries = projects
      .map(appProjectSummary)
      .filter((p) => !status || p.status === status);

    res.json({ projects: summaries });
  } catch (err) {
    next(err);
  }
});

// §3.2 GET /projects/{id} — full detail, including every plot
appProjectsRouter.get('/:id', async (req, res, next) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: String(req.params.id), ...APP_VISIBLE_PROJECT },
      include: { units: { include: unitInclude, orderBy: { propertyNumber: 'asc' } }, files: true },
    });
    if (!project) {
      return res.status(404).json({ error: { code: 'project_not_found', message: 'That project could not be found.' } });
    }
    const amenities = project.amenityIds.length
      ? await prisma.amenity.findMany({ where: { id: { in: project.amenityIds } }, select: { name: true } })
      : [];
    res.json(appProjectDetail(project, amenities.map((a) => a.name)));
  } catch (err) {
    next(err);
  }
});

// §3.3 GET /properties/{id} — single plot
appPropertiesRouter.get('/:id', async (req, res, next) => {
  try {
    // A plot in a deactivated project answers exactly like an unknown id, so a stale
    // deep link cannot reach hidden inventory.
    const unit = await prisma.propertyUnit.findFirst({
      where: { id: String(req.params.id), project: APP_VISIBLE_PROJECT },
      include: { ...unitInclude, project: { select: { projectName: true } } },
    });
    if (!unit) {
      return res.status(404).json({ error: { code: 'property_not_found', message: 'That plot could not be found.' } });
    }
    res.json(appProperty(unit, unit.project.projectName));
  } catch (err) {
    next(err);
  }
});

/**
 * Not in the doc: a flat plot list filtered by project, so the app can page through a
 * large layout without pulling the whole §3.2 payload. `GET /projects/{id}` already
 * embeds every plot, so this is purely an optimisation for big projects.
 */
appPropertiesRouter.get('/', async (req, res, next) => {
  try {
    const projectId = String(req.query.project_id ?? '').trim();
    if (!projectId) {
      return res.status(400).json({ error: { code: 'missing_project_id', message: 'project_id is required.' } });
    }
    const project = await prisma.project.findFirst({
      where: { id: projectId, ...APP_VISIBLE_PROJECT },
      select: { projectName: true, status: true, holdReason: true, units: { include: unitInclude } },
    });
    if (!project) {
      return res.status(404).json({ error: { code: 'project_not_found', message: 'That project could not be found.' } });
    }
    const agg = aggregateProject(project, project.units);
    res.json({
      properties: project.units.map((u) => appProperty(u, project.projectName)),
      available_count: agg.availableCount,
      property_count: agg.propertyCount,
    });
  } catch (err) {
    next(err);
  }
});
