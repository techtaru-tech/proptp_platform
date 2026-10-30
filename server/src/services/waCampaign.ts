import crypto from 'crypto';
import type { Prisma, WaCampaign, WaContact, WhatsAppAccount } from '@prisma/client';
import { prisma } from '../prisma';
import {
  ensureConversation, fillPlaceholders, listApprovedTemplates, localPart, resolveTemplateParams, sendPrepared,
  sendTemplateToNumber, SERVICE_WINDOW_MS, type ApprovedTemplate, type InboundMessage,
} from './whatsapp';

/**
 * WhatsApp campaigns.
 *
 * A campaign is an imported list that is sent an approved template. For the demo flow, what the
 * person taps then decides what they are sent next — language, the demo video, an interest
 * question, two eligibility questions, a Calendly booking — and a poller sends the timed
 * follow-ups. Four rules hold throughout:
 *   - nobody who has said STOP is ever messaged again (see optOut);
 *   - outside the 24-hour window only an approved template may be sent, so every timed message
 *     checks the window first and falls back to a template or skips;
 *   - the CRM is the source of truth: the flow records what a lab *says*, and only a person in
 *     the review queue can mark it eligible or take one of the limited slots;
 *   - a message is never sent twice — state is written before the next step is scheduled.
 */

const DRY = () => process.env.WHATSAPP_DRY_RUN === '1';
const MIN = 60_000;
const HOUR = 60 * MIN;

// ---------------------------------------------------------------------------
// Copy — the messages, as the owner's brief words them. Every one can be overridden per campaign.
// ---------------------------------------------------------------------------

export const DEFAULT_COPY: Record<string, string> = {
  M02: 'Great, {name}! 🎉\nWould you like to watch the SmartLab product demo in English or Hindi?',
  M03: '🎬 Here is your SmartLab product demo!\nExplore online test bookings, patient reports, branded apps, home collection and lab CRM.\nPlease watch the videos below. We’ll ask for your feedback shortly.\nThe Diwali offer is available only to eligible labs, subject to approved terms.',
  M04: '🎬 यह रहा SmartLab का हिंदी डेमो!\nदेखिए कैसे आपकी लैब के नाम से ऐप, ऑनलाइन टेस्ट बुकिंग, रिपोर्ट, होम कलेक्शन और CRM एक ही प्लेटफॉर्म पर काम कर सकते हैं।\nनीचे दिए वीडियो देखने के बाद हमें बताइए कि क्या आप आगे बात करना चाहेंगे।\nदिवाली ऑफ़र पात्रता और स्वीकृत शर्तों के अधीन है।',
  M05: 'Hi {name}! 😊\nWould you like to explore SmartLab for your lab and check your eligibility for our Diwali 50% initiative?',
  M05_hi: 'नमस्ते {name}! 😊\nक्या आप SmartLab के बारे में आगे बात करना और दिवाली की 50% पहल के लिए अपनी पात्रता चेक करना चाहेंगे?',
  M06: 'To check eligibility, approximately how many patient samples does your lab process per day?',
  M07: 'Which best describes your lab?',
  M08: 'Thanks, {name}! 🙌\nYour lab may qualify for the SmartLab Diwali initiative. Our specialist will verify the details and explain the applicable offer.\n\n📅 Book a 20-minute consultation using the button below.\n*Final eligibility, pricing and availability will be confirmed by our team.*',
  M09: 'Thanks for sharing the details. The special Diwali funding initiative may not apply to your lab under the current criteria.\nYou can still explore SmartLab at standard commercial terms. Would you like our team to contact you?',
  M10: 'No problem, {name}. 😊\nWhen you are ready, reply DEMO to explore SmartLab. We will pause this promotional sequence.',
  M11: 'Thank you for your time, {name}. We will stop this SmartLab promotional sequence. Wishing your lab continued success!',
  M13: 'Hi {name}, your SmartLab consultation is still pending.\nYou can choose a convenient time with the button below.\nOur team will explain eligibility, the product and next steps.',
  M14: 'Your SmartLab consultation is confirmed! 🎉\nDate: {date}\nTime: {time} ({tz})\nMeeting link: {join_url}\nPlease keep any relevant lab details handy.',
  M15: 'Reminder: your SmartLab consultation starts in 1 hour.\nTime: {time}\nJoin: {join_url}\nSee you soon!',
  M16: 'Thanks! A SmartLab specialist will help with your question. Our team will reply as soon as possible.',
  STOP_OK: 'You have been unsubscribed from SmartLab promotional messages. You will not receive any more of them.',
};

/** The demo videos the owner asked for — user, phlebotomist and admin — in each language, with default descriptions. */
export const DEFAULT_DEMO_VIDEOS: { language: 'en' | 'hi'; title: string; caption: string }[] = [
  { language: 'en', title: 'Patient App', caption: '📱 *1/3 · Patient App*\nYour lab’s own branded app for patients: they book tests and packages, choose home sample collection, pay online and download their reports, all under your lab’s name.' },
  { language: 'en', title: 'Phlebotomist App', caption: '🩺 *2/3 · Phlebotomist App*\nFor your sample collection team: see the day’s home visits, navigate to the patient, mark samples as collected and update the status live, so you always know where every sample is.' },
  { language: 'en', title: 'Admin Dashboard', caption: '🖥️ *3/3 · Admin Dashboard & CRM*\nWhere you run the lab: every booking from the app and website lands here. Assign phlebotomists, track samples, upload reports, manage payments and follow up with leads, all from one place.' },
  { language: 'hi', title: 'Patient App', caption: '📱 *1/3 · पेशेंट ऐप*\nआपकी लैब के नाम से अपना ऐप: मरीज़ टेस्ट और पैकेज बुक करते हैं, होम सैंपल कलेक्शन चुनते हैं, ऑनलाइन पेमेंट करते हैं और रिपोर्ट डाउनलोड करते हैं।' },
  { language: 'hi', title: 'Phlebotomist App', caption: '🩺 *2/3 · फ्लेबोटोमिस्ट ऐप*\nसैंपल कलेक्शन टीम के लिए: दिन की होम विज़िट देखें, मरीज़ तक पहुँचें, सैंपल कलेक्ट होने पर मार्क करें और स्टेटस लाइव अपडेट करें।' },
  { language: 'hi', title: 'Admin Dashboard', caption: '🖥️ *3/3 · एडमिन डैशबोर्ड और CRM*\nयहीं से लैब चलती है: ऐप और वेबसाइट की हर बुकिंग यहाँ आती है। फ्लेबोटोमिस्ट असाइन करें, सैंपल ट्रैक करें, रिपोर्ट अपलोड करें, पेमेंट और लीड्स एक ही जगह संभालें।' },
];

