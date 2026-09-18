import { Router } from 'express';
import { prisma } from '../prisma';
import { runAutomationManually } from '../services/automationEngine';

export const automationsRouter = Router();

const VALID_STEP_TYPES = ['condition', 'action', 'delay'];

function validateSteps(steps: unknown): string | null {
  if (!Array.isArray(steps)) return 'steps must be an array.';
  for (const step of steps as any[]) {
    if (!VALID_STEP_TYPES.includes(step?.type)) return `Invalid step type "${step?.type}".`;
    if (!step.config || typeof step.config !== 'object') return 'Every step needs a config object.';
  }
  return null;
}

automationsRouter.get('/', async (_req, res) => {
  const rows = await prisma.automation.findMany({
    orderBy: { createdAt: 'desc' },
    include: { steps: { orderBy: { sortOrder: 'asc' } }, _count: { select: { runs: true } } },
  });
  res.json(rows.map(({ _count, ...a }) => ({ ...a, runCount: _count.runs })));
});

automationsRouter.get('/manual', async (_req, res) => {
  const rows = await prisma.automation.findMany({ where: { enabled: true, triggerType: 'manual' }, orderBy: { createdAt: 'desc' } });
  res.json(rows);
});

automationsRouter.get('/:id', async (req, res) => {
  const row = await prisma.automation.findUnique({ where: { id: req.params.id }, include: { steps: { orderBy: { sortOrder: 'asc' } } } });
  if (!row) return res.status(404).json({ error: 'Automation not found' });
  res.json(row);
});

automationsRouter.post('/', async (req, res) => {
  const { name, description, enabled, respectBusinessHours, triggerType, triggerConfig, steps } = req.body as {
    name: string;
    description?: string;
    enabled?: boolean;
    respectBusinessHours?: boolean;
    triggerType: string;
    triggerConfig?: unknown;
    steps?: unknown;
  };
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!triggerType) return res.status(400).json({ error: 'Trigger event is required.' });

  const stepError = validateSteps(steps ?? []);
  if (stepError) return res.status(400).json({ error: stepError });

  const created = await prisma.automation.create({
    data: {
      name: name.trim(),
      description: description?.trim() || undefined,
      enabled: enabled ?? true,
      respectBusinessHours: !!respectBusinessHours,
      triggerType,
      triggerConfig: (triggerConfig ?? undefined) as any,
      steps: {
        create: (steps as any[] ?? []).map((s, index) => ({ type: s.type, sortOrder: index, config: s.config })),
      },
    },
    include: { steps: { orderBy: { sortOrder: 'asc' } } },
  });
  res.status(201).json(created);
});

automationsRouter.patch('/:id', async (req, res) => {
  const existing = await prisma.automation.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Automation not found' });

  const { name, description, enabled, respectBusinessHours, triggerType, triggerConfig, steps } = req.body as {
    name?: string;
    description?: string;
    enabled?: boolean;
    respectBusinessHours?: boolean;
    triggerType?: string;
    triggerConfig?: unknown;
    steps?: unknown;
  };

  if (steps !== undefined) {
    const stepError = validateSteps(steps);
    if (stepError) return res.status(400).json({ error: stepError });
  }

  // Steps are replaced wholesale, same as the Forms builder's fields: the editor always submits
  // the full, ordered list, and a step carries no history worth preserving individually — the
  // AutomationRun log already records what actually happened at the time a run passed through it.
  const updated = await prisma.$transaction(async (tx) => {
    if (steps !== undefined) {
      await tx.automationStep.deleteMany({ where: { automationId: existing.id } });
    }
    return tx.automation.update({
      where: { id: existing.id },
      data: {
        name: name?.trim(),
        description: description !== undefined ? description?.trim() || null : undefined,
        enabled,
        respectBusinessHours,
        triggerType,
        triggerConfig: triggerConfig !== undefined ? (triggerConfig as any) : undefined,
        ...(steps !== undefined
          ? { steps: { create: (steps as any[]).map((s, index) => ({ type: s.type, sortOrder: index, config: s.config })) } }
          : {}),
      },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
  });
  res.json(updated);
});

automationsRouter.post('/:id/toggle', async (req, res) => {
  const existing = await prisma.automation.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Automation not found' });
  const updated = await prisma.automation.update({ where: { id: req.params.id }, data: { enabled: !existing.enabled } });
  res.json(updated);
});

automationsRouter.delete('/:id', async (req, res) => {
  await prisma.automation.delete({ where: { id: req.params.id } }).catch(() => undefined);
  res.status(204).send();
});

automationsRouter.get('/runs/list', async (req, res) => {
  const { page = '1', pageSize = '20', automationId } = req.query as Record<string, string>;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);

  const where = automationId && automationId !== 'all' ? { automationId } : {};
  const [items, total] = await Promise.all([
    prisma.automationRun.findMany({ where, orderBy: { ranAt: 'desc' }, skip: (pageNum - 1) * size, take: size }),
    prisma.automationRun.count({ where }),
  ]);

  // AutomationRun.leadId is a plain string (not a Prisma relation, matching how assignedUserId
  // stays decoupled from the mock partner/user layer) — resolve names with one extra lookup.
  const leads = await prisma.lead.findMany({
    where: { id: { in: items.map((r) => r.leadId) } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(leads.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()]));

  res.json({
    items: items.map((r) => ({ ...r, leadName: nameById.get(r.leadId) })),
    total,
    page: pageNum,
    pageSize: size,
  });
});

/**
 * Runs the automation's full step chain (conditions, actions, delays) for each selected lead —
 * the same engine every automatic trigger uses (server/src/services/automationEngine.ts).
 * `teamMemberIds` is only meaningful for an `assign_lead` step with `assignMode: 'team'`: Teams
 * still live in the frontend's mock partner layer, so the frontend resolves membership and
 * passes it in here (see leadAutomationService.ts) rather than this server needing its own copy.
 */
automationsRouter.post('/:id/run', async (req, res) => {
  const { leadIds, teamMemberIds } = req.body as { leadIds: string[]; teamMemberIds?: string[] };
  const automation = await prisma.automation.findUnique({ where: { id: req.params.id } });
  if (!automation) return res.status(404).json({ error: 'Automation not found' });

  const result = await runAutomationManually(automation.id, leadIds, teamMemberIds);
  res.json(result);
});
