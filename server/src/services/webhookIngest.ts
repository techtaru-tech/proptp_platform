import type { LeadSourceConnection, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { outsideBusinessHoursFlag } from './businessHours';
import { fireTrigger } from './automationEngine';

/**
 * Generic inbound-webhook ingestion, shared by the receiver route and the dry-run "test payload"
 * action. Meta has its own route (server/src/routes/webhooks.ts) because Meta sends only a
 * leadgen_id and the answers have to be fetched from the Graph API; every other platform posts the
 * answers themselves, so they all flow through here.
 */

/** Lead columns a mapping is allowed to target. `name` is split across firstName/lastName. */
const LEAD_COLUMNS = ['firstName', 'lastName', 'email', 'phone', 'city', 'company', 'jobTitle', 'country', 'notes'] as const;
const FULL_NAME_TARGETS = ['name', 'fullname', 'full_name'];

/**
 * Keys that map themselves without any configuration. Real forms name things wildly
 * ("your-name" from Contact Form 7, "PHONE_NUMBER" from Google Ads, "mobile" from most Indian
 * form builders), so recognising the common ones means a connection usually works out of the box.
 */
const KEY_ALIASES: Record<string, string> = {
  name: 'name', fullname: 'name', yourname: 'name', leadname: 'name', contactname: 'name', personname: 'name',
  firstname: 'firstName', fname: 'firstName', givenname: 'firstName',
  lastname: 'lastName', lname: 'lastName', surname: 'lastName', familyname: 'lastName',
  email: 'email', emailaddress: 'email', youremail: 'email', mail: 'email', emailid: 'email',
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', mobilenumber: 'phone', mobileno: 'phone',
  contact: 'phone', contactnumber: 'phone', contactno: 'phone', tel: 'phone', telephone: 'phone', whatsapp: 'phone',
  city: 'city', town: 'city', location: 'city',
  company: 'company', companyname: 'company', organisation: 'company', organization: 'company', business: 'company',
  jobtitle: 'jobTitle', designation: 'jobTitle', role: 'jobTitle', position: 'jobTitle',
  country: 'country',
  message: 'notes', comments: 'notes', comment: 'notes', notes: 'notes', enquiry: 'notes',
  inquiry: 'notes', query: 'notes', requirement: 'notes', requirements: 'notes', remarks: 'notes',
};

/** Payload keys that carry the platform's own id for the submission — used to reject replays. */
const EXTERNAL_ID_KEYS = ['lead_id', 'leadId', 'leadgen_id', 'submission_id', 'submissionId', 'entry_id', 'response_id', 'id'];

/** Lowercased, punctuation-free form of a key so "Full Name", "full_name" and "your-name" all match. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    // JotForm posts composite fields as objects, e.g. { first: 'Meena', last: 'Agarwal' }.
    return Object.values(value as Record<string, unknown>).map(asText).filter(Boolean).join(' ').trim();
  }
  return String(value).trim();
}

export interface FlatPayload {
  /** Flat answers, in the order they arrived — the label is kept for notes and the activity log. */
  entries: { key: string; label: string; value: string }[];
  /** The platform's own submission id, when it sent one. */
  externalId?: string;
  /** Google Ads marks its "send test lead" payloads; those must not become real leads. */
  isPlatformTest: boolean;
}

/**
 * Turns whatever a platform posted into flat key/label/value triples.
 * Handles the three shapes that actually occur in the wild, then falls back to a shallow walk:
 *  - Google Ads lead forms: { user_column_data: [{ column_id, column_name, string_value }] }
 *  - Typeform: { form_response: { answers: [{ field: { ref }, type, text|email|phone_number }] } }
 *  - Everything else (web forms, Zapier, Make, JotForm): a flat JSON or form-encoded object.
 */
