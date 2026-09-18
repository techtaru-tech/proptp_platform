import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../prisma';
import type { Prisma } from '@prisma/client';
import { decrypt } from '../services/crypto';
import { verifySignature, fetchLeadData, getFormName } from '../services/metaService';
import { applyFormMapping, fetchOptionLabels, mappingForForm, saveCustomValues, unmappedNote } from '../services/leadFieldMapping';
import { recordInbound, recordStatus } from '../services/whatsapp';
import { ingestWebhookLead } from '../services/webhookIngest';
import { outsideBusinessHoursFlag } from '../services/businessHours';
import { fireTrigger } from '../services/automationEngine';
import { getSettings } from '../services/airphone';
import { getEmailSettings } from '../services/email';
import { recordCallLog, resolveAgentForCall } from '../services/callRouting';
import { describeRequest, logTelephonyEvent } from '../services/telephonyEvents';

export const webhookRouter = Router();

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || '';

/**
 * Meta's one-time webhook verification handshake — when you paste the "Callback URL" +
 * "Verify Token" into the Meta App dashboard, Meta sends this GET request and expects the
 * `hub.challenge` value echoed back verbatim if `hub.verify_token` matches ours.
 */
webhookRouter.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/**
 * Real Meta Lead Ads webhook receiver. Meta only ever sends the `leadgen_id` here — the actual
 * answers are fetched separately via the Graph API using the connected Page's access token.
 * Every receipt is logged to IntegrationActivity (mirrors the real `webhook_logs` table), whether
 * it succeeds, fails signature verification, or fails to process.
 */
