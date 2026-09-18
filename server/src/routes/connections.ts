import { Router } from 'express';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma';
import { encrypt, decrypt } from '../services/crypto';
import {
  buildOAuthDialogUrl,
  exchangeCodeForUserToken,
  exchangeForLongLivedToken,
  getManagedPages,
  subscribePageToLeadgen,
  testPageToken,
} from '../services/metaService';
import type { LeadSourceConnection, Prisma } from '@prisma/client';
import { ingestWebhookLead } from '../services/webhookIngest';
import { backfillMetaLeads } from '../services/metaBackfill';
import { mappingForForm } from '../services/leadFieldMapping';

export const connectionsRouter = Router();

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:4000';

function maskToken(token: string): string {
  return `${'•'.repeat(12)}${token.slice(-4)}`;
}

/**
 * Meta authenticates by request signature and Meta's app config holds a single callback URL, so it
 * receives at the bare `/meta` path. Every other source authenticates by the token in the URL,
 * which is why theirs is included — that URL is a credential, hence the Rotate action below.
 */
export function webhookUrlFor(c: Pick<LeadSourceConnection, 'source' | 'webhookToken'>): string {
  return c.source === 'meta'
    ? `${PUBLIC_BASE_URL}/api/webhook/meta`
    : `${PUBLIC_BASE_URL}/api/webhook/${c.source}/${c.webhookToken}`;
}

function toPublicShape(c: LeadSourceConnection) {
  return {
    id: c.id,
    source: c.source,
    name: c.name,
    status: c.status,
    active: c.active,
    connectedAccountLabel: c.connectedAccountLabel ?? undefined,
    lastReceivedAt: c.lastReceivedAt ?? undefined,
    lastError: c.lastError ?? undefined,
    webhookTokenMasked: maskToken(c.webhookToken),
    webhookUrl: webhookUrlFor(c),
    fieldMapping: c.fieldMapping ?? undefined,
    /** Which credential fields are on file — the values themselves never leave the server. */
    credentialKeys: c.credentials ? Object.keys(c.credentials as Record<string, unknown>) : [],
  };
}

/** Encrypts each non-Meta credential value; blank entries are dropped so a partial edit can't wipe one. */
function encryptCredentials(credentials: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value === 'string' && value.trim()) out[key] = encrypt(value.trim());
  }
  return out;
}

connectionsRouter.get('/', async (_req, res) => {
  const rows = await prisma.leadSourceConnection.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(rows.map(toPublicShape));
});

/** Cross-connection webhook activity log (the Integrations page's "Activity Log" tab).
 * Registered before `GET /:id` — otherwise `/activity` would be matched as `:id = "activity"`. */
connectionsRouter.get('/activity', async (req, res) => {
  const { page = '1', pageSize = '20', connectionId, status, sortDir } = req.query as Record<string, string>;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);

  const where: Record<string, unknown> = {};
  if (connectionId && connectionId !== 'all') where.connectionId = connectionId;
  if (status && status !== 'all') where.status = status;

  const [items, total] = await Promise.all([
    prisma.integrationActivity.findMany({
      where,
      orderBy: { receivedAt: sortDir === 'asc' ? 'asc' : 'desc' },
      skip: (pageNum - 1) * size,
      take: size,
    }),
    prisma.integrationActivity.count({ where }),
  ]);

  res.json({ items, total, page: pageNum, pageSize: size });
});

connectionsRouter.get('/:id', async (req, res) => {
  const row = await prisma.leadSourceConnection.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Connection not found' });
  res.json(toPublicShape(row));
});

/**
 * Creates a connection. For `source: 'meta'` with a page access token supplied directly
 * (the manual path — pasting App ID / App Secret / Page Access Token / Page ID, all
 * obtainable from the Meta App dashboard), this immediately subscribes the Page to the
 * app's `leadgen` webhook field so real leads start flowing in right away.
 */
