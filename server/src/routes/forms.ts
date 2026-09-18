import { Router } from 'express';
import axios from 'axios';
import { prisma } from '../prisma';
import type { Prisma } from '@prisma/client';
import { encrypt, decrypt } from '../services/crypto';
import { outsideBusinessHoursFlag } from '../services/businessHours';
import { fireTrigger } from '../services/automationEngine';

export const formsRouter = Router();

const FIELD_TYPES = ['short_text', 'long_text', 'email', 'phone', 'number', 'date', 'dropdown', 'checkbox', 'gdpr_consent'] as const;
type FieldType = (typeof FIELD_TYPES)[number];

/**
 * The consent field every public form carries. Generated here rather than accepted from the
 * client so it can't be edited away or reordered — the form owner only chooses whether the rest
 * of the form exists, never whether consent is collected.
 */
const GDPR_FIELD = {
  type: 'gdpr_consent' as FieldType,
  label: 'I consent to being contacted about this enquiry.',
  fieldKey: 'consent',
  required: true,
  placeholder: null,
  // `options` is deliberately absent, not null: Prisma's Json input rejects a bare null.
};

/** Answers under these keys land on the Lead itself; everything else stays in the submission. */
const LEAD_TEXT_COLUMNS = ['firstName', 'lastName', 'email', 'phone', 'city', 'company', 'jobTitle', 'country', 'notes'] as const;
/** A single "name"/"full name" field is split across firstName + lastName. */
const FULL_NAME_KEYS = ['name', 'fullName', 'full_name'];

interface IncomingField {
  type?: string;
  label?: string;
  placeholder?: string | null;
  fieldKey?: string;
  step?: number;
  required?: boolean;
  options?: unknown;
}

/**
 * Local calendar date as YYYY-MM-DD. Not `toISOString().slice(0, 10)`: the server runs in IST, so
 * a local midnight serialises to the previous day and every analytics bucket would be off by one.
 */
function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** URL-safe, lowercase, no leading/trailing separators — this ends up in /f/<slug>. */
function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Never let a secret reach any client, and expose only whether a key is on file. */
function toAdminForm<T extends { recaptchaSecretKey?: string | null }>(form: T) {
  const { recaptchaSecretKey, ...rest } = form;
  return { ...rest, hasRecaptchaSecret: !!recaptchaSecretKey };
}

/**
 * Normalises the client's field list: drops anything unusable, renumbers `sortOrder` from the
 * submitted order (that is what drag-and-drop reordering means), strips any client-supplied
 * consent field, and appends the canonical one last.
 */
function buildFieldRows(fields: IncomingField[]) {
  const rows = fields
    .filter((f) => f.type !== 'gdpr_consent')
    .map((f, index) => {
      const type = (FIELD_TYPES as readonly string[]).includes(f.type ?? '') ? (f.type as FieldType) : 'short_text';
      const options = type === 'dropdown' && Array.isArray(f.options)
        ? (f.options as unknown[]).map((o) => String(o).trim()).filter(Boolean)
        : undefined;
      return {
        type,
        label: (f.label ?? '').trim(),
        placeholder: f.placeholder?.trim() || null,
        fieldKey: (f.fieldKey ?? '').trim(),
        step: Math.max(1, Number(f.step) || 1),
        required: !!f.required,
        options: options && options.length > 0 ? (options as Prisma.InputJsonValue) : undefined,
        sortOrder: index,
      };
    })
    .filter((f) => f.label && f.fieldKey);

  return [...rows, { ...GDPR_FIELD, step: rows.length ? Math.max(...rows.map((f) => f.step)) : 1, sortOrder: rows.length }];
}

function validateFormBody(body: any): string | null {
  if (!body?.name?.trim()) return 'Form name is required.';
  if (!body?.slug?.trim()) return 'Slug is required.';
  if (!normalizeSlug(body.slug)) return 'Slug must contain at least one letter or number.';
  if (!body?.submitLabel?.trim()) return 'Submit button label is required.';
  const fields: IncomingField[] = Array.isArray(body.fields) ? body.fields : [];
  const usable = fields.filter((f) => f.type !== 'gdpr_consent');
  if (usable.length === 0) return 'Add at least one field.';
  for (const f of usable) {
    if (!f.label?.trim()) return 'Every field needs a label.';
    if (!f.fieldKey?.trim()) return `Field "${f.label}" needs a field key.`;
    if (f.type === 'dropdown' && (!Array.isArray(f.options) || f.options.filter((o) => String(o).trim()).length === 0)) {
      return `Dropdown "${f.label}" needs at least one option.`;
    }
  }
  const keys = usable.map((f) => (f.fieldKey ?? '').trim().toLowerCase());
  const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
  if (duplicate) return `Duplicate field key "${duplicate}" — each key must be unique.`;
  return null;
}

