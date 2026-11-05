import { Router } from 'express';
import { writeAudit } from '../../services/audit';
import type { AuthedRequest } from '../../services/auth';
import { enabled, rotateDemoData, rotationStatus, shiftDemoDates } from '../../services/demoRotation';
import { requireFullAccess } from './auth';

export const adminDemoDataRouter = Router();

/**
 * Settings > Demo Data — for the demo box only (DEMO_TOOLS=true in server/.env).
 *
 * "Refresh" moves every date forward so the newest lead lands on now, then pulls a few leads,
 * bookings and visits onto today — for right before a meeting. The rotation (services/
 * demoRotation.ts) does the same on its own every few hours and adds a fresh batch of records.
 */

adminDemoDataRouter.get('/status', async (_req, res, next) => {
  try {
    res.json({ enabled: enabled(), rotation: enabled() ? await rotationStatus() : null });
  } catch (err) {
    next(err);
  }
});

adminDemoDataRouter.post('/refresh', requireFullAccess, async (req: AuthedRequest, res, next) => {
  if (!enabled()) return res.status(403).json({ error: 'Demo tools are switched off on this server.' });
  try {
    const result = await shiftDemoDates({ freshen: true });
    if (!result) return res.status(409).json({ error: 'There is no demo data to refresh. Run the demo seed first.' });
    await writeAudit(req, { module: 'Settings', action: 'Refreshed demo data', recordId: 'demo-data', recordLabel: 'Demo data' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Runs the rotation now instead of waiting for the next one. */
adminDemoDataRouter.post('/rotate', requireFullAccess, async (req: AuthedRequest, res, next) => {
  if (!enabled()) return res.status(403).json({ error: 'Demo tools are switched off on this server.' });
  try {
    const result = await rotateDemoData();
    if (!result) return res.status(409).json({ error: 'A rotation is already running. Try again in a minute.' });
    await writeAudit(req, { module: 'Settings', action: 'Rotated demo data', recordId: result.batchId, recordLabel: 'Demo data' });
    res.json({ ...result, rotation: await rotationStatus() });
  } catch (err) {
    next(err);
  }
});
