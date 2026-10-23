import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { UPLOAD_DIR } from '../../services/upload';
import { buildLeadWhere, type LeadFilter } from '../../services/leadFilters';
import {
  createTemplate, deleteTemplate, type NewTemplate, type TemplateButton, fillPlaceholders, listAllTemplates, listApprovedTemplates, resolveTemplateParams, localPart, sendTemplateToNumber, toWaAddress,
  WhatsAppError,
} from '../../services/whatsapp';

/**
 * Broadcasting an approved template to a list. Sits under Notifications because that is what
 * it is — pushing a message out — while CRM → Conversations is for reading and replying to
 * the threads it starts. Both go through the same linked Cloud API number.
 */
export const whatsappTemplatesRouter = Router();

/** Meta throttles hard on a burst; spacing the sends is the difference between queued and dropped. */
const SEND_GAP_MS = 200;
const MAX_RECIPIENTS = 500;

/** The tokens a broadcast may put in a template variable, resolved per recipient. */
const LEAD_TOKENS = ['first_name', 'last_name', 'full_name'] as const;

interface Recipient {
  phone: string;
  leadId: string | null;
  firstName: string;
  lastName: string;
}

function resolveParams(params: string[], recipient: Recipient): string[] {
  return resolveTemplateParams(params, recipient);
}

/** The account every broadcast goes through — the first active linked number. */
async function activeAccount() {
  const account = await prisma.whatsAppAccount.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!account) {
    throw new WhatsAppError('No WhatsApp number is linked yet. Add one in Settings → WhatsApp.', 400);
  }
  return account;
}

function handle(err: unknown, res: any, next: (e?: unknown) => void) {
  if (err instanceof WhatsAppError) return res.status(err.httpStatus).json({ error: err.message });
  return next(err);
}

// ---------------------------------------------------------------------------
// What can be sent
// ---------------------------------------------------------------------------

