import { Router } from 'express';
import type { Prisma, ProjectCategory } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { adminBooking, adminProject, adminUnit } from '../../services/adminMappers';
import { listResult, paginateInMemory, parseListQuery } from '../../services/list';
import { aggregateProject, paidAmountFromBookings, remainingAmount } from '../../services/derive';

export const adminProjectsRouter = Router();
export const adminUnitsRouter = Router();

const CATEGORIES: ProjectCategory[] = ['residential', 'commercial', 'agricultural'];
const unitInclude = { facings: true } satisfies Prisma.PropertyUnitInclude;

/**
 * The real `projects.project_location` is one free-text field ("Vesu, Surat") with no
 * separate city column, so "city" is the segment after the last comma — the same rule the
 * frontend used, kept server-side now that filtering happens in SQL.
 */
function cityFromLocation(location: string): string {
  const parts = location.split(',');
  return (parts[parts.length - 1] ?? location).trim();
}

/** Numeric project fields arrive from a form and can be blank; blank must stay null. */
function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function projectWritable(body: Record<string, any>): Prisma.ProjectUncheckedUpdateInput {
  const data: Prisma.ProjectUncheckedUpdateInput = {};
  const copy = <K extends keyof Prisma.ProjectUncheckedUpdateInput>(key: K, transform?: (v: any) => any) => {
    if (body[key as string] !== undefined) {
      data[key] = transform ? transform(body[key as string]) : body[key as string];
    }
  };
  copy('projectName');
  copy('projectType');
  copy('projectLocation');
  copy('landArea');
  copy('projectPrice');
  copy('projectDescription');
  copy('status', Number);
  copy('sortOrder', Number);
  copy('holdReason');
  copy('banner');
  copy('thumbnail');
  copy('map');
  copy('googleLocation');
  copy('distanceMap');
  copy('layoutPlanUrl');
  copy('d3ViewLink');
  copy('d3ViewFile');
  copy('d3WalkthroughLink');
  copy('d3WalkthroughFile');
  copy('amenityIds');
  copy('gallery');
  if (body.category !== undefined && CATEGORIES.includes(body.category)) data.category = body.category;
  const lat = optionalNumber(body.latitude);
  if (lat !== undefined) data.latitude = lat;
  const lng = optionalNumber(body.longitude);
  if (lng !== undefined) data.longitude = lng;
  return data;
}

/**
 * The three certificate lists the project form edits are `ProjectFile` rows, not columns, so
 * a save reconciles them: rows whose file is no longer in the list go, files not yet stored
 * are created. Keyed on the file URL because that is what the form round-trips — an upload
 * produces a unique path, so it identifies a row as well as its id would.
 */
const FILE_KIND_BY_FIELD = {
  jdaCertificates: 'jda',
  reraCertificates: 'rera',
  constructionPhotographs: 'construction',
} as const;

async function syncProjectFiles(tx: Prisma.TransactionClient, projectId: string, body: Record<string, any>) {
  for (const [field, kind] of Object.entries(FILE_KIND_BY_FIELD)) {
    const list = body[field];
    if (!Array.isArray(list)) continue;
    const wanted = list.map((item: any) => String(item?.file ?? item)).filter(Boolean);
    const existing = await tx.projectFile.findMany({ where: { projectId, kind }, select: { id: true, file: true } });

    const stale = existing.filter((row) => !wanted.includes(row.file)).map((row) => row.id);
    if (stale.length > 0) await tx.projectFile.deleteMany({ where: { id: { in: stale } } });

    const known = new Set(existing.map((row) => row.file));
    const added = wanted.filter((file) => !known.has(file));
    if (added.length > 0) {
      await tx.projectFile.createMany({ data: added.map((file) => ({ projectId, kind, file })) });
    }
  }
}

// Must be declared before `/:id`, or "lookups" would be read as a project id.
adminProjectsRouter.get('/lookups', async (_req, res, next) => {
  try {
    const [amenities, propertyTypes, addresses, projects] = await Promise.all([
      prisma.amenity.findMany({ orderBy: { name: 'asc' } }),
      prisma.propertyTypeOption.findMany({ orderBy: { name: 'asc' } }),
      prisma.addressOption.findMany({ orderBy: { name: 'asc' } }),
      prisma.project.findMany({ select: { projectLocation: true } }),
    ]);
    res.json({
      amenities,
      propertyTypes,
      addresses,
      cities: [...new Set(projects.map((p) => cityFromLocation(p.projectLocation)))].filter(Boolean).sort(),
    });
  } catch (err) {
    next(err);
  }
});

