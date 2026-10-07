import fs from 'fs';
import path from 'path';
import { Router, type NextFunction, type Response } from 'express';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { publicUrl, upload, UPLOAD_DIR } from '../../services/upload';
import { activityProgress } from '../../services/construction';
import { makeMaterialEntryHandler, materialPhotoFields } from '../materialEntry';

/**
 * Site staff's side of construction — /api/v1/app/construction.
 *
 * A person sees and reports on the activities assigned to them, and nothing else. Updates must
 * carry photographs with the time and place the app's camera stamped on them; a photo with no
 * stamp is refused, which is how "no gallery uploads" is enforced on the server rather than
 * trusted to the app. `client_id` makes a retried upload (a dropped connection, an offline
 * queue draining twice) the same update instead of a duplicate.
 */
export const appConstructionRouter = Router();
appConstructionRouter.use(requireAuth);

const fail = (res: any, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });

export async function listMyActivities(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const rows = await prisma.constructionActivity.findMany({
      where: { assigneeId: req.auth!.sub },
      include: { project: { select: { projectName: true } }, updates: { select: { status: true, percentComplete: true, capturedAt: true } } },
      orderBy: { plannedEnd: 'asc' },
    });
    res.json({
      activities: rows.map((a) => {
        const p = activityProgress(a);
        return {
          id: a.id,
          project: a.project.projectName,
          phase: a.phase,
          block: a.block,
          name: a.name,
          planned_start: a.plannedStart.toISOString(),
          planned_end: a.plannedEnd.toISOString(),
          planned_percent: p.planned,
          actual_percent: p.actual,
          days_behind: p.daysBehind,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

appConstructionRouter.get('/activities', listMyActivities);

export const removeFiles = (files: Express.Multer.File[]) =>
  files.forEach((f) => fs.unlink(path.join(UPLOAD_DIR, f.filename), () => undefined));

export async function postProgressUpdate(req: AuthedRequest, res: Response, next: NextFunction) {
  const files = (req.files ?? []) as Express.Multer.File[];
  try {
    const b = req.body ?? {};
    const clientId = b.client_id ? String(b.client_id) : null;

    // A retry of something already stored is success, not an error.
    if (clientId) {
      const dup = await prisma.progressUpdate.findUnique({ where: { clientId } });
      if (dup) {
        removeFiles(files);
        return res.status(200).json({ id: dup.id, status: dup.status, duplicate: true });
      }
    }

    const activity = await prisma.constructionActivity.findUnique({ where: { id: String(b.activity_id ?? '') } });
    if (!activity || activity.assigneeId !== req.auth!.sub) {
      removeFiles(files);
      return fail(res, 404, 'activity_not_found', 'That activity is not assigned to you.');
    }

    const workDone = String(b.work_done ?? '').trim();
    const percent = Math.round(Number(b.percent_complete));
    const manpower = Math.max(0, Math.round(Number(b.manpower ?? 0)) || 0);
    const capturedAt = new Date(String(b.captured_at ?? ''));
    if (!workDone) { removeFiles(files); return fail(res, 400, 'missing_work_done', 'Say what work was done.'); }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) { removeFiles(files); return fail(res, 400, 'invalid_percent', 'percent_complete must be between 0 and 100.'); }
    if (Number.isNaN(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 5 * 60_000) {
      removeFiles(files);
      return fail(res, 400, 'invalid_captured_at', 'captured_at must be the time the update was taken, not in the future.');
    }

    let meta: { taken_at?: string; latitude?: number; longitude?: number }[] = [];
    try { meta = JSON.parse(String(b.photo_meta ?? '[]')); } catch { meta = []; }
    if (files.length === 0) { return fail(res, 400, 'photos_required', 'Add at least one photo taken in the app.'); }
    if (meta.length !== files.length) { removeFiles(files); return fail(res, 400, 'photo_meta_missing', 'Every photo needs its time and location stamp.'); }
    const stamps = meta.map((m) => ({ takenAt: new Date(String(m.taken_at)), latitude: Number(m.latitude), longitude: Number(m.longitude) }));
    if (stamps.some((s) => Number.isNaN(s.takenAt.getTime()) || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude) || Math.abs(s.latitude) > 90 || Math.abs(s.longitude) > 180)) {
      removeFiles(files);
      return fail(res, 400, 'photo_meta_invalid', 'Every photo needs a valid date, time and location.');
    }

    const created = await prisma.progressUpdate.create({
      data: {
        activityId: activity.id,
        authorId: req.auth!.sub,
        workDone,
        manpower,
        percentComplete: percent,
        remarks: b.remarks ? String(b.remarks).slice(0, 1000) : null,
        capturedAt,
        clientId,
        photos: { create: files.map((f, i) => ({ url: publicUrl(f), ...stamps[i] })) },
      },
    });
    res.status(201).json({ id: created.id, status: created.status, duplicate: false });
  } catch (err) {
    removeFiles(files);
    next(err);
  }
}

appConstructionRouter.post('/updates', upload.array('photos', 10), postProgressUpdate);

appConstructionRouter.get('/updates', async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.progressUpdate.findMany({
      where: { authorId: req.auth!.sub },
      include: { activity: { select: { name: true } } },
      orderBy: { capturedAt: 'desc' },
      take: 50,
    });
    res.json({
      updates: rows.map((u) => ({
        id: u.id,
        activity: u.activity.name,
        work_done: u.workDone,
        percent_complete: u.percentComplete,
        status: u.status,
        rejection_reason: u.rejectionReason,
        captured_at: u.capturedAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Issues assigned to me or raised by me, the detail of one, and raising a new one from site. */
const mineOrRaisedByMe = (me: string) => ({ OR: [{ ownerId: me }, { raisedById: me }] });

const issueRow = (i: any, me: string) => ({
  id: i.id,
  project: i.project.projectName,
  title: i.title,
  due_date: i.dueDate?.toISOString() ?? null,
  status: i.status,
  assigned_to_me: i.ownerId === me,
  raised_by_me: i.raisedById === me,
  photos_count: i.photos.length,
  created_at: i.createdAt.toISOString(),
});

appConstructionRouter.get('/issues', async (req: AuthedRequest, res, next) => {
  try {
    const me = req.auth!.sub;
    const rows = await prisma.siteIssue.findMany({
      where: { ...mineOrRaisedByMe(me), status: { not: 'closed' } },
      include: { project: { select: { projectName: true } } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ issues: rows.map((i) => issueRow(i, me)) });
  } catch (err) {
    next(err);
  }
});

appConstructionRouter.get('/issues/:id', async (req: AuthedRequest, res, next) => {
  try {
    const me = req.auth!.sub;
    const i = await prisma.siteIssue.findFirst({
      where: { id: String(req.params.id), ...mineOrRaisedByMe(me) },
      include: {
        project: { select: { projectName: true } },
        activity: { select: { name: true } },
        owner: { select: { name: true } },
        raisedBy: { select: { name: true } },
      },
    });
    if (!i) return fail(res, 404, 'issue_not_found', 'That issue is not yours.');
    res.json({
      ...issueRow(i, me),
      description: i.description,
      photos: i.photos,
      activity: i.activity?.name ?? null,
      raised_by: i.raisedBy.name,
      owner: i.owner?.name ?? null,
      closed_at: i.closedAt?.toISOString() ?? null,
      close_note: i.closeNote,
    });
  } catch (err) {
    next(err);
  }
});

appConstructionRouter.post('/issues', upload.array('photos', 6), async (req: AuthedRequest, res, next) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  try {
    const b = req.body ?? {};
    const title = String(b.title ?? '').trim();
    const activity = b.activity_id ? await prisma.constructionActivity.findUnique({ where: { id: String(b.activity_id) } }) : null;
    const projectId = activity?.projectId ?? String(b.project_id ?? '');
    if (!title) { removeFiles(files); return fail(res, 400, 'missing_title', 'Describe the issue.'); }
    if (!projectId || !(await prisma.project.count({ where: { id: projectId } }))) { removeFiles(files); return fail(res, 400, 'invalid_project', 'Choose a project.'); }
    const created = await prisma.siteIssue.create({
      data: { projectId, activityId: activity?.id ?? null, title, description: b.description ? String(b.description) : null, photos: files.map(publicUrl), raisedById: req.auth!.sub },
    });
    res.status(201).json({ id: created.id });
  } catch (err) {
    removeFiles(files);
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Material received at site
//
// The same entry the staff panel and the vendor portal make, from the same handler, so the rules
// (a photo each of the material, the challan and the vehicle, stamped with time and place) are one
// implementation. An entry starts as pending; somebody checks it in the panel under Vendors &
// Material, and the person who entered it sees the verdict here.
// ---------------------------------------------------------------------------

/** Whoever receives material at a site. Channel partners are not site staff, and vendors have their own portal. */
function siteStaffOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.auth!.role === 'channel_partner' || req.auth!.role === 'vendor') {
    return fail(res, 403, 'not_site_staff', 'Material is recorded by site staff.');
  }
  next();
}

appConstructionRouter.get('/materials/lookups', siteStaffOnly, async (_req, res, next) => {
  try {
    const [projects, materials, vendors] = await Promise.all([
      prisma.project.findMany({ select: { id: true, projectName: true }, orderBy: { projectName: 'asc' } }),
      prisma.materialItem.findMany({ select: { name: true, unit: true }, orderBy: { name: 'asc' } }),
      prisma.vendor.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    res.json({ projects: projects.map((p) => ({ id: p.id, name: p.projectName })), materials, vendors });
  } catch (err) {
    next(err);
  }
});

appConstructionRouter.post('/materials', siteStaffOnly, materialPhotoFields, makeMaterialEntryHandler({ vendorFromLogin: false }));

appConstructionRouter.get('/materials', siteStaffOnly, async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.materialEntry.findMany({
      where: { createdById: req.auth!.sub },
      include: { material: true, vendor: { select: { name: true } }, project: { select: { projectName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      entries: rows.map((e) => ({
        id: e.id, project: e.project.projectName, material: e.material.name, unit: e.material.unit, quantity: e.quantity, vendor: e.vendor?.name ?? null,
        challan_no: e.challanNo, vehicle_no: e.vehicleNo, received_by: e.receivedBy, received_on: e.receivedOn.toISOString(),
        status: e.status, rejection_reason: e.rejectionReason, entered_at: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});
