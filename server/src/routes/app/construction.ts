import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';
import { publicUrl, upload, UPLOAD_DIR } from '../../services/upload';
import { activityProgress } from '../../services/construction';

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

appConstructionRouter.get('/activities', async (req: AuthedRequest, res, next) => {
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
});

const removeFiles = (files: Express.Multer.File[]) =>
  files.forEach((f) => fs.unlink(path.join(UPLOAD_DIR, f.filename), () => undefined));

appConstructionRouter.post('/updates', upload.array('photos', 10), async (req: AuthedRequest, res, next) => {
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
});

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

/** Issues assigned to me, and raising a new one from site. */
appConstructionRouter.get('/issues', async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.siteIssue.findMany({
      where: { ownerId: req.auth!.sub, status: { not: 'closed' } },
      include: { project: { select: { projectName: true } } },
      orderBy: { dueDate: 'asc' },
    });
    res.json({ issues: rows.map((i) => ({ id: i.id, project: i.project.projectName, title: i.title, due_date: i.dueDate?.toISOString() ?? null, status: i.status })) });
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
