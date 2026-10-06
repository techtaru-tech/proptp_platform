import axios from 'axios';
import { prisma } from '../prisma';
import { decrypt } from './crypto';

/**
 * DLT SMS. Indian operators deliver only messages whose wording was pre-approved (a DLT template),
 * so nothing here sends free text: a send names an approved template and supplies its variables.
 * The provider call is isolated in `deliver`, so supporting another provider is one function.
 */

export const getSmsSettings = () => prisma.smsSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });

export const VAR = /\{#var#\}/gi;

/** Fills the template's {#var#} slots, in order, with the given values. */
export function renderSms(body: string, params: string[]): string {
  let i = 0;
  return body.replace(VAR, () => params[i++] ?? '');
}
export const slotCount = (body: string) => (body.match(VAR) ?? []).length;

/** A 10-digit Indian mobile, with the country code the provider wants. */
export function smsNumber(input: unknown): string | null {
  const d = String(input ?? '').replace(/\D/g, '');
  const ten = d.slice(-10);
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

async function deliver(settings: Awaited<ReturnType<typeof getSmsSettings>>, to: string, text: string, dltTemplateId: string): Promise<string> {
  if (settings.provider !== 'msg91') throw new Error(`The “${settings.provider}” provider is not supported.`);
  const { data } = await axios.get('https://api.msg91.com/api/sendhttp.php', {
    params: { authkey: decrypt(settings.authKey!), mobiles: to, message: text, sender: settings.senderId, route: 4, country: 91, DLT_TE_ID: dltTemplateId, PE_ID: settings.dltEntityId || undefined },
    timeout: 15_000,
  });
  const out = typeof data === 'string' ? data : JSON.stringify(data);
  // MSG91 answers with a request id when it accepts the message, and with a JSON error when it does not.
  if (typeof data === 'object' && data && (data as { type?: string }).type === 'error') throw new Error(String((data as { message?: string }).message ?? out));
  return out;
}

/** Sends one approved template to one number, and records what happened either way. */
export async function sendSms(input: { to: unknown; templateName: string; params?: string[]; leadId?: string | null }): Promise<{ ok: boolean; detail: string }> {
  const log = (to: string, text: string, ok: boolean, detail: string) =>
    prisma.smsLog.create({ data: { to, templateName: input.templateName, text, status: ok ? 'sent' : 'failed', detail, leadId: input.leadId ?? null } }).catch(() => undefined);
  const settings = await getSmsSettings();
  const template = await prisma.smsTemplate.findUnique({ where: { name: input.templateName } });
  const to = smsNumber(input.to);
  const text = template ? renderSms(template.body, input.params ?? []) : '';
  const fail = async (detail: string) => { await log(String(input.to ?? ''), text, false, detail); return { ok: false, detail }; };
  if (!settings.enabled) return fail('SMS is switched off in Settings.');
  if (!settings.authKey || !settings.senderId) return fail('SMS is not set up: add the provider key and the sender id.');
  if (!template || !template.active) return fail(`There is no active SMS template called “${input.templateName}”.`);
  if (!to) return fail('That is not a valid Indian mobile number.');
  if ((input.params ?? []).length < slotCount(template.body)) return fail(`The template needs ${slotCount(template.body)} value(s).`);
  try {
    const detail = await deliver(settings, to, text, template.dltTemplateId);
    await log(to, text, true, detail.slice(0, 300));
    return { ok: true, detail };
  } catch (e) {
    return fail((e as Error).message);
  }
}