function formWriteData(body: any) {
  return {
    name: body.name.trim(),
    slug: normalizeSlug(body.slug),
    displayTitle: body.displayTitle?.trim() || null,
    description: body.description?.trim() || null,
    submitLabel: body.submitLabel.trim(),
    thankYouMessage: body.thankYouMessage?.trim() || null,
    redirectUrl: body.redirectUrl?.trim() || null,
    isMultiStep: !!body.isMultiStep,
    isActive: body.isActive === undefined ? true : !!body.isActive,
    pipelineId: body.pipelineId || null,
    pipelineStageId: body.pipelineStageId || null,
    assignedUserId: body.assignedUserId || null,
    accentColor: body.accentColor?.trim() || '#C34245',
    layout: body.layout === 'plain' ? 'plain' : 'card',
    recaptchaEnabled: !!body.recaptchaEnabled,
    recaptchaSiteKey: body.recaptchaSiteKey?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Admin list
// ---------------------------------------------------------------------------

formsRouter.get('/', async (req, res) => {
  const { page = '1', pageSize = '10', search, sortBy, sortDir } = req.query as Record<string, string>;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 10);

  const where: Prisma.LeadFormWhereInput = search
    ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }] }
    : {};

  const SORTABLE = ['name', 'slug', 'createdAt'];
  const orderBy: Prisma.LeadFormOrderByWithRelationInput = SORTABLE.includes(sortBy ?? '')
    ? { [sortBy as string]: sortDir === 'asc' ? 'asc' : 'desc' }
    : { createdAt: 'desc' };

  const [items, total] = await Promise.all([
    prisma.leadForm.findMany({
      where,
      orderBy,
      skip: (pageNum - 1) * size,
      take: size,
      include: { _count: { select: { submissions: true } } },
    }),
    prisma.leadForm.count({ where }),
  ]);

  res.json({
    items: items.map(({ _count, ...form }) => ({ ...toAdminForm(form), submissionCount: _count.submissions })),
    total,
    page: pageNum,
    pageSize: size,
  });
});

// ---------------------------------------------------------------------------
// Public endpoints — registered BEFORE `/:id` so "public" is never read as a form id.
// These are the only routes a visitor's browser touches.
// ---------------------------------------------------------------------------