export interface DemoVideo { language: 'en' | 'hi'; title: string; caption: string; url: string }

/** The campaign's demo videos that have a file. An entry saved without a language is English. */
export function demoVideosOf(campaign: Pick<WaCampaign, 'demoVideos'>, language?: 'en' | 'hi'): DemoVideo[] {
  const raw = Array.isArray(campaign.demoVideos) ? (campaign.demoVideos as unknown as DemoVideo[]) : [];
  return raw
    .filter((v) => v && typeof v.url === 'string' && v.url.trim())
    .map((v) => ({ ...v, language: v.language === 'hi' ? 'hi' : 'en' } as DemoVideo))
    .filter((v) => !language || v.language === language);
}

function copyFor(campaign: Pick<WaCampaign, 'copy'>, key: string, language?: string | null): string {
  const custom = (campaign.copy ?? {}) as Record<string, string>;
  const lang = language === 'hi' ? 'hi' : 'en';
  return custom[`${key}_${lang}`] || (lang === 'hi' ? DEFAULT_COPY[`${key}_hi`] : '') || custom[key] || DEFAULT_COPY[key] || '';
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? vars[k] : whole));
}

// ---------------------------------------------------------------------------
// Phones and consent
// ---------------------------------------------------------------------------

/** A mobile as WhatsApp wants it: 91 plus ten digits. Null when it cannot be one. */
export function normalizePhone(raw: unknown): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length !== 10 || !/^[6-9]/.test(digits)) return null;
  return `91${digits}`;
}

export const isStopWord = (text: string) => /^\s*(stop|unsubscribe|opt[\s-]?out|stop\s+all|cancel\s+subscription|band\s*karo|बंद)\s*[.!]*\s*$/i.test(text);

export async function optedOutPhones(phones: string[]): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  const rows = await prisma.waOptOut.findMany({ where: { phone: { in: phones } }, select: { phone: true } });
  return new Set(rows.map((r) => r.phone));
}

export async function isOptedOut(phone: string): Promise<boolean> {
  const n = normalizePhone(phone);
  return n ? (await prisma.waOptOut.count({ where: { phone: n } })) > 0 : false;
}

/** Records the opt-out and halts every campaign the person is in, at once. */
export async function optOut(phone: string, reason: string, source: string): Promise<void> {
  const n = normalizePhone(phone) ?? phone;
  await prisma.waOptOut.upsert({ where: { phone: n }, update: { reason, source }, create: { phone: n, reason, source } });
  const contacts = await prisma.waContact.findMany({ where: { phone: n, state: { not: 'OPTED_OUT' } } });
  for (const c of contacts) {
    await prisma.waContact.update({ where: { id: c.id }, data: { optInStatus: 'opted_out', state: 'OPTED_OUT', nextActionAt: null } });
    await event(c.campaignId, c.id, 'opted_out', reason);
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function event(campaignId: string, contactId: string | null, type: string, detail?: string, messageId?: string) {
  await prisma.waEvent.create({ data: { campaignId, contactId, type, detail: detail?.slice(0, 500) ?? null, messageId: messageId ?? null } });
}

async function leadNote(contact: Pick<WaContact, 'leadId'>, text: string) {
  if (contact.leadId) await prisma.leadActivity.create({ data: { leadId: contact.leadId, type: 'note_added', description: text } }).catch(() => undefined);
}

async function move(contact: WaContact, state: string, patch: Prisma.WaContactUncheckedUpdateInput = {}): Promise<WaContact> {
  return prisma.waContact.update({ where: { id: contact.id }, data: { state, ...patch } });
}

async function senderAccount(): Promise<WhatsAppAccount | null> {
  return prisma.whatsAppAccount.findFirst({ where: { active: true, accessToken: { not: null } }, orderBy: { createdAt: 'asc' } });
}

async function windowOpen(conversationId: string): Promise<boolean> {
  const c = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId }, select: { lastInboundAt: true } });
  return !!c?.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

/** 09:00–20:00 in India: nobody wants a promotional message at midnight. Skipped in a dry run. */
function inSendHours(now = new Date()): boolean {
  if (DRY()) return true;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(now));
  return hour >= 9 && hour < 20;
}

const inWindow = (c: WaCampaign, now = new Date()) => (!c.startsAt || c.startsAt <= now) && (!c.endsAt || c.endsAt >= now);

// ---------------------------------------------------------------------------
// Free-form sends (only ever inside the 24-hour window)
// ---------------------------------------------------------------------------

type Conv = { id: string; contactPhone: string };

async function sendText(conv: Conv, body: string) {
  await sendPrepared(conv.id, { type: 'text', body, payload: { messaging_product: 'whatsapp', to: conv.contactPhone, type: 'text', text: { body, preview_url: true } } });
}

async function sendButtons(conv: Conv, contactId: string, body: string, options: [string, string][]) {
  await sendPrepared(conv.id, {
    type: 'interactive',
    body: `${body}\n${options.map(([, title]) => `[${title}]`).join(' ')}`,
    payload: {
      messaging_product: 'whatsapp', to: conv.contactPhone, type: 'interactive',
      interactive: { type: 'button', body: { text: body }, action: { buttons: options.map(([action, title]) => ({ type: 'reply', reply: { id: `wac:${contactId}:${action}`, title } })) } },
    },
  });
}

async function sendLink(conv: Conv, body: string, label: string, url: string) {
  await sendPrepared(conv.id, {
    type: 'interactive',
    body: `${body}\n[Link: ${label}]`,
    payload: { messaging_product: 'whatsapp', to: conv.contactPhone, type: 'interactive', interactive: { type: 'cta_url', body: { text: body }, action: { name: 'cta_url', parameters: { display_text: label, url } } } },
  });
}

async function sendVideo(conv: Conv, url: string, caption: string) {
  await sendPrepared(conv.id, { type: 'video', body: caption, payload: { messaging_product: 'whatsapp', to: conv.contactPhone, type: 'video', video: { link: url, caption } } });
}

function calendlyLink(campaign: WaCampaign, contact: WaContact): string | null {
  if (!campaign.calendlyUrl) return null;
  try {
    const url = new URL(campaign.calendlyUrl);
    url.searchParams.set('utm_source', 'whatsapp');
    url.searchParams.set('utm_campaign', campaign.id);
    // What ties the booking Calendly reports back to this person.
    url.searchParams.set('utm_content', contact.id);
    if (contact.name.trim()) url.searchParams.set('name', contact.name.trim());
    return url.toString();
  } catch {
    return null;
  }
}

