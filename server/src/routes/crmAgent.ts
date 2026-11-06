import { Router } from 'express';
import { prisma } from '../prisma';
import type { AuthedRequest } from '../services/auth';
import { AssistantError } from '../services/assistant';
import { resolveKey } from '../services/anthropicKey';
import { CRM_AGENT_MODEL, askCrmAgent, crmChatView, type AgentEvent, type PageContext } from '../services/crmAgent';

/** The CRM analyst — /api/crm-agent. Needs the CRM module; every chat belongs to the person who started it. */
export const crmAgentRouter = Router();

crmAgentRouter.get('/status', async (_req, res, next) => {
  try {
    const { key } = await resolveKey();
    res.json({ configured: !!key, model: CRM_AGENT_MODEL });
  } catch (err) { next(err); }
});

crmAgentRouter.get('/conversations', async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.assistantConversation.findMany({ where: { userId: req.auth!.sub, kind: 'crm' }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, title: true, updatedAt: true } });
    res.json(rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })));
  } catch (err) { next(err); }
});

crmAgentRouter.get('/conversations/:id', async (req: AuthedRequest, res, next) => {
  try {
    const v = await crmChatView(req.auth!.sub, String(req.params.id));
    if (!v) return res.status(404).json({ error: 'That chat was not found.' });
    res.json(v);
  } catch (err) { next(err); }
});

crmAgentRouter.delete('/conversations/:id', async (req: AuthedRequest, res, next) => {
  try {
    const n = await prisma.assistantConversation.deleteMany({ where: { id: String(req.params.id), userId: req.auth!.sub, kind: 'crm' } });
    if (n.count === 0) return res.status(404).json({ error: 'That chat was not found.' });
    res.status(204).send();
  } catch (err) { next(err); }
});

/**
 * Ask a question. The answer streams back as server-sent events: the chat id, each lookup as it
 * starts and finishes, progress notes, the answer text as it is written, then "done". Closing the
 * connection stops the work.
 */
crmAgentRouter.post('/chat', async (req: AuthedRequest, res) => {
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
    const context = req.body?.context && typeof req.body.context === 'object' ? (req.body.context as PageContext) : undefined;
    await askCrmAgent({
      userId: req.auth!.sub,
      auth: String(req.headers.authorization ?? ''),
      conversationId: req.body?.conversationId ? String(req.body.conversationId) : null,
      message: String(req.body?.message ?? ''),
      context,
      emit,
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof AssistantError ? err.message : 'Something went wrong while answering. Try again.';
    if (!(err instanceof AssistantError)) console.error('[crm-agent]', err);
    emit({ type: 'error', message });
  } finally {
    clearInterval(keepAlive);
    if (!res.writableEnded) res.end();
  }
});
