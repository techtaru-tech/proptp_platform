import { Router } from 'express';
import { prisma } from '../prisma';
import { suppress, verifyUnsubscribeToken } from '../services/email';

/**
 * Public, unauthenticated, and deliberately a plain HTML page rather than JSON — this URL is
 * opened by a person from an email client, and it has to work with one click and no login.
 */
export const unsubscribeRouter = Router();

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7f9;color:#111827">
<div style="max-width:34rem;margin:12vh auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #e5e7eb">
<h1 style="margin:0 0 12px;font-size:20px">${title}</h1>${body}</div></body></html>`;
}

unsubscribeRouter.get('/:email/:token', async (req, res, next) => {
  try {
    const email = decodeURIComponent(String(req.params.email)).toLowerCase();
    if (!verifyUnsubscribeToken(email, String(req.params.token))) {
      return res.status(403).send(page('Link not valid', '<p>This unsubscribe link is not valid. Please reply to the email and ask us to remove you.</p>'));
    }

    const lead = await prisma.lead.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    await suppress(email, 'unsubscribed', lead?.id);
    if (lead) {
      await prisma.leadActivity.create({
        data: { leadId: lead.id, type: 'note_added', description: 'Unsubscribed from marketing email.' },
      });
    }

    res.send(
      page(
        'You have been unsubscribed',
        `<p><strong>${email}</strong> will not receive any further marketing email from us.</p>
         <p style="color:#6b7280;font-size:14px">If this was a mistake, reply to any earlier email and we will add you back.</p>`
      )
    );
  } catch (err) {
    next(err);
  }
});
