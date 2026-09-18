import { Router } from 'express';
import { prisma } from '../prisma';

/** Saved subject/body pairs a sequence step can be prefilled from. */
export const emailTemplatesRouter = Router();

emailTemplatesRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await prisma.emailTemplate.findMany({ orderBy: { name: 'asc' } }));
  } catch (err) {
    next(err);
  }
});

emailTemplatesRouter.post('/', async (req, res, next) => {
  try {
    const { name, subject, body } = req.body ?? {};
    if (!String(name ?? '').trim() || !String(subject ?? '').trim() || !String(body ?? '').trim()) {
      return res.status(400).json({ error: 'name, subject and body are required.' });
    }
    res.status(201).json(
      await prisma.emailTemplate.create({
        data: { name: String(name).trim(), subject: String(subject).trim(), body: String(body) },
      })
    );
  } catch (err) {
    next(err);
  }
});

emailTemplatesRouter.patch('/:id', async (req, res, next) => {
  try {
    const { name, subject, body } = req.body ?? {};
    res.json(
      await prisma.emailTemplate.update({
        where: { id: String(req.params.id) },
        data: {
          ...(name !== undefined ? { name: String(name).trim() } : {}),
          ...(subject !== undefined ? { subject: String(subject).trim() } : {}),
          ...(body !== undefined ? { body: String(body) } : {}),
        },
      })
    );
  } catch (err) {
    next(err);
  }
});

emailTemplatesRouter.delete('/:id', async (req, res, next) => {
  try {
    await prisma.emailTemplate.delete({ where: { id: String(req.params.id) } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