connectionsRouter.post('/', async (req, res) => {
  const { name, source, active = true, credentials = {}, fieldMapping } = req.body as {
    name: string;
    source: string;
    active?: boolean;
    credentials?: Record<string, string>;
    fieldMapping?: Record<string, string>;
  };

  if (!name?.trim() || !source) return res.status(400).json({ error: 'name and source are required' });

  const data: Record<string, unknown> = { name: name.trim(), source, active, fieldMapping };

  if (source === 'meta') {
    const { app_id, app_secret, page_access_token, page_id } = credentials;
    if (!app_id || !app_secret) {
      return res.status(400).json({ error: 'app_id and app_secret are required for a Meta connection.' });
    }
    data.metaAppId = app_id;
    data.metaAppSecret = encrypt(app_secret);

    if (page_access_token && page_id) {
      try {
        await subscribePageToLeadgen(page_id, page_access_token);
        const test = await testPageToken(page_id, page_access_token);
        data.metaPageId = page_id;
        data.metaPageAccessToken = encrypt(page_access_token);
        data.connectedAccountLabel = test.message.replace('Connected to Facebook Page ', '').replace(/^"|"\.$/g, '');
        data.status = 'connected';
      } catch (err) {
        data.status = 'error';
        data.lastError = err instanceof Error ? err.message : 'Failed to subscribe the Page to webhook events.';
      }
    } else {
      data.status = 'disconnected';
    }
  } else {
    // Previously these were dropped on the floor: a Google Ads connection would ask for six
    // credentials and store none of them. Stored encrypted, per value.
    const stored = encryptCredentials(credentials);
    if (Object.keys(stored).length > 0) data.credentials = stored;
    data.status = 'disconnected';
  }

  const created = await prisma.leadSourceConnection.create({ data: data as any });
  res.status(201).json(toPublicShape(created));
});

connectionsRouter.patch('/:id', async (req, res) => {
  const { name, active, fieldMapping, credentials } = req.body as {
    name?: string;
    active?: boolean;
    fieldMapping?: Record<string, string>;
    credentials?: Record<string, string>;
  };
  const existing = await prisma.leadSourceConnection.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Connection not found' });

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (active !== undefined) data.active = active;
  if (fieldMapping !== undefined) data.fieldMapping = fieldMapping;

  if (existing.source !== 'meta' && credentials) {
    // Merged, not replaced, so leaving a field blank keeps whatever is already stored.
    const stored = encryptCredentials(credentials);
    if (Object.keys(stored).length > 0) {
      data.credentials = { ...((existing.credentials as Record<string, string> | null) ?? {}), ...stored };
    }
  }

  if (existing.source === 'meta' && credentials) {
    if (credentials.app_secret) data.metaAppSecret = encrypt(credentials.app_secret);
    if (credentials.page_access_token && credentials.page_id) {
      try {
        await subscribePageToLeadgen(credentials.page_id, credentials.page_access_token);
        data.metaPageId = credentials.page_id;
        data.metaPageAccessToken = encrypt(credentials.page_access_token);
        data.status = 'connected';
        data.lastError = null;
      } catch (err) {
        data.status = 'error';
        data.lastError = err instanceof Error ? err.message : 'Failed to re-subscribe the Page.';
      }
    }
  }

  const updated = await prisma.leadSourceConnection.update({ where: { id: req.params.id }, data: data as any });
  res.json(toPublicShape(updated));
});

connectionsRouter.delete('/:id', async (req, res) => {
  await prisma.leadSourceConnection.delete({ where: { id: req.params.id } }).catch(() => undefined);
  res.status(204).send();
});

connectionsRouter.post('/:id/toggle-active', async (req, res) => {
  const existing = await prisma.leadSourceConnection.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Connection not found' });
  const active = !existing.active;
  const updated = await prisma.leadSourceConnection.update({
    where: { id: req.params.id },
    data: { active, status: active ? (existing.metaPageAccessToken ? 'connected' : 'disconnected') : 'disconnected' },
  });
  res.json(toPublicShape(updated));
});

