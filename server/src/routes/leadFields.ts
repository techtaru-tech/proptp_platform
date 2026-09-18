import crypto from 'crypto';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { MAPPABLE_LEAD_FIELDS } from '../services/leadFieldMapping';

/** Custom lead fields — the ones the CRM does not ship with. */
export const leadFieldsRouter = Router();

const TYPES = ['text', 'number', 'date', 'dropdown', 'checkbox'];

/**
 * Derived from the label so a mapping never breaks when someone renames the field.
 *
 * Lead forms here are often written in Hindi, and an ASCII-only slug of a Devanagari question
 * is empty. So: slug the ASCII when there is some, and otherwise fall back to a short hash of
 * the label — stable for the same label, and readable enough as an internal identifier.
 */
function keyFrom(label: string): string {
  const ascii = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  // At least one letter, or the slug is meaningless: "क्या आप 10% ..." would key as "10".
  if (/[a-z]/.test(ascii)) return ascii;
  return `field_${crypto.createHash('sha1').update(label.trim()).digest('hex').slice(0, 8)}`;
}

function serialize(f: Prisma.LeadCustomFieldGetPayload<object>) {
  return {
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.type,
    options: Array.isArray(f.options) ? (f.options as string[]) : [],
    sortOrder: f.sortOrder,
  };
}

/** Everything a mapping dropdown needs: built-in columns plus the custom fields. */
leadFieldsRouter.get('/targets', async (_req, res, next) => {
  try {
    const custom = await prisma.leadCustomField.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
    res.json({
      builtIn: MAPPABLE_LEAD_FIELDS.map((f) => ({ value: f.value, label: f.label })),
      custom: custom.map(serialize),
    });
  } catch (err) {
    next(err);
  }
});

leadFieldsRouter.get('/', async (_req, res, next) => {
  try {
    const rows = await prisma.leadCustomField.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
    res.json(rows.map(serialize));
  } catch (err) {
    next(err);
  }
});

leadFieldsRouter.post('/', async (req, res, next) => {
  try {
    const label = String(req.body?.label ?? '').trim();
    const type = String(req.body?.type ?? 'text');
    if (!label) return res.status(400).json({ error: 'A field name is required.' });
    if (!TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${TYPES.join(', ')}.` });

    const key = keyFrom(label);
    if (await prisma.leadCustomField.findUnique({ where: { key }, select: { id: true } })) {
      return res.status(409).json({ error: `A field named "${label}" already exists.` });
    }

    const options = Array.isArray(req.body?.options)
      ? req.body.options.map((o: unknown) => String(o).trim()).filter(Boolean)
      : [];
    if (type === 'dropdown' && options.length === 0) {
      return res.status(400).json({ error: 'A dropdown needs at least one option.' });
    }

    const created = await prisma.leadCustomField.create({
      data: { key, label, type, options: options.length ? options : undefined },
    });
    res.status(201).json(serialize(created));
  } catch (err) {
    next(err);
  }
});

leadFieldsRouter.patch('/:id', async (req, res, next) => {
  try {
    const data: Prisma.LeadCustomFieldUncheckedUpdateInput = {};
    // `key` is deliberately immutable: field mappings refer to it.
    if (req.body?.label !== undefined) data.label = String(req.body.label).trim();
    if (req.body?.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder) || 0;
    if (Array.isArray(req.body?.options)) {
      data.options = req.body.options.map((o: unknown) => String(o).trim()).filter(Boolean);
    }
    res.json(serialize(await prisma.leadCustomField.update({ where: { id: String(req.params.id) }, data })));
  } catch (err) {
    next(err);
  }
});

leadFieldsRouter.delete('/:id', async (req, res, next) => {
  try {
    await prisma.leadCustomField.delete({ where: { id: String(req.params.id) } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
