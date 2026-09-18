import { Router } from 'express';
import { prisma } from '../prisma';

export const pipelinesRouter = Router();

pipelinesRouter.get('/', async (_req, res) => {
  const rows = await prisma.pipeline.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { stages: true, leads: true } } },
  });
  res.json(rows);
});

pipelinesRouter.post('/', async (req, res) => {
  const { name, description, isDefault } = req.body as { name: string; description?: string; isDefault?: boolean };
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });

  if (isDefault) await prisma.pipeline.updateMany({ data: { isDefault: false } });

  const created = await prisma.pipeline.create({
    data: { name: name.trim(), description: description?.trim() || undefined, isDefault: !!isDefault },
  });
  res.status(201).json(created);
});

// ---------------------------------------------------------------------------
// Stages — registered before `/:id` and `/:id/stages` GET so `/stages/:stageId`
// (a fixed "stages" first segment) is never shadowed by the `/:id` param routes below.
// ---------------------------------------------------------------------------

/** Every stage across every pipeline, flat — for pages that need to resolve a lead's stage
 * (name/color/won-lost) without knowing which pipeline it belongs to up front. */
pipelinesRouter.get('/stages/all', async (_req, res) => {
  const rows = await prisma.pipelineStage.findMany({ orderBy: [{ pipelineId: 'asc' }, { sortOrder: 'asc' }] });
  res.json(rows);
});

pipelinesRouter.get('/:id/stages', async (req, res) => {
  const rows = await prisma.pipelineStage.findMany({
    where: { pipelineId: req.params.id },
    orderBy: { sortOrder: 'asc' },
  });
  res.json(rows);
});

pipelinesRouter.post('/:id/stages', async (req, res) => {
  const { name, color } = req.body as { name: string; color?: string };
  if (!name?.trim()) return res.status(400).json({ error: 'Stage name is required.' });

  const count = await prisma.pipelineStage.count({ where: { pipelineId: req.params.id } });
  const created = await prisma.pipelineStage.create({
    data: {
      pipelineId: req.params.id,
      name: name.trim(),
      color: color || '#6366f1',
      sortOrder: count + 1,
    },
  });
  res.status(201).json(created);
});

pipelinesRouter.patch('/stages/:stageId', async (req, res) => {
  const { name, color, isWon, isLost, winProbability, sortOrder } = req.body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (color !== undefined) data.color = color;
  if (isWon !== undefined) data.isWon = isWon;
  if (isLost !== undefined) data.isLost = isLost;
  if (winProbability !== undefined) data.winProbability = winProbability;
  if (sortOrder !== undefined) data.sortOrder = sortOrder;

  const updated = await prisma.pipelineStage.update({ where: { id: req.params.stageId }, data }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Stage not found' });
  res.json(updated);
});

pipelinesRouter.delete('/stages/:stageId', async (req, res) => {
  const leadCount = await prisma.lead.count({ where: { pipelineStageId: req.params.stageId } });
  if (leadCount > 0) {
    return res.status(400).json({ error: `${leadCount} lead(s) are currently in this stage. Move them to another stage first.` });
  }
  await prisma.pipelineStage.delete({ where: { id: req.params.stageId } }).catch(() => undefined);
  res.status(204).send();
});

pipelinesRouter.post('/:id/stages/reorder', async (req, res) => {
  const { orderedIds } = req.body as { orderedIds: string[] };
  await Promise.all(
    orderedIds.map((stageId, i) => prisma.pipelineStage.update({ where: { id: stageId }, data: { sortOrder: i + 1 } }))
  );
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Single-pipeline routes
// ---------------------------------------------------------------------------

pipelinesRouter.get('/:id', async (req, res) => {
  const row = await prisma.pipeline.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Pipeline not found' });
  res.json(row);
});

pipelinesRouter.patch('/:id', async (req, res) => {
  const { name, description, isDefault } = req.body as { name?: string; description?: string; isDefault?: boolean };
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (isDefault !== undefined) data.isDefault = isDefault;

  if (isDefault === true) {
    await prisma.pipeline.updateMany({ where: { id: { not: req.params.id } }, data: { isDefault: false } });
  }

  const updated = await prisma.pipeline.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Pipeline not found' });
  res.json(updated);
});

pipelinesRouter.delete('/:id', async (req, res) => {
  const leadCount = await prisma.lead.count({ where: { pipelineId: req.params.id } });
  if (leadCount > 0) {
    return res.status(400).json({ error: `${leadCount} lead(s) are currently in this pipeline. Move them out first.` });
  }
  await prisma.pipeline.delete({ where: { id: req.params.id } }).catch(() => undefined);
  res.status(204).send();
});

export const tagsRouter = Router();

tagsRouter.get('/', async (_req, res) => {
  const rows = await prisma.leadTag.findMany();
  res.json(rows);
});
