import crypto from 'crypto';
import axios from 'axios';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { decrypt, encrypt } from '../services/crypto';
import { writeAudit } from '../services/audit';
import type { AuthedRequest } from '../services/auth';
import {
  BOARD_COLUMNS, boardColumn, CampaignError, dashboard, DEFAULT_COPY, DEFAULT_DEMO_VIDEOS, demoVideosOf, importContacts, normalizePhone, optOut, reviewContact, runCampaignTick,
} from '../services/waCampaign';

/** WhatsApp campaigns: set up, import a list, watch it move, review who qualifies. */
export const waCampaignsRouter = Router();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:4000';
const STATUSES = ['draft', 'active', 'paused'];
const MAX_IMPORT = 5000;

const fail = (res: any, err: unknown, next: (e?: unknown) => void) =>
  err instanceof CampaignError ? res.status(err.status).json({ error: err.message }) : next(err);

function view(c: Prisma.WaCampaignGetPayload<{}>) {
  const warnings: string[] = [];
  if (!c.introTemplate) warnings.push('Choose the approved first-message template.');
  if (c.introParams.some((p) => p.includes('{terms_url}')) && !c.termsUrl) warnings.push('The first message uses the terms link, but none is set.');
  if (c.kind === 'flow') {
    if (!c.introHeaderVideoUrl) warnings.push('Add the video for the first message’s header.');
    for (const [lang, name, single] of [['en', 'English', c.demoVideoEn], ['hi', 'Hindi', c.demoVideoHi]] as const) {
      if (demoVideosOf(c, lang).length === 0) warnings.push(single ? `Upload the ${name} demo videos — until then only the older single ${name} video is sent.` : `Upload the ${name} demo videos.`);
    }
    if (!c.calendlyUrl) warnings.push('Add the Calendly link.');
    if (!c.nudgeTemplate) warnings.push('No follow-up template: people who do not answer are not nudged.');
    if (!c.calendlySigningKey) warnings.push('Calendly is not connected, so bookings will not update the CRM.');
  }
  if (!c.endsAt) warnings.push('No end date is set — an offer should always expire.');
  return {
    id: c.id, name: c.name, kind: c.kind, status: c.status, startsAt: c.startsAt?.toISOString(), endsAt: c.endsAt?.toISOString(),
    termsUrl: c.termsUrl ?? undefined, dailySendCap: c.dailySendCap, slotCap: c.slotCap,
    introTemplate: c.introTemplate ?? undefined, introLanguage: c.introLanguage, introHeaderVideoUrl: c.introHeaderVideoUrl ?? undefined, introParams: c.introParams,
    nudgeTemplate: c.nudgeTemplate ?? undefined, nudgeLanguage: c.nudgeLanguage, nudgeParams: c.nudgeParams,
    confirmTemplate: c.confirmTemplate ?? undefined, reminderTemplate: c.reminderTemplate ?? undefined,
    demoVideoEn: c.demoVideoEn ?? undefined, demoVideoHi: c.demoVideoHi ?? undefined,
    demoVideos: Array.isArray(c.demoVideos) ? c.demoVideos : [],
    minSamples: c.minSamples, minLabAgeYears: c.minLabAgeYears, copy: c.copy ?? {},
    calendlyUrl: c.calendlyUrl ?? undefined, hasCalendlyToken: !!c.calendlyToken, calendlyConnected: !!c.calendlyWebhookId,
    calendlyWebhookUrl: `${PUBLIC_BASE_URL}/api/webhook/calendly/${c.id}`,
    lastError: c.lastError ?? undefined, warnings, createdAt: c.createdAt.toISOString(),
  };
}

