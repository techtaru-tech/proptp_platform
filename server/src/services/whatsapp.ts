import axios from 'axios';
import type { Prisma, WhatsAppAccount, WhatsAppConversation } from '@prisma/client';
import { prisma } from '../prisma';
import { decrypt } from './crypto';

/**
 * WhatsApp Business via Meta's Cloud API.
 *
 * Two halves, same as the telephony integration: we POST to Graph to send, and Meta POSTs to
 * our webhook for inbound messages and delivery receipts. Credentials live per linked number,
 * because a business can have several and they are provisioned independently.
 */

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const REQUEST_TIMEOUT_MS = 20_000;

/** WhatsApp's customer-service window: freeform replies are only allowed inside 24h of the
 *  customer's last message. Outside it, only a pre-approved template may be sent. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsAppError extends Error {
  constructor(message: string, readonly httpStatus = 400) {
    super(message);
  }
}

/** Digits only. Meta returns `wa_id` without a +, and users type numbers every which way. */
export function normalizeWaNumber(input: unknown): string {
  return String(input ?? '').replace(/\D/g, '');
}

/**
 * The address Meta expects: digits with a country code. A bare ten digits is Indian, which
 * every number in this database is — and a broadcast that sends ten of them opens a second
 * thread for someone who already has one.
 */
