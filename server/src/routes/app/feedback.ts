import { Router } from 'express';
import { prisma } from '../../prisma';
import { requireAuth, type AuthedRequest } from '../../services/auth';

/** API docs §5.6 — partner feedback. */
export const appFeedbackRouter = Router();

const TOPICS = ['Booking', 'Payout', 'Attendance', 'App speed', 'Something else'];

appFeedbackRouter.post('/', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const topic = String(req.body?.topic ?? '');
    const message = String(req.body?.message ?? '').trim();
    if (!TOPICS.includes(topic)) {
      return res.status(400).json({ error: { code: 'invalid_topic', message: `topic must be one of: ${TOPICS.join(', ')}.` } });
    }
    if (!message) {
      return res.status(400).json({ error: { code: 'missing_message', message: 'A message is required.' } });
    }
    await prisma.feedback.create({ data: { userId: req.auth!.sub, topic, message } });
    res.status(201).json({ received: true });
  } catch (err) {
    next(err);
  }
});
