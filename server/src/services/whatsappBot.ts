import type { Prisma, WhatsAppBot, WhatsAppBotNode } from '@prisma/client';
import { prisma } from '../prisma';
import { sendPrepared, type InboundMessage } from './whatsapp';

/**
 * Auto-reply bots. A bot is a small flow of messages: the first one answers whoever writes in,
 * and each message may offer reply options (each leading to another message in the flow) or a
 * single link. WhatsApp's own rules shape it:
 *   - up to 3 reply options show as buttons, up to 10 as a tap-to-open list;
 *   - a link button is a message of its own — it cannot sit beside reply buttons;
 *   - free-form messages are only allowed inside 24 hours of the person's last message, which is
 *     always true here because every reply answers something they just sent.
 */

export interface BotButton {
  title: string;
  type: 'reply' | 'url';
  url?: string;
  /** Key of the node a reply option leads to. */
  nextKey?: string;
}

export const MAX_BUTTON_TITLE = 20;
export const MAX_REPLY_OPTIONS = 10;

/** `bot:<botId>:<nodeKey>:<index>` — what a tapped option reports back, so we know where it was. */
const optionId = (botId: string, nodeKey: string, index: number) => `bot:${botId}:${nodeKey}:${index}`;

export function readButtons(raw: Prisma.JsonValue): BotButton[] {
  return Array.isArray(raw) ? (raw as unknown as BotButton[]) : [];
}

/** `{name}` becomes the person's first name, or a greeting that still reads. */
function personalise(text: string, contactName?: string | null): string {
  const first = String(contactName ?? '').trim().split(/\s+/)[0] || 'there';
  return text.replace(/\{name\}/gi, first);
}

/** The Graph payload for a node, and the text the thread keeps for it. */
export function buildMessage(bot: WhatsAppBot, node: WhatsAppBotNode, to: string, contactName?: string | null) {
  const body = personalise(node.body, contactName);
  const buttons = readButtons(node.buttons);
  const base = { messaging_product: 'whatsapp', to };
  const header = node.headerImageUrl ? { header: { type: 'image', image: { link: node.headerImageUrl } } } : {};

  const link = buttons.find((b) => b.type === 'url');
  const replies = buttons.filter((b) => b.type === 'reply');

  if (link) {
    return {
      type: 'interactive',
      thread: `${body}\n[Link: ${link.title}]`,
      payload: {
        ...base, type: 'interactive',
        interactive: { type: 'cta_url', ...header, body: { text: body }, action: { name: 'cta_url', parameters: { display_text: link.title, url: link.url } } },
      },
    };
  }

  if (replies.length > 0) {
    const thread = `${body}\n${replies.map((b) => `[${b.title}]`).join(' ')}`;
    // Ids are positions among the node's reply options, which is what the tap reports back.
    const rows = replies.map((b, i) => ({ id: optionId(bot.id, node.key, buttons.indexOf(b)), title: b.title, i }));
    if (replies.length <= 3) {
      return {
        type: 'interactive', thread,
        payload: {
          ...base, type: 'interactive',
          interactive: { type: 'button', ...header, body: { text: body }, action: { buttons: rows.map((r) => ({ type: 'reply', reply: { id: r.id, title: r.title } })) } },
        },
      };
    }
    return {
      type: 'interactive', thread,
      payload: {
        ...base, type: 'interactive',
        interactive: { type: 'list', ...header, body: { text: body }, action: { button: 'Choose an option', sections: [{ title: 'Options', rows: rows.map((r) => ({ id: r.id, title: r.title })) }] } },
      },
    };
  }

  // A plain-text message cannot carry a header image, so saving refuses an image on a node with no options.
  return { type: 'text', thread: body, payload: { ...base, type: 'text', text: { body, preview_url: true } } };
}

async function sendNode(bot: WhatsAppBot, node: WhatsAppBotNode, conversation: { id: string; contactPhone: string; contactName: string | null; leadId: string | null }) {
  const message = buildMessage(bot, node, conversation.contactPhone, conversation.contactName);
  await sendPrepared(conversation.id, { type: message.type, body: message.thread, payload: message.payload });
  await prisma.whatsAppConversation.update({ where: { id: conversation.id }, data: { botRepliedAt: new Date() } });

  if (node.handoff && conversation.leadId) {
    await prisma.leadActivity.create({
      data: { leadId: conversation.leadId, type: 'note_added', description: `WhatsApp auto-reply "${bot.name}": the person reached "${node.label || node.key}" and is waiting for someone from the team.` },
    });
  }
}

/** Which active bot answers a message that is not a tap: a keyword match first, else the catch-all. */
async function pickBot(text: string): Promise<WhatsAppBot | null> {
  const bots = await prisma.whatsAppBot.findMany({ where: { status: 'active' }, orderBy: { createdAt: 'asc' } });
  const lower = text.toLowerCase();
  return (
    bots.find((b) => b.triggerType === 'keywords' && b.keywords.some((k) => k && lower.includes(k.toLowerCase()))) ??
    bots.find((b) => b.triggerType === 'any') ??
    null
  );
}

export async function handleBotInbound(
  conversationId: string,
  message: InboundMessage,
  parsed: { type: string; body: string }
): Promise<void> {
  const conversation = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return;

  // A tap on one of our options: go wherever that option leads.
  const tapped = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id;
  if (tapped?.startsWith('bot:')) {
    const [, botId, nodeKey, index] = tapped.split(':');
    const bot = await prisma.whatsAppBot.findUnique({ where: { id: botId }, include: { nodes: true } });
    if (!bot || bot.status !== 'active') return;
    const node = bot.nodes.find((n) => n.key === nodeKey);
    const option = node ? readButtons(node.buttons)[Number(index)] : undefined;
    const next = option?.nextKey ? bot.nodes.find((n) => n.key === option.nextKey) : undefined;
    if (next) await sendNode(bot, next, conversation);
    return;
  }

  // Anything else is a fresh message. Only plain text starts a flow — a photo or a voice note
  // is not a question the bot can answer — and never over a person who has stepped in.
  if (parsed.type !== 'text' || !parsed.body.trim() || conversation.intervened) return;

  const bot = await pickBot(parsed.body);
  if (!bot) return;
  if (conversation.botRepliedAt && Date.now() - conversation.botRepliedAt.getTime() < bot.cooldownHours * 3_600_000) return;

  const start = await prisma.whatsAppBotNode.findUnique({ where: { botId_key: { botId: bot.id, key: bot.startKey } } });
  if (start) await sendNode(bot, start, conversation);
}