const vars = (campaign: WaCampaign, contact: WaContact) => ({ name: firstName(contact.name), terms_url: campaign.termsUrl ?? '' });

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function pickTemplate(list: ApprovedTemplate[], name: string, language: string): ApprovedTemplate | undefined {
  if (DRY()) return { name, language, category: 'MARKETING', body: `Hi {{1}} [${name}] {{2}}`, variableCount: 2, headerFormat: /intro|ugc|show/i.test(name) ? 'VIDEO' : undefined };
  return list.find((t) => t.name === name && t.language === language) ?? list.find((t) => t.name === name);
}

interface Ctx {
  account: WhatsAppAccount;
  templates: () => Promise<ApprovedTemplate[]>;
}

async function sendTemplateStep(ctx: Ctx, campaign: WaCampaign, contact: WaContact, step: 'intro' | 'nudge' | 'confirm' | 'reminder', extra: Record<string, string> = {}) {
  const spec = {
    intro: { name: campaign.introTemplate, language: campaign.introLanguage, params: campaign.introParams, payloads: campaign.kind === 'flow' ? ['UGC_SHOW_DEMO', 'UGC_NOT_NOW', 'UGC_NOT_INTERESTED'] : [] },
    nudge: { name: campaign.nudgeTemplate, language: campaign.nudgeLanguage, params: campaign.nudgeParams, payloads: ['UGC_SHOW_DEMO', 'UGC_NOT_INTERESTED'] },
    confirm: { name: campaign.confirmTemplate, language: campaign.introLanguage, params: ['{date}', '{time}', '{tz}', '{join_url}'], payloads: [] },
    reminder: { name: campaign.reminderTemplate, language: campaign.introLanguage, params: ['{time}', '{join_url}'], payloads: [] },
  }[step];
  if (!spec.name) return { ok: false as const, reason: `No ${step} template is set on the campaign.` };

  const template = pickTemplate(await ctx.templates(), spec.name, spec.language);
  if (!template) return { ok: false as const, reason: `"${spec.name}" is not an approved template on this number.` };

  const v = { ...vars(campaign, contact), ...extra };
  const params = resolveTemplateParams(spec.params.map((p) => fill(p, v)), { firstName: firstName(contact.name), lastName: '' });
  if (params.length !== template.variableCount && !DRY()) {
    return { ok: false as const, reason: `"${spec.name}" needs ${template.variableCount} value(s) but the campaign supplies ${params.length}.` };
  }
  let headerMedia: { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; link: string } | undefined;
  if (template.headerFormat) {
    if (!campaign.introHeaderVideoUrl) return { ok: false as const, reason: `"${spec.name}" has a ${template.headerFormat.toLowerCase()} header but the campaign has no file link for it.` };
    headerMedia = { format: template.headerFormat, link: campaign.introHeaderVideoUrl };
  }

  try {
    const sent = await sendTemplateToNumber(
      ctx.account, contact.phone,
      { name: template.name, language: template.language, params, body: fillPlaceholders(template.body, params), headerMedia, buttonPayloads: spec.payloads.map((a) => `wac:${contact.id}:${a}`) },
      null
    );
    return { ok: true as const, messageId: sent.messageId, conversationId: sent.conversationId };
  } catch (err) {
    return { ok: false as const, reason: err instanceof Error ? err.message : String(err), send: true };
  }
}

// ---------------------------------------------------------------------------
// Inbound: what a tap or a word does
// ---------------------------------------------------------------------------

const TERMINAL = new Set(['OPTED_OUT', 'MEETING_COMPLETED', 'FAILED']);

/** The button labels, for templates whose taps arrive without our payload. */
const LABEL_ACTIONS: Record<string, string> = {
  'show demo': 'UGC_SHOW_DEMO', 'not now': 'UGC_NOT_NOW', 'not interested': 'UGC_NOT_INTERESTED',
  'english': 'LANG_EN', 'हिंदी': 'LANG_HI',
  'yes, interested': 'DEMO_INTERESTED', 'हाँ, इच्छुक हूँ': 'DEMO_INTERESTED', 'रुचि नहीं': 'DEMO_NOT_INTERESTED',
  'ask a question': 'DEMO_QUESTION', 'सवाल पूछें': 'DEMO_QUESTION',
  '50 or more': 'ELIG_SAMPLES_50PLUS', 'below 50': 'ELIG_SAMPLES_BELOW50', 'not sure': 'ELIG_UNSURE',
  'pathologist-led': 'ELIG_PATH', '3+ years running': 'ELIG_3YRS', 'other / unsure': 'ELIG_OTHER',
  'talk to team': 'TEAM_TALK',
};

/** A typed answer, read as the tap it stands for — only where the question is unambiguous. */
function textAction(state: string, text: string): string | null {
  const t = text.trim().toLowerCase();
  if (/^demo\b/.test(t)) return 'UGC_SHOW_DEMO';
  if (state === 'LANGUAGE_PENDING') {
    if (/english|angrezi|अंग्रेज/.test(t)) return 'LANG_EN';
    if (/hindi|हिंदी|हिन्दी/.test(t)) return 'LANG_HI';
  }
  if (state === 'INTEREST_PENDING' || state === 'UGC_SENT') {
    if (/^(yes|yeah|yep|haan|han|ha|हाँ|हां|interested|ok|okay)\b/.test(t)) return state === 'UGC_SENT' ? 'UGC_SHOW_DEMO' : 'DEMO_INTERESTED';
    if (/^(no|nahi|nahin|नहीं|not interested)\b/.test(t)) return 'DEMO_NOT_INTERESTED';
  }
  return null;
}

function actionFrom(message: InboundMessage, contact: WaContact, text: string): string | null {
  const id = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? message.button?.payload;
  if (id?.startsWith('wac:')) {
    const [, contactId, action] = id.split(':');
    return contactId === contact.id ? action : null;
  }
  const label = (message.button?.text ?? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? '').trim().toLowerCase();
  if (label && LABEL_ACTIONS[label]) return LABEL_ACTIONS[label];
  return text ? textAction(contact.state, text) : null;
}

/**
 * Called for every inbound message before the auto-reply bots. Returns true when the campaign
 * dealt with it, so nothing else answers the same message.
 */
