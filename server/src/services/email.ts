import crypto from 'crypto';
import axios from 'axios';
import type { EmailSettings } from '@prisma/client';
import { prisma } from '../prisma';
import { decrypt } from './crypto';

/**
 * The one place an email to a lead is sent from — used by both the sequence engine and the
 * automation "Send Email" action, so there is a single implementation of suppression,
 * placeholder rendering, the unsubscribe footer, and what gets written to the timeline.
 *
 * Transport is Brevo's REST API. Swapping to SendGrid/SES/Mailgun means replacing `transport`
 * below and nothing else: everything above it is provider-agnostic.
 */

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:4000';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export async function getEmailSettings(): Promise<EmailSettings> {
  const existing = await prisma.emailSettings.findUnique({ where: { id: 'default' } });
  if (existing) return existing;
  return prisma.emailSettings.create({
    data: { id: 'default', inboundWebhookToken: crypto.randomBytes(18).toString('hex') },
  });
}

/** Configured means: switched on, a key saved, and a From address to send as. */
export async function isEmailConfigured(): Promise<boolean> {
  const settings = await getEmailSettings();
  return settings.enabled && !!settings.apiKey && !!settings.fromEmail;
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

const FIELDS = ['first_name', 'last_name', 'full_name', 'company', 'email', 'phone', 'city'] as const;

type PlaceholderLead = {
  firstName: string;
  lastName: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
};

/** `{{lead.first_name}}`, `{{first_name}}` and `{first_name}` all resolve to the same value. */
export function renderPlaceholders(text: string, lead: PlaceholderLead): string {
  const values: Record<(typeof FIELDS)[number], string> = {
    first_name: lead.firstName,
    last_name: lead.lastName,
    full_name: `${lead.firstName} ${lead.lastName}`.trim(),
    company: lead.company ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    city: lead.city ?? '',
  };
  let out = text;
  for (const field of FIELDS) {
    out = out.replace(new RegExp(`\\{\\{\\s*(?:lead\\.)?${field}\\s*\\}\\}`, 'g'), values[field]);
    out = out.replace(new RegExp(`\\{\\s*${field}\\s*\\}`, 'g'), values[field]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

const UNSUBSCRIBE_SECRET = process.env.JWT_SECRET || 'techtaru-dev-jwt-secret-change-me';

/**
 * Signed rather than stored: the link is an HMAC of the address, so it cannot be guessed for
 * someone else's address and no per-lead column has to be kept in step.
 */
export function unsubscribeToken(email: string): string {
  return crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(email.toLowerCase()).digest('hex').slice(0, 32);
}

export function unsubscribeUrl(email: string): string {
  return `${PUBLIC_BASE_URL}/api/unsubscribe/${encodeURIComponent(email)}/${unsubscribeToken(email)}`;
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = unsubscribeToken(email);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

export async function isSuppressed(email: string): Promise<boolean> {
  return !!(await prisma.emailSuppression.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } }));
}

export async function suppress(email: string, reason: string, leadId?: string | null): Promise<void> {
  await prisma.emailSuppression.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), reason, leadId: leadId ?? null },
    update: { reason },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Bodies are authored as HTML in the sequence builder; plain text gets its newlines kept. */
function withFooter(body: string, settings: EmailSettings, email: string): string {
  const html = /<[a-z][\s\S]*>/i.test(body) ? body : `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>`;
  return `${html}
<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb">
<p style="font-size:12px;color:#6b7280;line-height:1.5">
  ${escapeHtml(settings.footerText)}<br>
  <a href="${unsubscribeUrl(email)}" style="color:#6b7280">Unsubscribe</a>
</p>`;
}

// ---------------------------------------------------------------------------
// Transport — the only provider-specific code in this file
// ---------------------------------------------------------------------------

async function transport(
  settings: EmailSettings,
  input: { to: string; toName?: string; subject: string; html: string }
): Promise<{ messageId?: string }> {
  const { data } = await axios.post(
    BREVO_ENDPOINT,
    {
      sender: { email: settings.fromEmail, name: settings.fromName || undefined },
      to: [{ email: input.to, name: input.toName || undefined }],
      replyTo: settings.replyToEmail ? { email: settings.replyToEmail } : undefined,
      subject: input.subject,
      htmlContent: input.html,
      // Brevo returns this on the inbound/event webhooks, which is how a reply is tied back.
      headers: { 'X-Mailer': 'TechTaru' },
    },
    {
      headers: { 'api-key': decrypt(settings.apiKey!), 'Content-Type': 'application/json' },
      timeout: 20_000,
    }
  );
  return { messageId: data?.messageId ? String(data.messageId) : undefined };
}

/** Sends without touching a lead — used by the "send a test email" button. */
export async function sendRawEmail(to: string, subject: string, html: string): Promise<void> {
  const settings = await getEmailSettings();
  if (!settings.enabled) throw new Error('Email is turned off in Settings → Email.');
  if (!settings.apiKey) throw new Error('No API key is saved in Settings → Email.');
  if (!settings.fromEmail) throw new Error('No From address is saved in Settings → Email.');
  await transport(settings, { to, subject, html });
}

// ---------------------------------------------------------------------------
// The seam every caller uses
// ---------------------------------------------------------------------------

export interface DeliverResult {
  ok: boolean;
  message: string;
}

/**
 * Sends an email to a lead and records it on their timeline. `source` names what produced it
 * — a sequence or an automation — and appears on the note so the timeline explains itself.
 *
 * When no provider is configured the content is still written to the timeline rather than
 * lost, and the caller is told plainly that nothing was delivered.
 */
export async function deliverLeadEmail(
  lead: { id: string; email?: string | null; firstName?: string; lastName?: string },
  input: { subject: string; body: string; source: string }
): Promise<DeliverResult> {
  if (!lead.email) return { ok: false, message: 'Lead has no email address on file.' };
  if (await isSuppressed(lead.email)) {
    return { ok: false, message: 'This address has unsubscribed.' };
  }

  const settings = await getEmailSettings();
  const subject = input.subject || '(no subject)';
  const configured = settings.enabled && !!settings.apiKey && !!settings.fromEmail;

  let delivered = false;
  let note: string;
  if (configured) {
    try {
      await transport(settings, {
        to: lead.email,
        toName: `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || undefined,
        subject,
        html: withFooter(input.body, settings, lead.email),
      });
      delivered = true;
      note = `Sent via ${settings.provider}`;
    } catch (err) {
      const detail = axios.isAxiosError(err)
        ? `${err.response?.status ?? ''} ${JSON.stringify(err.response?.data ?? err.message)}`
        : err instanceof Error
          ? err.message
          : 'Unknown error';
      await prisma.leadActivity.create({
        data: { leadId: lead.id, type: 'email_sent', description: `${input.source} failed to send "${subject}": ${detail}` },
      });
      return { ok: false, message: `Provider rejected the send: ${detail}` };
    }
  } else {
    note = '[Not delivered — email is not configured in Settings → Email]';
  }

  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: 'email_sent',
      description: delivered
        ? `${input.source} sent "${subject}".`
        : `${input.source} would send "${subject}" — not delivered, email is not configured.`,
    },
  });
  await prisma.leadNote.create({
    data: {
      leadId: lead.id,
      userId: 'system',
      userName: input.source,
      body: `${note}\nSubject: ${subject}\n\n${input.body}`,
    },
  });

  return { ok: true, message: delivered ? 'Sent.' : 'Logged (not delivered — email is not configured).' };
}