adminProjectsRouter.get('/', async (req, res, next) => {
  try {
    const query = parseListQuery(req);
    const status = String(req.query.status ?? 'all');
    const city = String(req.query.city ?? 'all');

    const where: Prisma.ProjectWhereInput = {};
    if (status !== 'all' && status !== '') where.status = Number(status);
    if (query.search) {
      where.OR = [
        { projectName: { contains: query.search, mode: 'insensitive' } },
        { projectLocation: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    // City is derived from the free-text location, so it is filtered with a suffix match
    // rather than an equality check on a column that does not exist.
    if (city !== 'all' && city !== '') where.projectLocation = { endsWith: city, mode: 'insensitive' };

    const SORTABLE: Record<string, Prisma.ProjectOrderByWithRelationInput> = {
      projectName: { projectName: query.sortDir },
      sortOrder: { sortOrder: query.sortDir },
      updatedAt: { updatedAt: query.sortDir },
    };
    const orderBy = (query.sortBy && SORTABLE[query.sortBy]) || { sortOrder: 'asc' as const };

    const [rows, total] = await Promise.all([
      prisma.project.findMany({
        where,
        // Plot tallies are shown on every row of this list, so they are counted in the same
        // query rather than fetched per project.
        include: { files: true, units: { select: { bookingStatus: true, status: true } } },
        orderBy,
        skip: query.skip,
        take: query.take,
      }),
      prisma.project.count({ where }),
    ]);
    res.json(
      listResult(
        rows.map((project) =>
          adminProject(project, {
            total: project.units.length,
            available: project.units.filter((u) => u.bookingStatus === 0 && u.status === 1).length,
            booked: project.units.filter((u) => u.bookingStatus === 1).length,
            soldOut: project.units.filter((u) => u.bookingStatus === 2).length,
          })
        ),
        total,
        query
      )
    );
  } catch (err) {
    next(err);
  }
});

/** Everything the Project Detail page renders, in one round trip. */
adminProjectsRouter.get('/:id/detail', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const project = await prisma.project.findUnique({
      where: { id },
      include: { files: true, units: { include: unitInclude, orderBy: { propertyNumber: 'asc' } } },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const [bookings, amenities, audit] = await Promise.all([
      prisma.booking.findMany({
        where: { unit: { projectId: id } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      project.amenityIds.length
        ? prisma.amenity.findMany({ where: { id: { in: project.amenityIds } }, select: { name: true } })
        : Promise.resolve([]),
      prisma.auditEntry.findMany({ where: { recordId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);

    const agg = aggregateProject(project, project.units);
    const counts = {
      total: agg.propertyCount,
      available: agg.availableCount,
      booked: project.units.filter((u) => u.bookingStatus === 1).length,
      soldOut: project.units.filter((u) => u.bookingStatus === 2).length,
    };
    res.json({
      project: adminProject(project, counts),
      units: project.units.map(adminUnit),
      bookings: bookings.map(adminBooking),
      amenityNames: amenities.map((a) => a.name),
      counts,
      audit: audit.map((a) => ({
        id: a.id,
        userId: a.userId,
        userName: a.userName,
        action: a.action,
        module: a.module,
        recordId: a.recordId,
        recordLabel: a.recordLabel,
        timestamp: a.createdAt.toISOString(),
        description: a.description,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminProjectsRouter.get('/:id', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: { id: String(req.params.id) }, include: { files: true } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(adminProject(project));
  } catch (err) {
    next(err);
  }
});

adminProjectsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    if (!body.projectName) return res.status(400).json({ error: 'projectName is required.' });
    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          ...(projectWritable(body) as Prisma.ProjectUncheckedCreateInput),
          projectName: String(body.projectName),
          projectLocation: String(body.projectLocation ?? ''),
        },
      });
      await syncProjectFiles(tx, project.id, body);
      return tx.project.findUniqueOrThrow({ where: { id: project.id }, include: { files: true } });
    });
    await writeAudit(req, {
      module: 'Projects',
      action: 'Created project',
      recordId: created.id,
      recordLabel: created.projectName,
      description: `Project ${created.projectName} was created.`,
    });
    res.status(201).json(adminProject(created));
  } catch (err) {
    next(err);
  }
});

adminProjectsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const id = String(req.params.id);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: projectWritable(body) });
      await syncProjectFiles(tx, id, body);
      return tx.project.findUniqueOrThrow({ where: { id }, include: { files: true } });
    });
    await writeAudit(req, {
      module: 'Projects',
      action: 'Updated project',
      recordId: updated.id,
      recordLabel: updated.projectName,
      description: `Project ${updated.projectName} was updated.`,
    });
    res.json(adminProject(updated));
  } catch (err) {
    next(err);
  }
});

adminProjectsRouter.post('/:id/toggle-status', async (req: AuthedRequest, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: { id: String(req.params.id) } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const nextStatus = project.status === 1 ? 0 : 1;
    const updated = await prisma.project.update({
      where: { id: project.id },
      // Deactivating is what the app reads as onHold, so a reason can be captured with it;
      // reactivating always clears the reason.
      data: {
        status: nextStatus,
        holdReason: nextStatus === 0 ? (req.body?.holdReason ? String(req.body.holdReason) : project.holdReason) : null,
      },
      include: { files: true },
    });
    await writeAudit(req, {
      module: 'Projects',
      action: nextStatus === 1 ? 'Activated project' : 'Deactivated project',
      recordId: updated.id,
      recordLabel: updated.projectName,
      description: `Project ${updated.projectName} was ${nextStatus === 1 ? 'activated' : 'deactivated'}.`,
    });
    res.json(adminProject(updated));
  } catch (err) {
    next(err);
  }
});

