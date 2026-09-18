# Rosium Platform Server

Express + Prisma + PostgreSQL backend for the whole platform: the **CRM** (leads, pipelines,
forms, automations, AI SDR agents), **operations** (projects, plots, bookings,
investments, payouts, wallet, support) and **HRMS** (attendance).

## 0. Architecture — one database, two API surfaces

All three modules share **one** Postgres database and one identity table (`User`). A partner who
registers from the Flutter app appears in the admin panel immediately; a plot the admin marks
Sold Out disappears from the app's available list on the next fetch.

Two API surfaces read those same tables, and neither transforms the other's output:

| Surface | Audience | Shape |
|---|---|---|
| `/api/*` | React admin panel | camelCase, the real Laravel column names and numeric status codes (`paymentMode: 2`), matching `src/types/index.ts` |
| `/api/v1/app/*` | Flutter partner app | snake_case, string enums, per `appApi.md` at the repo root |

Each has its own serializer layer — `src/services/adminMappers.ts` and
`src/services/appMappers.ts`. Everything an API exposes that the database does not store
(`plot_size_range`, `available_count`, `PropertyStatus`, `BusinessSummary`, a project's derived
`open`/`onHold`/`soldOut`) is computed once in `src/services/derive.ts` and used by both, so the
two surfaces can never disagree about a number.

Business logic that has side effects lives in one place too: `src/services/bookings.ts` is the
only thing that creates a `Booking`, so the app's booking screen and the admin's "record
deposit" action produce identical ledger rows (investment, commission, referral bonuses, plot
status, notification).

**Auth.** One JWT for both surfaces. Admins sign in with email + password
(`POST /api/auth/login`); partners are OTP-only (`POST /api/v1/app/auth/otp` → `/verify`).
Everything under `/api/*` requires an admin token apart from a small public allowlist (the login
itself, the Meta/web-form webhooks, and the visitor-facing public form endpoints) — see
`adminGuard` in `src/routes/admin/auth.ts`.

**Not wired, on purpose.** No SMS provider (so OTPs are returned as `dev_otp` outside
production instead of being faked as "sent") and no payment gateway (so `mode: "online"` records
a payment without verifying one). Both are single, clearly marked functions. See §0.6 of
`appApi.md`.

## 1. One-time setup

```bash
cd server
npm install
npm run prisma:migrate      # creates the Postgres tables (needs a running Postgres + DATABASE_URL in .env)
npm run prisma:seed         # CRM pipelines/tags + partners, projects, plots, bookings, attendance
npm run dev                 # starts the API on http://localhost:4300
```

The seed prints the admin sign-in it created:

```
email:    admin@rosium.in
password: Rosium@2026
```

Override those with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` before seeding. The seed is
idempotent for reference data and skips the transactional half (bookings, attendance, payouts)
once bookings exist, so re-running it is safe.

For the partner app, sign in as any seeded partner phone (`9700001507`, `9700001644`, …) using
the `dev_otp` the OTP endpoint returns. See §10 of `appApi.md`.

The frontend (`npm run dev` in the project root) is already configured via `.env` →
`VITE_API_BASE_URL=http://localhost:4300/api` to talk to this server.