/** Same checks on create and update, so a campaign can never be saved half-valid. */
function fields(body: any): { error: string } | { data: Prisma.WaCampaignUncheckedCreateInput } {
  const name = String(body?.name ?? '').trim();
  if (!name) return { error: 'A name is required.' };
  const kind = body?.kind === 'single' ? 'single' : 'flow';
  const status = String(body?.status ?? 'draft');
  if (!STATUSES.includes(status)) return { error: 'status must be draft, active or paused.' };
  const date = (v: unknown) => (v ? new Date(String(v)) : null);
  const startsAt = date(body.startsAt), endsAt = date(body.endsAt);
  if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) return { error: 'The dates are not valid.' };
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'The end must be after the start.' };
  const https = (v: unknown, label: string) => {
    const s = String(v ?? '').trim();
    if (s && !/^https:\/\/\S+$/i.test(s)) throw new Error(`${label} must be a public https link.`);
    return s || null;
  };
  try {
    const list = (v: unknown, dflt: string[]) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()) : dflt);
    return {
      data: {
        name, kind, status, startsAt, endsAt,
        termsUrl: https(body.termsUrl, 'The terms link'),
        dailySendCap: Math.min(100000, Math.max(1, Math.floor(Number(body.dailySendCap) || 250))),
        slotCap: Math.max(0, Math.floor(Number(body.slotCap) || 0)),
        introTemplate: String(body.introTemplate ?? '').trim() || null,
        introLanguage: String(body.introLanguage ?? 'en').trim() || 'en',
        introHeaderVideoUrl: https(body.introHeaderVideoUrl, 'The header video'),
        introParams: list(body.introParams, ['{first_name}', '{terms_url}']),
        nudgeTemplate: String(body.nudgeTemplate ?? '').trim() || null,
        nudgeLanguage: String(body.nudgeLanguage ?? 'en').trim() || 'en',
        nudgeParams: list(body.nudgeParams, ['{first_name}']),
        confirmTemplate: String(body.confirmTemplate ?? '').trim() || null,
        reminderTemplate: String(body.reminderTemplate ?? '').trim() || null,
        demoVideoEn: https(body.demoVideoEn, 'The English demo'),
        demoVideoHi: https(body.demoVideoHi, 'The Hindi demo'),
        demoVideos: (Array.isArray(body.demoVideos) ? body.demoVideos : []).slice(0, 10).map((d: any, i: number) => {
          const title = String(d?.title ?? '').trim().slice(0, 60);
          const caption = String(d?.caption ?? '').trim();
          if (caption.length > 1000) throw new Error(`Demo video ${i + 1}: the description is limited to 1000 characters.`);
          return { language: d?.language === 'hi' ? 'hi' : 'en', title, caption, url: https(d?.url, `Demo video ${i + 1}`) ?? '' };
        }).filter((d: { url: string; title: string }) => d.url || d.title) as Prisma.InputJsonValue,
        minSamples: Math.max(1, Math.floor(Number(body.minSamples) || 50)),
        minLabAgeYears: Math.max(0, Math.floor(Number(body.minLabAgeYears) || 3)),
        copy: (typeof body.copy === 'object' && body.copy ? body.copy : {}) as Prisma.InputJsonValue,
        calendlyUrl: https(body.calendlyUrl, 'The Calendly link'),
      },
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

waCampaignsRouter.get('/defaults', (_req, res) => res.json({ copy: DEFAULT_COPY, demoVideos: DEFAULT_DEMO_VIDEOS }));

waCampaignsRouter.get('/', async (_req, res, next) => {
  try {
    const rows = await prisma.waCampaign.findMany({ orderBy: { createdAt: 'desc' } });
    const counts = await prisma.waContact.groupBy({ by: ['campaignId'], _count: { _all: true } });
    res.json(rows.map((c) => ({ ...view(c), contactCount: counts.find((x) => x.campaignId === c.id)?._count._all ?? 0 })));
  } catch (err) {
    next(err);
  }
});

// ---- opt-outs (before /:id so the path is not read as an id) ----------------

waCampaignsRouter.get('/opt-outs', async (_req, res, next) => {
  try {
    const rows = await prisma.waOptOut.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    res.json(rows.map((r) => ({ phone: r.phone, reason: r.reason, source: r.source, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    next(err);
  }
});

waCampaignsRouter.post('/opt-outs', async (req: AuthedRequest, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'That is not a valid mobile number.' });
    await optOut(phone, String(req.body?.reason ?? 'Added by the team').slice(0, 200), 'team');
    await writeAudit(req, { module: 'CRM', action: 'Added a number to the WhatsApp opt-out list', recordId: phone, recordLabel: phone });
    res.status(201).json({ phone });
  } catch (err) {
    next(err);
  }
});

waCampaignsRouter.delete('/opt-outs/:phone', async (req: AuthedRequest, res, next) => {
  try {
    await prisma.waOptOut.delete({ where: { phone: String(req.params.phone) } });
    await writeAudit(req, { module: 'CRM', action: 'Removed a number from the WhatsApp opt-out list', recordId: String(req.params.phone), recordLabel: String(req.params.phone) });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Review actions and the forced tick sit before /:id for the same reason. */
waCampaignsRouter.post('/run-due', async (_req, res, next) => {
  try {
    await runCampaignTick();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

waCampaignsRouter.post('/contacts/:contactId/review', async (req: AuthedRequest, res, next) => {
  try {
    const b = req.body ?? {};
    if (!['approve', 'reject'].includes(b.decision)) return res.status(400).json({ error: 'decision must be approve or reject.' });
    const updated = await reviewContact(String(req.params.contactId), {
      decision: b.decision, b2c: typeof b.b2c === 'boolean' ? b.b2c : undefined,
      labAgeYears: b.labAgeYears === undefined ? undefined : Number(b.labAgeYears) || null,
      professionalType: b.professionalType ? String(b.professionalType) : undefined,
      labName: b.labName === undefined ? undefined : String(b.labName).slice(0, 120),
      city: b.city === undefined ? undefined : String(b.city).slice(0, 80),
      note: b.note === undefined ? undefined : String(b.note).slice(0, 500),
    }, req.auth!.sub);
    await writeAudit(req, { module: 'CRM', action: `${b.decision === 'approve' ? 'Verified' : 'Rejected'} a lab for the WhatsApp offer`, recordId: updated.id, recordLabel: updated.name || updated.phone });
    res.json({ id: updated.id, verification: updated.verification });
  } catch (err) {
    fail(res, err, next);
  }
});

// ---- campaigns ---------------------------------------------------------------

waCampaignsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = fields(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const created = await prisma.waCampaign.create({ data: parsed.data });
    await writeAudit(req, { module: 'CRM', action: 'Created a WhatsApp campaign', recordId: created.id, recordLabel: created.name });
    res.status(201).json(view(created));
  } catch (err) {
    next(err);
  }
});

waCampaignsRouter.get('/:id', async (req, res, next) => {
  try {
    const c = await prisma.waCampaign.findUnique({ where: { id: String(req.params.id) } });
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    res.json(view(c));
  } catch (err) {
    next(err);
  }
});

waCampaignsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const parsed = fields(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const updated = await prisma.waCampaign.update({ where: { id: String(req.params.id) }, data: parsed.data });
    await writeAudit(req, { module: 'CRM', action: 'Updated a WhatsApp campaign', recordId: updated.id, recordLabel: updated.name });
    res.json(view(updated));
  } catch (err) {
    next(err);
  }
});

waCampaignsRouter.patch('/:id/status', async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'status must be draft, active or paused.' });
    const c = await prisma.waCampaign.findUnique({ where: { id: String(req.params.id) } });
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    // Starting is the one step that must not happen half-ready.
    if (status === 'active') {
      if (!c.introTemplate) return res.status(400).json({ error: 'Choose the approved first-message template before starting.' });
      if (!c.endsAt) return res.status(400).json({ error: 'Set an end date before starting — an offer must always expire.' });
      if (c.kind === 'flow' && !c.introHeaderVideoUrl && /video/i.test(c.introTemplate)) return res.status(400).json({ error: 'Add the header video first.' });
    }
    const updated = await prisma.waCampaign.update({ where: { id: c.id }, data: { status, lastError: null } });
    await writeAudit(req, { module: 'CRM', action: `Set a WhatsApp campaign to ${status}`, recordId: c.id, recordLabel: c.name });
    res.json(view(updated));
  } catch (err) {
    next(err);
  }
});

waCampaignsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const removed = await prisma.waCampaign.delete({ where: { id: String(req.params.id) } });
    await writeAudit(req, { module: 'CRM', action: 'Deleted a WhatsApp campaign', recordId: removed.id, recordLabel: removed.name });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- import ----------------------------------------------------------------

waCampaignsRouter.post('/:id/import', async (req: AuthedRequest, res, next) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: 'The list is empty.' });
    if (rows.length > MAX_IMPORT) return res.status(400).json({ error: `Import at most ${MAX_IMPORT} rows at a time.` });
    // WhatsApp marketing needs the person's consent, and where it came from is kept with each contact.
    if (req.body?.confirmConsent !== true) return res.status(400).json({ error: 'Confirm that these people agreed to receive WhatsApp messages.' });
    const source = String(req.body?.optInSource ?? '').trim();
    if (source.length < 3) return res.status(400).json({ error: 'Say where their consent came from (a form, an event, an enquiry…).' });
    const campaign = await prisma.waCampaign.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true } });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const result = await importContacts(campaign.id, rows, source.slice(0, 200));
    await writeAudit(req, { module: 'CRM', action: `Imported ${result.added} contacts into a WhatsApp campaign`, recordId: campaign.id, recordLabel: campaign.name });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---- watching it -----------------------------------------------------------

