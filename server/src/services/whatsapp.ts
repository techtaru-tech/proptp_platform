import fs from 'fs';
import axios from 'axios';
import type { Prisma, WhatsAppAccount, WhatsAppConversation } from '@prisma/client';
import { prisma } from '../prisma';
import { decrypt } from './crypto';
import { UPLOAD_DIR } from './upload';

/**
 * WhatsApp Business via Meta's Cloud API.
 *
 * Two halves, same as the telephony integration: we POST to Graph to send, and Meta POSTs to
 * our webhook for inbound messages and delivery receipts. Credentials live per linked number,
 * because a business can have several and they are provisioned independently.
 */

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PINBOT_BASE = 'https://partnersv1.pinbot.ai/v3';
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

/** The Partners API speaks Meta's message shapes; only the address and the auth header differ. */
function apiFor(account: WhatsAppAccount): { base: string; headers: Record<string, string> } {
  const token = requireCredentials(account);
  return account.provider === 'pinbot'
    ? { base: PINBOT_BASE, headers: { apikey: token, 'Content-Type': 'application/json' } }
    : { base: GRAPH_BASE, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

async function postToGraph(account: WhatsAppAccount, payload: Record<string, unknown>): Promise<string | undefined> {
  const { base, headers } = apiFor(account);
  const { data } = await axios.post(`${base}/${account.phoneNumberId}/messages`, payload, {
    headers,
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
  /** IMAGE | VIDEO | DOCUMENT when the header is a file — the sender supplies a link to it per send. */
  headerFormat?: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  /** A header with its own {{1}} variable, which is not filled — such templates are flagged. */
  unsupported?: string;
}

/**
 * Fills the tokens a variable may carry with this person's own details. Meta rejects an empty
 * variable outright, so an unknown name becomes a greeting that still reads.
 */
export function resolveTemplateParams(params: string[], person: { firstName: string; lastName: string }): string[] {
  return params.map((param) => {
    const filled = param
      .replace(/\{first_name\}/gi, person.firstName)
      .replace(/\{last_name\}/gi, person.lastName)
      .replace(/\{full_name\}/gi, `${person.firstName} ${person.lastName}`.trim());
    return filled.trim() || 'there';
  });
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

  const headerHasVariables = /\{\{\s*\d+\s*\}\}/.test(String(header?.text ?? ''));
  const format = String(header?.format ?? '').toUpperCase();
  const headerFormat = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format) ? (format as 'IMAGE' | 'VIDEO' | 'DOCUMENT') : undefined;

  // Quick-reply, phone and fixed-link buttons need nothing at send time; the rest take a value we do not collect.
  const buttons: any[] = components.find((c) => c?.type === 'BUTTONS')?.buttons ?? [];
  const buttonNeedsValue = buttons.some(
    (b) => (String(b?.type).toUpperCase() === 'URL' && /\{\{/.test(String(b?.url ?? ''))) || !['URL', 'PHONE_NUMBER', 'QUICK_REPLY'].includes(String(b?.type).toUpperCase())
  );

  return {
    name: String(raw?.name ?? ''),
    language: String(raw?.language ?? 'en'),
    category: String(raw?.category ?? ''),
    body: text,
    variableCount: placeholders.length,
    headerFormat,
    unsupported: headerHasVariables
      ? 'This template has a header with its own variable, which this screen cannot fill yet.'
      : buttonNeedsValue
        ? 'This template has a button that needs a value per message (a link with a variable, or a copy-code button), which this screen cannot fill yet.'
        : undefined,
  };
}

/** Only APPROVED templates — the others cannot be sent and would only be false choices. */
export async function listApprovedTemplates(account: WhatsAppAccount): Promise<ApprovedTemplate[]> {
  const { base, headers } = apiFor(account);
  if (!account.wabaId) throw new WhatsAppError('This number has no WhatsApp Business Account ID saved.');

  const { data } = await axios.get(`${base}/${account.wabaId}/message_templates`, {
    headers,
    params: { fields: 'name,status,language,category,components', limit: 200 },
    timeout: REQUEST_TIMEOUT_MS,
  });

  return (Array.isArray(data?.data) ? data.data : [])
    .filter((t: any) => String(t?.status).toUpperCase() === 'APPROVED')
    .map(readTemplate)
    .sort((a: ApprovedTemplate, b: ApprovedTemplate) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Template management — create, track approval, delete
//
// Meta reviews every template (usually minutes, sometimes a day) and answers APPROVED,
// PENDING or REJECTED. Nothing is stored here: the status shown is whatever Meta says now.
// ---------------------------------------------------------------------------

export interface ManagedTemplate {
  id?: string;
  name: string;
  language: string;
  category: string;
  /** APPROVED | PENDING | REJECTED | PAUSED | DISABLED … exactly as Meta reports it. */
  status: string;
  rejectedReason?: string;
  header?: string;
  /** TEXT | IMAGE | VIDEO | DOCUMENT — what kind of header the template carries. */
  headerFormat?: string;
  body: string;
  footer?: string;
  buttons: TemplateButton[];
}

export type TemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string }
  | { type: 'PHONE_NUMBER'; text: string; phone: string };

function metaFailure(err: unknown): WhatsAppError {
  if (axios.isAxiosError(err)) {
    const e = err.response?.data?.error;
    // `error_user_msg` is Meta's plain-language reason, e.g. why a template body was refused.
    return new WhatsAppError(String(e?.error_user_msg ?? e?.message ?? err.response?.data?.message ?? err.message), 502);
  }
  return new WhatsAppError(err instanceof Error ? err.message : 'WhatsApp request failed.', 502);
}

export async function listAllTemplates(account: WhatsAppAccount): Promise<ManagedTemplate[]> {
  const { base, headers } = apiFor(account);
  if (!account.wabaId) throw new WhatsAppError('This number has no WhatsApp Business Account ID saved.');
  try {
    const { data } = await axios.get(`${base}/${account.wabaId}/message_templates`, {
      headers,
      params: { fields: 'name,status,language,category,components,rejected_reason', limit: 200 },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return (Array.isArray(data?.data) ? data.data : []).map((t: any): ManagedTemplate => {
      const components: any[] = Array.isArray(t?.components) ? t.components : [];
      const text = (type: string) => components.find((c) => c?.type === type)?.text as string | undefined;
      const reason = String(t?.rejected_reason ?? '');
      return {
        id: t?.id ? String(t.id) : undefined,
        name: String(t?.name ?? ''),
        language: String(t?.language ?? 'en'),
        category: String(t?.category ?? ''),
        status: String(t?.status ?? '').toUpperCase(),
        // Meta answers NONE for a template that was not rejected.
        rejectedReason: reason && reason !== 'NONE' ? reason : undefined,
        header: text('HEADER'),
        headerFormat: components.find((c) => c?.type === 'HEADER')?.format ? String(components.find((c) => c?.type === 'HEADER').format).toUpperCase() : undefined,
        body: text('BODY') ?? '',
        footer: text('FOOTER'),
        buttons: ((components.find((c) => c?.type === 'BUTTONS')?.buttons ?? []) as any[]).map((b): TemplateButton => {
          const type = String(b?.type ?? '').toUpperCase();
          if (type === 'URL') return { type: 'URL', text: String(b.text ?? ''), url: String(b.url ?? '') };
          if (type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: String(b.text ?? ''), phone: String(b.phone_number ?? '') };
          return { type: 'QUICK_REPLY', text: String(b.text ?? '') };
        }),
      };
    });
  } catch (err) {
    throw metaFailure(err);
  }
}

export interface NewTemplate {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY';
  /** A text header, or a file header whose sample Meta's reviewers see. The file itself is sent per message. */
  header?:
    | { format: 'TEXT'; text: string }
    | { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; sample: { path: string; mime: string; name: string } };
  body: string;
  footer?: string;
  buttons?: TemplateButton[];
  /** One sample per {{n}} in the body — Meta will not review a template without them. */
  samples: string[];
}

/** The App ID Meta's file-upload API is addressed to. Read from the token itself when not configured. */
async function resolveAppId(token: string): Promise<string> {
  if (process.env.META_APP_ID) return process.env.META_APP_ID;
  try {
    const { data } = await axios.get(`${GRAPH_BASE}/debug_token`, {
      params: { input_token: token, access_token: token },
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (data?.data?.app_id) return String(data.data.app_id);
  } catch {
    // fall through to the explanation below
  }
  throw new WhatsAppError('Could not work out the Meta App ID needed to upload the sample file. Set META_APP_ID in server/.env.');
}

/**
 * Meta will not review a template with an image, video or document header unless it is shown
 * an example of it, and that example has to go through its Resumable Upload API first.
 * Returns the handle (`h`) the template refers to.
 */
async function uploadSampleHandle(account: WhatsAppAccount, sample: { path: string; mime: string; name: string }): Promise<string> {
  if (account.provider === 'pinbot') {
    throw new WhatsAppError('Image, video and document headers can only be created on a number linked through Meta directly.');
  }
  const token = requireCredentials(account);
  const buffer = fs.readFileSync(sample.path);
  try {
    const appId = await resolveAppId(token);
    const { data: session } = await axios.post(`${GRAPH_BASE}/${appId}/uploads`, null, {
      params: { file_length: buffer.length, file_type: sample.mime, file_name: sample.name, access_token: token },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const { data } = await axios.post(`${GRAPH_BASE}/${session.id}`, buffer, {
      headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
      maxBodyLength: Infinity,
      timeout: 120_000,
    });
    if (!data?.h) throw new WhatsAppError('Meta did not accept the sample file.', 502);
    return String(data.h);
  } catch (err) {
    if (err instanceof WhatsAppError) throw err;
    throw metaFailure(err);
  }
}

export async function createTemplate(account: WhatsAppAccount, input: NewTemplate): Promise<{ id?: string; status: string }> {
  const { base, headers } = apiFor(account);
  if (!account.wabaId) throw new WhatsAppError('This number has no WhatsApp Business Account ID saved.');

  const components: Record<string, unknown>[] = [];
  if (input.header?.format === 'TEXT') {
    components.push({ type: 'HEADER', format: 'TEXT', text: input.header.text });
  } else if (input.header) {
    const handle = await uploadSampleHandle(account, input.header.sample);
    components.push({ type: 'HEADER', format: input.header.format, example: { header_handle: [handle] } });
  }

  const count = (input.body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;
  components.push({
    type: 'BODY',
    text: input.body,
    ...(count > 0 ? { example: { body_text: [input.samples.slice(0, count)] } } : {}),
  });
  if (input.footer) components.push({ type: 'FOOTER', text: input.footer });

  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((b) => {
        if (b.type === 'URL') {
          return { type: 'URL', text: b.text, url: b.url, ...(b.example ? { example: [b.example] } : {}) };
        }
        if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone };
        return { type: 'QUICK_REPLY', text: b.text };
      }),
    });
  }

  try {
    const { data } = await axios.post(
      `${base}/${account.wabaId}/message_templates`,
      { name: input.name, language: input.language, category: input.category, components },
      { headers, timeout: REQUEST_TIMEOUT_MS }
    );
    return { id: data?.id ? String(data.id) : undefined, status: String(data?.status ?? 'PENDING').toUpperCase() };
  } catch (err) {
    throw metaFailure(err);
  }
}

export async function deleteTemplate(account: WhatsAppAccount, name: string): Promise<void> {
  const { base, headers } = apiFor(account);
  if (!account.wabaId) throw new WhatsAppError('This number has no WhatsApp Business Account ID saved.');
  try {
    await axios.delete(`${base}/${account.wabaId}/message_templates`, { headers, params: { name }, timeout: REQUEST_TIMEOUT_MS });
  } catch (err) {
    throw metaFailure(err);
  }
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
  template: { name: string; language: string; params: string[]; body?: string; headerMedia?: { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; link: string } },
  sentByUserId?: string | null
): Promise<SendResult & { conversationId: string; leadId: string | null }> {
  const conversation = await ensureConversation(account, contactPhone);

  const parts: Record<string, unknown>[] = [];
  if (template.headerMedia) {
    const kind = template.headerMedia.format.toLowerCase();
    parts.push({ type: 'header', parameters: [{ type: kind, [kind]: { link: template.headerMedia.link } }] });
  }
  if (template.params.length > 0) {
    parts.push({ type: 'body', parameters: template.params.map((text) => ({ type: 'text', text })) });
  }
  const components = parts.length > 0 ? parts : undefined;

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

/**
 * Sends a message someone else has already shaped — an interactive one with buttons, say. The
 * caller says what the thread should show for it; this does the sending and the bookkeeping.
 */
export async function sendPrepared(
  conversationId: string,
  input: { type: string; body: string; payload: Record<string, unknown> }
): Promise<SendResult> {
  const conversation = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId }, include: { account: true } });
  if (!conversation) throw new WhatsAppError('Conversation not found.', 404);
  return deliver(conversation.account, conversation, { ...input, sentByUserId: null });
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
      ? String(err.response?.data?.error?.message ?? err.response?.data?.message ?? err.message)
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
      // "Intervened" means a person typed a reply here. A template sent by a broadcast or a drip
      // campaign is an automation's message even though a user pressed Send, and counting it would
      // silence the auto-reply bot for everyone who had ever been messaged that way.
      intervened: input.sentByUserId && input.type === 'text' ? true : conversation.intervened,
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

export interface InboundMessage {
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
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
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

  // The auto-reply bot answers last, once the message is safely recorded — and whatever it does,
  // a failure there must never lose or reject an inbound message.
  try {
    const { handleBotInbound } = await import('./whatsappBot');
    await handleBotInbound(conversation.id, message, parsed);
  } catch (err) {
    console.error('[whatsapp bot] failed:', err instanceof Error ? err.message : err);
  }
}

/** Delivery receipts: sent -> delivered -> read, or failed. */
export async function recordStatus(status: { id?: string; status?: string; errors?: { title?: string }[] }): Promise<void> {
  if (!status.id || !status.status) return;
  const data: Prisma.WhatsAppMessageUncheckedUpdateInput = { status: status.status };
  if (status.errors?.[0]?.title) data.error = status.errors[0].title;
  await prisma.whatsAppMessage.updateMany({ where: { providerMessageId: status.id }, data });
}
