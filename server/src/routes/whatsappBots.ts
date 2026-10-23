import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { writeAudit } from '../services/audit';
import type { AuthedRequest } from '../services/auth';
import { MAX_BUTTON_TITLE, MAX_REPLY_OPTIONS, readButtons, type BotButton } from '../services/whatsappBot';

/**
 * Auto-reply bots: the flow of messages an incoming WhatsApp chat is answered with. The shape
 * of a flow is checked here, once, so a saved bot can never offer WhatsApp something it will refuse.
 */
export const whatsappBotsRouter = Router();

const STATUSES = ['draft', 'active', 'paused'];
const TRIGGERS = ['any', 'keywords'];

interface NodeInput {
  key?: string;
  label?: string;
  body?: string;
  headerImageUrl?: string;
  buttons?: BotButton[];
  handoff?: boolean;
}

/** Returns the cleaned nodes, or the reason the flow cannot be saved. */
interface CleanNode {
  key: string;
  label: string;
  body: string;
  headerImageUrl: string | null;
  buttons: BotButton[];
  handoff: boolean;
}

function readFlow(body: any): { nodes: CleanNode[] } | { error: string } {
  const raw: NodeInput[] = Array.isArray(body?.nodes) ? body.nodes : [];
  if (raw.length === 0) return { error: 'A bot needs at least one message.' };

  const keys = raw.map((n) => String(n.key ?? '').trim());
  if (keys.some((k) => !/^[a-z0-9_]{1,20}$/i.test(k)) || new Set(keys).size !== keys.length) return { error: 'Every message needs its own short id.' };
  if (!keys.includes(String(body?.startKey ?? ''))) return { error: 'The first message is missing.' };

  const nodes: CleanNode[] = [];
  for (const [i, n] of raw.entries()) {
    const where = `Message ${i + 1}`;
    const text = String(n.body ?? '').trim();
    if (!text) return { error: `${where} has no text.` };
    if (text.length > 1024) return { error: `${where} is ${text.length} characters — WhatsApp allows 1024.` };

    const buttons: BotButton[] = (Array.isArray(n.buttons) ? n.buttons : []).map((b) => ({
      title: String(b?.title ?? '').trim(),
      type: b?.type === 'url' ? 'url' : 'reply',
      ...(b?.type === 'url' ? { url: String(b.url ?? '').trim() } : { nextKey: b?.nextKey ? String(b.nextKey) : undefined }),
    }));
    if (buttons.some((b) => !b.title)) return { error: `${where}: every option needs a label.` };
    if (buttons.some((b) => b.title.length > MAX_BUTTON_TITLE)) return { error: `${where}: option labels are limited to ${MAX_BUTTON_TITLE} characters.` };

    const links = buttons.filter((b) => b.type === 'url');
    const replies = buttons.filter((b) => b.type === 'reply');
    if (links.length > 0 && (links.length > 1 || replies.length > 0)) {
      return { error: `${where}: WhatsApp allows either one link button or reply options in a message, not both. Put the link in its own message.` };
    }
    if (links.some((b) => !/^https?:\/\/\S+$/i.test(b.url ?? ''))) return { error: `${where}: the link must start with https://` };
    if (replies.length > MAX_REPLY_OPTIONS) return { error: `${where}: at most ${MAX_REPLY_OPTIONS} reply options.` };
    if (replies.some((b) => b.nextKey && !keys.includes(b.nextKey))) return { error: `${where}: an option leads to a message that no longer exists.` };

    const image = String(n.headerImageUrl ?? '').trim();
    if (image && !/^https:\/\/\S+$/i.test(image)) return { error: `${where}: the image must be a public https link.` };
    if (image && buttons.length === 0) return { error: `${where}: an image can only be shown on a message that has options or a link.` };

    nodes.push({ key: keys[i], label: String(n.label ?? '').trim(), body: text, headerImageUrl: image || null, buttons, handoff: n.handoff === true });
  }
  return { nodes };
}