whatsappTemplatesRouter.get('/', async (_req, res, next) => {
  try {
    const account = await activeAccount();
    res.json({
      account: { id: account.id, label: account.label, displayPhone: account.displayPhone },
      templates: await listApprovedTemplates(account),
      tokens: LEAD_TOKENS,
    });
  } catch (err) {
    handle(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// Who it goes to
// ---------------------------------------------------------------------------

/** Ten digits, or the same with a country code — the shapes people paste in. */
function parseTypedNumbers(raw: unknown): string[] {
  return Array.from(
    new Set(
      String(raw ?? '')
        .split(/[\s,;]+/)
        .map((part) => localPart(part))
        .filter((digits) => digits.length === 10)
    )
  );
}

/**
 * Turns a filter and a box of typed numbers into one de-duplicated list of people, each
 * carrying whatever lead we know for them so `{first_name}` can be filled in per recipient.
 */
async function resolveAudience(body: any): Promise<Recipient[]> {
  const byPhone = new Map<string, Recipient>();

  const typed = parseTypedNumbers(body?.numbers);
  if (typed.length > 0) {
    const leads = await prisma.lead.findMany({
      where: { OR: typed.map((digits) => ({ phone: { endsWith: digits } })) },
      select: { id: true, firstName: true, lastName: true, phone: true },
    });
    for (const digits of typed) {
      const lead = leads.find((l) => localPart(l.phone) === digits);
      byPhone.set(digits, {
        phone: digits,
        leadId: lead?.id ?? null,
        firstName: lead?.firstName ?? '',
        lastName: lead?.lastName ?? '',
      });
    }
  }

  if (body?.useLeadFilter) {
    const leads = await prisma.lead.findMany({
      where: buildLeadWhere((body.leadFilter ?? {}) as LeadFilter),
      select: { id: true, firstName: true, lastName: true, phone: true },
      orderBy: { createdAt: 'desc' },
      // One over the cap, so the caller can tell "exactly the limit" from "more than the limit".
      take: MAX_RECIPIENTS + 1,
    });
    for (const lead of leads) {
      const digits = localPart(lead.phone);
      if (digits.length !== 10 || byPhone.has(digits)) continue;
      byPhone.set(digits, { phone: digits, leadId: lead.id, firstName: lead.firstName, lastName: lead.lastName });
    }
  }

  return Array.from(byPhone.values());
}

/** How many people a filter reaches, before anyone commits to messaging them. */
whatsappTemplatesRouter.post('/audience', async (req, res, next) => {
  try {
    const recipients = await resolveAudience(req.body ?? {});
    res.json({
      count: recipients.length,
      overLimit: recipients.length > MAX_RECIPIENTS,
      limit: MAX_RECIPIENTS,
      sample: recipients.slice(0, 8).map((r) => ({
        phone: r.phone,
        name: `${r.firstName} ${r.lastName}`.trim() || undefined,
      })),
    });
  } catch (err) {
    handle(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

whatsappTemplatesRouter.post('/send', async (req: AuthedRequest, res, next) => {
  try {
    const account = await activeAccount();

    const templateName = String(req.body?.templateName ?? '').trim();
    const language = String(req.body?.language ?? 'en').trim();
    const params: string[] = Array.isArray(req.body?.params) ? req.body.params.map((p: unknown) => String(p ?? '')) : [];
    if (!templateName) return res.status(400).json({ error: 'Pick a template first.' });

    // Read back from Meta rather than trusting the browser: approval can be revoked between
    // the page loading and Send being pressed, and the wording is needed for the thread copy.
    const approved = await listApprovedTemplates(account);
    const template = approved.find((t) => t.name === templateName && t.language === language)
      ?? approved.find((t) => t.name === templateName);
    if (!template) {
      return res.status(400).json({ error: `"${templateName}" is no longer an approved template on this number.` });
    }
    if (params.length !== template.variableCount) {
      return res.status(400).json({
        error: `"${templateName}" needs ${template.variableCount} value${template.variableCount === 1 ? '' : 's'}, but ${params.length} were given.`,
      });
    }

    // A file header has no default: the link is given with every send, and WhatsApp fetches it.
    let headerMedia: { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; link: string } | undefined;
    if (template.headerFormat) {
      const link = String(req.body?.headerMediaUrl ?? '').trim();
      if (!/^https:\/\/\S+$/i.test(link)) {
        return res.status(400).json({ error: `"${templateName}" has a ${template.headerFormat.toLowerCase()} header — give a public https link to it.` });
      }
      headerMedia = { format: template.headerFormat, link };
    }

    const recipients = await resolveAudience(req.body ?? {});
    if (recipients.length === 0) return res.status(400).json({ error: 'No valid phone numbers matched.' });
    if (recipients.length > MAX_RECIPIENTS) {
      return res.status(400).json({ error: `That reaches ${recipients.length} people. Narrow the filter to ${MAX_RECIPIENTS} or fewer.` });
    }

    const results: { phone: string; ok: boolean; message: string }[] = [];
    for (const recipient of recipients) {
      const resolved = resolveParams(params, recipient);
      let ok = true;
      let message = 'Sent.';

      try {
        await sendTemplateToNumber(
          account,
          recipient.phone,
          { name: template.name, language: template.language, params: resolved, body: template.body, headerMedia },
          req.auth?.sub ?? null
        );
      } catch (err) {
        // One rejected number must not abandon the rest of the list.
        ok = false;
        message = err instanceof Error ? err.message : String(err);
      }

      results.push({ phone: recipient.phone, ok, message });

      await prisma.whatsAppTemplateSend.create({
        data: {
          templateName: template.name,
          language: template.language,
          destination: toWaAddress(recipient.phone),
          params: resolved,
          body: fillPlaceholders(template.body, resolved),
          status: ok ? 'sent' : 'failed',
          errorMessage: ok ? null : message,
          leadId: recipient.leadId,
          sentBy: req.auth?.sub ?? null,
        },
      });

      if (recipients.length > 1) await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
    }

    const sent = results.filter((r) => r.ok).length;
    await writeAudit(req, {
      module: 'Notifications',
      action: `Sent WhatsApp template to ${sent}/${results.length} numbers`,
      recordId: template.name,
      recordLabel: template.name,
    });

    res.json({ sent, failed: results.length - sent, results });
  } catch (err) {
    handle(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// Managing templates — create, watch approval, delete
// ---------------------------------------------------------------------------

/** Every template on the number with the status Meta gives it right now, not just approved ones. */
whatsappTemplatesRouter.get('/manage', async (_req, res, next) => {
  try {
    const account = await activeAccount();
    res.json({ templates: await listAllTemplates(account) });
  } catch (err) {
    handle(err, res, next);
  }
});

const SAMPLE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.pdf': 'application/pdf',
};
const HEADER_EXTENSIONS: Record<string, string[]> = {
  IMAGE: ['.jpg', '.jpeg', '.png'],
  VIDEO: ['.mp4'],
  DOCUMENT: ['.pdf'],
};

whatsappTemplatesRouter.post('/manage', async (req: AuthedRequest, res, next) => {
  try {
    const account = await activeAccount();
    const body = req.body ?? {};
    // Meta only accepts lowercase letters, digits and underscores in a name.
    const name = String(body.name ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const text = String(body.body ?? '').trim();
    const footer = String(body.footer ?? '').trim();
    const samples: string[] = Array.isArray(body.samples) ? body.samples.map((v: unknown) => String(v ?? '').trim()) : [];
    const category = body.category === 'UTILITY' ? 'UTILITY' : 'MARKETING';
    const fail = (error: string) => res.status(400).json({ error });

    if (!/^[a-z0-9_]{1,512}$/.test(name)) return fail('Name may only use letters, numbers and underscores.');
    if (!text) return fail('The message text is required.');
    if (text.length > 1024) return fail(`The message text is limited to 1024 characters — this one is ${text.length}.`);
    if (footer.length > 60) return fail('The footer is limited to 60 characters.');
    if (/\{\{/.test(footer)) return fail('A footer cannot hold a variable.');

    // Header: none, a line of text, or a file whose sample Meta's reviewers get to see.
    let header: NewTemplate['header'];
    const h = body.header ?? {};
    const format = String(h.format ?? 'NONE').toUpperCase();
    if (format === 'TEXT') {
      const headerText = String(h.text ?? '').trim();
      if (!headerText) return fail('Type the header text, or choose no header.');
      if (headerText.length > 60) return fail('The header is limited to 60 characters.');
      if (/\{\{/.test(headerText)) return fail('A text header cannot hold a variable here.');
      header = { format: 'TEXT', text: headerText };
    } else if (format in HEADER_EXTENSIONS) {
      const url = String(h.sampleUrl ?? '');
      if (!/^\/uploads\/[\w.-]+$/.test(url)) return fail(`Upload an example ${format.toLowerCase()} for the header first.`);
      const file = path.join(UPLOAD_DIR, path.basename(url));
      const ext = path.extname(file).toLowerCase();
      if (!HEADER_EXTENSIONS[format].includes(ext) || !fs.existsSync(file)) {
        return fail(`The example must be a ${HEADER_EXTENSIONS[format].join(' / ')} file.`);
      }
      header = { format: format as 'IMAGE' | 'VIDEO' | 'DOCUMENT', sample: { path: file, mime: SAMPLE_MIME[ext], name: path.basename(file) } };
    }

    const placeholders = Array.from(new Set(text.match(/\{\{\s*\d+\s*\}\}/g) ?? []));
    if (placeholders.length > 0) {
      const numbers = placeholders.map((p) => Number(p.replace(/\D/g, ''))).sort((a, b) => a - b);
      if (numbers.some((n, i) => n !== i + 1)) return fail('Variables must run {{1}}, {{2}}, {{3}} with no gaps.');
      if (samples.length < numbers.length || samples.slice(0, numbers.length).some((v) => !v)) {
        return fail('Give an example value for every variable — Meta will not review the template without them.');
      }
    }

    // Buttons: Meta allows 10 in all, of which at most 2 links and 1 phone number.
    const buttons: TemplateButton[] = [];
    for (const raw of Array.isArray(body.buttons) ? body.buttons : []) {
      const label = String(raw?.text ?? '').trim();
      if (!label) return fail('Every button needs its label.');
      if (label.length > 25) return fail(`The button "${label}" is over 25 characters.`);
      if (raw.type === 'URL') {
        const url = String(raw.url ?? '').trim();
        if (!/^https?:\/\/\S+$/i.test(url)) return fail(`The button "${label}" needs a link starting with https://`);
        const dynamic = /\{\{1\}\}$/.test(url);
        if (/\{\{/.test(url) && !dynamic) return fail('A link variable must be {{1}} at the very end of the link.');
        const example = String(raw.example ?? '').trim();
        if (dynamic && !/^https?:\/\/\S+$/i.test(example)) return fail(`Give an example full link for the button "${label}".`);
        buttons.push({ type: 'URL', text: label, url, example: dynamic ? example : undefined });
      } else if (raw.type === 'PHONE_NUMBER') {
        const phone = String(raw.phone ?? '').replace(/[^\d+]/g, '');
        if (phone.replace(/\D/g, '').length < 8) return fail(`The button "${label}" needs a phone number with its country code.`);
        buttons.push({ type: 'PHONE_NUMBER', text: label, phone });
      } else {
        buttons.push({ type: 'QUICK_REPLY', text: label });
      }
    }
    if (buttons.length > 10) return fail('A template can have at most 10 buttons.');
    if (buttons.filter((b) => b.type === 'URL').length > 2) return fail('At most 2 link buttons are allowed.');
    if (buttons.filter((b) => b.type === 'PHONE_NUMBER').length > 1) return fail('Only 1 call button is allowed.');

    const created = await createTemplate(account, {
      name, language: String(body.language ?? 'en').trim() || 'en', category,
      header, body: text, footer: footer || undefined, buttons, samples,
    });
    await writeAudit(req, { module: 'Notifications', action: 'Submitted a WhatsApp template for approval', recordId: name, recordLabel: name });
    res.status(201).json({ name, ...created });
  } catch (err) {
    handle(err, res, next);
  }
});

whatsappTemplatesRouter.delete('/manage/:name', async (req: AuthedRequest, res, next) => {
  try {
    const account = await activeAccount();
    const name = String(req.params.name);
    await deleteTemplate(account, name);
    await writeAudit(req, { module: 'Notifications', action: 'Deleted a WhatsApp template', recordId: name, recordLabel: name });
    res.status(204).end();
  } catch (err) {
    handle(err, res, next);
  }
});

whatsappTemplatesRouter.get('/sends', async (req, res, next) => {
  try {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const sends = await prisma.whatsAppTemplateSend.findMany({ orderBy: { sentAt: 'desc' }, take });
    res.json({
      sends: sends.map((s) => ({
        id: s.id,
        templateName: s.templateName,
        destination: s.destination,
        body: s.body ?? undefined,
        status: s.status,
        errorMessage: s.errorMessage ?? undefined,
        sentAt: s.sentAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});