/** The payload the "Send test payload" action maps when the caller doesn't supply its own. */
const SAMPLE_WEBHOOK_PAYLOAD = {
  name: 'Test Visitor',
  phone: '9000000001',
  email: 'test.visitor@example.com',
  city: 'Jaipur',
  message: 'Sample payload sent from the Integrations page.',
};

connectionsRouter.post('/:id/test', async (req, res) => {
  const c = await prisma.leadSourceConnection.findUnique({ where: { id: req.params.id } });
  if (!c) return res.status(404).json({ error: 'Connection not found' });

  // Meta is the one source with credentials to check against a live API.
  if (c.source === 'meta') {
    if (!c.metaPageId || !c.metaPageAccessToken) {
      return res.json({ success: false, message: `${c.name} is not currently connected.` });
    }
    const result = await testPageToken(c.metaPageId, decrypt(c.metaPageAccessToken));
    return res.json(result);
  }

  // Webhook sources have nothing to call outward, so the useful test is the state of the endpoint.
  if (!c.active) {
    return res.json({ success: false, message: `${c.name} is inactive — the endpoint rejects payloads until you switch it on.` });
  }

  const receipts = await prisma.integrationActivity.count({ where: { connectionId: c.id } });
  const mappings = c.fieldMapping ? Object.keys(c.fieldMapping as Record<string, unknown>).length : 0;
  const secured = !!(c.credentials as Record<string, string> | null)?.webhook_secret;
  const lastSeen = c.lastReceivedAt ? `last receipt ${c.lastReceivedAt.toISOString()}` : 'nothing received yet';

  res.json({
    success: true,
    message: `Endpoint is live and listening. ${receipts} receipt(s) logged, ${lastSeen}. ${mappings} field mapping(s) configured${mappings === 0 ? ' (common key names are auto-detected)' : ''}${secured ? ', webhook secret enforced' : ''}.`,
  });
});

/**
 * Dry run: maps a payload exactly as the receiver would and reports what lead it produces, without
 * writing anything. This is how someone checks a field mapping before pointing a real platform here.
 */
connectionsRouter.post('/:id/simulate', async (req, res) => {
  const c = await prisma.leadSourceConnection.findUnique({ where: { id: req.params.id } });
  if (!c) return res.status(404).json({ error: 'Connection not found' });
  if (c.source === 'meta') {
    return res.status(400).json({ error: 'Meta payloads carry only a leadgen_id — use Test, which verifies the Page token against the Graph API.' });
  }

  const payload = req.body && typeof req.body.payload === 'object' && req.body.payload !== null ? req.body.payload : SAMPLE_WEBHOOK_PAYLOAD;
  const result = await ingestWebhookLead({ connection: c, payload, dryRun: true });

  res.json({
    success: result.status !== 'failed',
    message: result.message,
    payload,
    mappedFields: result.mapped.fields,
    unmappedKeys: result.mapped.unmappedKeys,
    extras: result.mapped.extras,
    wouldFlagDuplicate: !!result.isDuplicate,
  });
});

/** The webhook URL is a credential, so it has to be replaceable if it leaks. */
connectionsRouter.post('/:id/rotate-token', async (req, res) => {
  const updated = await prisma.leadSourceConnection
    .update({ where: { id: req.params.id }, data: { webhookToken: randomUUID().replace(/-/g, '') } })
    .catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Connection not found' });
  res.json(toPublicShape(updated));
});

connectionsRouter.get('/:id/activity', async (req, res) => {
  const rows = await prisma.integrationActivity.findMany({
    where: { connectionId: req.params.id },
    orderBy: { receivedAt: 'desc' },
    take: 100,
  });
  res.json(rows);
});

// ---------------------------------------------------------------------------
// OAuth — "Connect with Facebook" as an alternative to pasting a page access
// token manually. Requires META_APP_ID / META_APP_SECRET to be set in .env,
// and PUBLIC_BASE_URL to be a real HTTPS URL Meta can redirect back to.
// ---------------------------------------------------------------------------