webhookRouter.post('/meta', async (req, res) => {
  // Always ack quickly — Meta retries aggressively on non-200 responses.
  res.sendStatus(200);

  const rawBody: Buffer = (req as any).rawBody;
  const signature = req.header('x-hub-signature-256');
  const body = req.body as {
    object?: string;
    entry?: { id: string; time: number; changes: { field: string; value: Record<string, any> }[] }[];
  };

  const entries = body.entry ?? [];
  for (const entry of entries) {
    const pageId = entry.id;
    const connection = await prisma.leadSourceConnection.findFirst({
      where: { source: 'meta', metaPageId: pageId, active: true },
    });

    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;
      const leadgenId: string | undefined = change.value?.leadgen_id;

      if (!connection) {
        // No connection configured for this page — log it but there's nothing to attribute it to.
        continue;
      }

      if (!connection.metaAppSecret || !verifySignature(rawBody, signature, decrypt(connection.metaAppSecret))) {
        await prisma.integrationActivity.create({
          data: {
            connectionId: connection.id,
            source: 'meta',
            status: 'invalid_signature',
            errorMessage: 'X-Hub-Signature-256 verification failed.',
            rawPayload: body as any,
          },
        });
        continue;
      }

      try {
        if (!leadgenId || !connection.metaPageAccessToken) throw new Error('Missing leadgen_id or page access token.');
        const leadData = await fetchLeadData(leadgenId, decrypt(connection.metaPageAccessToken));
        // Per-form mapping an admin configured, falling back to automatic name matching.
        const pageToken = decrypt(connection.metaPageAccessToken);
        const { lead: mapped, custom, unmapped } = applyFormMapping(
          leadData.field_data,
          mappingForForm(connection.fieldMapping, leadData.form_id),
          leadData.form_id ? await fetchOptionLabels(leadData.form_id, pageToken) : {}
        );

        const existing = await prisma.lead.findFirst({
          where: { source: 'meta', externalLeadId: leadgenId },
        });

        let leadId: string;
        if (existing) {
          leadId = existing.id;
        } else {
          const created = await prisma.lead.create({
            data: {
              firstName: mapped.firstName,
              lastName: mapped.lastName,
              email: mapped.email,
              phone: mapped.phone ?? '',
              city: mapped.city,
              company: mapped.company,
              jobTitle: mapped.jobTitle,
              source: 'meta',
              externalLeadId: leadgenId,
              sourceConnectionId: connection.id,
              utmSource: 'meta',
              utmMedium: 'paid_social',
              utmCampaign: leadData.campaign_name ?? undefined,
              // Kept whole so the lead's page can say which ad produced it. Meta hands this
              // over with the lead and never again, so it is stored now or lost.
              adDetail: {
                formName: leadData.form_id
                  ? await getFormName(leadData.form_id, decrypt(connection.metaPageAccessToken))
                  : null,
                campaignId: leadData.campaign_id ?? null,
                campaignName: leadData.campaign_name ?? null,
                adsetId: leadData.adset_id ?? null,
                adsetName: leadData.adset_name ?? null,
                adId: leadData.ad_id ?? null,
                adName: leadData.ad_name ?? null,
                formId: leadData.form_id ?? null,
              },
              status: 'new',
              priority: 'normal',
              receivedOutsideBusinessHours: await outsideBusinessHoursFlag(),
            },
          });
          leadId = created.id;
          await saveCustomValues(leadId, custom);
          const leftover = unmappedNote(unmapped);
          if (leftover) {
            await prisma.leadNote.create({
              data: { leadId, userId: 'system', userName: 'Meta Lead Ads', body: `Form answers with no mapped field:\n${leftover}` },
            });
          }
          await fireTrigger('lead_created', leadId);
          const fullName = `${mapped.firstName} ${mapped.lastName}`.trim();
          await prisma.leadActivity.create({
            data: {
              leadId,
              type: 'created',
              description: `Lead "${fullName}" ingested from Meta Lead Ads.`,
            },
          });
        }

        await prisma.leadSourceConnection.update({
          where: { id: connection.id },
          data: { lastReceivedAt: new Date(), status: 'connected', lastError: null },
        });

        await prisma.integrationActivity.create({
          data: {
            connectionId: connection.id,
            source: 'meta',
            status: 'processed',
            leadId,
            leadsCreated: existing ? 0 : 1,
            rawPayload: body as any,
            processedAt: new Date(),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error processing lead.';
        await prisma.leadSourceConnection.update({
          where: { id: connection.id },
          data: { status: 'error', lastError: message },
        });
        await prisma.integrationActivity.create({
          data: {
            connectionId: connection.id,
            source: 'meta',
            status: 'failed',
            errorMessage: message,
            rawPayload: body as any,
            processedAt: new Date(),
          },
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// WhatsApp Cloud API — inbound messages and delivery receipts.
//
// One URL per linked number (the account id is in the path) so several numbers can point at
// this server independently, each with its own verify token and app secret.
// ---------------------------------------------------------------------------

/** Meta's one-time handshake when the Callback URL is saved in the app dashboard. */
webhookRouter.get('/whatsapp/:accountId', async (req, res) => {
  const account = await prisma.whatsAppAccount.findUnique({ where: { id: String(req.params.accountId) } });
  if (!account) return res.sendStatus(404);
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === account.verifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

webhookRouter.post('/whatsapp/:accountId', async (req, res) => {
  const account = await prisma.whatsAppAccount.findUnique({ where: { id: String(req.params.accountId) } });
  if (!account || !account.active) return res.sendStatus(403);

  // Signature is checked before the ack: an unsigned body must not reach the database.
  if (account.appSecret) {
    const rawBody: Buffer = (req as any).rawBody;
    if (!verifySignature(rawBody, req.header('x-hub-signature-256'), decrypt(account.appSecret))) {
      return res.sendStatus(403);
    }
  }

  // Acked immediately — Meta retries hard on anything that is not a prompt 200.
  res.sendStatus(200);

  try {
    const body = req.body as {
      entry?: { changes?: { field?: string; value?: any }[] }[];
    };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const value = change.value ?? {};
        const contactName: string | undefined = value.contacts?.[0]?.profile?.name;

        for (const message of value.messages ?? []) {
          await recordInbound(account, message, contactName);
        }
        for (const status of value.statuses ?? []) {
          await recordStatus(status);
        }
      }
    }
  } catch (err) {
    console.error('[whatsapp] inbound failed:', err, JSON.stringify(req.body)?.slice(0, 500));
  }
});

// ---------------------------------------------------------------------------
// Inbound email — a reply from a lead.
//
// This is what makes a sequence's "Stop when lead replies" real: the reply is written as an
// `email_received` activity, and the sequence engine unenrols on its next tick (and always
// re-checks immediately before a send, so nothing slips out after a reply).
// ---------------------------------------------------------------------------

/** Brevo posts either a single object or `{ items: [...] }`; other providers vary again. */
function inboundMessages(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return body ? [body] : [];
}

function senderAddress(message: any): string {
  const raw =
    message?.from?.address ??
    message?.from?.[0]?.address ??
    message?.From ??
    message?.sender ??
    message?.from ??
    '';
  const match = String(raw).match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0].toLowerCase() : '';
}

webhookRouter.post('/email/:token/inbound', async (req, res) => {
  const settings = await getEmailSettings();
  if (!settings.enabled || settings.inboundWebhookToken !== String(req.params.token)) return res.sendStatus(403);

  // Acknowledged before the work, and never with an error: a provider that sees a failure
  // here retries or disables the route.
  res.json({ status: 'ok' });

  try {
    for (const message of inboundMessages(req.body)) {
      const from = senderAddress(message);
      if (!from) continue;

      const lead = await prisma.lead.findFirst({
        where: { email: { equals: from, mode: 'insensitive' } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (!lead) continue;

      const subject = String(message?.subject ?? message?.Subject ?? '(no subject)');
      const text = String(message?.text ?? message?.Text ?? message?.html ?? '').replace(/<[^>]*>/g, '').trim();

      await prisma.leadActivity.create({
        data: { leadId: lead.id, type: 'email_received', description: `Reply received: "${subject}".` },
      });
      await prisma.leadNote.create({
        data: {
          leadId: lead.id,
          userId: 'system',
          userName: 'Inbound email',
          body: `From: ${from}\nSubject: ${subject}\n\n${text.slice(0, 4000)}`,
        },
      });
    }
  } catch (err) {
    console.error('[inbound email] failed:', err);
  }
});

// ---------------------------------------------------------------------------
// Airphone telephony — the two endpoints the provider calls into.
//
// Registered before the generic `/:source/:token` receiver so they cannot be shadowed. The
// token in the path is the credential, the same arrangement the lead-source webhooks use;
// the full URLs are shown (and rotatable) on Settings -> Telephony.
// ---------------------------------------------------------------------------

/**
 * The provider appends its query string to whatever URL you give it *without* a `?`, so the
 * path segment arrives as the token with `caller=...&unique_id=...` glued to the end. Rather
 * than lose a live call to that, the glued remainder is recognised and parsed.
 *
 * Matching is still exact: the stored token has to be a prefix of the segment, so nothing is
 * accepted that would not have been accepted before -- only more of what is already ours.
 */
function parseGlued(remainder: string): Record<string, string> {
  const glued: Record<string, string> = {};
  new URLSearchParams(remainder.replace(/^[?&]/, '')).forEach((value, key) => {
    glued[key] = value;
  });
  return glued;
}

async function telephonyGuard(rawToken: string): Promise<{ ok: boolean; enabled: boolean; glued: Record<string, string> }> {
  const settings = await getSettings();
  if (!settings.enabled) return { ok: false, enabled: false, glued: {} };
  if (rawToken === settings.webhookToken) return { ok: true, enabled: true, glued: {} };

  if (rawToken.startsWith(settings.webhookToken)) {
    return { ok: true, enabled: true, glued: parseGlued(rawToken.slice(settings.webhookToken.length)) };
  }

  return { ok: false, enabled: true, glued: {} };
}

/**
 * The provider's parameter names are only as reliable as the documentation, and a live call
 * is a bad time to discover a rename. The first present alias wins; whatever actually arrived
 * is on the TelephonyEvent record either way.
 */
function pick(source: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = source[name] ?? source[name.toLowerCase()] ?? source[name.toUpperCase()];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return undefined;
}

/**
 * "Who should take this call?" — asked while the customer is still on hold, so it answers
 * with the agent number and a requestId and does nothing slow.
 *
 * Accepts POST as well as GET: the query string is where this is documented, but a provider
 * that posts the same fields should not be met with a 404 while a customer waits.
 */
async function handleAgentNumberWebhook(req: Request, res: Response, next: NextFunction) {
  const request = describeRequest(req as any);
  try {
    const guard = await telephonyGuard(String(req.params.token));
    if (!guard.ok) {
      const reason = guard.enabled
        ? 'The token in the webhook URL does not match the one in Settings -> Telephony.'
        : 'Telephony is turned off in Settings -> Telephony.';
      await logTelephonyEvent({ kind: 'routing', outcome: 'rejected', request, errorMessage: reason, response: { httpStatus: 403 } });
      return res.sendStatus(403);
    }

    const input = {
      ...guard.glued,
      ...(req.query as Record<string, unknown>),
      ...((req.body ?? {}) as Record<string, unknown>),
    };
    const answer = await resolveAgentForCall({
      caller: pick(input, 'caller', 'caller_id', 'callerid', 'from', 'cli', 'mobile') ?? '',
      uniqueId: pick(input, 'unique_id', 'uniqueid', 'call_id', 'callid'),
      virtualNumber: pick(input, 'vnm', 'ivr_number', 'virtual_number', 'did', 'to'),
    });

    // No agent and no fallback: answering with an empty number is how the provider is told
    // there is nobody to route to.
    const body = answer ? { number: answer.number, requestId: answer.requestId } : { number: '', requestId: '' };
    await logTelephonyEvent({
      kind: 'routing',
      outcome: 'ok',
      request,
      response: body,
      errorMessage: answer ? undefined : 'No agent and no fallback number — answered with an empty number.',
      callLogId: answer?.callLogId ?? null,
    });
    res.json(body);
  } catch (err) {
    await logTelephonyEvent({
      kind: 'routing',
      outcome: 'failed',
      request,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    next(err);
  }
}

webhookRouter.get('/airphone/:token', handleAgentNumberWebhook);
webhookRouter.post('/airphone/:token', handleAgentNumberWebhook);

/**
 * The call log the provider pushes after hangup. The path is matched loosely for the same
 * reason the token is: the provider may glue its parameters straight onto the URL.
 */
webhookRouter.post('/airphone/:token/:tail', async (req, res, next) => {
  const tail = String(req.params.tail ?? '');
  if (!tail.startsWith('call-log')) return next();

  const request = describeRequest(req as any);
  const guard = await telephonyGuard(String(req.params.token));
  if (!guard.ok) {
    await logTelephonyEvent({
      kind: 'call_log',
      outcome: 'rejected',
      request,
      response: { httpStatus: 403 },
      errorMessage: guard.enabled
        ? 'The token in the webhook URL does not match the one in Settings -> Telephony.'
        : 'Telephony is turned off in Settings -> Telephony.',
    });
    return res.sendStatus(403);
  }
  // Acknowledged before the work, and never with an error: a provider that sees a failure
  // here retries or disables the callback, and the payload is kept either way.
  res.json({ status: 'ok' });
  try {
    const result = await recordCallLog({
      ...guard.glued,
      ...parseGlued(tail.slice('call-log'.length)),
      ...((req.body ?? {}) as Record<string, unknown>),
    });
    await logTelephonyEvent({
      kind: 'call_log',
      outcome: 'ok',
      request,
      response: { status: 'ok', callLogId: result.id, created: result.created },
      callLogId: result.id,
    });
  } catch (err) {
    console.error('[airphone] call-log failed:', err, req.body);
    await logTelephonyEvent({
      kind: 'call_log',
      outcome: 'failed',
      request,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// Generic inbound receiver — every source except Meta.
//
// The token in the path IS the credential: it is generated per connection, unguessable, and
// rotatable from the Integrations page, so a platform only ever needs the one URL. Meta keeps its
// own `/meta` route above because it authenticates with an X-Hub-Signature-256 header instead and
// only sends a leadgen_id.
//
// Registered after `/meta`, and a two-segment path, so the two can never shadow each other.
// ---------------------------------------------------------------------------

/** Some platforms probe the URL with a GET before they will save it. */
webhookRouter.get('/:source/:token', async (req, res) => {
  const connection = await prisma.leadSourceConnection.findUnique({ where: { webhookToken: req.params.token } });
  if (!connection || connection.source !== req.params.source) {
    return res.status(404).json({ error: 'Unknown webhook endpoint.' });
  }
  res.json({ ok: true, connection: connection.name, source: connection.source, active: connection.active });
});

webhookRouter.post('/:source/:token', async (req, res) => {
  const { source, token } = req.params;

  if (source === 'meta') {
    return res.status(400).json({ error: 'Meta connections receive at /api/webhook/meta, which verifies the request signature.' });
  }

  const connection = await prisma.leadSourceConnection.findUnique({ where: { webhookToken: token } });
  if (!connection || connection.source !== source) {
    return res.status(404).json({ error: 'Unknown webhook endpoint.' });
  }

  const logRejection = (status: 'failed' | 'invalid_signature', errorMessage: string) =>
    prisma.integrationActivity.create({
      data: {
        connectionId: connection.id,
        source: connection.source,
        status,
        errorMessage,
        rawPayload: (req.body ?? {}) as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });

  if (!connection.active) {
    await logRejection('failed', 'Connection is inactive — payload discarded.');
    return res.status(403).json({ error: 'This connection is inactive.' });
  }

  // Optional second factor: connectors whose schema has a `webhook_secret` (Google Ads, Microsoft
  // Ads, YouTube) send it in the payload as `api_key`. Only enforced when one has been saved.
  const storedSecret = (connection.credentials as Record<string, string> | null)?.webhook_secret;
  if (storedSecret) {
    const presented =
      (req.headers['x-webhook-secret'] as string | undefined) ??
      (req.body?.api_key as string | undefined) ??
      (req.body?.webhook_secret as string | undefined);
    if (!presented || presented !== decrypt(storedSecret)) {
      await logRejection('invalid_signature', 'Webhook secret did not match.');
      return res.status(401).json({ error: 'Invalid webhook secret.' });
    }
  }

  const result = await ingestWebhookLead({
    connection,
    payload: req.body,
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Always 200, even for a mapping failure: a bad payload will fail identically on every retry, and
  // most platforms disable a webhook that keeps erroring. The failure is recorded in the Activity
  // Log with the offending payload instead, which is where someone can actually act on it.
  res.status(200).json({
    ok: result.status !== 'failed',
    status: result.status,
    message: result.message,
    leadId: result.leadId,
    leadsCreated: result.leadsCreated,
  });
});
