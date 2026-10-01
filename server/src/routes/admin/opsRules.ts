import { Router } from 'express';
import { prisma } from '../../prisma';
import type { AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import { MODULES } from '../../services/permissions';
import { CHANNELS, TRIGGER_CATALOGUE, dueFor, runOpsRules, triggerByKey, validateRule } from '../../services/opsRules';

/** Operations rules — /api/ops-rules. Every trigger, recipient, channel and delay is set here. */
export const adminOpsRulesRouter = Router();

adminOpsRulesRouter.get('/catalogue', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({ where: { status: 'active', role: { not: 'vendor' } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' }, take: 500 });
    res.json({ triggers: TRIGGER_CATALOGUE, channels: CHANNELS, modules: MODULES, users });
  } catch (err) {
    next(err);
  }
});

adminOpsRulesRouter.get('/', async (_req, res, next) => {
  try {
    const rules = await prisma.opsRule.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { fires: true } } } });
    const last = await prisma.opsRuleFire.groupBy({ by: ['ruleId'], _max: { firedAt: true } });
    const lastBy = new Map(last.map((l) => [l.ruleId, l._max.firedAt]));
    res.json(rules.map(({ _count, ...r }) => ({ ...r, fireCount: _count.fires, lastFiredAt: lastBy.get(r.id)?.toISOString() ?? null })));
  } catch (err) {
    next(err);
  }
});

function readBody(body: any) {
  const name = String(body?.name ?? '').trim();
  const trigger = String(body?.trigger ?? '');
  const config = body?.config && typeof body.config === 'object' ? body.config : {};
  const steps = body?.steps;
  if (!name) return { error: 'Give the rule a name.' };
  const err = validateRule(trigger, steps);
  if (err) return { error: err };
  const def = triggerByKey(trigger)!;
  const clean: Record<string, number> = {};
  for (const p of def.params) {
    const v = config[p.key] === undefined ? p.default : Number(config[p.key]);
    if (!Number.isFinite(v) || v < 0) return { error: `${p.label} must be zero or more.` };
    clean[p.key] = v;
  }
  return { name, trigger, config: clean, steps };
}

adminOpsRulesRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const r = readBody(req.body);
    if ('error' in r) return res.status(400).json({ error: r.error });
    const created = await prisma.opsRule.create({ data: { name: r.name, trigger: r.trigger, config: r.config, steps: r.steps } });
    await writeAudit(req, { module: 'Automation', action: 'Created operations rule', recordId: created.id, recordLabel: created.name, description: r.trigger });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

adminOpsRulesRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.opsRule.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Rule not found.' });
    const r = readBody({ name: existing.name, trigger: existing.trigger, config: existing.config, steps: existing.steps, ...req.body });
    if ('error' in r) return res.status(400).json({ error: r.error });
    // Changing what a rule does restarts its clock, so edited steps never fire for conditions
    // that predate the edit.
    const changed = JSON.stringify(r.steps) !== JSON.stringify(existing.steps) || JSON.stringify(r.config) !== JSON.stringify(existing.config) || r.trigger !== existing.trigger;
    const updated = await prisma.opsRule.update({
      where: { id: existing.id },
      data: { name: r.name, trigger: r.trigger, config: r.config, steps: r.steps, ...(changed && existing.enabled ? { enabledAt: new Date() } : {}) },
    });
    if (changed && r.trigger !== existing.trigger) await prisma.opsRuleFire.deleteMany({ where: { ruleId: existing.id } });
    await writeAudit(req, { module: 'Automation', action: 'Edited operations rule', recordId: updated.id, recordLabel: updated.name, description: '' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

adminOpsRulesRouter.post('/:id/toggle', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.opsRule.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Rule not found.' });
    const enabled = !existing.enabled;
    const updated = await prisma.opsRule.update({ where: { id: existing.id }, data: { enabled, enabledAt: enabled ? new Date() : existing.enabledAt } });
    await writeAudit(req, { module: 'Automation', action: enabled ? 'Switched on operations rule' : 'Switched off operations rule', recordId: updated.id, recordLabel: updated.name, description: '' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

adminOpsRulesRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await prisma.opsRule.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) return res.status(404).json({ error: 'Rule not found.' });
    await prisma.opsRule.delete({ where: { id: existing.id } });
    await writeAudit(req, { module: 'Automation', action: 'Deleted operations rule', recordId: existing.id, recordLabel: existing.name, description: '' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * A dry run: what the rule would do if it were running now, and what is coming. Nothing is sent
 * or changed, so a rule can be checked before it is switched on.
 */
adminOpsRulesRouter.get('/:id/preview', async (req, res, next) => {
  try {
    const rule = await prisma.opsRule.findUnique({ where: { id: String(req.params.id) } });
    if (!rule) return res.status(404).json({ error: 'Rule not found.' });
    // A rule that is off would act from the moment it is switched on, so preview it that way.
    const asIfOn = { ...rule, enabledAt: rule.enabled ? rule.enabledAt : new Date() };
    const { subjects, due, upcoming } = await dueFor(asIfOn);
    const steps = rule.steps as unknown as { delayHours: number; action: { kind: string } }[];
    res.json({
      enabled: rule.enabled,
      matching: subjects,
      wouldFireNow: due.slice(0, 50).map((d) => ({ subject: d.subject.label, step: d.stepIndex + 1, action: steps[d.stepIndex].action.kind })),
      wouldFireNowCount: due.length,
      upcoming: upcoming.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 20).map((u) => ({ subject: u.subject.label, step: u.stepIndex + 1, action: steps[u.stepIndex].action.kind, at: u.at.toISOString() })),
    });
  } catch (err) {
    next(err);
  }
});

adminOpsRulesRouter.get('/:id/fires', async (req, res, next) => {
  try {
    const rows = await prisma.opsRuleFire.findMany({ where: { ruleId: String(req.params.id) }, orderBy: { firedAt: 'desc' }, take: 100 });
    res.json(rows.map((f) => ({ ...f, firedAt: f.firedAt.toISOString() })));
  } catch (err) {
    next(err);
  }
});

adminOpsRulesRouter.post('/run', async (_req, res, next) => {
  try {
    res.json({ fired: await runOpsRules() });
  } catch (err) {
    next(err);
  }
});