export async function handleCampaignInbound(conversationId: string, message: InboundMessage, parsed: { type: string; body: string }): Promise<boolean> {
  const conv = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId }, select: { id: true, contactPhone: true, intervened: true } });
  if (!conv) return false;
  const text = parsed.type === 'text' ? parsed.body.trim() : '';

  // STOP is honoured everywhere and first — whatever else the person is in the middle of.
  if (text && isStopWord(text)) {
    await optOut(conv.contactPhone, `Sent "${text}"`, 'whatsapp');
    const campaign = await prisma.waContact.findFirst({ where: { phone: conv.contactPhone }, include: { campaign: true }, orderBy: { updatedAt: 'desc' } });
    await sendText(conv, copyFor(campaign?.campaign ?? { copy: {} }, 'STOP_OK')).catch(() => undefined);
    return true;
  }

  const contact = await prisma.waContact.findFirst({
    where: { phone: conv.contactPhone, state: { notIn: [...TERMINAL] }, campaign: { status: { in: ['active', 'paused'] } } },
    include: { campaign: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!contact) return false;
  const { campaign } = contact;

  const replied = await prisma.waEvent.count({ where: { contactId: contact.id, type: 'replied' } });
  if (!replied) await event(campaign.id, contact.id, 'replied', text.slice(0, 120) || message.type);

  // A single-template campaign has no journey, and a person who has stepped in has taken over:
  // either way the reply belongs to the team and the assistant.
  if (campaign.kind !== 'flow') return false;
  if (conv.intervened) {
    if (contact.nextActionAt) await prisma.waContact.update({ where: { id: contact.id }, data: { nextActionAt: null } });
    return false;
  }

  const action = actionFrom(message, contact, text);
  if (!action) {
    // Any other reply ends the timed nudges: a person should answer it now.
    if (contact.nextActionAt) await prisma.waContact.update({ where: { id: contact.id }, data: { nextActionAt: null } });
    return false;
  }
  await act(campaign, contact, conv, action);
  return true;
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

async function act(campaign: WaCampaign, contact: WaContact, conv: Conv, action: string): Promise<void> {
  const v = vars(campaign, contact);
  const say = (key: string) => fill(copyFor(campaign, key, contact.language), v);
  const reset = { nextActionAt: null, nudgeCount: 0 };

  switch (action) {
    case 'UGC_SHOW_DEMO': {
      await event(campaign.id, contact.id, 'demo_requested');
      await move(contact, 'LANGUAGE_PENDING', reset);
      await sendButtons(conv, contact.id, say('M02'), [['LANG_EN', 'English'], ['LANG_HI', 'हिंदी']]);
      return;
    }
    case 'UGC_NOT_NOW':
    case 'TEAM_NOT_NOW': {
      await event(campaign.id, contact.id, 'not_now');
      await move(contact, 'DEFERRED', reset);
      await sendText(conv, say('M10'));
      return;
    }
    case 'UGC_NOT_INTERESTED':
    case 'DEMO_NOT_INTERESTED': {
      await event(campaign.id, contact.id, 'not_interested');
      await move(contact, 'CLOSED', reset);
      await leadNote(contact, 'WhatsApp campaign: said they are not interested.');
      await sendText(conv, say('M11'));
      return;
    }
    case 'LANG_EN':
    case 'LANG_HI': {
      const language = action === 'LANG_HI' ? 'hi' : 'en';
      const name = language === 'hi' ? 'Hindi' : 'English';
      // That language's demo videos; with none uploaded yet, its older single demo video.
      let videos: { url: string; caption: string }[] = demoVideosOf(campaign, language).map((d) => ({ url: d.url, caption: fill(d.caption, v) }));
      const single = language === 'hi' ? campaign.demoVideoHi : campaign.demoVideoEn;
      if (videos.length === 0 && single) videos = [{ url: single, caption: '' }];
      const updated = await move(contact, 'LANGUAGE_PENDING', { language });
      if (videos.length === 0) {
        // Never skip the demo silently: it goes to a person.
        await event(campaign.id, contact.id, 'send_failed', `No ${name} demo video is set`);
        await leadNote(contact, `WhatsApp campaign: asked for the ${name} demo, but none is set up — please send it.`);
        await move(updated, 'HUMAN', reset);
        return;
      }
      await sendText(conv, fill(copyFor(campaign, language === 'hi' ? 'M04' : 'M03'), v));
      for (const video of videos) {
        // Spaced out, so WhatsApp delivers them in order.
        await new Promise((resolve) => setTimeout(resolve, DRY() ? 0 : 4000));
        await sendVideo(conv, video.url, video.caption);
      }
      await event(campaign.id, contact.id, 'demo_sent', `${language}: ${videos.length} video(s)`);
      // The interest question follows a few minutes later, never claiming the videos were watched.
      await move(updated, 'DEMO_SENT', { nextActionAt: new Date(Date.now() + 12 * MIN), nudgeCount: 0 });
      return;
    }
    case 'DEMO_INTERESTED': {
      await event(campaign.id, contact.id, 'interested');
      await leadNote(contact, 'WhatsApp campaign: interested in SmartLab after the demo.');
      await move(contact, 'ELIG_Q1', reset);
      await sendButtons(conv, contact.id, say('M06'), [['ELIG_SAMPLES_50PLUS', '50 or more'], ['ELIG_SAMPLES_BELOW50', 'Below 50'], ['ELIG_UNSURE', 'Not sure']]);
      return;
    }
    case 'DEMO_QUESTION':
    case 'TEAM_TALK': {
      await event(campaign.id, contact.id, 'asked_team');
      await leadNote(contact, 'WhatsApp campaign: wants to talk to the team.');
      await move(contact, 'HUMAN', reset);
      await sendText(conv, say('M16'));
      return;
    }
    case 'ELIG_SAMPLES_50PLUS':
    case 'ELIG_SAMPLES_BELOW50':
    case 'ELIG_UNSURE': {
      const band = action === 'ELIG_SAMPLES_50PLUS' ? '50plus' : action === 'ELIG_SAMPLES_BELOW50' ? 'below50' : 'unsure';
      const updated = await move(contact, 'ELIG_Q1', { sampleBand: band });
      if (band === 'below50') {
        await event(campaign.id, contact.id, 'ineligible', 'Under 50 samples a day (self-reported)');
        await move(updated, 'INELIGIBLE', reset);
        await sendButtons(conv, contact.id, say('M09'), [['TEAM_TALK', 'Talk to Team'], ['TEAM_NOT_NOW', 'Not Now']]);
        return;
      }
      await move(updated, 'ELIG_Q2', reset);
      await sendButtons(conv, contact.id, say('M07'), [['ELIG_PATH', 'Pathologist-led'], ['ELIG_3YRS', '3+ years running'], ['ELIG_OTHER', 'Other / Unsure']]);
      return;
    }
    case 'ELIG_PATH':
    case 'ELIG_3YRS':
    case 'ELIG_OTHER': {
      const type = action === 'ELIG_PATH' ? 'pathologist' : action === 'ELIG_3YRS' ? '3yrs' : 'other';
      // What a lab says about itself is never enough: this goes to a person to verify.
      const updated = await move(contact, 'CALENDLY_LINK_SENT', {
        professionalType: type, verification: 'none', nextActionAt: new Date(Date.now() + 5 * HOUR), nudgeCount: 0,
        ...(type === '3yrs' ? { labAgeYears: campaign.minLabAgeYears } : {}),
      });
      await event(campaign.id, contact.id, 'review_required', `${updated.sampleBand ?? '?'} samples, ${type}`);
      await leadNote(contact, `WhatsApp campaign: self-reported ${updated.sampleBand === '50plus' ? '50+ samples a day' : 'sample count unsure'}, ${type === 'pathologist' ? 'pathologist-led' : type === '3yrs' ? '3+ years running' : 'other / unsure'}. Needs verification before the offer is confirmed.`);
      await sendConsultation(campaign, updated, conv, 'M08');
      return;
    }
  }
}

/** The booking button — or, with no Calendly link set, a person. */
async function sendConsultation(campaign: WaCampaign, contact: WaContact, conv: Conv, key: 'M08' | 'M13') {
  const link = calendlyLink(campaign, contact);
  const body = fill(copyFor(campaign, key, contact.language), vars(campaign, contact));
  if (!link) {
    await event(campaign.id, contact.id, 'send_failed', 'No Calendly link is set');
    await leadNote(contact, 'WhatsApp campaign: ready to book a consultation, but no Calendly link is set up — please arrange it.');
    await move(contact, 'HUMAN', { nextActionAt: null });
    await sendText(conv, copyFor(campaign, 'M16'));
    return;
  }
  await sendLink(conv, body, 'Book Consultation', link);
  if (key === 'M08') await event(campaign.id, contact.id, 'link_sent');
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

export class CampaignError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function reviewContact(contactId: string, input: {
  decision: 'approve' | 'reject'; b2c?: boolean | null; labAgeYears?: number | null; professionalType?: string | null;
  labName?: string | null; city?: string | null; note?: string | null;
}, userId: string): Promise<WaContact> {
  const contact = await prisma.waContact.findUnique({ where: { id: contactId }, include: { campaign: true } });
  if (!contact) throw new CampaignError('Contact not found.', 404);
  const { campaign } = contact;

  const details: Prisma.WaContactUncheckedUpdateInput = {
    ...(input.b2c !== undefined ? { b2c: input.b2c } : {}),
    ...(input.labAgeYears !== undefined ? { labAgeYears: input.labAgeYears } : {}),
    ...(input.professionalType ? { professionalType: input.professionalType } : {}),
    ...(input.labName !== undefined ? { labName: input.labName } : {}),
    ...(input.city !== undefined ? { city: input.city } : {}),
    reviewNote: input.note ?? contact.reviewNote,
    verifiedBy: userId,
    verifiedAt: new Date(),
  };

  if (input.decision === 'reject') {
    const updated = await prisma.waContact.update({ where: { id: contact.id }, data: { ...details, verification: 'rejected' } });
    await event(campaign.id, contact.id, 'ineligible', input.note ?? 'Rejected on review');
    await leadNote(contact, `WhatsApp campaign: reviewed and not eligible${input.note ? ` — ${input.note}` : ''}.`);
    return updated;
  }

  // The slots are a hard limit, so counting them and taking one happen under one lock.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${campaign.id}))`;
    if (campaign.slotCap > 0) {
      const taken = await tx.waContact.count({ where: { campaignId: campaign.id, verification: 'verified', id: { not: contact.id } } });
      if (taken >= campaign.slotCap) throw new CampaignError(`All ${campaign.slotCap} offer slots are already taken.`, 409);
    }
    const updated = await tx.waContact.update({ where: { id: contact.id }, data: { ...details, verification: 'verified' } });
    await tx.waEvent.create({ data: { campaignId: campaign.id, contactId: contact.id, type: 'eligible', detail: input.note ?? null } });
    if (contact.leadId) await tx.leadActivity.create({ data: { leadId: contact.leadId, type: 'note_added', description: `WhatsApp campaign: verified eligible for the offer${input.note ? ` — ${input.note}` : ''}.` } });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportResult {
  added: number;
  duplicates: number;
  optedOut: number;
  invalid: { row: number; value: string; reason: string }[];
}

export async function importContacts(campaignId: string, rows: { name?: string; phone?: string; city?: string; labName?: string }[], optInSource: string): Promise<ImportResult> {
  const result: ImportResult = { added: 0, duplicates: 0, optedOut: 0, invalid: [] };
  const batch = `import-${Date.now()}`;

  const seen = new Set<string>();
  const clean: { phone: string; name: string; city?: string; labName?: string; row: number }[] = [];
  rows.forEach((r, i) => {
    const phone = normalizePhone(r.phone);
    if (!phone) return void result.invalid.push({ row: i + 1, value: String(r.phone ?? ''), reason: 'Not a valid 10-digit Indian mobile number' });
    if (seen.has(phone)) return void (result.duplicates += 1);
    seen.add(phone);
    clean.push({ phone, name: String(r.name ?? '').trim().slice(0, 80), city: r.city?.trim() || undefined, labName: r.labName?.trim() || undefined, row: i + 1 });
  });

  const [optedOutSet, existing] = await Promise.all([
    optedOutPhones(clean.map((c) => c.phone)),
    prisma.waContact.findMany({ where: { campaignId, phone: { in: clean.map((c) => c.phone) } }, select: { phone: true } }),
  ]);
  const existingSet = new Set(existing.map((e) => e.phone));

  for (const c of clean) {
    if (optedOutSet.has(c.phone)) { result.optedOut += 1; continue; }
    if (existingSet.has(c.phone)) { result.duplicates += 1; continue; }

    // Tie the contact to the CRM lead with this number, or make one, so the journey shows up on it.
    const local = localPart(c.phone);
    let lead = await prisma.lead.findFirst({ where: { phone: { endsWith: local }, archivedAt: null }, select: { id: true } });
    if (!lead) {
      const [first, ...rest] = c.name.split(/\s+/).filter(Boolean);
      lead = await prisma.lead.create({
        data: { firstName: first || 'WhatsApp', lastName: rest.join(' ') || local, phone: local, city: c.city ?? null, company: c.labName ?? null, source: 'whatsapp', status: 'new', priority: 'normal' },
        select: { id: true },
      });
    }
    await prisma.waContact.create({
      data: { campaignId, phone: c.phone, name: c.name, leadId: lead.id, optInSource, importBatch: batch, city: c.city ?? null, labName: c.labName ?? null },
    });
    result.added += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Calendly
// ---------------------------------------------------------------------------

/** Calendly signs `<t>.<body>` with the key we gave it at registration. */
export function verifyCalendlySignature(rawBody: Buffer | undefined, header: string | undefined, key: string): boolean {
  if (!rawBody || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 180) return false;
  const expected = crypto.createHmac('sha256', key).update(`${parts.t}.${rawBody.toString('utf8')}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const IST = 'Asia/Kolkata';
const fmtDate = (d: Date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST }).format(d);
const fmtTime = (d: Date) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST }).format(d);

export async function handleCalendlyEvent(campaignId: string, body: any): Promise<string> {
  const campaign = await prisma.waCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return 'unknown campaign';
  const kind = String(body?.event ?? '');
  const p = body?.payload ?? {};
  const contactId = String(p?.tracking?.utm_content ?? '');
  const contact = contactId ? await prisma.waContact.findFirst({ where: { id: contactId, campaignId } }) : null;

  if (!contact) {
    await event(campaignId, null, 'calendly_unmatched', `${kind} ${p?.email ?? ''}`);
    return 'unmatched';
  }

  if (kind === 'invitee.created') {
    const inviteeUri = String(p.uri ?? '');
    if (!inviteeUri || (await prisma.waMeeting.findUnique({ where: { inviteeUri } }))) return 'duplicate';
    const ev = p.scheduled_event ?? {};
    const startsAt = new Date(ev.start_time);
    if (Number.isNaN(startsAt.getTime())) return 'bad time';

    // A reschedule arrives as a new booking that names the old one: the old row is retired, not duplicated.
    if (p.old_invitee) await prisma.waMeeting.updateMany({ where: { inviteeUri: String(p.old_invitee) }, data: { status: 'rescheduled' } });

    const meeting = await prisma.waMeeting.create({
      data: { contactId: contact.id, campaignId, inviteeUri, eventUri: ev.uri ?? null, startsAt, endsAt: ev.end_time ? new Date(ev.end_time) : null, joinUrl: ev.location?.join_url ?? null },
    });
    await move(contact, 'MEETING_BOOKED', { nextActionAt: null, nudgeCount: 0 });
    await event(campaignId, contact.id, 'meeting_booked', startsAt.toISOString());
    await leadNote(contact, `WhatsApp campaign: consultation booked for ${fmtDate(startsAt)} ${fmtTime(startsAt)} IST.`);
    await confirmMeeting(campaign, contact, meeting.startsAt, meeting.joinUrl);
    return 'booked';
  }

  if (kind === 'invitee.canceled') {
    const meeting = await prisma.waMeeting.findUnique({ where: { inviteeUri: String(p.uri ?? '') } });
    if (!meeting) return 'unknown meeting';
    const rescheduled = p.rescheduled === true;
    await prisma.waMeeting.update({ where: { id: meeting.id }, data: { status: rescheduled ? 'rescheduled' : 'canceled' } });
    if (rescheduled) return 'rescheduled'; // the new booking follows; the contact stays booked
    const stillBooked = await prisma.waMeeting.count({ where: { contactId: contact.id, status: 'booked' } });
    if (!stillBooked) {
      await move(contact, 'CALENDLY_LINK_SENT', { nextActionAt: new Date(Date.now() + 4 * HOUR), nudgeCount: 0 });
      await event(campaignId, contact.id, 'meeting_canceled');
      await leadNote(contact, 'WhatsApp campaign: the consultation was canceled.');
    }
    return 'canceled';
  }
  return 'ignored';
}

async function confirmMeeting(campaign: WaCampaign, contact: WaContact, startsAt: Date, joinUrl: string | null) {
  const account = await senderAccount();
  if (!account) return;
  const conversation = await ensureConversation(account, contact.phone, contact.name);
  const v = { ...vars(campaign, contact), date: fmtDate(startsAt), time: fmtTime(startsAt), tz: 'IST', join_url: joinUrl ?? 'the link in your Calendly email' };
  try {
    if (await windowOpen(conversation.id)) {
      await sendText(conversation, fill(copyFor(campaign, 'M14', contact.language), v));
    } else if (campaign.confirmTemplate) {
      const r = await sendTemplateStep({ account, templates: () => listApprovedTemplates(account) }, campaign, contact, 'confirm', v);
      if (!r.ok) await event(campaign.id, contact.id, 'send_failed', `Booking confirmation: ${r.reason}`);
    }
  } catch (err) {
    await event(campaign.id, contact.id, 'send_failed', `Booking confirmation: ${err instanceof Error ? err.message : err}`);
  }
}

// ---------------------------------------------------------------------------
// The poller
// ---------------------------------------------------------------------------

const PER_TICK = 15;

async function sendIntros(campaign: WaCampaign, ctx: Ctx) {
  if (!inSendHours()) return;
  const since = new Date(Date.now() - 24 * HOUR);
  const sentToday = await prisma.waEvent.count({ where: { campaignId: campaign.id, type: 'intro_sent', createdAt: { gte: since } } });
  const room = Math.min(PER_TICK, campaign.dailySendCap - sentToday);
  if (room <= 0) return;

  const queued = await prisma.waContact.findMany({ where: { campaignId: campaign.id, state: 'QUEUED' }, orderBy: { createdAt: 'asc' }, take: room });
  const stopped = await optedOutPhones(queued.map((c) => c.phone));

  for (const contact of queued) {
    if (stopped.has(contact.phone)) {
      await move(contact, 'OPTED_OUT', { optInStatus: 'opted_out' });
      continue;
    }
    const r = await sendTemplateStep(ctx, campaign, contact, 'intro');
    if (r.ok) {
      await move(contact, campaign.kind === 'flow' ? 'UGC_SENT' : 'SENT', { introSentAt: new Date(), attempts: 0, lastError: null, nextActionAt: campaign.kind === 'flow' ? new Date(Date.now() + 24 * HOUR) : null });
      await event(campaign.id, contact.id, 'intro_sent', undefined, r.messageId);
    } else if ('send' in r) {
      // Meta refused this one. A few tries, then it is marked failed so it is not retried for ever.
      const attempts = contact.attempts + 1;
      await prisma.waContact.update({ where: { id: contact.id }, data: attempts >= 3 ? { state: 'FAILED', attempts, lastError: r.reason } : { attempts, lastError: r.reason } });
      if (attempts >= 3) await event(campaign.id, contact.id, 'send_failed', r.reason);
    } else {
      // The campaign itself is not ready (the template is not approved…). Stop here and say so.
      await prisma.waCampaign.update({ where: { id: campaign.id }, data: { lastError: r.reason } });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (campaign.lastError) await prisma.waCampaign.update({ where: { id: campaign.id }, data: { lastError: null } });
}

async function runDueStep(campaign: WaCampaign, contact: WaContact, ctx: Ctx) {
  const conversation = await ensureConversation(ctx.account, contact.phone, contact.name);
  // A person has taken the chat over: the timed steps stop.
  if (conversation.intervened) return void (await prisma.waContact.update({ where: { id: contact.id }, data: { nextActionAt: null } }));
  const open = await windowOpen(conversation.id);
  const v = vars(campaign, contact);
  const say = (key: string) => fill(copyFor(campaign, key, contact.language), v);

  switch (contact.state) {
    case 'UGC_SENT': {
      if (contact.nudgeCount >= 2 || !campaign.nudgeTemplate) {
        await move(contact, 'UNRESPONSIVE', { nextActionAt: null });
        await event(campaign.id, contact.id, 'unresponsive');
        return;
      }
      const r = await sendTemplateStep(ctx, campaign, contact, 'nudge');
      if (!r.ok) return void (await event(campaign.id, contact.id, 'send_failed', `Nudge: ${r.reason}`));
      await move(contact, 'UGC_SENT', { nudgeCount: contact.nudgeCount + 1, nextActionAt: new Date(Date.now() + 48 * HOUR) });
      await event(campaign.id, contact.id, 'nudge_sent', String(contact.nudgeCount + 1), r.messageId);
      return;
    }
    case 'DEMO_SENT': {
      // Asked, never assumed watched.
      const lang = contact.language;
      const yes = lang === 'hi' ? 'हाँ, इच्छुक हूँ' : 'Yes, Interested';
      const no = lang === 'hi' ? 'रुचि नहीं' : 'Not Interested';
      const ask = lang === 'hi' ? 'सवाल पूछें' : 'Ask a Question';
      await sendButtons(conversation, contact.id, say('M05'), [['DEMO_INTERESTED', yes], ['DEMO_NOT_INTERESTED', no], ['DEMO_QUESTION', ask]]);
      await move(contact, 'INTEREST_PENDING', { nextActionAt: new Date(Date.now() + 24 * HOUR), nudgeCount: 0 });
      return;
    }
    case 'INTEREST_PENDING': {
      if (contact.nudgeCount >= 1) {
        await move(contact, 'UNRESPONSIVE', { nextActionAt: null });
        await event(campaign.id, contact.id, 'unresponsive');
        return;
      }
      if (open) {
        await sendButtons(conversation, contact.id, say('M05'), [['DEMO_INTERESTED', contact.language === 'hi' ? 'हाँ, इच्छुक हूँ' : 'Yes, Interested'], ['DEMO_NOT_INTERESTED', contact.language === 'hi' ? 'रुचि नहीं' : 'Not Interested'], ['DEMO_QUESTION', contact.language === 'hi' ? 'सवाल पूछें' : 'Ask a Question']]);
      } else {
        const r = await sendTemplateStep(ctx, campaign, contact, 'nudge');
        if (!r.ok) return void (await event(campaign.id, contact.id, 'send_failed', `Reminder: ${r.reason}`));
      }
      await move(contact, 'INTEREST_PENDING', { nudgeCount: contact.nudgeCount + 1, nextActionAt: new Date(Date.now() + 48 * HOUR) });
      return;
    }
    case 'CALENDLY_LINK_SENT': {
      if (contact.nudgeCount >= 1) {
        await move(contact, 'UNRESPONSIVE', { nextActionAt: null });
        await event(campaign.id, contact.id, 'unresponsive');
        return;
      }
      // Outside the window there is no approved template for this nudge, so it is skipped, not forced.
      if (open) await sendConsultation(campaign, contact, conversation, 'M13');
      await prisma.waContact.update({ where: { id: contact.id }, data: { nudgeCount: 1, nextActionAt: new Date(Date.now() + 48 * HOUR) } });
      return;
    }
  }
}

async function processCampaign(campaign: WaCampaign, ctx: Ctx) {
  await sendIntros(campaign, ctx);

  if (campaign.kind === 'flow' && inSendHours()) {
    const due = await prisma.waContact.findMany({
      where: { campaignId: campaign.id, nextActionAt: { lte: new Date() }, state: { in: ['UGC_SENT', 'DEMO_SENT', 'INTEREST_PENDING', 'CALENDLY_LINK_SENT'] } },
      orderBy: { nextActionAt: 'asc' },
      take: PER_TICK,
    });
    const stopped = await optedOutPhones(due.map((c) => c.phone));
    for (const contact of due) {
      if (stopped.has(contact.phone)) { await move(contact, 'OPTED_OUT', { nextActionAt: null, optInStatus: 'opted_out' }); continue; }
      await runDueStep(campaign, contact, ctx).catch((err) => console.error(`[wa campaign] step failed for ${contact.id}:`, err instanceof Error ? err.message : err));
    }
  }
}

/** The hour-before reminders, and marking finished meetings as attended. */
async function processMeetings(ctx: Ctx) {
  const now = new Date();
  const soon = await prisma.waMeeting.findMany({
    where: { status: 'booked', reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + 65 * MIN) } },
    include: { contact: { include: { campaign: true } } },
  });
  for (const m of soon) {
    const { contact } = m;
    if (await isOptedOut(contact.phone)) continue;
    await prisma.waMeeting.update({ where: { id: m.id }, data: { reminderSentAt: now } }); // marked first: never twice
    const conversation = await ensureConversation(ctx.account, contact.phone, contact.name);
    const v = { ...vars(contact.campaign, contact), time: fmtTime(m.startsAt), join_url: m.joinUrl ?? 'the link in your Calendly email' };
    try {
      if (await windowOpen(conversation.id)) await sendText(conversation, fill(copyFor(contact.campaign, 'M15', contact.language), v));
      else if (contact.campaign.reminderTemplate) await sendTemplateStep(ctx, contact.campaign, contact, 'reminder', v);
    } catch (err) {
      await event(contact.campaignId, contact.id, 'send_failed', `Reminder: ${err instanceof Error ? err.message : err}`);
    }
  }

  const over = await prisma.waMeeting.findMany({ where: { status: 'booked', OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: new Date(now.getTime() - 45 * MIN) } }] }, include: { contact: true } });
  for (const m of over) {
    await prisma.waMeeting.update({ where: { id: m.id }, data: { status: 'completed' } });
    await move(m.contact, 'MEETING_COMPLETED', { nextActionAt: null });
    await event(m.campaignId, m.contactId, 'meeting_completed');
  }
}

let running = false;

export async function runCampaignTick(): Promise<void> {
  // A slow tick must not overlap the next one — two would send the same step twice.
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const campaigns = (await prisma.waCampaign.findMany({ where: { status: 'active' } })).filter((c) => inWindow(c, now));
    const account = await senderAccount();
    if (!account) {
      if (campaigns.length) console.error('[wa campaign] campaigns are active but no WhatsApp number with a token is linked.');
      return;
    }
    let cached: Promise<ApprovedTemplate[]> | undefined;
    const ctx: Ctx = { account, templates: () => (cached ??= DRY() ? Promise.resolve([]) : listApprovedTemplates(account)) };

    for (const campaign of campaigns) {
      await processCampaign(campaign, ctx).catch((err) => {
        console.error(`[wa campaign] "${campaign.name}" failed:`, err instanceof Error ? err.message : err);
        return prisma.waCampaign.update({ where: { id: campaign.id }, data: { lastError: String(err instanceof Error ? err.message : err).slice(0, 300) } }).catch(() => undefined);
      });
    }
    await processMeetings(ctx).catch((err) => console.error('[wa campaign] meetings failed:', err instanceof Error ? err.message : err));
  } finally {
    running = false;
  }
}

let handle: ReturnType<typeof setInterval> | undefined;
export function startCampaignPoller(intervalMs = 30_000): void {
  if (handle) return;
  const tick = () => void runCampaignTick().catch((err) => console.error('[wa campaign] tick failed:', err));
  tick();
  handle = setInterval(tick, intervalMs);
}

// ---------------------------------------------------------------------------
// Dashboard and board
// ---------------------------------------------------------------------------

/** Where a contact sits on the board. The review column is for self-reported labs not yet verified. */
export function boardColumn(c: Pick<WaContact, 'state' | 'verification'>): string {
  switch (c.state) {
    case 'QUEUED': return 'Queued';
    case 'SENT':
    case 'UGC_SENT': return 'UGC Sent';
    case 'LANGUAGE_PENDING': return 'Demo Requested';
    case 'DEMO_SENT':
    case 'INTEREST_PENDING': return 'Demo Sent';
    case 'ELIG_Q1':
    case 'ELIG_Q2': return 'Interested';
    case 'CALENDLY_LINK_SENT': return c.verification === 'verified' ? 'Booking Pending' : c.verification === 'rejected' ? 'Not Eligible' : 'Eligibility Review';
    case 'MEETING_BOOKED': return 'Meeting Booked';
    case 'MEETING_COMPLETED': return 'Meeting Completed';
    case 'INELIGIBLE': return 'Not Eligible';
    case 'HUMAN': return 'Needs Team';
    case 'DEFERRED': return 'Not Now';
    case 'CLOSED': return 'Not Interested';
    case 'UNRESPONSIVE': return 'Unresponsive';
    case 'OPTED_OUT': return 'Opted Out';
    default: return 'Failed';
  }
}

export const BOARD_COLUMNS = ['Queued', 'UGC Sent', 'Demo Requested', 'Demo Sent', 'Interested', 'Eligibility Review', 'Booking Pending', 'Meeting Booked', 'Meeting Completed', 'Needs Team', 'Not Now', 'Not Interested', 'Not Eligible', 'Unresponsive', 'Opted Out', 'Failed'];

export async function dashboard(campaignId: string) {
  const [contacts, events, introMessages, meetings] = await Promise.all([
    prisma.waContact.findMany({ where: { campaignId }, select: { state: true, language: true, verification: true, optInStatus: true } }),
    prisma.waEvent.groupBy({ by: ['type'], where: { campaignId, contactId: { not: null } }, _count: { _all: true } }),
    prisma.waEvent.findMany({ where: { campaignId, type: 'intro_sent', messageId: { not: null } }, select: { messageId: true } }),
    prisma.waMeeting.groupBy({ by: ['status'], where: { campaignId }, _count: { _all: true } }),
  ]);
  const count = (t: string) => events.find((e) => e.type === t)?._count._all ?? 0;

  // Delivered and read come from Meta's receipts on the first message, not from guesses.
  const ids = introMessages.map((m) => m.messageId!);
  const receipts = ids.length ? await prisma.whatsAppMessage.groupBy({ by: ['status'], where: { id: { in: ids } }, _count: { _all: true } }) : [];
  const rec = (s: string) => receipts.find((r) => r.status === s)?._count._all ?? 0;
  const read = rec('read');
  const delivered = rec('delivered') + read;

  const byColumn: Record<string, number> = {};
  for (const c of contacts) byColumn[boardColumn(c)] = (byColumn[boardColumn(c)] ?? 0) + 1;
  const m = (s: string) => meetings.find((x) => x.status === s)?._count._all ?? 0;

  return {
    imported: contacts.length,
    optedIn: contacts.filter((c) => c.optInStatus === 'opted_in').length,
    optedOut: contacts.filter((c) => c.optInStatus === 'opted_out').length,
    sent: count('intro_sent'),
    delivered,
    read,
    replies: count('replied'),
    demoRequested: count('demo_requested'),
    demoSent: count('demo_sent'),
    english: contacts.filter((c) => c.language === 'en').length,
    hindi: contacts.filter((c) => c.language === 'hi').length,
    interested: count('interested'),
    reviewRequired: count('review_required'),
    verifiedEligible: contacts.filter((c) => c.verification === 'verified').length,
    notEligible: contacts.filter((c) => c.verification === 'rejected' || c.state === 'INELIGIBLE').length,
    linkSent: count('link_sent'),
    meetingsBooked: m('booked') + m('completed') + m('canceled') + m('rescheduled'),
    meetingsActive: m('booked'),
    meetingsCompleted: m('completed'),
    notInterested: count('not_interested'),
    unresponsive: count('unresponsive'),
    failed: contacts.filter((c) => c.state === 'FAILED').length,
    byColumn,
  };
}