formsRouter.get('/public/:slug', async (req, res) => {
  const form = await prisma.leadForm.findUnique({
    where: { slug: req.params.slug },
    include: { fields: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!form || !form.isActive) return res.status(404).json({ error: 'This form is not available.' });

  // Only what the public page needs to render — no pipeline wiring, no owner, no secrets.
  res.json({
    slug: form.slug,
    displayTitle: form.displayTitle || form.name,
    description: form.description,
    submitLabel: form.submitLabel,
    thankYouMessage: form.thankYouMessage,
    redirectUrl: form.redirectUrl,
    isMultiStep: form.isMultiStep,
    accentColor: form.accentColor,
    layout: form.layout,
    recaptchaEnabled: form.recaptchaEnabled,
    recaptchaSiteKey: form.recaptchaEnabled ? form.recaptchaSiteKey : null,
    fields: form.fields.map((f) => ({
      id: f.id,
      type: f.type,
      label: f.label,
      placeholder: f.placeholder,
      fieldKey: f.fieldKey,
      step: f.step,
      required: f.required,
      options: f.options,
    })),
  });
});

formsRouter.post('/public/:slug/submit', async (req, res) => {
  const form = await prisma.leadForm.findUnique({
    where: { slug: req.params.slug },
    include: { fields: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!form || !form.isActive) return res.status(404).json({ error: 'This form is not available.' });

  const answers: Record<string, unknown> = (req.body?.data && typeof req.body.data === 'object') ? req.body.data : {};

  // Honeypot: a bot fills every input it finds. Answer 200 so it can't tell it was rejected.
  if (typeof req.body?.honeypot === 'string' && req.body.honeypot.trim() !== '') {
    return res.status(201).json({ ok: true });
  }

  if (form.recaptchaEnabled && form.recaptchaSecretKey) {
    const token = req.body?.recaptchaToken;
    if (!token) return res.status(400).json({ error: 'Captcha verification failed. Please retry.' });
    try {
      const verify = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        new URLSearchParams({ secret: decrypt(form.recaptchaSecretKey), response: String(token) }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
      );
      if (!verify.data?.success) return res.status(400).json({ error: 'Captcha verification failed. Please retry.' });
    } catch {
      return res.status(502).json({ error: 'Could not verify the captcha. Please retry.' });
    }
  }

  const missing = form.fields.filter((f) => {
    if (!f.required) return false;
    const value = answers[f.fieldKey];
    if (f.type === 'checkbox' || f.type === 'gdpr_consent') return value !== true;
    return value === undefined || value === null || String(value).trim() === '';
  });
  if (missing.length > 0) {
    return res.status(400).json({ error: `Please complete: ${missing.map((f) => f.label).join(', ')}` });
  }

  // Map answers onto Lead columns; keep everything else for the submission record and a note.
  const leadData: Record<string, string> = {};
  const extras: { label: string; value: string }[] = [];
  for (const field of form.fields) {
    if (field.type === 'gdpr_consent') continue;
    const raw = answers[field.fieldKey];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const value = typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw).trim();
    const key = field.fieldKey;

    if (FULL_NAME_KEYS.includes(key)) {
      const [first, ...rest] = value.split(/\s+/);
      leadData.firstName = first;
      leadData.lastName = rest.join(' ');
    } else if ((LEAD_TEXT_COLUMNS as readonly string[]).includes(key)) {
      leadData[key] = value;
    } else {
      extras.push({ label: field.label, value });
    }
  }

  const created = await prisma.lead.create({
    data: {
      firstName: leadData.firstName ?? '',
      lastName: leadData.lastName ?? '',
      email: leadData.email || undefined,
      phone: leadData.phone ?? '',
      city: leadData.city || undefined,
      company: leadData.company || undefined,
      jobTitle: leadData.jobTitle || undefined,
      country: leadData.country || undefined,
      notes: leadData.notes || undefined,
      source: 'web_form',
      otherSource: form.name,
      landingPage: req.body?.pageUrl || undefined,
      referrerUrl: req.body?.referrer || undefined,
      utmSource: req.body?.utmSource || undefined,
      utmMedium: req.body?.utmMedium || undefined,
      utmCampaign: req.body?.utmCampaign || undefined,
      status: 'new',
      priority: 'normal',
      assignedUserId: form.assignedUserId || undefined,
      pipelineId: form.pipelineId || undefined,
      pipelineStageId: form.pipelineStageId || undefined,
      stageEnteredAt: form.pipelineStageId ? new Date() : undefined,
      receivedOutsideBusinessHours: await outsideBusinessHoursFlag(),
    },
  });

  const submission = await prisma.leadFormSubmission.create({
    data: {
      formId: form.id,
      leadId: created.id,
      data: answers as Prisma.InputJsonValue,
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || undefined,
      userAgent: req.headers['user-agent'] || undefined,
      pageUrl: req.body?.pageUrl || undefined,
    },
  });

  const fullName = `${created.firstName} ${created.lastName}`.trim() || 'Unnamed lead';
  await prisma.leadActivity.create({
    data: {
      leadId: created.id,
      type: 'created',
      description: `Lead "${fullName}" captured from form "${form.name}".`,
      metadata: { formId: form.id, formSlug: form.slug, submissionId: submission.id },
    },
  });
  await fireTrigger('lead_created', created.id);
  await fireTrigger('form_submitted', created.id, { formId: form.id });

  // Answers that don't map to a Lead column would otherwise only live in the submission blob.
  if (extras.length > 0) {
    await prisma.leadNote.create({
      data: {
        leadId: created.id,
        userId: 'system',
        userName: form.name,
        body: `Form answers:\n${extras.map((e) => `${e.label}: ${e.value}`).join('\n')}`,
      },
    });
  }

  res.status(201).json({ ok: true, leadId: created.id, submissionId: submission.id });
});

// ---------------------------------------------------------------------------
// Admin detail / analytics / CRUD
// ---------------------------------------------------------------------------

formsRouter.get('/:id', async (req, res) => {
  const form = await prisma.leadForm.findUnique({
    where: { id: req.params.id },
    include: { fields: { orderBy: { sortOrder: 'asc' } }, _count: { select: { submissions: true } } },
  });
  if (!form) return res.status(404).json({ error: 'Form not found' });
  const { _count, ...rest } = form;
  res.json({ ...toAdminForm(rest), submissionCount: _count.submissions });
});

formsRouter.get('/:id/submissions', async (req, res) => {
  const { page = '1', pageSize = '20' } = req.query as Record<string, string>;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);

  const [items, total] = await Promise.all([
    prisma.leadFormSubmission.findMany({
      where: { formId: req.params.id },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * size,
      take: size,
      include: { lead: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } } },
    }),
    prisma.leadFormSubmission.count({ where: { formId: req.params.id } }),
  ]);

  res.json({
    items: items.map(({ lead, ...s }) => ({
      ...s,
      leadName: lead ? `${lead.firstName} ${lead.lastName}`.trim() : undefined,
      leadPhone: lead?.phone,
      leadEmail: lead?.email ?? undefined,
    })),
    total,
    page: pageNum,
    pageSize: size,
  });
});