/**
 * Turns a **user** access token into a permanent **page** token, without the OAuth round trip.
 *
 * This is the step everyone gets wrong by hand: the token Graph API Explorer hands you is a
 * short-lived user token, and a page token derived from it inherits that expiry. Exchanging
 * for a long-lived user token first is what makes the resulting page tokens permanent.
 *
 * Call once with just the token to list the Pages this login manages, then again with the
 * chosen `pageId` to store its token and subscribe it to `leadgen`.
 */
connectionsRouter.post('/:id/meta/link', async (req, res) => {
  const c = await prisma.leadSourceConnection.findUnique({ where: { id: String(req.params.id) } });
  if (!c || c.source !== 'meta') return res.status(404).json({ error: 'Meta connection not found.' });
  if (!c.metaAppId || !c.metaAppSecret) {
    return res.status(400).json({ error: 'Save the App ID and App Secret on this connection first.' });
  }
  const userAccessToken = String(req.body?.userAccessToken ?? '').trim();
  if (!userAccessToken) return res.status(400).json({ error: 'A user access token is required.' });
  const pageId = String(req.body?.pageId ?? '').trim();

  try {
    const appSecret = decrypt(c.metaAppSecret);
    const longToken = await exchangeForLongLivedToken(userAccessToken, c.metaAppId, appSecret);
    const pages = await getManagedPages(longToken);

    if (!pageId) {
      if (pages.length === 0) {
        return res.status(400).json({
          error: 'This login does not manage any Facebook Page. Add yourself as an admin of the Page first.',
        });
      }
      // Tokens are deliberately not returned to the browser — only what the picker needs.
      return res.json({ pages: pages.map((p) => ({ id: p.id, name: p.name })) });
    }

    const page = pages.find((p) => p.id === pageId);
    if (!page) {
      return res.status(400).json({
        error: `Page ${pageId} is not managed by this login. Available: ${pages.map((p) => `${p.name} (${p.id})`).join(', ') || 'none'}.`,
      });
    }

    // Subscribing is what actually starts delivery, and it is the step that fails without
    // the leads_retrieval permission — so the error is surfaced rather than swallowed.
    await subscribePageToLeadgen(page.id, page.access_token);

    const updated = await prisma.leadSourceConnection.update({
      where: { id: c.id },
      data: {
        metaPageId: page.id,
        metaPageAccessToken: encrypt(page.access_token),
        connectedAccountLabel: `${page.name} (Facebook Page)`,
        status: 'connected',
        lastError: null,
      },
    });
    res.json({ connection: toPublicShape(updated), page: { id: page.id, name: page.name } });
  } catch (err) {
    const message = axios.isAxiosError(err)
      ? String(err.response?.data?.error?.message ?? err.message)
      : err instanceof Error
        ? err.message
        : 'Could not link the Page.';
    await prisma.leadSourceConnection.update({ where: { id: c.id }, data: { status: 'error', lastError: message } });
    res.status(400).json({ error: message });
  }
});

/**
 * Imports the leads a Page's forms already hold — the webhook only delivers what arrives
 * after subscribing, so a Page with history starts out empty here.
 *
 * Runs in the background: thousands of leads take minutes, which is far longer than an HTTP
 * request should be held open. Progress lands in the Activity Log, one row per form.
 */
