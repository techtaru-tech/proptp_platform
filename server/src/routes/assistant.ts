import { Router } from 'express';
import { prisma } from '../prisma';
import type { AuthedRequest } from '../services/auth';
import { ASSISTANT_MODEL, AssistantError, decide, isConfigured, sendMessage, view } from '../services/assistant';

/** The panel's chat assistant — /api/assistant. Every chat belongs to the person who started it. */
export const assistantRouter = Router();

const fail = (res: any, err: unknown, next: (e: unknown) => void) => (err instanceof AssistantError ? res.status(err.status).json({ error: err.message }) : next(err));

assistantRouter.get('/status', async (_req, res, next) => {
  try { res.json({ configured: await isConfigured(), model: ASSISTANT_MODEL }); } catch (err) { next(err); }
});

assistantRouter.get('/conversations', async (req: AuthedRequest, res, next) => {
  try {
    const rows = await prisma.assistantConversation.findMany({ where: { userId: req.auth!.sub, kind: 'general' }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, title: true, updatedAt: true } });
    res.json(rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })));
  } catch (err) { next(err); }
});

assistantRouter.get('/conversations/:id', async (req: AuthedRequest, res, next) => {
  try {
    const v = await view(req.auth!.sub, String(req.params.id));
    if (!v) return res.status(404).json({ error: 'That chat was not found.' });
    res.json(v);
  } catch (err) { next(err); }
});

/** Sends a message (starting a chat when there is no id), runs the assistant, and returns the chat as it now stands. */
assistantRouter.post('/chat', async (req: AuthedRequest, res, next) => {
  try {
    const id = await sendMessage(req.auth!.sub, String(req.headers.authorization ?? ''), req.body?.conversationId ? String(req.body.conversationId) : null, String(req.body?.message ?? ''));
    res.json(await view(req.auth!.sub, id));
  } catch (err) { fail(res, err, next); }
});

assistantRouter.post('/conversations/:id/decide', async (req: AuthedRequest, res, next) => {
  try {
    if (typeof req.body?.approve !== 'boolean') return res.status(400).json({ error: 'approve must be true or false.' });
    await decide(req.auth!.sub, String(req.headers.authorization ?? ''), String(req.params.id), req.body.approve);
    res.json(await view(req.auth!.sub, String(req.params.id)));
  } catch (err) { fail(res, err, next); }
});

assistantRouter.delete('/conversations/:id', async (req: AuthedRequest, res, next) => {
  try {
    const n = await prisma.assistantConversation.deleteMany({ where: { id: String(req.params.id), userId: req.auth!.sub } });
    if (n.count === 0) return res.status(404).json({ error: 'That chat was not found.' });
    res.status(204).send();
  } catch (err) { next(err); }
});