formsRouter.get('/:id/analytics', async (req, res) => {
  const days = Math.min(180, Math.max(7, Number((req.query as Record<string, string>).days) || 30));
  const form = await prisma.leadForm.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, createdAt: true } });
  if (!form) return res.status(404).json({ error: 'Form not found' });

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const [total, inRange, withLead] = await Promise.all([
    prisma.leadFormSubmission.count({ where: { formId: form.id } }),
    prisma.leadFormSubmission.findMany({
      where: { formId: form.id, createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.leadFormSubmission.count({ where: { formId: form.id, leadId: { not: null } } }),
  ]);

  // One bucket per day, zeros included — a chart with holes in it reads as missing data.
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    buckets.set(localDateKey(d), 0);
  }
  for (const s of inRange) {
    const key = localDateKey(s.createdAt);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  res.json({
    total,
    leadsCreated: withLead,
    last7Days: inRange.filter((s) => s.createdAt.getTime() >= Date.now() - 7 * 86_400_000).length,
    daily: [...buckets.entries()].map(([date, count]) => ({ date, count })),
  });
});

formsRouter.post('/', async (req, res) => {
  const error = validateFormBody(req.body);
  if (error) return res.status(400).json({ error });

  const data = formWriteData(req.body);
  const taken = await prisma.leadForm.findUnique({ where: { slug: data.slug } });
  if (taken) return res.status(409).json({ error: `Slug "${data.slug}" is already in use.` });

  const created = await prisma.leadForm.create({
    data: {
      ...data,
      recaptchaSecretKey: req.body.recaptchaSecretKey?.trim() ? encrypt(req.body.recaptchaSecretKey.trim()) : null,
      fields: { create: buildFieldRows(req.body.fields ?? []) },
    },
    include: { fields: { orderBy: { sortOrder: 'asc' } } },
  });
  res.status(201).json({ ...toAdminForm(created), submissionCount: 0 });
});

formsRouter.patch('/:id', async (req, res) => {
  const existing = await prisma.leadForm.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Form not found' });

  const error = validateFormBody(req.body);
  if (error) return res.status(400).json({ error });

  const data = formWriteData(req.body);
  const taken = await prisma.leadForm.findFirst({ where: { slug: data.slug, id: { not: existing.id } } });
  if (taken) return res.status(409).json({ error: `Slug "${data.slug}" is already in use.` });

  // Fields are replaced wholesale: the builder always submits the full, ordered list, and rows
  // carry no history worth preserving (submissions keep their answers keyed by fieldKey).
  const updated = await prisma.$transaction(async (tx) => {
    await tx.leadFormField.deleteMany({ where: { formId: existing.id } });
    return tx.leadForm.update({
      where: { id: existing.id },
      data: {
        ...data,
        // An empty secret in the payload means "leave the stored one alone", not "clear it".
        recaptchaSecretKey: req.body.recaptchaSecretKey?.trim()
          ? encrypt(req.body.recaptchaSecretKey.trim())
          : existing.recaptchaSecretKey,
        fields: { create: buildFieldRows(req.body.fields ?? []) },
      },
      include: { fields: { orderBy: { sortOrder: 'asc' } }, _count: { select: { submissions: true } } },
    });
  });

  const { _count, ...rest } = updated;
  res.json({ ...toAdminForm(rest), submissionCount: _count.submissions });
});

formsRouter.delete('/:id', async (req, res) => {
  const deleted = await prisma.leadForm.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!deleted) return res.status(404).json({ error: 'Form not found' });
  res.status(204).send();
});
