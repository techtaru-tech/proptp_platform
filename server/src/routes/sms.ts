import { Router } from 'express';
import { prisma } from '../prisma';
import { encrypt } from '../services/crypto';
import { writeAudit } from '../services/audit';
import type { AuthedRequest } from '../services/auth';
import { getSmsSettings, renderSms, sendSms, slotCount } from '../services/sms';

/** Settings > SMS (DLT) — /api/sms. */
export const smsRouter = Router();

const PROVIDERS = ['msg91'];
const publicSettings = (s: Awaited<ReturnType<typeof getSmsSettings>>) => ({ provider: s.provider, enabled: s.enabled, hasAuthKey: !!s.authKey, senderId: s.senderId, dltEntityId: s.dltEntityId, providers: PROVIDERS });

smsRouter.get('/settings', async (_req, res, next) => {
  try { res.json(publicSettings(await getSmsSettings())); } catch (err) { next(err); }
});

smsRouter.patch('/settings', async (req: AuthedRequest, res, next) => {
  try {
    const b = req.body ?? {};
    const data: Record<string, unknown> = {};
    if (b.provider !== undefined) { if (!PROVIDERS.includes(String(b.provider))) return res.status(400).json({ error: `Provider must be one of: ${PROVIDERS.join(', ')}.` }); data.provider = String(b.provider); }
    if (b.senderId !== undefined) { const v = String(b.senderId).trim().toUpperCase(); if (v && !/^[A-Z]{6}$/.test(v)) return res.status(400).json({ error: 'The sender id is six letters, as registered with DLT.' }); data.senderId = v; }
    if (b.dltEntityId !== undefined) data.dltEntityId = String(b.dltEntityId).trim();
    if (b.authKey) data.authKey = encrypt(String(b.authKey).trim());
    if (b.enabled !== undefined) data.enabled = !!b.enabled;
    await getSmsSettings();
    const updated = await prisma.smsSettings.update({ where: { id: 'default' }, data });
    if (updated.enabled && (!updated.authKey || !updated.senderId)) {
      await prisma.smsSettings.update({ where: { id: 'default' }, data: { enabled: false } });
      return res.status(400).json({ error: 'Add the provider key and the sender id before switching SMS on.' });
    }
    await writeAudit(req, { module: 'Settings', action: 'Updated SMS settings', recordId: 'default', recordLabel: 'SMS', description: '' });
    res.json(publicSettings(updated));
  } catch (err) { next(err); }
});

const readTemplate = (b: Record<string, unknown>) => {
  const name = String(b?.name ?? '').trim();
  const dltTemplateId = String(b?.dltTemplateId ?? '').trim();
  const body = String(b?.body ?? '').trim();
  if (!/^[a-z0-9_]{2,40}$/.test(name)) return { error: 'The name is lowercase letters, digits and underscores, e.g. payment_reminder.' };
  if (!dltTemplateId) return { error: 'Enter the DLT template id the operator gave you.' };
  if (!body) return { error: 'Enter the approved wording, with {#var#} where a value goes.' };
  return { data: { name, dltTemplateId, body, active: b?.active === undefined ? true : !!b.active } };
};

smsRouter.get('/templates', async (_req, res, next) => {
  try { res.json((await prisma.smsTemplate.findMany({ orderBy: { name: 'asc' } })).map((t) => ({ ...t, createdAt: t.createdAt.toISOString(), slots: slotCount(t.body) }))); } catch (err) { next(err); }
});

smsRouter.post('/templates', async (req: AuthedRequest, res, next) => {
  try {
    const { data, error } = readTemplate(req.body);
    if (error || !data) return res.status(400).json({ error });
    if (await prisma.smsTemplate.count({ where: { name: data.name } })) return res.status(409).json({ error: 'A template with that name already exists.' });
    const t = await prisma.smsTemplate.create({ data });
    await writeAudit(req, { module: 'Settings', action: 'Added SMS template', recordId: t.id, recordLabel: t.name, description: '' });
    res.status(201).json(t);
  } catch (err) { next(err); }
});

smsRouter.patch('/templates/:id', async (req: AuthedRequest, res, next) => {
  try {
    const current = await prisma.smsTemplate.findUnique({ where: { id: String(req.params.id) } });
    if (!current) return res.status(404).json({ error: 'Template not found.' });
    const { data, error } = readTemplate({ ...current, ...req.body });
    if (error || !data) return res.status(400).json({ error });
    if (data.name !== current.name && (await prisma.smsTemplate.count({ where: { name: data.name } }))) return res.status(409).json({ error: 'A template with that name already exists.' });
    res.json(await prisma.smsTemplate.update({ where: { id: current.id }, data }));
  } catch (err) { next(err); }
});

smsRouter.delete('/templates/:id', async (req: AuthedRequest, res, next) => {
  try {
    const t = await prisma.smsTemplate.findUnique({ where: { id: String(req.params.id) } });
    if (!t) return res.status(404).json({ error: 'Template not found.' });
    const rules = await prisma.opsRule.findMany({ select: { steps: true } });
    if (rules.some((r) => JSON.stringify(r.steps).includes(`"${t.name}"`))) return res.status(409).json({ error: 'An operations rule uses this template. Switch the template off instead.' });
    await prisma.smsTemplate.delete({ where: { id: t.id } });
    await writeAudit(req, { module: 'Settings', action: 'Deleted SMS template', recordId: t.id, recordLabel: t.name, description: '' });
    res.status(204).send();
  } catch (err) { next(err); }
});

/** Sends one approved template to one number (a test, or a message to a lead), and logs it. */
smsRouter.post('/send', async (req: AuthedRequest, res, next) => {
  try {
    const templateName = String(req.body?.templateName ?? '');
    const params = Array.isArray(req.body?.params) ? req.body.params.map(String) : [];
    let to = req.body?.to;
    const leadId = req.body?.leadId ? String(req.body.leadId) : null;
    if (leadId) {
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { phone: true } });
      if (!lead) return res.status(404).json({ error: 'Lead not found.' });
      to = lead.phone;
    }
    const r = await sendSms({ to, templateName, params, leadId });
    if (!r.ok) return res.status(422).json({ error: r.detail });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

smsRouter.post('/preview', async (req, res, next) => {
  try {
    const t = await prisma.smsTemplate.findUnique({ where: { name: String(req.body?.templateName ?? '') } });
    if (!t) return res.status(404).json({ error: 'Template not found.' });
    res.json({ text: renderSms(t.body, Array.isArray(req.body?.params) ? req.body.params.map(String) : []), slots: slotCount(t.body) });
  } catch (err) { next(err); }
});

smsRouter.get('/log', async (_req, res, next) => {
  try { res.json((await prisma.smsLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })).map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))); } catch (err) { next(err); }
});