export function flattenPayload(payload: unknown): FlatPayload {
  const body = (payload ?? {}) as Record<string, any>;
  const entries: { key: string; label: string; value: string }[] = [];
  const push = (key: string, label: string, value: unknown) => {
    const text = asText(value);
    if (key && text) entries.push({ key, label: label || key, value: text });
  };

  if (Array.isArray(body.user_column_data)) {
    for (const column of body.user_column_data) {
      const key = String(column?.column_id ?? column?.column_name ?? '');
      push(key, String(column?.column_name ?? key), column?.string_value);
    }
  } else if (Array.isArray(body.form_response?.answers)) {
    for (const answer of body.form_response.answers) {
      const key = String(answer?.field?.ref ?? answer?.field?.id ?? '');
      const value =
        answer?.text ?? answer?.email ?? answer?.phone_number ?? answer?.number ?? answer?.boolean ??
        answer?.date ?? answer?.url ?? answer?.choice?.label ?? answer?.choices?.labels;
      push(key, String(answer?.field?.title ?? key), value);
    }
  } else {
    const source = typeof body.data === 'object' && body.data !== null && !Array.isArray(body.data) ? body.data : body;
    for (const [key, value] of Object.entries(source)) {
      if (EXTERNAL_ID_KEYS.includes(key)) continue;
      if (['api_key', 'apiKey', 'webhook_secret', 'token', 'honeypot'].includes(key)) continue;
      push(key, key, value);
    }
  }

  const externalIdKey = EXTERNAL_ID_KEYS.find((key) => asText(body[key]) !== '');
  return {
    entries,
    externalId: externalIdKey ? asText(body[externalIdKey]) : undefined,
    isPlatformTest: body.is_test === true || body.is_test === 'true' || body.test_lead === true,
  };
}

export interface MappedLead {
  fields: Partial<Record<(typeof LEAD_COLUMNS)[number], string>>;
  /** Answers that don't correspond to a Lead column — kept as a note so nothing is lost. */
  extras: { label: string; value: string }[];
  /** Keys the mapping/aliases could not place, for the test action to report back. */
  unmappedKeys: string[];
}

/**
 * Applies the connection's configured `fieldMapping` (source key -> lead field) first, then the
 * built-in aliases for anything left over.
 */
export function mapPayloadToLead(flat: FlatPayload, fieldMapping?: unknown): MappedLead {
  const mapping = new Map<string, string>();
  if (fieldMapping && typeof fieldMapping === 'object' && !Array.isArray(fieldMapping)) {
    for (const [from, to] of Object.entries(fieldMapping as Record<string, unknown>)) {
      const target = asText(to);
      if (target) mapping.set(normalizeKey(from), target);
    }
  }

  const fields: MappedLead['fields'] = {};
  const extras: MappedLead['extras'] = [];
  const unmappedKeys: string[] = [];

  for (const entry of flat.entries) {
    const normalized = normalizeKey(entry.key);
    const target = mapping.get(normalized) ?? KEY_ALIASES[normalized];

    if (target && FULL_NAME_TARGETS.includes(normalizeKey(target))) {
      const [first, ...rest] = entry.value.split(/\s+/);
      fields.firstName = first;
      if (rest.length > 0) fields.lastName = rest.join(' ');
      continue;
    }
    if (target && (LEAD_COLUMNS as readonly string[]).includes(target)) {
      // First value wins: a form that asks twice shouldn't have the later blank-ish answer overwrite.
      if (!fields[target as (typeof LEAD_COLUMNS)[number]]) fields[target as (typeof LEAD_COLUMNS)[number]] = entry.value;
      continue;
    }
    extras.push({ label: entry.label, value: entry.value });
    unmappedKeys.push(entry.key);
  }

  return { fields, extras, unmappedKeys };
}

export interface IngestResult {
  status: 'processed' | 'failed' | 'skipped';
  leadId?: string;
  leadsCreated: number;
  message: string;
  mapped: MappedLead;
  isDuplicate?: boolean;
}

/**
 * Runs the full pipeline for one inbound payload. `dryRun` maps and validates without writing
 * anything, which is what the connection's "Send test payload" action uses.
 */