export function toWaAddress(input: unknown): string {
  const digits = normalizeWaNumber(input);
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

/** The local 10 digits, for matching against Lead.phone which is stored without a country code. */
export function localPart(waNumber: string): string {
  const digits = normalizeWaNumber(waNumber);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function windowExpiresAt(conversation: Pick<WhatsAppConversation, 'lastInboundAt'>): Date | null {
  return conversation.lastInboundAt ? new Date(conversation.lastInboundAt.getTime() + SERVICE_WINDOW_MS) : null;
}

export function canSendFreeform(conversation: Pick<WhatsAppConversation, 'lastInboundAt'>): boolean {
  const expiry = windowExpiresAt(conversation);
  return !!expiry && expiry.getTime() > Date.now();
}

function requireCredentials(account: WhatsAppAccount): string {
  if (!account.active) throw new WhatsAppError('This WhatsApp number is turned off.');
  if (!account.accessToken) throw new WhatsAppError('No access token is saved for this WhatsApp number.');
  return decrypt(account.accessToken);
}

async function postToGraph(account: WhatsAppAccount, payload: Record<string, unknown>): Promise<string | undefined> {
  const token = requireCredentials(account);
  const { data } = await axios.post(`${GRAPH_BASE}/${account.phoneNumberId}/messages`, payload, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: REQUEST_TIMEOUT_MS,
  });
  return data?.messages?.[0]?.id ? String(data.messages[0].id) : undefined;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export function previewOf(message: { type: string; body: string }): string {
  if (message.body.trim()) return message.body.trim().slice(0, 160);
  return `[${message.type}]`;
}

/**
 * Finds or creates the thread for a number on a linked account, and links it to a lead.
 *
 * An inbound message from someone we do not know is a lead — that is the whole point of
 * putting WhatsApp behind a CRM — so one is created unless the account says otherwise.
 */
export async function ensureConversation(
  account: WhatsAppAccount,
  contactPhone: string,
  contactName?: string | null
): Promise<WhatsAppConversation> {
  const phone = toWaAddress(contactPhone);
  const existing = await prisma.whatsAppConversation.findUnique({
    where: { accountId_contactPhone: { accountId: account.id, contactPhone: phone } },
  });
  if (existing) {
    if (contactName && !existing.contactName) {
      return prisma.whatsAppConversation.update({ where: { id: existing.id }, data: { contactName } });
    }
    return existing;
  }

  const local = localPart(phone);
  let lead = local.length >= 10
    ? await prisma.lead.findFirst({
        where: { phone: { endsWith: local } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, assignedUserId: true },
      })
    : null;

  if (!lead && account.createLeadOnInbound) {
    const [firstName, ...rest] = String(contactName ?? '').trim().split(/\s+/).filter(Boolean);
    const created = await prisma.lead.create({
      data: {
        firstName: firstName || 'WhatsApp',
        lastName: rest.join(' ') || local || phone,
        phone: local || phone,
        source: 'whatsapp',
        status: 'new',
        priority: 'normal',
      },
      select: { id: true, assignedUserId: true },
    });
    await prisma.leadActivity.create({
      data: { leadId: created.id, type: 'created', description: `Lead created from a WhatsApp message to ${account.label}.` },
    });
    lead = created;
  }

  return prisma.whatsAppConversation.create({
    data: {
      accountId: account.id,
      contactPhone: phone,
      contactName: contactName ?? null,
      leadId: lead?.id ?? null,
      assignedUserId: lead?.assignedUserId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface SendResult {
  messageId: string;
  providerMessageId?: string;
}

/**
 * Sends a freeform text message. Refused outside the 24-hour window — Meta would reject it
 * anyway, and failing here gives a message a person can act on instead of a Graph error code.
 */
export async function sendText(
  conversationId: string,
  body: string,
  sentByUserId?: string | null
): Promise<SendResult> {
  const conversation = await prisma.whatsAppConversation.findUnique({
    where: { id: conversationId },
    include: { account: true },
  });
  if (!conversation) throw new WhatsAppError('Conversation not found.', 404);
  if (!body.trim()) throw new WhatsAppError('Message body is required.');
  if (!canSendFreeform(conversation)) {
    throw new WhatsAppError(
      'The 24-hour reply window has closed. WhatsApp only allows an approved template message now.',
      409
    );
  }

  return deliver(conversation.account, conversation, {
    type: 'text',
    body: body.trim(),
    sentByUserId: sentByUserId ?? null,
    payload: { messaging_product: 'whatsapp', to: conversation.contactPhone, type: 'text', text: { body: body.trim(), preview_url: true } },
  });
}

/** Templates are the only thing allowed once the window has closed. */
export async function sendTemplate(
  conversationId: string,
  templateName: string,
  languageCode: string,
  sentByUserId?: string | null
): Promise<SendResult> {
  const conversation = await prisma.whatsAppConversation.findUnique({
    where: { id: conversationId },
    include: { account: true },
  });
  if (!conversation) throw new WhatsAppError('Conversation not found.', 404);
  if (!templateName.trim()) throw new WhatsAppError('A template name is required.');

  return deliver(conversation.account, conversation, {
    type: 'template',
    body: `[template: ${templateName}]`,
    sentByUserId: sentByUserId ?? null,
    payload: {
      messaging_product: 'whatsapp',
      to: conversation.contactPhone,
      type: 'template',
      template: { name: templateName.trim(), language: { code: languageCode || 'en' } },
    },
  });
}

// ---------------------------------------------------------------------------
// Approved templates, read from Meta
//
// The list is never mirrored into our database. A template's approval can be revoked by Meta
// at any time, and a stale local copy would offer people something that no longer sends.
// ---------------------------------------------------------------------------

export interface ApprovedTemplate {
  name: string;
  language: string;
  category: string;
  /** The BODY text as approved, with its {{1}} placeholders left in. */
  body: string;
  /** How many placeholders the body has — the send form asks for exactly this many values. */
  variableCount: number;
  /** Meta allows variables in the header too; we do not fill them, so such templates are flagged. */
  unsupported?: string;
}

/** Substitutes {{1}}, {{2}} … with the values actually sent, for the copy kept in the thread. */
export function fillPlaceholders(text: string, params: string[]): string {
  return params.reduce(
    (filled, value, index) => filled.replace(new RegExp(`\\{\\{\\s*${index + 1}\\s*\\}\\}`, 'g'), value),
    text
  );
}

function readTemplate(raw: any): ApprovedTemplate {
  const components: any[] = Array.isArray(raw?.components) ? raw.components : [];
  const body = components.find((c) => c?.type === 'BODY');
  const header = components.find((c) => c?.type === 'HEADER');
  const text = String(body?.text ?? '');
  const placeholders = text.match(/\{\{\s*\d+\s*\}\}/g) ?? [];

  const headerHasVariables = /\{\{\s*\d+\s*\}\}/.test(String(header?.text ?? '')) ||
    ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(header?.format ?? ''));

  return {
    name: String(raw?.name ?? ''),
    language: String(raw?.language ?? 'en'),
    category: String(raw?.category ?? ''),
    body: text,
    variableCount: placeholders.length,
    unsupported: headerHasVariables ? 'This template has a header that needs its own content, which this screen cannot fill yet.' : undefined,
  };
}

/** Only APPROVED templates — the others cannot be sent and would only be false choices. */
export async function listApprovedTemplates(account: WhatsAppAccount): Promise<ApprovedTemplate[]> {
  const token = requireCredentials(account);
  if (!account.wabaId) throw new WhatsAppError('This number has no WhatsApp Business Account ID saved.');

  const { data } = await axios.get(`${GRAPH_BASE}/${account.wabaId}/message_templates`, {
    params: { access_token: token, fields: 'name,status,language,category,components', limit: 200 },
    timeout: REQUEST_TIMEOUT_MS,
  });

  return (Array.isArray(data?.data) ? data.data : [])
    .filter((t: any) => String(t?.status).toUpperCase() === 'APPROVED')
    .map(readTemplate)
    .sort((a: ApprovedTemplate, b: ApprovedTemplate) => a.name.localeCompare(b.name));
}

/**
 * One approved template to one number, starting the thread if there is not one yet.
 *
 * Separate from `sendTemplate`, which replies inside a conversation someone is already
 * reading: a broadcast reaches people who have never written to us, so the thread has to be
 * created before there is anywhere to record the message.
 */
export async function sendTemplateToNumber(
  account: WhatsAppAccount,
  contactPhone: string,
  template: { name: string; language: string; params: string[]; body?: string },
  sentByUserId?: string | null
): Promise<SendResult & { conversationId: string; leadId: string | null }> {
  const conversation = await ensureConversation(account, contactPhone);

  const components = template.params.length > 0
    ? [{ type: 'body', parameters: template.params.map((text) => ({ type: 'text', text })) }]
    : undefined;

  const result = await deliver(account, conversation, {
    type: 'template',
    // Readable in the thread: the approved wording with the values actually sent filled in,
    // falling back to the template's name when the caller did not hand over the wording.
    body: fillPlaceholders(template.body || `[${template.name}]`, template.params),
    sentByUserId: sentByUserId ?? null,
    payload: {
      messaging_product: 'whatsapp',
      to: conversation.contactPhone,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language || 'en' },
        ...(components ? { components } : {}),
      },
    },
  });

  return { ...result, conversationId: conversation.id, leadId: conversation.leadId };
}

/** One write path for every outbound message, so the thread summary can never drift. */
async function deliver(
  account: WhatsAppAccount,
  conversation: WhatsAppConversation,
  input: { type: string; body: string; sentByUserId: string | null; payload: Record<string, unknown> }
): Promise<SendResult> {
  // Checked before anything is written: a missing token is a configuration problem, not a
  // failed message, and recording it as one would leave a dead row in the customer's thread.
  requireCredentials(account);

  let providerMessageId: string | undefined;
  let status = 'sent';
  let error: string | null = null;

  try {
    providerMessageId = await postToGraph(account, input.payload);
  } catch (err) {
    status = 'failed';
    error = axios.isAxiosError(err)
      ? String(err.response?.data?.error?.message ?? err.message)
      : err instanceof Error
        ? err.message
        : 'Unknown error';
  }

  const message = await prisma.whatsAppMessage.create({
    data: {
      conversationId: conversation.id,
      providerMessageId: providerMessageId ?? null,
      direction: 'outbound',
      type: input.type,
      body: input.body,
      status,
      error,
      sentByUserId: input.sentByUserId,
    },
  });

  if (status === 'failed') {
    await prisma.whatsAppAccount.update({ where: { id: account.id }, data: { status: 'error', lastError: error } });
    throw new WhatsAppError(error ?? 'WhatsApp rejected the message.', 502);
  }

  await prisma.whatsAppConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: message.sentAt,
      lastMessagePreview: previewOf(message),
      // "Intervened" means a person replied here, as opposed to an automation.
      intervened: input.sentByUserId ? true : conversation.intervened,
    },
  });
  await prisma.whatsAppAccount.update({
    where: { id: account.id },
    data: { lastMessageAt: message.sentAt, status: 'connected', lastError: null },
  });

  if (conversation.leadId) {
    await prisma.leadActivity.create({
      data: {
        leadId: conversation.leadId,
        type: 'note_added',
        description: `WhatsApp sent: "${previewOf(message)}"`,
        userId: input.sentByUserId ?? undefined,
      },
    });
  }

  return { messageId: message.id, providerMessageId };
}

