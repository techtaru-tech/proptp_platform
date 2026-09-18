import { Router } from 'express';
import type { Prisma, TicketStatus } from '@prisma/client';
import { prisma } from '../../prisma';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { adminTicket } from '../../services/adminMappers';
import { listResult, parseListQuery } from '../../services/list';

export const adminSupportRouter = Router();

const ticketInclude = {
  user: { select: { name: true, role: true } },
  messages: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.SupportTicketInclude;

adminSupportRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const query = parseListQuery(req);
    const status = String(req.query.status ?? 'all');

    const where: Prisma.SupportTicketWhereInput = {};
    if (status !== 'all' && status !== '') where.status = status as TicketStatus;
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: ticketInclude,
        orderBy: { updatedAt: query.sortBy === 'updatedAt' ? query.sortDir : 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.supportTicket.count({ where }),
    ]);
    res.json(listResult(rows.map(adminTicket), total, query));
  } catch (err) {
    next(err);
  }
});

adminSupportRouter.get('/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: String(req.params.id) }, include: ticketInclude });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json(adminTicket(ticket));
  } catch (err) {
    next(err);
  }
});

adminSupportRouter.post('/:id/reply', async (req: AuthedRequest, res, next) => {
  try {
    const message = String(req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'A message is required.' });

    const id = String(req.params.id);
    const existing = await prisma.supportTicket.findUnique({ where: { id }, select: { status: true, userId: true } });
    if (!existing) return res.status(404).json({ error: 'Ticket not found' });

    const actor = req.auth ? await prisma.user.findUnique({ where: { id: req.auth.sub }, select: { id: true, name: true } }) : null;
    const now = new Date();

    const ticket = await prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({
        data: {
          ticketId: id,
          authorId: actor?.id ?? 'admin',
          authorName: `${actor?.name ?? 'Admin'} (Admin)`,
          authorRole: 'admin',
          message,
          attachments: Array.isArray(req.body?.attachments) ? req.body.attachments.map(String) : [],
        },
      });
      return tx.supportTicket.update({
        where: { id },
        // An admin reply moves an untouched ticket to `pending` (waiting on the partner);
        // anything already resolved/closed keeps its status.
        data: { lastReplyAt: now, status: existing.status === 'open' ? 'pending' : existing.status },
        include: ticketInclude,
      });
    });

    // Tell the partner there is a reply waiting.
    const notification = await prisma.notification.create({
      data: { title: 'Support reply', body: `There's a new reply on your ticket: ${ticket.subject}`, type: 'system', audience: 'all' },
    });
    await prisma.notificationRecipient.create({ data: { notificationId: notification.id, userId: existing.userId } });

    res.json(adminTicket(ticket));
  } catch (err) {
    next(err);
  }
});

adminSupportRouter.post('/:id/status', async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!['open', 'pending', 'resolved', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'status must be open, pending, resolved or closed.' });
    }
    const ticket = await prisma.supportTicket.update({
      where: { id: String(req.params.id) },
      data: { status: status as TicketStatus },
      include: ticketInclude,
    });
    await writeAudit(req, {
      module: 'Support',
      action: `Ticket marked ${status}`,
      recordId: ticket.id,
      recordLabel: ticket.subject,
    });
    res.json(adminTicket(ticket));
  } catch (err) {
    next(err);
  }
});