export async function ingestWebhookLead(options: {
  connection: LeadSourceConnection;
  payload: unknown;
  ip?: string;
  userAgent?: string;
  dryRun?: boolean;
}): Promise<IngestResult> {
  const { connection, payload, ip, userAgent, dryRun } = options;
  const flat = flattenPayload(payload);
  const mapped = mapPayloadToLead(flat, connection.fieldMapping);

  const logActivity = async (
    status: 'pending' | 'processed' | 'failed' | 'invalid_signature',
    extra: { leadId?: string; leadsCreated?: number; errorMessage?: string }
  ) => {
    if (dryRun) return;
    await prisma.integrationActivity.create({
      data: {
        connectionId: connection.id,
        source: connection.source,
        status,
        leadId: extra.leadId,
        leadsCreated: extra.leadsCreated ?? 0,
        errorMessage: extra.errorMessage,
        rawPayload: (payload ?? {}) as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });
  };

  if (flat.entries.length === 0) {
    const message = 'Payload contained no readable fields.';
    await logActivity('failed', { errorMessage: message });
    if (!dryRun) {
      await prisma.leadSourceConnection.update({
        where: { id: connection.id },
        data: { status: 'error', lastError: message, lastReceivedAt: new Date() },
      });
    }
    return { status: 'failed', leadsCreated: 0, message, mapped };
  }

  // A lead with neither a phone nor an email can't be followed up on, so it's a config error.
  if (!mapped.fields.phone && !mapped.fields.email) {
    const message = `No phone or email found. Unrecognised keys: ${flat.entries.map((e) => e.key).join(', ')}. Add a field mapping for this connection.`;
    await logActivity('failed', { errorMessage: message });
    if (!dryRun) {
      await prisma.leadSourceConnection.update({
        where: { id: connection.id },
        data: { status: 'error', lastError: message, lastReceivedAt: new Date() },
      });
    }
    return { status: 'failed', leadsCreated: 0, message, mapped };
  }

  // Google Ads' "send test lead" button posts a real-looking payload; accepting it without
  // creating a lead is what makes their validation pass while keeping the CRM clean.
  if (flat.isPlatformTest) {
    const message = 'Platform test payload accepted — no lead created.';
    await logActivity('processed', { leadsCreated: 0 });
    if (!dryRun) {
      await prisma.leadSourceConnection.update({
        where: { id: connection.id },
        data: { status: 'connected', lastError: null, lastReceivedAt: new Date() },
      });
    }
    return { status: 'skipped', leadsCreated: 0, message, mapped };
  }

  if (flat.externalId) {
    const seen = await prisma.lead.findFirst({
      where: { source: connection.source, externalLeadId: flat.externalId },
      select: { id: true },
    });
    if (seen) {
      const message = `Already ingested (${connection.source} id ${flat.externalId}).`;
      await logActivity('processed', { leadId: seen.id, leadsCreated: 0 });
      if (!dryRun) {
        await prisma.leadSourceConnection.update({
          where: { id: connection.id },
          data: { status: 'connected', lastError: null, lastReceivedAt: new Date() },
        });
      }
      return { status: 'skipped', leadId: seen.id, leadsCreated: 0, message, mapped };
    }
  }

  // Same person submitting twice is still a lead worth having — flagged, not dropped.
  const duplicateOf = mapped.fields.phone
    ? await prisma.lead.findFirst({ where: { phone: mapped.fields.phone }, select: { id: true } })
    : null;

  if (dryRun) {
    return {
      status: 'processed',
      leadsCreated: 1,
      message: 'Payload is valid — a lead would be created.',
      mapped,
      isDuplicate: !!duplicateOf,
    };
  }

  const created = await prisma.lead.create({
    data: {
      firstName: mapped.fields.firstName ?? '',
      lastName: mapped.fields.lastName ?? '',
      email: mapped.fields.email || undefined,
      phone: mapped.fields.phone ?? '',
      city: mapped.fields.city || undefined,
      company: mapped.fields.company || undefined,
      jobTitle: mapped.fields.jobTitle || undefined,
      country: mapped.fields.country || undefined,
      notes: mapped.fields.notes || undefined,
      source: connection.source,
      otherSource: connection.name,
      externalLeadId: flat.externalId,
      sourceConnectionId: connection.id,
      utmSource: connection.source,
      status: 'new',
      priority: 'normal',
      isDuplicate: !!duplicateOf,
      receivedOutsideBusinessHours: await outsideBusinessHoursFlag(),
    },
  });

  const fullName = `${created.firstName} ${created.lastName}`.trim() || 'Unnamed lead';
  await prisma.leadActivity.create({
    data: {
      leadId: created.id,
      type: 'created',
      description: `Lead "${fullName}" received from ${connection.name} webhook.`,
      metadata: { connectionId: connection.id, source: connection.source, externalId: flat.externalId ?? null },
    },
  });
  await fireTrigger('lead_created', created.id);

  if (mapped.extras.length > 0) {
    await prisma.leadNote.create({
      data: {
        leadId: created.id,
        userId: 'system',
        userName: connection.name,
        body: `Webhook payload:\n${mapped.extras.map((e) => `${e.label}: ${e.value}`).join('\n')}`,
      },
    });
  }

  await logActivity('processed', { leadId: created.id, leadsCreated: 1 });
  await prisma.leadSourceConnection.update({
    where: { id: connection.id },
    data: { status: 'connected', lastError: null, lastReceivedAt: new Date() },
  });

  void ip;
  void userAgent;

  return {
    status: 'processed',
    leadId: created.id,
    leadsCreated: 1,
    message: duplicateOf ? 'Lead created and flagged as a possible duplicate.' : 'Lead created.',
    mapped,
    isDuplicate: !!duplicateOf,
  };
}
