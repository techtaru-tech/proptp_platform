import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { buildLeadWhere, type LeadFilter } from '../../services/leadFilters';
import {
  fillPlaceholders, listApprovedTemplates, localPart, sendTemplateToNumber, toWaAddress,
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
  return params.map((param) => {
    const filled = param
      .replace(/\{first_name\}/gi, recipient.firstName)
      .replace(/\{last_name\}/gi, recipient.lastName)
      .replace(/\{full_name\}/gi, `${recipient.firstName} ${recipient.lastName}`.trim());
    // Meta rejects an empty variable outright, so an unknown name becomes a greeting that reads.
    return filled.trim() || 'there';
  });
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