## 2. Environment variables (`server/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `PORT` | API port (default 4300) |
| `CLIENT_ORIGIN` | Vite dev server origin, for CORS |
| `META_APP_ID` / `META_APP_SECRET` | From your Meta App (see below) — optional at the env level; can also be set per-connection from the Integrations UI |
| `META_WEBHOOK_VERIFY_TOKEN` | Any random string. You'll paste the same value into the Meta App dashboard |
| `PUBLIC_BASE_URL` | The public HTTPS URL Meta can reach this server on (see ngrok section) |
| `ENCRYPTION_KEY` | Encrypts stored Page access tokens / App secrets at rest |
| `JWT_SECRET` | Signs the admin + partner JWTs. **Must be changed in production.** |
| `JWT_EXPIRES_IN` | Token lifetime (default `30d`) |
| `ORG_TIME_ZONE` | The zone attendance days are resolved in (default `Asia/Kolkata`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | The admin account the seed creates |

## 3. Getting real leads from Meta — what you have to do on Meta's side

This is unavoidable and can't be automated from here: Meta requires a **Meta Developer App**
tied to your own Facebook Business account and a **Facebook Page** you administer.

### Step 1 — Create a Meta App
1. Go to https://developers.facebook.com/apps → **Create App** → choose type **"Other"** → **"Business"**.
2. Once created, open **App Settings → Basic**. Copy the **App ID** and **App Secret**.

### Step 2 — Add the "Webhooks" product
1. In the app dashboard, **Add Product** → **Webhooks**.
2. Under the **Page** object, click **Subscribe to this object**.
3. **Callback URL**: `https://<your-public-url>/api/webhook/meta`
4. **Verify Token**: the exact value you put in `META_WEBHOOK_VERIFY_TOKEN`.
5. Click **Verify and Save** — Meta calls the callback URL with a GET request; this server answers
   it automatically (`server/src/routes/webhooks.ts`).
6. Subscribe to the **`leadgen`** field.

Meta requires HTTPS here. For local development, run a tunnel:
```bash
# either
npx ngrok http 4300
# or
cloudflared tunnel --url http://localhost:4300
```
Use the `https://...` URL it gives you as both `PUBLIC_BASE_URL` in `.env` and the Callback URL above.

### Step 3 — Add the "Facebook Login for Business" product (for the OAuth "Connect" button)
This lets the CRM's **Integrations → Add Connection → Connect with Facebook** button fetch your
Page's access token automatically instead of you pasting it in by hand. Add the product, and under
**Settings**, add `https://<your-public-url>/api/connections/oauth/callback` as a valid OAuth redirect URI.

### Step 4 — Get `leads_retrieval` permission
Reading actual lead answers (`GET /{leadgen_id}`) requires the `leads_retrieval` permission, which
Meta only grants after **App Review** (or immediately, in **Development Mode**, for Pages you
personally administer — enough to fully test end-to-end before going live). To go live for a Page
you don't personally manage, submit the app for App Review requesting `leads_retrieval` and
`pages_show_list`.

### Step 5 — Connect it from the CRM
Go to **CRM → Integrations → Add Connection**, choose **Meta**, and either:
- **Manual**: paste App ID, App Secret, and (once you have it) the Page Access Token + Page ID, or
- **OAuth**: save just the App ID/Secret first, then use **Reconnect** on the connection card to
  run the "Connect with Facebook" flow, which lists your Pages and picks the first one automatically.

Either path calls `POST /{page_id}/subscribed_apps?subscribed_fields=leadgen` for you, which is the
step that actually turns webhook delivery on for that Page.

### Step 6 — Test it
Submit a real test lead through Meta's **Lead Ads Testing Tool**
(https://developers.facebook.com/tools/lead-ads-testing) against your connected Page/Form. Within
a few seconds it should appear in **CRM → Leads** with `source: Meta` and the campaign/UTM fields
filled in from the Graph API response.

## 4. What's wired to this backend vs. still mock data

**The entire CRM module is now backend-driven — no mock CRM data remains.** Every file under
`src/data/mock{Leads,LeadNotes,LeadActivities,LeadTasks,Automations,Pipelines,Integrations,
IntegrationActivity}.ts` has been deleted; nothing in `src/pages/crm/*` or the CRM services reads
from an in-memory array anymore (`src/services/*.ts` call `http://localhost:4300/api/...`):

- **Leads** — list/detail/create/edit/status/assign/star/tags/stage-move, bulk actions (assign,
  status, priority, tag, untag, move stage, delete), CSV import. Every mutating action (single or
  bulk) writes a real `LeadActivity` row and, for assign/stage-move, a real history row too.
- **Lead activity timeline, notes, and follow-ups** — list/create/complete/reschedule, both a
  global cross-lead feed and per-lead. Global list/run rows are enriched server-side with the
  lead's name (a plain join), so no page needs a client-side "look up this lead by id" step.
- **Lead history** (`GET /leads/:id/history`) — real stage-move and reassignment history, replacing
  the old static generator. Reassignment history is keyed by `fromUserId`/`toUserId` (not stored
  names), so round-robin automation can query "this user's last assignment" directly and the
  frontend resolves display names the same way `assignedUserId` already is everywhere else.
- **Pipelines and their stages** — full CRUD (CRM → Pipeline → "Pipelines" tab): create/edit/delete
  pipelines, add/rename/recolor/reorder/delete stages, mark a stage won/lost, set a default
  pipeline. Deleting a pipeline/stage that still has leads on it is blocked with a clear error
  instead of silently orphaning those leads. `usePipelineReferenceData()`
  (`src/hooks/usePipelineReferenceData.ts`) is the one place every Lead page reads pipeline/stage/
  tag names/colors from, so an edit in the Pipeline Manager is reflected everywhere immediately.
- **Lead source connections** (Integrations page) and their webhook activity log — includes the
  real Meta Lead Ads webhook (see section 3 above).
- **Lead Automation** (`src/services/leadAutomationService.ts`, `src/pages/crm/LeadAutomation.tsx`,
  `Automation`/`AutomationRun` tables) — full rule CRUD, enable/disable, and the bulk "Run
  Automation" action, including real round-robin (oldest-last-assigned wins, from actual
  `LeadAssignmentHistoryEntry` rows) and specific/team assignment modes.
- **CRM Overview dashboard + Lead Reports** (`src/services/leadReportService.ts`,
  `server/src/routes/reports.ts`) — dashboard stats, the lead-creation trend chart, status
  breakdown, source performance, pipeline stage distribution, assignee performance, and
  follow-up-completion stats are all live Postgres aggregate queries (Prisma `count`/`groupBy`/
  `aggregate`), so they reflect real (including Meta-sourced) leads as they come in.

**What's still the original in-memory mock data** (`src/data/mock*.ts`) — deliberately out of scope
for this pass, unrelated to the CRM/Leads work: partners/users/teams, projects/properties,
bookings/payments, investments, attendance, payouts, support tickets. Automation's
`assignUserIds`/`assignTeamId` and a lead's `assignedUserId` are plain strings that reference this
mock partner/team layer — the same "not a hard foreign key" pattern used throughout, so Automation
and Leads work correctly today without Partners/Teams also being migrated.

## 5. Useful commands

```bash
npm run prisma:studio   # visual DB browser at http://localhost:5555
npm run build            # compile to dist/
npm run start             # run the compiled server
```
