import { Router } from 'express';
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { ROLE_BY_ID, adminAttendance } from '../../services/adminMappers';
import { listResult, parseListQuery } from '../../services/list';
import { dayKey, dayKeyFromString } from '../../services/dates';
import { getAssignedLocation, getPolicy, upsertMark } from '../../services/attendance';

export const adminAttendanceRouter = Router();

const recordInclude = { user: { select: { name: true, role: true } } } satisfies Prisma.AttendanceRecordInclude;

/**
 * `status` is derived (see adminMappers.attendanceStatus), so it is filtered on the two
 * columns it is derived FROM rather than on a column that does not exist.
 */
function statusFilter(status: string): Prisma.AttendanceRecordWhereInput {
  switch (status) {
    case 'checked_out':
      return { syncStatus: 'synced', checkInAt: { not: null }, checkOutAt: { not: null } };
    case 'checked_in':
      return { syncStatus: 'synced', checkInAt: { not: null }, checkOutAt: null };
    case 'not_checked_in':
      return { syncStatus: 'synced', checkInAt: null };
    case 'pending_sync':
      return { syncStatus: 'pending' };
    case 'failed':
      return { syncStatus: 'failed' };
    default:
      return {};
  }
}

function buildWhere(req: AuthedRequest, search: string): Prisma.AttendanceRecordWhereInput {
  const where: Prisma.AttendanceRecordWhereInput = {};
  const status = String(req.query.status ?? 'all');
  const role = String(req.query.role ?? 'all');
  const locationStatus = String(req.query.locationStatus ?? 'all');
  const syncStatus = String(req.query.syncStatus ?? 'all');
  const dateFrom = String(req.query.dateFrom ?? '');
  const dateTo = String(req.query.dateTo ?? '');
  const userId = String(req.query.userId ?? '');

  Object.assign(where, statusFilter(status !== 'all' ? status : ''));

  // Role and name both filter the related user, so they are collected and applied once.
  const userWhere: Prisma.UserWhereInput = {};
  if (role !== 'all' && role !== '') userWhere.role = ROLE_BY_ID[Number(role)] as UserRole;
  if (locationStatus !== 'all' && locationStatus !== '') {
    where.geoFenceResult = locationStatus as Prisma.EnumGeoFenceResultFilter['equals'];
  }
  if (syncStatus !== 'all' && syncStatus !== '') {
    where.syncStatus = syncStatus as Prisma.EnumAttendanceSyncStatusFilter['equals'];
  }
  if (userId) where.userId = userId;
  if (dateFrom || dateTo) {
    where.date = {
      ...(dateFrom ? { gte: dayKeyFromString(dateFrom.slice(0, 10)) } : {}),
      ...(dateTo ? { lte: dayKeyFromString(dateTo.slice(0, 10)) } : {}),
    };
  }
  if (search) userWhere.name = { contains: search, mode: 'insensitive' };
  if (Object.keys(userWhere).length > 0) where.user = userWhere;
  return where;
}

adminAttendanceRouter.get('/today', async (_req, res, next) => {
  try {
    const records = await prisma.attendanceRecord.findMany({
      where: { date: dayKey() },
      include: recordInclude,
      orderBy: { user: { name: 'asc' } },
    });
    res.json({ records: records.map(adminAttendance) });
  } catch (err) {
    next(err);
  }
});

adminAttendanceRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const where = buildWhere(req, query.search);
    const orderBy: Prisma.AttendanceRecordOrderByWithRelationInput =
      query.sortBy === 'userName' ? { user: { name: query.sortDir } } : { date: query.sortBy === 'date' ? query.sortDir : 'desc' };

    const [rows, total] = await Promise.all([
      prisma.attendanceRecord.findMany({ where, include: recordInclude, orderBy, skip: query.skip, take: query.take }),
      prisma.attendanceRecord.count({ where }),
    ]);
    res.json(listResult(rows.map(adminAttendance), total, query));
  } catch (err) {
    next(err);
  }
});

adminAttendanceRouter.get('/pending-sync', async (_req, res, next) => {
  try {
    const rows = await prisma.attendanceRecord.findMany({
      where: { syncStatus: 'pending' },
      include: recordInclude,
      orderBy: { date: 'desc' },
      take: 100,
    });
    res.json({ records: rows.map(adminAttendance) });
  } catch (err) {
    next(err);
  }
});

adminAttendanceRouter.get('/failed', async (_req, res, next) => {
  try {
    const rows = await prisma.attendanceRecord.findMany({
      where: { syncStatus: 'failed' },
      include: recordInclude,
      orderBy: { date: 'desc' },
      take: 100,
    });
    res.json({ records: rows.map(adminAttendance) });
  } catch (err) {
    next(err);
  }
});

adminAttendanceRouter.get('/corrections', async (_req, res, next) => {
  try {
    const rows = await prisma.attendanceRecord.findMany({
      where: { correctionRequested: true },
      include: recordInclude,
      orderBy: [{ correctionStatus: 'asc' }, { date: 'desc' }],
    });
    res.json({ records: rows.map(adminAttendance) });
  } catch (err) {
    next(err);
  }
});

