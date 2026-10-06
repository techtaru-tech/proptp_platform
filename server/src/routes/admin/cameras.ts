import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import type { AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import fs from 'fs';
import path from 'path';
import { UPLOAD_DIR } from '../../services/upload';
import { healthOf, newKey } from '../../services/cameras';

/** Site cameras — /api/cameras. */
export const adminCamerasRouter = Router();

const shape = (c: any) => ({
  id: c.id, name: c.name, projectId: c.projectId, projectName: c.project?.projectName, placement: c.placement, liveUrl: c.liveUrl,
  active: c.active, expectedEveryMinutes: c.expectedEveryMinutes, keyPrefix: c.keyPrefix, lastImageAt: c.lastImageAt?.toISOString() ?? null,
  lastSeenAt: c.lastSeenAt?.toISOString() ?? null, ...healthOf(c),
});

adminCamerasRouter.get('/', async (_req, res, next) => {
  try {
    const cams = await prisma.camera.findMany({ include: { project: { select: { projectName: true } } }, orderBy: { name: 'asc' } });
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [today, flagged, latest] = await Promise.all([
      prisma.cameraImage.groupBy({ by: ['cameraId'], where: { capturedAt: { gte: since } }, _count: { _all: true } }),
      prisma.cameraImage.groupBy({ by: ['cameraId'], where: { review: 'flagged' }, _count: { _all: true } }),
      prisma.cameraImage.findMany({ where: { cameraId: { in: cams.map((c) => c.id) } }, orderBy: { capturedAt: 'desc' }, distinct: ['cameraId'], select: { cameraId: true, url: true } }),
    ]);
    const t = new Map(today.map((g) => [g.cameraId, g._count._all]));
    const f = new Map(flagged.map((g) => [g.cameraId, g._count._all]));
    const l = new Map(latest.map((x) => [x.cameraId, x.url]));
    res.json(cams.map((c) => ({ ...shape(c), imagesToday: t.get(c.id) ?? 0, flagged: f.get(c.id) ?? 0, latestUrl: l.get(c.id) ?? null })));
  } catch (err) {
    next(err);
  }
});

adminCamerasRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const projectId = String(req.body?.projectId ?? '');
    if (!name) return res.status(400).json({ error: 'Give the camera a name.' });
    if (!(await prisma.project.count({ where: { id: projectId } }))) return res.status(400).json({ error: 'Choose the site it is on.' });
    const every = Math.round(Number(req.body?.expectedEveryMinutes ?? 60));
    if (!Number.isFinite(every) || every < 1 || every > 1440) return res.status(400).json({ error: 'How often it pushes must be between 1 minute and 24 hours.' });
    const { key, hash, prefix } = newKey();
    const created = await prisma.camera.create({
      data: { name, projectId, placement: req.body?.placement ? String(req.body.placement).trim() : null, expectedEveryMinutes: every, keyHash: hash, keyPrefix: prefix },
      include: { project: { select: { projectName: true } } },
    });
    await writeAudit(req, { module: 'Cameras', action: 'Added camera', recordId: created.id, recordLabel: created.name, description: '' });
    // The key is returned exactly once.
    res.status(201).json({ ...shape(created), key });
  } catch (err) {
    next(err);
  }
});

adminCamerasRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.camera.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Camera not found.' });
    const data: Prisma.CameraUncheckedUpdateInput = {};
    if (req.body?.name !== undefined) { const n = String(req.body.name).trim(); if (!n) return res.status(400).json({ error: 'The name cannot be empty.' }); data.name = n; }
    if (req.body?.placement !== undefined) data.placement = String(req.body.placement).trim() || null;
    if (req.body?.liveUrl !== undefined) {
      const u = String(req.body.liveUrl).trim();
      if (u && !/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'The live address must start with http:// or https://.' });
      data.liveUrl = u || null;
    }
    if (req.body?.projectId !== undefined) {
      if (!(await prisma.project.count({ where: { id: String(req.body.projectId) } }))) return res.status(400).json({ error: 'Choose the site it is on.' });
      data.projectId = String(req.body.projectId);
    }
    if (req.body?.active !== undefined) data.active = !!req.body.active;
    if (req.body?.expectedEveryMinutes !== undefined) {
      const e = Math.round(Number(req.body.expectedEveryMinutes));
      if (!Number.isFinite(e) || e < 1 || e > 1440) return res.status(400).json({ error: 'How often it pushes must be between 1 minute and 24 hours.' });
      data.expectedEveryMinutes = e;
    }
    const updated = await prisma.camera.update({ where: { id: existing.id }, data, include: { project: { select: { projectName: true } } } });
    await writeAudit(req, { module: 'Cameras', action: 'Edited camera', recordId: existing.id, recordLabel: updated.name, description: '' });
    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});

/** A new key; the old one stops working at once. The only way to take access back from a PC. */
adminCamerasRouter.post('/:id/rotate-key', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.camera.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Camera not found.' });
    const { key, hash, prefix } = newKey();
    await prisma.camera.update({ where: { id: existing.id }, data: { keyHash: hash, keyPrefix: prefix } });
    await writeAudit(req, { module: 'Cameras', action: 'Rotated camera key', recordId: existing.id, recordLabel: existing.name, description: '' });
    res.json({ key });
  } catch (err) {
    next(err);
  }
});

adminCamerasRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.camera.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Camera not found.' });
    await prisma.camera.delete({ where: { id: existing.id } });
    await writeAudit(req, { module: 'Cameras', action: 'Removed camera', recordId: existing.id, recordLabel: existing.name, description: 'Its pictures were removed from the list.' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

const imageShape = (i: any) => ({
  id: i.id, cameraId: i.cameraId, cameraName: i.camera?.name, projectName: i.camera?.project?.projectName, url: i.url, capturedAt: i.capturedAt.toISOString(), receivedAt: i.receivedAt.toISOString(),
  review: i.review, flagNote: i.flagNote, flaggedAt: i.flaggedAt?.toISOString() ?? null, issueId: i.issueId,
});

adminCamerasRouter.get('/images', async (req, res, next) => {
  try {
    const cameraId = String(req.query.cameraId ?? '');
    const review = String(req.query.review ?? 'all');
    const day = String(req.query.date ?? '');
    const page = Math.max(1, Number(req.query.page) || 1);
    const where: Prisma.CameraImageWhereInput = {};
    if (cameraId) where.cameraId = cameraId;
    if (['unreviewed', 'ok', 'flagged'].includes(review)) where.review = review;
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) where.capturedAt = { gte: new Date(`${day}T00:00:00.000+05:30`), lte: new Date(`${day}T23:59:59.999+05:30`) };
    const [rows, total] = await Promise.all([
      prisma.cameraImage.findMany({ where, include: { camera: { select: { name: true, project: { select: { projectName: true } } } } }, orderBy: { capturedAt: 'desc' }, skip: (page - 1) * 48, take: 48 }),
      prisma.cameraImage.count({ where }),
    ]);
    res.json({ items: rows.map(imageShape), total, page, pageSize: 48 });
  } catch (err) {
    next(err);
  }
});

/**
 * Removes pictures: the rows, and the files too, except a picture a site issue still shows, whose
 * file is kept so the issue is not left with a broken image.
 */
async function removePictures(req: AuthedRequest, where: Prisma.CameraImageWhereInput, label: string) {
  const rows = await prisma.cameraImage.findMany({ where, select: { id: true, url: true, issueId: true, camera: { select: { name: true } } } });
  if (rows.length === 0) return 0;
  await prisma.cameraImage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  for (const r of rows) {
    if (r.issueId) continue;
    const file = path.join(UPLOAD_DIR, path.basename(r.url));
    fs.unlink(file, () => undefined);
  }
  await writeAudit(req, { module: 'Cameras', action: 'Deleted camera pictures', recordId: rows[0].id, recordLabel: rows[0].camera.name, description: `${rows.length} picture(s) — ${label}.` });
  return rows.length;
}

adminCamerasRouter.post('/images/delete', async (req: AuthedRequest, res, next) => {
  try {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Choose the pictures to delete.' });
    res.json({ deleted: await removePictures(req, { id: { in: ids.map(String).slice(0, 1000) } }, 'chosen') });
  } catch (err) {
    next(err);
  }
});

/** Every picture a camera holds. The camera itself, and its key, stay. */
adminCamerasRouter.post('/:id/images/delete-all', async (req: AuthedRequest, res, next) => {
  try {
    const cam = await prisma.camera.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!cam) return res.status(404).json({ error: 'Camera not found.' });
    res.json({ deleted: await removePictures(req, { cameraId: cam.id }, 'all of them') });
  } catch (err) {
    next(err);
  }
});

adminCamerasRouter.delete('/images/:id', async (req: AuthedRequest, res, next) => {
  try {
    const n = await removePictures(req, { id: String(req.params.id) }, 'one');
    if (n === 0) return res.status(404).json({ error: 'Picture not found.' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * A person's verdict on a picture. Flagging can raise a site issue in the same step — with the
 * picture on it, so a problem seen on a camera becomes work on the site's issue list, not a note nobody reads.
 */
adminCamerasRouter.post('/images/:id/review', async (req: AuthedRequest, res, next) => {
  try {
    const decision = String(req.body?.decision ?? '');
    if (!['ok', 'flag', 'clear'].includes(decision)) return res.status(400).json({ error: 'decision must be ok, flag or clear.' });
    const img = await prisma.cameraImage.findUnique({ where: { id: String(req.params.id) }, include: { camera: { include: { project: { select: { projectName: true } } } } } });
    if (!img) return res.status(404).json({ error: 'Picture not found.' });

    if (decision === 'ok' || decision === 'clear') {
      const updated = await prisma.cameraImage.update({ where: { id: img.id }, data: decision === 'ok' ? { review: 'ok', flagNote: null, flaggedAt: null, flaggedById: null } : { review: 'unreviewed', flagNote: null, flaggedAt: null, flaggedById: null } });
      return res.json({ review: updated.review, issueId: updated.issueId });
    }

    const note = String(req.body?.note ?? '').trim();
    if (!note) return res.status(400).json({ error: 'Say what is wrong in the picture.' });
    if (img.review === 'flagged') return res.status(409).json({ error: 'This picture is already flagged.' });

    let issueId: string | null = null;
    if (req.body?.raiseIssue !== false) {
      const issue = await prisma.siteIssue.create({
        data: {
          projectId: img.camera.projectId, title: `Camera ${img.camera.name}: ${note}`.slice(0, 200),
          description: `Flagged on the ${img.camera.name} camera at ${img.capturedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`,
          photos: [img.url], raisedById: req.auth!.sub,
          dueDate: req.body?.dueDate ? new Date(String(req.body.dueDate)) : null,
        },
      });
      issueId = issue.id;
    }
    const updated = await prisma.cameraImage.update({ where: { id: img.id }, data: { review: 'flagged', flagNote: note, flaggedAt: new Date(), flaggedById: req.auth!.sub, issueId } });
    await writeAudit(req, { module: 'Cameras', action: 'Flagged a camera picture', recordId: img.id, recordLabel: img.camera.name, description: note });
    res.json({ review: updated.review, issueId });
  } catch (err) {
    next(err);
  }
});
