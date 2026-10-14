import { Router } from 'express';
import { prisma } from '../../prisma';
import type { AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';

/**
 * Site cameras — /api/cameras.
 *
 * A camera here is a name, the site it is on, where it points, and the address its live picture is
 * served from. Nothing is stored about the camera itself (no RTSP address, no password): the
 * camera speaks RTSP, which a browser cannot play, so a gateway at the site turns it into an
 * https address and that is the only thing the CRM needs to know (tools/site-gateway).
 */
export const adminCamerasRouter = Router();

const shape = (c: any) => ({
  id: c.id, name: c.name, projectId: c.projectId, projectName: c.project?.projectName, placement: c.placement, liveUrl: c.liveUrl, active: c.active,
});

/** An https address, because the panel is https and a browser will not play an http stream inside it. */
function readLiveUrl(raw: unknown): { url: string | null; error?: string } {
  const value = String(raw ?? '').trim();
  if (!value) return { url: null };
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return { url: null, error: 'The live address is not a valid web address.' };
  }
  if (u.protocol !== 'https:') return { url: null, error: 'The live address must start with https://.' };
  return { url: u.toString() };
}

adminCamerasRouter.get('/', async (_req, res, next) => {
  try {
    const cams = await prisma.camera.findMany({ include: { project: { select: { projectName: true } } }, orderBy: [{ project: { projectName: 'asc' } }, { name: 'asc' }] });
    res.json(cams.map(shape));
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
    const live = readLiveUrl(req.body?.liveUrl);
    if (live.error) return res.status(400).json({ error: live.error });
    const created = await prisma.camera.create({
      data: { name, projectId, placement: req.body?.placement ? String(req.body.placement).trim() : null, liveUrl: live.url },
      include: { project: { select: { projectName: true } } },
    });
    await writeAudit(req, { module: 'Cameras', action: 'Added camera', recordId: created.id, recordLabel: created.name, description: '' });
    res.status(201).json(shape(created));
  } catch (err) {
    next(err);
  }
});

adminCamerasRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.camera.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Camera not found.' });
    const data: Record<string, unknown> = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Give the camera a name.' });
      data.name = name;
    }
    if (req.body?.projectId !== undefined) {
      if (!(await prisma.project.count({ where: { id: String(req.body.projectId) } }))) return res.status(400).json({ error: 'Choose the site it is on.' });
      data.projectId = String(req.body.projectId);
    }
    if (req.body?.placement !== undefined) data.placement = String(req.body.placement).trim() || null;
    if (req.body?.active !== undefined) data.active = !!req.body.active;
    if (req.body?.liveUrl !== undefined) {
      const live = readLiveUrl(req.body.liveUrl);
      if (live.error) return res.status(400).json({ error: live.error });
      data.liveUrl = live.url;
    }
    const updated = await prisma.camera.update({ where: { id }, data, include: { project: { select: { projectName: true } } } });
    await writeAudit(req, { module: 'Cameras', action: 'Edited camera', recordId: id, recordLabel: updated.name, description: '' });
    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});

adminCamerasRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.camera.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Camera not found.' });
    await prisma.camera.delete({ where: { id: existing.id } });
    await writeAudit(req, { module: 'Cameras', action: 'Removed camera', recordId: existing.id, recordLabel: existing.name, description: '' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