/** Project media/certificate rows (JDA, RERA, construction photos). */
adminProjectsRouter.post('/:id/files', async (req: AuthedRequest, res, next) => {
  try {
    const kind = String(req.body?.kind ?? '');
    if (!['jda', 'rera', 'construction'].includes(kind)) {
      return res.status(400).json({ error: 'kind must be jda, rera or construction.' });
    }
    if (!req.body?.file) return res.status(400).json({ error: 'file is required.' });
    const created = await prisma.projectFile.create({
      data: {
        projectId: String(req.params.id),
        kind: kind as 'jda' | 'rera' | 'construction',
        file: String(req.body.file),
        caption: req.body.caption ? String(req.body.caption) : null,
        isVideo: !!req.body.isVideo,
        capturedOn: req.body.capturedOn ? new Date(String(req.body.capturedOn)) : null,
      },
    });
    res.status(201).json({ id: created.id, file: created.file });
  } catch (err) {
    next(err);
  }
});

adminProjectsRouter.delete('/files/:fileId', async (req, res, next) => {
  try {
    await prisma.projectFile.delete({ where: { id: String(req.params.fileId) } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminProjectsRouter.get('/:id/units', async (req, res, next) => {
  try {
    const bookingStatus = String(req.query.bookingStatus ?? 'all');
    const search = String(req.query.search ?? '').trim();
    const where: Prisma.PropertyUnitWhereInput = { projectId: String(req.params.id) };
    if (bookingStatus !== 'all' && bookingStatus !== '') where.bookingStatus = Number(bookingStatus);
    if (search) {
      where.OR = [
        { propertyNumber: { contains: search, mode: 'insensitive' } },
        { propertyTitle: { contains: search, mode: 'insensitive' } },
        { propertyType: { contains: search, mode: 'insensitive' } },
      ];
    }
    const units = await prisma.propertyUnit.findMany({ where, include: unitInclude, orderBy: { propertyNumber: 'asc' } });
    res.json({ units: units.map(adminUnit) });
  } catch (err) {
    next(err);
  }
});

/** Mirrors the real BulkPriceController — only unbooked, active units may be repriced. */
adminProjectsRouter.get('/:id/bulk-priceable', async (req, res, next) => {
  try {
    const units = await prisma.propertyUnit.findMany({
      where: { projectId: String(req.params.id), bookedById: null, status: 1 },
      include: unitInclude,
      orderBy: { propertyNumber: 'asc' },
    });
    res.json({ units: units.map(adminUnit) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Units (flat, across all projects) — the real `admin.propertyList`
// ---------------------------------------------------------------------------

function unitWritable(body: Record<string, any>): Prisma.PropertyUnitUncheckedUpdateInput {
  const data: Prisma.PropertyUnitUncheckedUpdateInput = {};
  const strings = [
    'propertyTitle', 'propertyNumber', 'propertyType', 'propertyArea', 'propertyMeasurement',
    'width', 'length', 'details', 'location', 'thumbnail', 'sitePlan', 'constructedArea', 'addressId',
  ] as const;
  for (const key of strings) if (body[key] !== undefined) (data as any)[key] = body[key];

  const numbers = [
    'status', 'bookingStatus', 'perAreaAmount', 'perAreaProfit',
    'totalInvestmentAmount', 'profit', 'charges', 'gstAndRegistration', 'tokenAmount',
  ] as const;
  for (const key of numbers) if (body[key] !== undefined) (data as any)[key] = Math.round(Number(body[key]) || 0);

  const booleans = ['isCorner', 'isFeatured', 'isVerified'] as const;
  for (const key of booleans) if (body[key] !== undefined) (data as any)[key] = !!body[key];

  if (body.images !== undefined) data.images = body.images;
  if (body.amenityIds !== undefined) data.amenityIds = body.amenityIds;
  return data;
}

/** Facings are a full replace, matching how the repeater on the unit form submits. */
async function replaceFacings(unitId: string, facings: unknown) {
  if (!Array.isArray(facings)) return;
  await prisma.plotFacing.deleteMany({ where: { unitId } });
  const rows = facings
    .filter((f: any) => f?.key)
    .map((f: any) => ({ unitId, key: String(f.key), value: String(f.value ?? '') }));
  if (rows.length) await prisma.plotFacing.createMany({ data: rows });
}

adminUnitsRouter.get('/', async (req, res, next) => {
  try {
    const query = parseListQuery(req);
    const projectId = String(req.query.projectId ?? 'all');
    const bookingStatus = String(req.query.bookingStatus ?? 'all');

    const where: Prisma.PropertyUnitWhereInput = {};
    if (projectId !== 'all' && projectId !== '') where.projectId = projectId;
    if (bookingStatus !== 'all' && bookingStatus !== '') where.bookingStatus = Number(bookingStatus);
    if (query.search) {
      where.OR = [
        { propertyNumber: { contains: query.search, mode: 'insensitive' } },
        { propertyTitle: { contains: query.search, mode: 'insensitive' } },
        { propertyType: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const SORTABLE: Record<string, Prisma.PropertyUnitOrderByWithRelationInput> = {
      totalInvestmentAmount: { totalInvestmentAmount: query.sortDir },
      updatedAt: { updatedAt: query.sortDir },
      propertyNumber: { propertyNumber: query.sortDir },
    };
    const orderBy = (query.sortBy && SORTABLE[query.sortBy]) || { createdAt: 'desc' as const };

    const [rows, total] = await Promise.all([
      prisma.propertyUnit.findMany({ where, include: unitInclude, orderBy, skip: query.skip, take: query.take }),
      prisma.propertyUnit.count({ where }),
    ]);
    res.json(listResult(rows.map(adminUnit), total, query));
  } catch (err) {
    next(err);
  }
});

adminUnitsRouter.get('/:id', async (req, res, next) => {
  try {
    const unit = await prisma.propertyUnit.findUnique({ where: { id: String(req.params.id) }, include: unitInclude });
    if (!unit) return res.status(404).json({ error: 'Property not found' });
    res.json(adminUnit(unit));
  } catch (err) {
    next(err);
  }
});

adminUnitsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    if (!body.projectId) return res.status(400).json({ error: 'projectId is required.' });
    const project = await prisma.project.findUnique({ where: { id: String(body.projectId) }, select: { projectName: true } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const created = await prisma.propertyUnit.create({
      data: {
        ...(unitWritable(body) as Prisma.PropertyUnitUncheckedCreateInput),
        projectId: String(body.projectId),
        propertyTitle: String(body.propertyTitle ?? `${project.projectName} — Plot`),
        propertyNumber: String(body.propertyNumber ?? ''),
      },
    });
    await replaceFacings(created.id, body.plotFacings);
    await writeAudit(req, {
      module: 'Properties',
      action: 'Created property',
      recordId: created.id,
      recordLabel: `${created.propertyNumber} · ${created.propertyTitle}`,
      description: `Plot ${created.propertyNumber} was added to ${project.projectName}.`,
    });
    const withFacings = await prisma.propertyUnit.findUniqueOrThrow({ where: { id: created.id }, include: unitInclude });
    res.status(201).json(adminUnit(withFacings));
  } catch (err) {
    next(err);
  }
});

adminUnitsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const updated = await prisma.propertyUnit.update({ where: { id }, data: unitWritable(req.body ?? {}) });
    await replaceFacings(id, req.body?.plotFacings);
    await writeAudit(req, {
      module: 'Properties',
      action: 'Updated property',
      recordId: id,
      recordLabel: `${updated.propertyNumber} · ${updated.propertyTitle}`,
      description: `Plot ${updated.propertyNumber} was updated.`,
    });
    const withFacings = await prisma.propertyUnit.findUniqueOrThrow({ where: { id }, include: unitInclude });
    res.json(adminUnit(withFacings));
  } catch (err) {
    next(err);
  }
});

adminUnitsRouter.post('/:id/toggle-status', async (req: AuthedRequest, res, next) => {
  try {
    const unit = await prisma.propertyUnit.findUnique({ where: { id: String(req.params.id) } });
    if (!unit) return res.status(404).json({ error: 'Property not found' });
    const updated = await prisma.propertyUnit.update({
      where: { id: unit.id },
      data: { status: unit.status === 1 ? 0 : 1 },
      include: unitInclude,
    });
    res.json(adminUnit(updated));
  } catch (err) {
    next(err);
  }
});

adminUnitsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const unit = await prisma.propertyUnit.findUnique({
      where: { id },
      include: { _count: { select: { bookings: true } } },
    });
    if (!unit) return res.status(404).json({ error: 'Property not found' });
    // Deleting a plot would cascade away real booking and investment history, so a plot
    // that has ever been booked can only be released (see /bookings/units/:id/free).
    if (unit._count.bookings > 0) {
      return res.status(409).json({ error: 'This property has bookings against it and cannot be deleted.' });
    }
    await prisma.propertyUnit.delete({ where: { id } });
    await writeAudit(req, {
      module: 'Properties',
      action: 'Deleted property',
      recordId: id,
      recordLabel: `${unit.propertyNumber} · ${unit.propertyTitle}`,
      description: `Plot ${unit.propertyNumber} was deleted.`,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminUnitsRouter.post('/bulk-price', async (req: AuthedRequest, res, next) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.json({ updated: 0 });

    // Only unbooked plots are repriceable, enforced here and not just in the UI.
    const ids = rows.map((r: any) => String(r.unitId));
    const eligible = await prisma.propertyUnit.findMany({
      where: { id: { in: ids }, bookedById: null },
      select: { id: true },
    });
    const eligibleIds = new Set(eligible.map((u) => u.id));

    const updates = rows
      .filter((r: any) => eligibleIds.has(String(r.unitId)))
      .map((r: any) =>
        prisma.propertyUnit.update({
          where: { id: String(r.unitId) },
          data: {
            totalInvestmentAmount: Math.round(Number(r.totalInvestmentAmount) || 0),
            perAreaAmount: Math.round(Number(r.perAreaAmount) || 0),
          },
        })
      );
    await prisma.$transaction(updates);
    await writeAudit(req, {
      module: 'Properties',
      action: 'Bulk price update',
      recordId: 'bulk',
      recordLabel: `${updates.length} properties`,
      description: `Pricing updated for ${updates.length} unbooked propert${updates.length === 1 ? 'y' : 'ies'}.`,
    });
    res.json({ updated: updates.length });
  } catch (err) {
    next(err);
  }
});

/**
 * The "Remaining Payments" list. `remainingAmount` is derived, so it cannot be an SQL
 * sort — the rows are built first and then sorted/paged in memory.
 */
adminUnitsRouter.get('/reports/remaining-payments', async (req, res, next) => {
  try {
    const query = parseListQuery(req);
    const units = await prisma.propertyUnit.findMany({
      where: { bookings: { some: {} } },
      include: {
        bookings: { orderBy: { createdAt: 'asc' } },
        project: { select: { projectName: true } },
      },
    });

    const rows = units
      .map((unit) => {
        const primary = unit.bookings.find((b) => b.isDeposit === 0) ?? unit.bookings[0];
        if (!primary) return null;
        const paidAmount = paidAmountFromBookings(unit.bookings);
        return {
          booking: adminBooking(primary),
          projectName: unit.project.projectName,
          unitLabel: `${unit.propertyNumber} · ${unit.propertyTitle}`,
          totalAmount: unit.totalInvestmentAmount,
          paidAmount,
          remainingAmount: remainingAmount(unit.totalInvestmentAmount, paidAmount),
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r && r.remainingAmount > 0)
      .filter((r) =>
        !query.search ||
        r.booking.bookingName.toLowerCase().includes(query.search.toLowerCase()) ||
        r.booking.reference.toLowerCase().includes(query.search.toLowerCase())
      );

    res.json(
      paginateInMemory(rows, query, (a, b, sortBy) =>
        sortBy === 'remainingAmount' ? a.remainingAmount - b.remainingAmount : 0
      )
    );
  } catch (err) {
    next(err);
  }
});
