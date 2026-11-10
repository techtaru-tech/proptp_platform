import { Router, type NextFunction, type Response } from 'express';
import { prisma } from '../prisma';
import type { AuthedRequest } from '../services/auth';
import { AssistantError } from '../services/assistant';
import { resolveKey } from '../services/anthropicKey';
import { sectionOverview } from '../services/moduleOverview';
import { pageStats } from '../services/pageStats';
import { MODULE_AGENT_MODEL, askModuleAgent, kindOf, moduleChatView, type AgentEvent } from '../services/moduleAgent';
import { accessFor, isSection, type Access, type SectionKey } from '../services/sections';

/**
 * /api/overview/:section and /api/module-agent/:section — a section's Overview page and its
 * assistant. A section spans several modules, so the module guard lets these through and each
 * request is checked here: the person must hold at least one of the section's modules.
 */

type SectionRequest = AuthedRequest & { section?: SectionKey; access?: Access };

async function openSection(req: SectionRequest, res: Response, next: NextFunction) {
  const section = String(req.params.section);
  if (!isSection(section)) return res.status(404).json({ error: 'There is no such section.' });
  try {
    const access = await accessFor(req.auth!.sub);
    if (!access.canOpen(section)) return res.status(403).json({ error: 'Your role does not have access to this section.' });
    req.section = section;
    req.access = access;
    next();
  } catch (err) { next(err); }
}

export const sectionOverviewRouter = Router();

/** The KPI strip for an inner page (?path=/attendance/leave). Each page checks its own module. */
sectionOverviewRouter.get('/page-stats', async (req: AuthedRequest, res, next) => {
  try {
    res.json({ kpis: await pageStats(String(req.query.path ?? ''), await accessFor(req.auth!.sub)) });
  } catch (err) { next(err); }
});

sectionOverviewRouter.get('/:section', openSection, async (req: SectionRequest, res, next) => {
  try {
    res.json(await sectionOverview(req.section!, req.access!));
  } catch (err) { next(err); }
});

export const moduleAgentRouter = Router();

moduleAgentRouter.get('/:section/status', openSection, async (_req, res, next) => {
  try {
    const { key } = await resolveKey();
    res.json({ configured: !!key, model: MODULE_AGENT_MODEL });
  } catch (err) { next(err); }
});

moduleAgentRouter.get('/:section/conversations', openSection, async (req: SectionRequest, res, next) => {
  try {
    const rows = await prisma.assistantConversation.findMany({ where: { userId: req.auth!.sub, kind: kindOf(req.section!) }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, title: true, updatedAt: true } });
    res.json(rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })));
  } catch (err) { next(err); }
});

moduleAgentRouter.get('/:section/conversations/:id', openSection, async (req: SectionRequest, res, next) => {
  try {
    const v = await moduleChatView(req.auth!.sub, req.section!, String(req.params.id));
    if (!v) return res.status(404).json({ error: 'That chat was not found.' });
    res.json(v);
  } catch (err) { next(err); }
});

moduleAgentRouter.delete('/:section/conversations/:id', openSection, async (req: SectionRequest, res, next) => {
  try {
    const n = await prisma.assistantConversation.deleteMany({ where: { id: String(req.params.id), userId: req.auth!.sub, kind: kindOf(req.section!) } });
    if (n.count === 0) return res.status(404).json({ error: 'That chat was not found.' });
    res.status(204).send();
  } catch (err) { next(err); }
});

/** Ask a question; the answer streams back as server-sent events. Closing the connection stops the work. */
moduleAgentRouter.post('/:section/chat', openSection, async (req: SectionRequest, res) => {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx would otherwise hold the stream until it ends.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const emit = (e: AgentEvent) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
  const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, 15_000);

  try {
    await askModuleAgent({
      section: req.section!,
      access: req.access!,
      conversationId: req.body?.conversationId ? String(req.body.conversationId) : null,
      message: String(req.body?.message ?? ''),
      emit,
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof AssistantError ? err.message : 'Something went wrong while answering. Try again.';
    if (!(err instanceof AssistantError)) console.error('[module-agent]', err);
    emit({ type: 'error', message });
  } finally {
    clearInterval(keepAlive);
    if (!res.writableEnded) res.end();
  }
});