adminAttendanceRouter.post('/:id/correction', async (req: AuthedRequest, res, next) => {
  try {
    const decision = String(req.body?.decision ?? '');
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approved or rejected.' });
    }
    const record = await prisma.attendanceRecord.update({
      where: { id: String(req.params.id) },
      data: { correctionStatus: decision as 'approved' | 'rejected' },
      include: recordInclude,
    });
    await writeAudit(req, {
      module: 'Attendance',
      action: decision === 'approved' ? 'Approved correction request' : 'Rejected correction request',
      recordId: record.id,
      recordLabel: `${record.user.name} — ${record.date.toISOString().slice(0, 10)}`,
      description: `Attendance correction for ${record.user.name} was ${decision}.`,
    });
    res.json(adminAttendance(record));
  } catch (err) {
    next(err);
  }
});

/** Lets an admin fix or enter a day's marks directly, through the same rules the app uses. */
adminAttendanceRouter.post('/manual', async (req: AuthedRequest, res, next) => {
  try {
    const userId = String(req.body?.userId ?? '');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const actor = req.auth ? await prisma.user.findUnique({ where: { id: req.auth.sub }, select: { name: true } }) : null;
    const record = await upsertMark(userId, {
      date: req.body?.date,
      checkInAt: req.body?.checkInAt,
      checkOutAt: req.body?.checkOutAt,
      checkInLocation: req.body?.checkInLocation,
      checkOutLocation: req.body?.checkOutLocation,
      markedBy: actor?.name ?? 'Admin',
      device: 'Admin panel',
    });
    await writeAudit(req, {
      module: 'Attendance',
      action: 'Entered attendance manually',
      recordId: record.id,
      recordLabel: `${user.name} — ${record.date.toISOString().slice(0, 10)}`,
      description: `Attendance for ${user.name} was entered by an admin.`,
    });
    const withUser = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: record.id }, include: recordInclude });
    res.json(adminAttendance(withUser));
  } catch (err) {
    next(err);
  }
});

adminAttendanceRouter.get('/policy', async (_req, res, next) => {
  try {
    const policy = await getPolicy();
    res.json({
      officeLat: policy.officeLat,
      officeLng: policy.officeLng,
      geoFenceRadiusMeters: policy.geoFenceRadiusMeters,
      workStartTime: policy.workStartTime,
      lateAfterMinutes: policy.lateAfterMinutes,
      standardWorkingHours: policy.standardWorkingHours,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The policy and the default WorkLocation are two views of the same office, so saving the
 * policy also moves the geofence the app reads from /attendance/assigned-location.
 */
adminAttendanceRouter.patch('/policy', async (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {};
    const data: Prisma.AttendancePolicySettingsUncheckedUpdateInput = {};
    if (body.officeLat !== undefined) data.officeLat = Number(body.officeLat);
    if (body.officeLng !== undefined) data.officeLng = Number(body.officeLng);
    if (body.geoFenceRadiusMeters !== undefined) data.geoFenceRadiusMeters = Math.round(Number(body.geoFenceRadiusMeters));
    if (body.workStartTime !== undefined) data.workStartTime = String(body.workStartTime);
    if (body.lateAfterMinutes !== undefined) data.lateAfterMinutes = Math.round(Number(body.lateAfterMinutes));
    if (body.standardWorkingHours !== undefined) data.standardWorkingHours = Number(body.standardWorkingHours);

    const policy = await prisma.attendancePolicySettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...(data as Prisma.AttendancePolicySettingsUncheckedCreateInput) },
    });
    const location = await getAssignedLocation();
    await prisma.workLocation.update({
      where: { id: location.id },
      data: { latitude: policy.officeLat, longitude: policy.officeLng, radius: policy.geoFenceRadiusMeters },
    });

    await writeAudit(req, {
      module: 'Settings',
      action: 'Changed attendance policy',
      recordId: 'attendance-policy',
      recordLabel: 'Attendance Policy',
      description: 'Attendance geo-fence policy was updated.',
    });
    res.json({
      officeLat: policy.officeLat,
      officeLng: policy.officeLng,
      geoFenceRadiusMeters: policy.geoFenceRadiusMeters,
      workStartTime: policy.workStartTime,
      lateAfterMinutes: policy.lateAfterMinutes,
      standardWorkingHours: policy.standardWorkingHours,
    });
  } catch (err) {
    next(err);
  }
});

adminAttendanceRouter.get('/:id', async (req, res, next) => {
  try {
    const record = await prisma.attendanceRecord.findUnique({ where: { id: String(req.params.id) }, include: recordInclude });
    if (!record) return res.status(404).json({ error: 'Attendance record not found' });
    res.json(adminAttendance(record));
  } catch (err) {
    next(err);
  }
});
