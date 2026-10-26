import { Router } from 'express';
import { prisma } from '../prisma';
import { encrypt } from '../services/crypto';
import { writeAudit } from '../services/audit';
import type { AuthedRequest } from '../services/auth';
import { AI_MODELS, AiError, getAiSettings, transcriptionKey, tryAssistant } from '../services/whatsappAi';

/** Settings, the knowledge base and a test box for the WhatsApp AI assistant. */
export const whatsappAiRouter = Router();

async function settingsView() {
  const s = await getAiSettings();
  return {
    enabled: s.enabled,
    model: s.model,
    instructions: s.instructions,
    maxRepliesPerHour: s.maxRepliesPerHour,
    voiceEnabled: s.voiceEnabled,
    transcriptionProvider: s.transcriptionProvider,
    // Keys never leave the server; the page only learns whether one is set.
    hasAnthropicKey: !!s.anthropicKey || !!process.env.ANTHROPIC_API_KEY,
    hasTranscriptionKey: !!transcriptionKey(s),
    models: AI_MODELS,
  };
}

whatsappAiRouter.get('/settings', async (_req, res, next) => {
  try {
    res.json(await settingsView());
  } catch (err) {
    next(err);
  }
});

whatsappAiRouter.patch('/settings', async (req: AuthedRequest, res, next) => {
  try {
    const b = req.body ?? {};
    const data: Record<string, unknown> = {};
    if (b.enabled !== undefined) data.enabled = !!b.enabled;
    if (b.model !== undefined) {
      if (!AI_MODELS.some((m) => m.value === b.model)) return res.status(400).json({ error: 'Choose one of the listed models.' });
      data.model = b.model;
    }
    if (b.instructions !== undefined) data.instructions = String(b.instructions).slice(0, 6000);
    if (b.maxRepliesPerHour !== undefined) data.maxRepliesPerHour = Math.min(200, Math.max(1, Math.floor(Number(b.maxRepliesPerHour) || 20)));
    if (b.voiceEnabled !== undefined) data.voiceEnabled = !!b.voiceEnabled;
    if (b.transcriptionProvider !== undefined) {
      if (!['groq', 'openai'].includes(b.transcriptionProvider)) return res.status(400).json({ error: 'Provider must be groq or openai.' });
      data.transcriptionProvider = b.transcriptionProvider;
    }
    // Blank means "keep the stored one" — the page never receives a key to send back.
    if (b.anthropicKey) data.anthropicKey = encrypt(String(b.anthropicKey).trim());
    if (b.transcriptionKey) data.transcriptionKey = encrypt(String(b.transcriptionKey).trim());

    await getAiSettings();
    await prisma.whatsAppAiSettings.update({ where: { id: 'default' }, data });
    await writeAudit(req, { module: 'CRM', action: 'Updated the WhatsApp AI assistant settings', recordId: 'default', recordLabel: 'WhatsApp AI' });
    res.json(await settingsView());
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

const MAX_ENTRY_CHARS = 8000;

function entryFrom(body: any): { title: string; content: string; active: boolean } | { error: string } {
  const title = String(body?.title ?? '').trim();
  const content = String(body?.content ?? '').trim();
  if (!title) return { error: 'A title is required.' };
  if (!content) return { error: 'The content is required.' };
  if (content.length > MAX_ENTRY_CHARS) return { error: `Keep one entry under ${MAX_ENTRY_CHARS} characters — split it into two.` };
  return { title: title.slice(0, 120), content, active: body?.active !== false };
}

const kbRow = (e: { id: string; title: string; content: string; active: boolean; updatedAt: Date }) => ({
  id: e.id, title: e.title, content: e.content, active: e.active, updatedAt: e.updatedAt.toISOString(),
});

whatsappAiRouter.get('/knowledge', async (_req, res, next) => {
  try {
    res.json((await prisma.whatsAppKnowledge.findMany({ orderBy: { title: 'asc' } })).map(kbRow));
  } catch (err) {
    next(err);
  }
});

whatsappAiRouter.post('/knowledge', async (req: AuthedRequest, res, next) => {
  try {
    const entry = entryFrom(req.body);
    if ('error' in entry) return res.status(400).json({ error: entry.error });
    const created = await prisma.whatsAppKnowledge.create({ data: entry });
    await writeAudit(req, { module: 'CRM', action: 'Added a WhatsApp AI knowledge entry', recordId: created.id, recordLabel: created.title });
    res.status(201).json(kbRow(created));
  } catch (err) {
    next(err);
  }
});

whatsappAiRouter.patch('/knowledge/:id', async (req: AuthedRequest, res, next) => {
  try {
    const entry = entryFrom(req.body);
    if ('error' in entry) return res.status(400).json({ error: entry.error });
    const updated = await prisma.whatsAppKnowledge.update({ where: { id: String(req.params.id) }, data: entry });
    await writeAudit(req, { module: 'CRM', action: 'Updated a WhatsApp AI knowledge entry', recordId: updated.id, recordLabel: updated.title });
    res.json(kbRow(updated));
  } catch (err) {
    next(err);
  }
});

whatsappAiRouter.delete('/knowledge/:id', async (req: AuthedRequest, res, next) => {
  try {
    const removed = await prisma.whatsAppKnowledge.delete({ where: { id: String(req.params.id) } });
    await writeAudit(req, { module: 'CRM', action: 'Deleted a WhatsApp AI knowledge entry', recordId: removed.id, recordLabel: removed.title });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Try it, and what it has been doing
// ---------------------------------------------------------------------------

/** What a message would be answered with — nothing is sent and nothing is recorded. */
whatsappAiRouter.post('/test', async (req, res, next) => {
  try {
    const message = String(req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'Type a message to try.' });
    const result = await tryAssistant(message, req.body?.phone ? String(req.body.phone) : undefined);
    res.json({ reply: result.reply, handoff: result.handoff, handoffReason: result.handoffReason, record: result.record, usage: result.usage });
  } catch (err) {
    if (err instanceof AiError) return res.status(400).json({ error: err.message });
    // Anthropic's own errors carry a readable message (a bad key, a billing problem).
    const status = (err as { status?: number })?.status;
    if (status && status >= 400 && status < 500) return res.status(400).json({ error: `Anthropic said: ${(err as Error).message}` });
    next(err);
  }
});

whatsappAiRouter.get('/replies', async (_req, res, next) => {
  try {
    const rows = await prisma.whatsAppAiReply.findMany({ orderBy: { createdAt: 'desc' }, take: 40 });
    const convos = await prisma.whatsAppConversation.findMany({
      where: { id: { in: rows.map((r) => r.conversationId) } },
      select: { id: true, contactPhone: true, contactName: true },
    });
    const byId = new Map(convos.map((c) => [c.id, c]));
    res.json(
      rows.map((r) => ({
        id: r.id,
        contact: byId.get(r.conversationId)?.contactName || byId.get(r.conversationId)?.contactPhone || '—',
        inbound: r.inbound,
        reply: r.reply,
        voice: r.voice,
        handoff: r.handoff,
        handoffReason: r.handoffReason ?? undefined,
        status: r.status,
        error: r.error ?? undefined,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    next(err);
  }
});