connectionsRouter.post('/:id/meta/backfill', async (req, res) => {
  const id = String(req.params.id);
  const c = await prisma.leadSourceConnection.findUnique({ where: { id } });
  if (!c || c.source !== 'meta') return res.status(404).json({ error: 'Meta connection not found.' });
  if (!c.metaPageId || !c.metaPageAccessToken) {
    return res.status(400).json({ error: 'Link a Facebook Page on this connection first.' });
  }

  res.json({ started: true, message: 'Import started. Progress appears in the Activity Log, one row per form.' });

  backfillMetaLeads(id, (p) => {
    console.log(`[meta backfill] ${p.form}: seen=${p.leadsSeen} imported=${p.imported} skipped=${p.skipped}`);
  })
    .then(async (p) => {
      console.log('[meta backfill] done', p);
      await prisma.integrationActivity.create({
        data: {
          connectionId: id,
          source: 'meta',
          status: 'processed',
          leadsCreated: p.imported,
          errorMessage:
            `Backfill finished — ${p.formsScanned} form(s) scanned, ${p.leadsSeen} lead(s) seen, ` +
            `${p.imported} imported, ${p.skipped} skipped (already present or no contact details), ${p.failed} form(s) unreadable.`,
          processedAt: new Date(),
        },
      });
    })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : 'Backfill failed.';
      console.error('[meta backfill] failed:', message);
      await prisma.integrationActivity.create({
        data: { connectionId: id, source: 'meta', status: 'failed', errorMessage: `Backfill failed: ${message}`, processedAt: new Date() },
      });
    });
});

/**
 * The forms on the linked Page, with the mapping already saved for each — everything the
 * mapping screen needs in one call.
 */
connectionsRouter.get('/:id/meta/forms', async (req, res) => {
  const c = await prisma.leadSourceConnection.findUnique({ where: { id: String(req.params.id) } });
  if (!c || c.source !== 'meta') return res.status(404).json({ error: 'Meta connection not found.' });
  if (!c.metaPageId || !c.metaPageAccessToken) return res.status(400).json({ error: 'Link a Facebook Page first.' });

  try {
    const token = decrypt(c.metaPageAccessToken);
    const forms: { id: string; name: string; mappedCount: number }[] = [];
    let url: string | undefined =
      `https://graph.facebook.com/v21.0/${c.metaPageId}/leadgen_forms?fields=id,name,leads_count&limit=100&access_token=${token}`;
    while (url) {
      const { data }: { data: any } = await axios.get(url, { timeout: 25000 });
      for (const f of data?.data ?? []) {
        forms.push({ id: f.id, name: f.name, mappedCount: Object.keys(mappingForForm(c.fieldMapping, f.id)).length });
      }
      url = data?.paging?.next;
    }
    res.json({ forms });
  } catch (err) {
    const message = axios.isAxiosError(err) ? String(err.response?.data?.error?.message ?? err.message) : 'Could not read the forms.';
    res.status(400).json({ error: message });
  }
});

/**
 * A form's questions, taken from its own definition rather than a sample lead, so a question
 * nobody has answered yet still shows up and can be mapped.
 */
connectionsRouter.get('/:id/meta/forms/:formId/questions', async (req, res) => {
  const c = await prisma.leadSourceConnection.findUnique({ where: { id: String(req.params.id) } });
  if (!c || c.source !== 'meta' || !c.metaPageAccessToken) return res.status(404).json({ error: 'Meta connection not found.' });

  try {
    const token = decrypt(c.metaPageAccessToken);
    const formId = String(req.params.formId);
    const { data }: { data: any } = await axios.get(
      `https://graph.facebook.com/v21.0/${formId}?fields=id,name,questions{key,label,type,options}&access_token=${token}`,
      { timeout: 25000 }
    );
    // Graph returns `questions` as a plain array here, not the usual `{ data: [...] }`
    // edge wrapper — accept both so a version change cannot silently empty this screen.
    const raw: any[] = Array.isArray(data?.questions) ? data.questions : (data?.questions?.data ?? []);
    const questions = raw.map((q: any) => ({
      // `key` is what arrives in field_data; label is what a person recognises.
      name: q.key,
      label: q.label ?? q.key,
      type: q.type ?? 'SHORT_ANSWER',
      options: (q.options ?? []).map((o: any) => o.value ?? o.key).filter(Boolean),
    }));
    res.json({ formId, formName: data?.name, questions, mapping: mappingForForm(c.fieldMapping, formId) });
  } catch (err) {
    const message = axios.isAxiosError(err) ? String(err.response?.data?.error?.message ?? err.message) : 'Could not read the form.';
    res.status(400).json({ error: message });
  }
});

