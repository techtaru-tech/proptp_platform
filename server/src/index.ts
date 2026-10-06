import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

// --- CRM (already live) ---
import { webhookRouter } from './routes/webhooks';
import { connectionsRouter } from './routes/connections';
import { leadsRouter } from './routes/leads';
import { tasksRouter } from './routes/tasks';
import { pipelinesRouter, tagsRouter } from './routes/pipelines';
import { followUpsRouter } from './routes/followups';
import { automationsRouter } from './routes/automations';
import { reportsRouter } from './routes/reports';
import { formsRouter } from './routes/forms';
import { settingsRouter } from './routes/settings';
import { aiSdrRouter } from './routes/aiSdrAgents';
import { emailSequencesRouter } from './routes/emailSequences';
import { emailTemplatesRouter } from './routes/emailTemplates';
import { callsRouter } from './routes/calls';
import { auditMutations } from './services/audit';
import { whatsappTemplatesRouter } from './routes/admin/whatsappTemplates';
import { adminLeaveRouter } from './routes/admin/leave';
import { adminPayrollRouter } from './routes/admin/payroll';
import { emailSettingsRouter } from './routes/emailSettings';
import { whatsappRouter } from './routes/whatsapp';
import { leadFieldsRouter } from './routes/leadFields';
import { unsubscribeRouter } from './routes/unsubscribe';
import { startAutomationPoller } from './services/automationEngine';
import { startEmailSequencePoller } from './services/emailSequenceEngine';
import { startNotificationPoller } from './services/notify';
import { startFollowUpReminderPoller } from './services/followUpReminders';

// --- Admin panel (operations + HRMS) ---
import { adminAuthRouter, adminGuard } from './routes/admin/auth';
import { adminUsersRouter, adminKycRouter } from './routes/admin/users';
import { adminTeamsRouter } from './routes/admin/teams';
import { crmTeamRouter } from './routes/crmTeam';
import { siteVisitsRouter } from './routes/siteVisits';
import { adminConstructionRouter } from './routes/admin/construction';
import { appConstructionRouter } from './routes/app/construction';
import { adminVendorsRouter, adminMaterialsRouter } from './routes/admin/vendors';
import { vendorPortalRouter, vendorPortalViewRouter } from './routes/vendorPortal';
import { adminLegalRouter } from './routes/admin/legal';
import { adminOpsRulesRouter } from './routes/admin/opsRules';
import { adminCamerasRouter } from './routes/admin/cameras';
import { cameraIngestRouter } from './routes/cameraIngest';
import { startOpsRulePoller } from './services/opsRules';
import { adminProjectsRouter, adminUnitsRouter } from './routes/admin/projects';
import { adminPlotHoldsRouter } from './routes/admin/plotHolds';
import { adminProjectMapsRouter, publicPlotMapRouter } from './routes/admin/projectMaps';
import { adminBookingsRouter } from './routes/admin/bookings';
import { adminInvestmentsRouter } from './routes/admin/investments';
import { adminFundsRouter, adminIncentivesRouter } from './routes/admin/wallet';
import { adminPayoutsRouter } from './routes/admin/payouts';
import { adminAttendanceRouter } from './routes/admin/attendance';
import { adminSupportRouter } from './routes/admin/support';
import { adminNotificationsRouter } from './routes/admin/notifications';
import { adminDashboardRouter } from './routes/admin/dashboard';
import { adminOpsReportsRouter } from './routes/admin/reports';
import { adminSettingsRouter } from './routes/admin/platformSettings';
import { panelRolesRouter, panelUsersRouter } from './routes/admin/panelAccess';
import { adminAuditRouter } from './routes/admin/audit';
import { adminUploadsRouter } from './routes/admin/uploads';

// --- Flutter partner app ---
import { appAuthRouter } from './routes/app/auth';
import { appAttendanceRouter } from './routes/app/attendance';
import { appProjectsRouter, appPropertiesRouter } from './routes/app/catalog';
import { appBookingsRouter } from './routes/app/bookings';
import { appPartnerRouter } from './routes/app/partner';
import { appFeedbackRouter } from './routes/app/feedback';
import { appPayoutsRouter } from './routes/app/payouts';
import { appAccountRouter } from './routes/app/account';
import { UPLOAD_DIR } from './services/upload';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

// `crossOriginResourcePolicy` is relaxed so the admin panel and the app can load uploaded
// images from /uploads on a different origin; everything else keeps helmet's defaults.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('dev'));
const ALLOWED_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** Any port on the loopback host, so a Vite that fell back to 5174 still reaches the API. */
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    // The Flutter app has no browser origin, so no-origin requests are allowed alongside the
    // admin panel's own. Auth is by Bearer token, not by cookie, so CORS is not the security
    // boundary here — which is why development can be relaxed about the port without giving
    // anything away. Production stays on the explicit list.
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      if (process.env.NODE_ENV !== 'production' && LOCALHOST.test(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
  })
);