// ---------------------------------------------------------------------------
// Inbound — called by the webhook
// ---------------------------------------------------------------------------

interface InboundMessage {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  location?: { latitude?: number; longitude?: number; name?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

/** Flattens Meta's per-type message shapes into the one row we store. */
function readInbound(message: InboundMessage): { type: string; body: string; mediaMimeType?: string } {
  const type = message.type ?? 'text';
  switch (type) {
    case 'text': return { type, body: message.text?.body ?? '' };
    case 'image': return { type, body: message.image?.caption ?? '', mediaMimeType: message.image?.mime_type };
    case 'document': return { type, body: message.document?.caption ?? message.document?.filename ?? '', mediaMimeType: message.document?.mime_type };
    case 'audio': return { type, body: '', mediaMimeType: message.audio?.mime_type };
    case 'video': return { type, body: message.video?.caption ?? '', mediaMimeType: message.video?.mime_type };
    case 'location': return { type, body: message.location?.name ?? `${message.location?.latitude}, ${message.location?.longitude}` };
    case 'button': return { type: 'text', body: message.button?.text ?? '' };
    case 'interactive': return { type: 'text', body: message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? '' };
    default: return { type: 'unsupported', body: `[${type}]` };
  }
}

export async function recordInbound(
  account: WhatsAppAccount,
  message: InboundMessage,
  contactName?: string | null
): Promise<void> {
  const from = normalizeWaNumber(message.from);
  if (!from) return;

  // Meta redelivers on any non-2xx, so the wamid is the guard against duplicates.
  if (message.id) {
    const seen = await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: message.id }, select: { id: true } });
    if (seen) return;
  }

  const conversation = await ensureConversation(account, from, contactName);
  const parsed = readInbound(message);
  const sentAt = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();

  const created = await prisma.whatsAppMessage.create({
    data: {
      conversationId: conversation.id,
      providerMessageId: message.id ?? null,
      direction: 'inbound',
      type: parsed.type,
      body: parsed.body,
      mediaMimeType: parsed.mediaMimeType ?? null,
      status: 'delivered',
      sentAt,
    },
  });

  await prisma.whatsAppConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: sentAt,
      lastInboundAt: sentAt,
      lastMessagePreview: previewOf(created),
      unreadCount: { increment: 1 },
      contactName: contactName ?? conversation.contactName,
    },
  });
  await prisma.whatsAppAccount.update({
    where: { id: account.id },
    data: { lastMessageAt: sentAt, status: 'connected', lastError: null },
  });

  if (conversation.leadId) {
    await prisma.leadActivity.create({
      data: { leadId: conversation.leadId, type: 'note_added', description: `WhatsApp received: "${previewOf(created)}"` },
    });
  }
}

/** Delivery receipts: sent -> delivered -> read, or failed. */
export async function recordStatus(status: { id?: string; status?: string; errors?: { title?: string }[] }): Promise<void> {
  if (!status.id || !status.status) return;
  const data: Prisma.WhatsAppMessageUncheckedUpdateInput = { status: status.status };
  if (status.errors?.[0]?.title) data.error = status.errors[0].title;
  await prisma.whatsAppMessage.updateMany({ where: { providerMessageId: status.id }, data });
}