function readSettings(body: any): { error: string } | { name: string; status: string; triggerType: string; keywords: string[]; cooldownHours: number; startKey: string } {
  const name = String(body?.name ?? '').trim();
  if (!name) return { error: 'name is required.' };
  const status = String(body?.status ?? 'draft');
  if (!STATUSES.includes(status)) return { error: 'status must be draft, active or paused.' };
  const triggerType = String(body?.triggerType ?? 'any');
  if (!TRIGGERS.includes(triggerType)) return { error: 'triggerType must be any or keywords.' };
  const keywords: string[] = Array.from(new Set((Array.isArray(body?.keywords) ? body.keywords : []).map((k: unknown) => String(k ?? '').trim().toLowerCase()).filter(Boolean)));
  if (triggerType === 'keywords' && keywords.length === 0) return { error: 'Add at least one keyword, or answer every first message.' };
  return { name, status, triggerType, keywords: triggerType === 'keywords' ? keywords : [], cooldownHours: Math.min(168, Math.max(0, Math.floor(Number(body?.cooldownHours) || 0))), startKey: String(body?.startKey ?? '') };
}

function summary(b: { id: string; name: string; status: string; triggerType: string; keywords: string[]; cooldownHours: number; startKey: string; createdAt: Date }, nodeCount: number) {
  return { id: b.id, name: b.name, status: b.status, triggerType: b.triggerType, keywords: b.keywords, cooldownHours: b.cooldownHours, startKey: b.startKey, nodeCount, createdAt: b.createdAt.toISOString() };
}

whatsappBotsRouter.get('/', async (_req, res, next) => {
  try {
    const bots = await prisma.whatsAppBot.findMany({ include: { _count: { select: { nodes: true } } }, orderBy: { createdAt: 'desc' } });
    res.json(bots.map((b) => summary(b, b._count.nodes)));
  } catch (err) {
    next(err);
  }
});

whatsappBotsRouter.get('/:id', async (req, res, next) => {
  try {
    const bot = await prisma.whatsAppBot.findUnique({ where: { id: String(req.params.id) }, include: { nodes: { orderBy: { sortOrder: 'asc' } } } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    res.json({
      ...summary(bot, bot.nodes.length),
      nodes: bot.nodes.map((n) => ({ key: n.key, label: n.label, body: n.body, headerImageUrl: n.headerImageUrl ?? undefined, buttons: readButtons(n.buttons), handoff: n.handoff })),
    });
  } catch (err) {
    next(err);
  }
});

whatsappBotsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const settings = readSettings(req.body);
    if ('error' in settings) return res.status(400).json({ error: settings.error });
    const flow = readFlow(req.body);
    if ('error' in flow) return res.status(400).json({ error: flow.error });

    const created = await prisma.whatsAppBot.create({
      data: { ...settings, nodes: { create: flow.nodes.map((n, i) => ({ ...n, buttons: n.buttons as unknown as Prisma.InputJsonValue, sortOrder: i })) } },
      select: { id: true, name: true },
    });
    await writeAudit(req, { module: 'CRM', action: 'Created a WhatsApp auto-reply bot', recordId: created.id, recordLabel: created.name });
    res.status(201).json({ id: created.id });
  } catch (err) {
    next(err);
  }
});

whatsappBotsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const settings = readSettings(req.body);
    if ('error' in settings) return res.status(400).json({ error: settings.error });
    const flow = readFlow(req.body);
    if ('error' in flow) return res.status(400).json({ error: flow.error });

    // Messages are replaced as one list — they are edited that way, and their keys keep every
    // option pointing at the right place.
    await prisma.$transaction(async (tx) => {
      await tx.whatsAppBotNode.deleteMany({ where: { botId: id } });
      await tx.whatsAppBot.update({ where: { id }, data: { ...settings, nodes: { create: flow.nodes.map((n, i) => ({ ...n, buttons: n.buttons as unknown as Prisma.InputJsonValue, sortOrder: i })) } } });
    });
    await writeAudit(req, { module: 'CRM', action: 'Updated a WhatsApp auto-reply bot', recordId: id, recordLabel: settings.name });
    res.json({ id });
  } catch (err) {
    next(err);
  }
});

whatsappBotsRouter.patch('/:id/status', async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'status must be draft, active or paused.' });
    const updated = await prisma.whatsAppBot.update({ where: { id: String(req.params.id) }, data: { status }, select: { id: true, name: true } });
    await writeAudit(req, { module: 'CRM', action: `Set a WhatsApp auto-reply bot to ${status}`, recordId: updated.id, recordLabel: updated.name });
    res.json({ id: updated.id, status });
  } catch (err) {
    next(err);
  }
});

whatsappBotsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const removed = await prisma.whatsAppBot.delete({ where: { id: String(req.params.id) } });
    await writeAudit(req, { module: 'CRM', action: 'Deleted a WhatsApp auto-reply bot', recordId: removed.id, recordLabel: removed.name });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