// The Meta webhook needs the RAW request body to verify X-Hub-Signature-256, so it gets its
// own body parser (which also stashes the raw buffer) instead of the app-wide express.json().
app.use(
  '/api/webhook',
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
// Plenty of form plugins (Contact Form 7, JotForm, plain HTML posts) send
// application/x-www-form-urlencoded rather than JSON, so the webhook mount accepts both.
app.use('/api/webhook', express.urlencoded({ extended: true }));
app.use('/api/webhook', webhookRouter);
// Opened from an email client by a person with no session — public by necessity.
app.use('/api/unsubscribe', unsubscribeRouter);
// A plot map shared with a buyer on WhatsApp. Same reasoning: no session to check.
app.use('/api/plot-map', publicPlotMapRouter);
app.use('/api/camera-ingest', cameraIngestRouter);

app.use(express.json({ limit: '2mb' }));
// Multipart endpoints (registration, booking KYC, uploads) also receive plain form fields.
app.use(express.urlencoded({ extended: true }));

// Uploaded files, read-only.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

// Behind nginx, so the client address arrives in X-Forwarded-For. Without this every signed-in
// device would be recorded as 127.0.0.1 on the Security screen.
app.set('trust proxy', 1);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Flutter partner app — /api/v1/app/*
// Auth is enforced per-router (the OTP/register endpoints are deliberately public),
// so this is mounted BEFORE the admin guard.
// ---------------------------------------------------------------------------
app.use('/api/v1/app/auth', appAuthRouter);
app.use('/api/v1/app/attendance', appAttendanceRouter);
app.use('/api/v1/app/projects', appProjectsRouter);
app.use('/api/v1/app/properties', appPropertiesRouter);
app.use('/api/v1/app/bookings', appBookingsRouter);
app.use('/api/v1/app/partner', appPartnerRouter);
app.use('/api/v1/app/feedback', appFeedbackRouter);
app.use('/api/v1/app/construction', appConstructionRouter);
app.use('/api/v1/app/payout-requests', appPayoutsRouter);
app.use('/api/v1/app/account', appAccountRouter);

// ---------------------------------------------------------------------------
// Admin panel — /api/*
// Everything past this guard needs an admin JWT, except the small public allowlist
// inside `adminGuard` (login, webhooks, public forms).
// ---------------------------------------------------------------------------
app.use('/api', adminGuard);
// After the guard, so the actor is known and partner-app traffic never reaches it: every
// mutation past this point is recorded unless its handler already described the change.
app.use('/api', auditMutations);
app.use('/api/auth', adminAuthRouter);

// CRM
app.use('/api/connections', connectionsRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/crm-team', crmTeamRouter);
app.use('/api/site-visits', siteVisitsRouter);
app.use('/api/construction', adminConstructionRouter);
app.use('/api/legal', adminLegalRouter);
app.use('/api/ops-rules', adminOpsRulesRouter);
app.use('/api/cameras', adminCamerasRouter);
// Staff looking at a vendor's portal. Before the vendors router so its paths are not read as ids.
app.use('/api/vendors/portal-view/:vendorId', vendorPortalViewRouter);
app.use('/api/vendors', adminVendorsRouter);
app.use('/api/materials', adminMaterialsRouter);
app.use('/api/vendor-portal', vendorPortalRouter);
app.use('/api/pipelines', pipelinesRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/followups', followUpsRouter);
app.use('/api/automations', automationsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/forms', formsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/sdr-agents', aiSdrRouter);
app.use('/api/email-sequences', emailSequencesRouter);
app.use('/api/email-templates', emailTemplatesRouter);
app.use('/api/calls', callsRouter);
app.use('/api/email-settings', emailSettingsRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/whatsapp-templates', whatsappTemplatesRouter);
app.use('/api/lead-fields', leadFieldsRouter);

// Task management
app.use('/api/tasks', tasksRouter);

// Operations + HRMS
app.use('/api/leave', adminLeaveRouter);
app.use('/api/payroll', adminPayrollRouter);
app.use('/api/users', adminUsersRouter);
app.use('/api/kyc', adminKycRouter);
app.use('/api/teams', adminTeamsRouter);
app.use('/api/projects', adminProjectsRouter);
app.use('/api/units', adminUnitsRouter);
app.use('/api/plot-holds', adminPlotHoldsRouter);
app.use('/api/project-maps', adminProjectMapsRouter);
app.use('/api/bookings', adminBookingsRouter);
app.use('/api/investments', adminInvestmentsRouter);
app.use('/api/funds', adminFundsRouter);
app.use('/api/incentive-requests', adminIncentivesRouter);
app.use('/api/payouts', adminPayoutsRouter);
app.use('/api/attendance', adminAttendanceRouter);
app.use('/api/support', adminSupportRouter);
app.use('/api/notifications', adminNotificationsRouter);
app.use('/api/dashboard', adminDashboardRouter);
app.use('/api/ops-reports', adminOpsReportsRouter);
app.use('/api/platform-settings', adminSettingsRouter);
app.use('/api/panel-roles', panelRolesRouter);
app.use('/api/panel-users', panelUsersRouter);
app.use('/api/audit', adminAuditRouter);
app.use('/api/uploads', adminUploadsRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  // Prisma's "record not found" surfaces as a 404 rather than a 500, which is what both
  // clients already branch on.
  if (err?.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'That value is already in use.' });
  res.status(500).json({ error: err?.message ?? 'Internal server error' });
});

/**
 * In production nginx is the only thing that should reach this process, so bind to
 * loopback rather than every interface — the security group is one layer, not two.
 * Development binds to 0.0.0.0 so a phone on the same network can hit the app API.
 */
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');

app.listen(PORT, HOST, () => {
  console.log(`Rosium platform server listening on http://${HOST}:${PORT}`);
  console.log(`  admin API  ->  /api/*`);
  console.log(`  app API    ->  /api/v1/app/*`);
  startAutomationPoller();
  startEmailSequencePoller();
  startNotificationPoller();
  startFollowUpReminderPoller();
  startOpsRulePoller();
});