waCampaignsRouter.get('/:id/dashboard', async (req, res, next) => {
  try {
    res.json(await dashboard(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

const contactRow = (c: Prisma.WaContactGetPayload<{}>) => ({
  id: c.id, name: c.name, phone: c.phone, leadId: c.leadId ?? undefined, state: c.state, column: boardColumn(c), language: c.language ?? undefined,
  sampleBand: c.sampleBand ?? undefined, professionalType: c.professionalType ?? undefined, labAgeYears: c.labAgeYears ?? undefined,
  b2c: c.b2c ?? undefined, labName: c.labName ?? undefined, city: c.city ?? undefined, verification: c.verification, reviewNote: c.reviewNote ?? undefined,
  optInSource: c.optInSource, nextActionAt: c.nextActionAt?.toISOString(), lastError: c.lastError ?? undefined, updatedAt: c.updatedAt.toISOString(),
});

waCampaignsRouter.get('/:id/contacts', async (req, res, next) => {
  try {
    const search = String(req.query.search ?? '').trim();
    const where: Prisma.WaContactWhereInput = { campaignId: String(req.params.id) };
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search.replace(/\D/g, '') || '__' } }];
    const rows = await prisma.waContact.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 1000 });
    res.json(rows.map(contactRow));
  } catch (err) {
    next(err);
  }
});

waCampaignsRouter.get('/:id/board', async (req, res, next) => {
  try {
    const rows = await prisma.waContact.findMany({ where: { campaignId: String(req.params.id) }, orderBy: { updatedAt: 'desc' }, take: 2000 });
    const columns: Record<string, ReturnType<typeof contactRow>[]> = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, []]));
    for (const r of rows) columns[boardColumn(r)].push(contactRow(r));
    res.json({ columns: BOARD_COLUMNS.map((name) => ({ name, total: columns[name].length, contacts: columns[name].slice(0, 40) })) });
  } catch (err) {
    next(err);
  }
});

/** Labs that told us about themselves and have not been verified — the specialist's queue. */
waCampaignsRouter.get('/:id/review', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? 'pending');
    const where: Prisma.WaContactWhereInput = { campaignId: String(req.params.id), professionalType: { not: null }, optInStatus: 'opted_in' };
    if (status === 'pending') where.verification = 'none';
    else where.verification = status === 'verified' ? 'verified' : 'rejected';
    const [rows, campaign, taken] = await Promise.all([
      prisma.waContact.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 300 }),
      prisma.waCampaign.findUnique({ where: { id: String(req.params.id) }, select: { slotCap: true, minSamples: true, minLabAgeYears: true } }),
      prisma.waContact.count({ where: { campaignId: String(req.params.id), verification: 'verified' } }),
    ]);
    res.json({ slotCap: campaign?.slotCap ?? 0, slotsTaken: taken, minSamples: campaign?.minSamples ?? 50, minLabAgeYears: campaign?.minLabAgeYears ?? 3, contacts: rows.map(contactRow) });
  } catch (err) {
    next(err);
  }
});

// ---- Calendly ----------------------------------------------------------------

/**
 * Registers our webhook with Calendly, so a booking, cancellation or reschedule reaches the CRM.
 * Calendly only accepts a signing key when the webhook is created through its API, which is why
 * this is done here and not by hand in its dashboard.
 */
waCampaignsRouter.post('/:id/calendly', async (req: AuthedRequest, res, next) => {
  try {
    const campaign = await prisma.waCampaign.findUnique({ where: { id: String(req.params.id) } });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const given = String(req.body?.token ?? '').trim();
    const token = given || (campaign.calendlyToken ? decrypt(campaign.calendlyToken) : '');
    if (!token) return res.status(400).json({ error: 'Paste a Calendly personal access token.' });
    if (!/^https:\/\//.test(PUBLIC_BASE_URL)) return res.status(400).json({ error: 'The server needs an https PUBLIC_BASE_URL for Calendly to reach it.' });

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const me = await axios.get('https://api.calendly.com/users/me', { headers, timeout: 20000 });
      const organization = me.data?.resource?.current_organization;
      const signingKey = crypto.randomBytes(24).toString('hex');
      const created = await axios.post('https://api.calendly.com/webhook_subscriptions', {
        url: `${PUBLIC_BASE_URL}/api/webhook/calendly/${campaign.id}`,
        events: ['invitee.created', 'invitee.canceled'],
        organization, scope: 'organization', signing_key: signingKey,
      }, { headers, timeout: 20000 });
      await prisma.waCampaign.update({
        where: { id: campaign.id },
        data: { calendlyToken: encrypt(token), calendlySigningKey: encrypt(signingKey), calendlyWebhookId: String(created.data?.resource?.uri ?? 'registered') },
      });
      await writeAudit(req, { module: 'CRM', action: 'Connected Calendly to a WhatsApp campaign', recordId: campaign.id, recordLabel: campaign.name });
      res.json({ connected: true });
    } catch (err) {
      const msg = axios.isAxiosError(err) ? String(err.response?.data?.message ?? err.response?.data?.title ?? err.message) : (err as Error).message;
      res.status(400).json({ error: `Calendly said: ${msg}` });
    }
  } catch (err) {
    next(err);
  }
});
