import { Router } from 'express';
import { prisma } from '../../prisma';
import type { AuthedRequest } from '../../services/auth';
import { writeAudit } from '../../services/audit';
import { getPolicy, validatePolicy } from '../../services/salesPolicy';

/** Settings > Sales policy — /api/sales-policy. */
export const adminSalesPolicyRouter = Router();

const shape = (p: Awaited<ReturnType<typeof getPolicy>>) => {
  const { id: _id, updatedAt, ...rest } = p;
  return { ...rest, updatedAt: updatedAt.toISOString() };
};

adminSalesPolicyRouter.get('/', async (_req, res, next) => {
  try {
    res.json(shape(await getPolicy()));
  } catch (err) {
    next(err);
  }
});

adminSalesPolicyRouter.patch('/', async (req: AuthedRequest, res, next) => {
  try {
    const current = await getPolicy();
    const { data, error } = validatePolicy({ ...current, ...req.body });
    if (error || !data) return res.status(400).json({ error });
    const updated = await prisma.salesPolicy.update({ where: { id: 'singleton' }, data });
    await writeAudit(req, { module: 'Settings', action: 'Updated sales policy', recordId: 'singleton', recordLabel: 'Sales policy', description: '' });
    res.json(shape(updated));
  } catch (err) {
    next(err);
  }
});
