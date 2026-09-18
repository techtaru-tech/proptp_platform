import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import type { AuthedRequest } from '../../services/auth';
import { adminAudit } from '../../services/adminMappers';
import { listResult, parseListQuery } from '../../services/list';

export const adminAuditRouter = Router();

adminAuditRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const module = String(req.query.module ?? 'all');
    const userName = String(req.query.userName ?? 'all');
    const recordId = String(req.query.recordId ?? '');
    const dateFrom = String(req.query.dateFrom ?? '');
    const dateTo = String(req.query.dateTo ?? '');

    const where: Prisma.AuditEntryWhereInput = {};
    if (module !== 'all' && module !== '') where.module = module;
    if (userName !== 'all' && userName !== '') where.userName = userName;
    if (recordId) where.recordId = recordId;
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: 'insensitive' } },
        { recordLabel: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.auditEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: query.skip, take: query.take }),
      prisma.auditEntry.count({ where }),
    ]);
    res.json(listResult(rows.map(adminAudit), total, query));
  } catch (err) {
    next(err);
  }
});

/** The filter dropdown options, taken from what the log actually contains. */
adminAuditRouter.get('/facets', async (_req, res, next) => {
  try {
    const [modules, users] = await Promise.all([
      prisma.auditEntry.findMany({ distinct: ['module'], select: { module: true }, orderBy: { module: 'asc' } }),
      prisma.auditEntry.findMany({ distinct: ['userName'], select: { userName: true }, orderBy: { userName: 'asc' } }),
    ]);
    res.json({ modules: modules.map((m) => m.module), users: users.map((u) => u.userName) });
  } catch (err) {
    next(err);
  }
});