/** Saves one form's mapping, leaving every other form's alone. */
connectionsRouter.put('/:id/meta/forms/:formId/mapping', async (req, res) => {
  const id = String(req.params.id);
  const formId = String(req.params.formId);
  const c = await prisma.leadSourceConnection.findUnique({ where: { id } });
  if (!c || c.source !== 'meta') return res.status(404).json({ error: 'Meta connection not found.' });

  const incoming = req.body?.mapping;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'mapping must be an object of question -> target.' });
  }
  const cleaned: Record<string, string> = {};
  for (const [question, target] of Object.entries(incoming as Record<string, unknown>)) {
    const value = String(target ?? '').trim();
    if (value) cleaned[question] = value;
  }

  const all = (c.fieldMapping && typeof c.fieldMapping === 'object' && !Array.isArray(c.fieldMapping)
    ? { ...(c.fieldMapping as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  if (Object.keys(cleaned).length > 0) all[formId] = cleaned;
  else delete all[formId];

  await prisma.leadSourceConnection.update({ where: { id }, data: { fieldMapping: all as Prisma.InputJsonValue } });
  res.json({ formId, mapping: cleaned });
});

connectionsRouter.get('/:id/oauth/start', async (req, res) => {
  const c = await prisma.leadSourceConnection.findUnique({ where: { id: req.params.id } });
  if (!c?.metaAppId) return res.status(400).json({ error: 'Save the App ID / App Secret on this connection first.' });
  const redirectUri = `${PUBLIC_BASE_URL}/api/connections/oauth/callback`;
  const url = buildOAuthDialogUrl(c.metaAppId, redirectUri, c.id);
  res.json({ url });
});

connectionsRouter.get('/oauth/callback', async (req, res) => {
  const { code, state: connectionId } = req.query as { code?: string; state?: string };
  if (!code || !connectionId) return res.status(400).send('Missing code or state.');

  const c = await prisma.leadSourceConnection.findUnique({ where: { id: connectionId } });
  if (!c?.metaAppId || !c.metaAppSecret) return res.status(400).send('Connection is missing App ID / App Secret.');

  try {
    const redirectUri = `${PUBLIC_BASE_URL}/api/connections/oauth/callback`;
    const appSecret = decrypt(c.metaAppSecret);
    const shortToken = await exchangeCodeForUserToken(code, c.metaAppId, appSecret, redirectUri);
    const longToken = await exchangeForLongLivedToken(shortToken, c.metaAppId, appSecret);
    const pages = await getManagedPages(longToken);
    if (pages.length === 0) throw new Error('No Facebook Pages were returned for this account.');
    // Only safe to auto-pick when there is genuinely one choice; otherwise the admin must
    // say which Page, via the "Link a Page" picker on the connection.
    if (pages.length > 1) {
      throw new Error(
        `This login manages ${pages.length} Pages (${pages.map((p) => p.name).join(', ')}). Use "Link a Page" on the connection to choose one.`
      );
    }
    const page = pages[0];

    await subscribePageToLeadgen(page.id, page.access_token);

    await prisma.leadSourceConnection.update({
      where: { id: c.id },
      data: {
        metaPageId: page.id,
        metaPageAccessToken: encrypt(page.access_token),
        connectedAccountLabel: `${page.name} (Facebook Page)`,
        status: 'connected',
        lastError: null,
      },
    });

    res.redirect(`${process.env.CLIENT_ORIGIN}/crm/integrations`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAuth callback failed.';
    await prisma.leadSourceConnection.update({ where: { id: c.id }, data: { status: 'error', lastError: message } });
    res.redirect(`${process.env.CLIENT_ORIGIN}/crm/integrations?error=${encodeURIComponent(message)}`);
  }
});
