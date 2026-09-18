import { Router } from 'express';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { getAssignedLocation, upsertMark } from '../../services/attendance';
import { dayRange } from '../../services/dates';
import { appAttendance, appWorkLocation } from '../../services/appMappers';

/** API docs §2 — offline-first attendance. */
export const appAttendanceRouter = Router();

appAttendanceRouter.use(requireAuth);

// §2.1 GET /attendance/assigned-location
appAttendanceRouter.get('/assigned-location', async (_req, res, next) => {
  try {
    res.json(appWorkLocation(await getAssignedLocation()));
  } catch (err) {
    next(err);
  }
});

// §2.2 GET /attendance?from&to — history for the signed-in partner
appAttendanceRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const records = await prisma.attendanceRecord.findMany({
      where: { userId: req.auth!.sub, date: dayRange(req.query.from, req.query.to) },
      orderBy: { date: 'desc' },
    });
    res.json({ records: records.map(appAttendance) });
  } catch (err) {
    next(err);
  }
});

// §2.3 POST /attendance — push a check-in or check-out mark (upsert by day)
appAttendanceRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub }, select: { name: true } });
    const body = req.body ?? {};
    const record = await upsertMark(req.auth!.sub, {
      date: body.date,
      checkInAt: body.check_in_at,
      checkOutAt: body.check_out_at,
      checkInLocation: body.check_in_location,
      checkOutLocation: body.check_out_location,
      // Not in the documented payload, but §2.3's note says the app has them at the point
      // of check-in and can add them — accepted here so no client change is needed later.
      checkInLat: typeof body.check_in_lat === 'number' ? body.check_in_lat : null,
      checkInLng: typeof body.check_in_lng === 'number' ? body.check_in_lng : null,
      checkOutLat: typeof body.check_out_lat === 'number' ? body.check_out_lat : null,
      checkOutLng: typeof body.check_out_lng === 'number' ? body.check_out_lng : null,
      markedBy: body.marked_by ?? user.name,
      device: body.device,
    });
    res.json(appAttendance(record));
  } catch (err) {
    next(err);
  }
});
