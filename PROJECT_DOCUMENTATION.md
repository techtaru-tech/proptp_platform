# Rosium Platform — Full Project Documentation

## 1. Project overview

Rosium Platform is a full-stack business platform for a real-estate and operations company. It combines:

- a CRM for leads and sales teams
- a property operations module for projects, plots, bookings, investments, and wallets
- an HRMS layer for attendance, leave, payroll, and employee management
- a task and workflow management system
- a partner/mobile-facing API for field staff and customers
- an admin dashboard used by internal staff and managers

The project is centered around Rosium Developers and is designed to serve both an internal React admin panel and a partner-facing Flutter app using one shared database and shared business logic.

The repository is organized as a monorepo with:

- `src/` — React + TypeScript frontend
- `server/` — Express + Prisma + PostgreSQL backend
- `public/` — static assets and downloadable tools
- `deploy/` and `deploy.sh` — deployment scripts
- `tools/` — utilities such as the camera uploader

The project description in the repo says:

> Rosium Developers — CRM, property operations and HRMS. React admin panel + Express/Prisma API.

This project is built on a real-estate operations model, but the implementation is generalized enough to cover many internal workflows used by a modern property and workforce business.

---

## 2. What this project does

### 2.1 CRM

The system includes lead capture, lead management, and sales workflows.

Core CRM capabilities include:

- lead creation and management
- lead assignment and reassignment
- pipeline and stage tracking
- drag-and-drop sales board
- follow-up tasks and reminders
- lead notes and activities
- lead tag management
- source tracking (including Meta lead ads)
- automation rules and assignment logic
- email sequences
- call logs and telephony event tracking
- WhatsApp conversations and templates
- lead form capture pages
- integrations with external systems

The CRM also supports:

- bulk lead operations
- CSV import
- lead reporting and dashboard analytics
- custom fields
- source-based attribution
- automation run history

### 2.2 Property operations

This is the operational heart of the project. It supports the full lifecycle of property sale and management.

Capabilities include:

- projects and property listings
- plot management and plot maps
- plot holds and bookings
- full booking ledgers
- investment tracking
- commission and referral bonuses
- wallet management
- KYC approvals
- payouts and commission statements
- support tickets
- construction tracking and vendor/material management
- legal and compliance records

This module is deeply tied to the real-estate and property business model and likely carries a lot of decision-critical business logic around accounting, property state, and payouts.

### 2.3 HRMS

The employee and workforce side of the system includes:

- attendance tracking
- geo-fencing for attendance capture
- attendance corrections
- leave requests and balances
- payroll runs
- payslips
- employee work status and platform access
- notifications and broadcasts

The HRMS layer is tightly integrated with the platform identity and role system, so employees, managers, and admins can each see only the features relevant to them.

### 2.4 Tasks and work management

There is a task system that supports:

- work assignment across teams
- kanban-style task boards
- visibility by role and team scope
- task tracking for managers and employees

This lets the platform manage both sales and operational work across departments.

### 2.5 Platform and administration

The platform layer includes:

- role-based access control
- panel roles with modules/groups
- audit log tracking of modifications
- organization settings
- notifications and broadcasts
- integrations management
- settings and operational rules
- user and team management

This is the shared scaffolding that makes the business modules work in a controlled and auditable environment.

### 2.6 Partner app API

The backend exposes a second API surface for a Flutter partner app:

- `/api/*` for the React admin panel
- `/api/v1/app/*` for the mobile/partner app

The two API types are intentionally separate:

- admin uses camelCase and numeric status codes
- partner app uses snake_case and string enums

The project uses separate mapper layers to avoid disagreements between surfaces and keeps core calculations in one place.

---

## 3. Core architecture

The project follows a classic full-stack architecture but with shared business logic and one database.

### 3.1 High-level structure

- Frontend: React 19 + Vite + TypeScript + Tailwind
- Backend: Express 5 + Prisma + PostgreSQL
- Database: single PostgreSQL database used by the CRM, operations, and HRMS modules
- Identity: one shared `User` model across both admin and partner surfaces
- Business rules: centralized in server-side services, not spread across the UI

### 3.2 Why the architecture matters

The repo README highlights a very important design decision:

- all three modules share one database
- both the web panel and partner app read the same data
- business logic with side effects lives in a single service layer
- derived values are computed once and reused to avoid different surfaces disagreeing on totals or statuses

This reduces drift between the admin panel and app experience and makes financial or operational calculations much more reliable.

### 3.3 API surfaces

The backend exposes two API families:

- admin API: internal platform features and dashboards
- partner app API: customer-facing or partner-access mobile endpoints

Examples from the repo:

- login endpoints for admin and app users
- CRM endpoints for leads and forms
- operations endpoints for projects, bookings, payments, payouts, and wallet
- HRMS endpoints for attendance and payroll
- integration endpoints for Meta, WhatsApp, and email

---

## 4. Technology stack

### 4.1 Frontend

The web app is built with:

- React 19
- Vite
- TypeScript
- Tailwind CSS
- React Router
- Recharts for charts
- Lucide icons
- `jspdf` and `jspdf-autotable` for exports

This is a modern admin dashboard stack designed for complex internal business workflows.

### 4.2 Backend

The server is built with:

- Node.js
- Express 5
- TypeScript
- Prisma ORM
- PostgreSQL
- JWT auth
- bcrypt for password hashing
- multer for uploads
- morgan for logging
- Swagger-like patterns are not emphasized here; instead the code and routes define the API surface directly

### 4.3 Additional integrations

The platform integrates with many external systems, including:

- Meta Lead Ads (webhooks and connectivity)
- WhatsApp Cloud API
- Email service and templates
- Airphone / telephony events
- camera upload tool for site photo ingestion
- QR / encryption utilities
- PDF generation and Excel exports

---

## 5. Repository layout

At the root of the repo you will see the main project pieces:

- `README.md` — top-level overview
- `DEPLOY.md` — deployment instructions
- `package.json` — frontend application manifest
- `server/` — backend project
- `public/` — static assets and browser-facing files
- `deploy/` — deployment automation
- `ecosystem.config.cjs` — pm2 process config

Inside `server/`:

- `src/` — all Express route and service logic
- `src/routes/` — HTTP route definitions
- `src/services/` — centralized business logic
- `prisma/` — Prisma schema, migrations, and seed data

Inside the frontend `src/`:

- `src/pages/` — application pages
- `src/components/` — UI building blocks
- `src/context/` — auth, UI, and reference data
- `src/hooks/` — helper hooks
- `src/layouts/` — page layouts
- `src/app/` — navigation and permissions configuration

This is a large full-featured SaaS-style project rather than a small demo app.

---

## 6. Getting started

### 6.1 Prerequisites

You need:

- Node.js 20+
- PostgreSQL database
- npm
- a terminal with Git access

### 6.2 Backend setup

From the repo root:

```bash
cd server
cp .env.example .env
npm install
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

The backend runs on:

- `http://localhost:4300`

The seed script creates sample admin credentials and initial reference data. The README notes the default admin sign-in values:

```text
email: admin@rosium.in
password: Rosium@2026
```

You can override the seed admin credentials with:

- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`

### 6.3 Frontend setup

From the project root:

```bash
cp .env.example .env
npm install
npm run dev
```

The frontend typically runs on:

- `http://localhost:5273`

The frontend is configured to talk to the backend at:

- `VITE_API_BASE_URL=http://localhost:4300/api`

---

## 7. Environment variables

The server uses environment variables for database access, secrets, and external integrations. The backend README lists important values, including:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | API port, default 4300 |
| `CLIENT_ORIGIN` | frontend origin for CORS |
| `META_APP_ID` | Meta app ID |
| `META_APP_SECRET` | Meta app secret |
| `META_WEBHOOK_VERIFY_TOKEN` | webhook verification token |
| `PUBLIC_BASE_URL` | public HTTPS base URL for webhook callbacks |
| `ENCRYPTION_KEY` | encrypts stored integration credentials |
| `JWT_SECRET` | JWT secret for auth |
| `JWT_EXPIRES_IN` | token expiration |
| `ORG_TIME_ZONE` | organization timezone |
| `SEED_ADMIN_EMAIL` | admin login email for seeding |
| `SEED_ADMIN_PASSWORD` | admin password for seeding |

The repo README also notes that production secrets should be changed and not left as defaults.

---

## 8. Tutorial: how the app is meant to work

### 8.1 Admin login flow

The admin panel is built around role-based access. Users log in through the admin auth routes, receive a JWT, and then access modules based on their role and permissions.

The repo uses a permission system and module-role mapping for panel access; this is enforced on both backend and frontend.

### 8.2 Sales and CRM workflow

Typical CRM workflow:

1. generate or import lead
2. assign lead to a salesperson or team
3. track lead activity and notes
4. move lead through pipeline stages
5. automate follow-ups or assignment rules
6. send WhatsApp or email communications as needed
7. close the lead or move to a lost/won status
8. monitor dashboards and reports

The system is designed for operational sales tracking rather than simple static lead tables.

### 8.3 Property workflow

Typical operations workflow:

1. create or manage a project
2. define plots within the project
3. track plot holds and bookings
4. record investments and associated ledger entries
5. calculate commissions and referral bonuses
6. process payments and payouts
7. approve KYC or support requests
8. monitor site progress, materials, vendors, and legal requirements

The platform appears to be designed to support the entire lifecycle of a real-estate business process end-to-end.

### 8.4 HR workflow

Typical HRMS workflow:

1. employee logs attendance
2. system validates attendance against configured rules and geofencing
3. employees submit leave requests
4. HR approves or adjusts attendance entries
5. payroll runs calculate compensation
6. payslips are produced and distributed
7. admin manages leave balances and team reports

---

## 9. Tutorial: CRM module

### Purpose

The CRM module is for handling sales opportunities, relationships, and conversions.

### Key CRM areas

- Leads
- Pipelines and stages
- Follow-ups
- Notes and activities
- Automations
- Lead forms
- Integrations
- Lead reports

### CRM features

The project has deep CRM functionality, including:

- pipeline and stage management
- lead source tracking
- history and assignment audit
- bulk actions
- automation engine
- custom field support
- integration with Meta Lead Ads
- email sequences and follow-up logic
- WhatsApp messaging templates
- task creation from lead activity

### Tutorial

1. Create a lead from the CRM dashboard or capture via a public form.
2. Assign the lead to a team or user.
3. Add notes and tasks.
4. Move it through the pipeline.
5. Set automation rules to follow up automatically.
6. Use reports to review conversion metrics, source performance, and assignee productivity.
7. Connect Meta or other integrations to ingest leads automatically.

---

## 10. Tutorial: operations module

### Purpose

This module manages project execution and transactions behind a property business.

### Key operations areas

- projects
- plots
- bookings
- investments
- wallet and KYC
- payouts and commission statements
- support tickets
- construction tracking
- legal and vendors

### Tutorial

1. Create a project and its associated plot inventory.
2. Mark plots as available, reserved, sold, or on hold.
3. Allow a customer to book a plot.
4. Record investments and deposit transactions.
5. Review the ledger for the booking to ensure accounting consistency.
6. Approve KYC or wallet activities.
7. Process payouts and generate commission statements.
8. Handle support tickets and operational cases.
9. Review vendor, material, and legal records for project execution.

---

## 11. Tutorial: HRMS module

### Purpose

Manages workforce operations and employee compensation data.

### Key HRMS areas

- attendance
- attendance corrections
- leave requests
- payroll
- payslips
- employee work rules

### Tutorial

1. Create or import employee profiles and assign roles.
2. Configure attendance rules and business hours.
3. Employees mark attendance or check in using configured rules.
4. Managers review attendance records and corrections.
5. Employees request leave and managers approve it.
6. Payroll runs aggregate attendance, leave, and compensation rules.
7. Payslips are generated and distributed.

---

## 12. Tutorial: tasks and workflows

### Purpose

The task system supports team coordination and role-scoped execution.

### How tasks work

- tasks are assigned across staff or teams
- each task belongs to a work context
- visibility is scoped by role
- team leads can see their team's tasks
- members typically see their own tasks
- managers can usually see more than individual contributors

### Tutorial

1. Create a task from a lead, project, or team workflow.
2. Assign it to the proper person or team.
3. Track status on the kanban board.
4. Update due dates and progress.
5. Monitor completion from dashboards and team views.

---

## 13. Tutorial: integrations and external systems

### 13.1 Meta Lead Ads

The repo specifically documents how to integrate with Meta Lead Ads.

Required steps include:

1. create a Meta Developer App
2. create a Facebook Page
3. configure the Webhooks product
4. add the callback URL for the Meta webhook
5. subscribe to the `leadgen` object
6. request `leads_retrieval` permission
7. connect the app through the CRM integrations UI

The server README explains this clearly and gives the exact callback patterns to use.

### 13.2 WhatsApp

The project includes WhatsApp templates, conversation features, and broadcast support.

Typical flow:

- configure WhatsApp Cloud API
- add account credentials in settings
- create message templates
- broadcast or respond to conversations
- monitor delivery and interactions

### 13.3 Email

The repo supports:

- email sequences
- templates
- outbound email flows
- inbound email webhook processing

### 13.4 Telephony

The system includes call history, telephony event tracking, and outbound call routing support.

---

## 14. Tutorial: public forms and lead capture

The project includes public lead-capture forms. These are used to collect leads from websites or external sources and then store them in the CRM.

This is especially relevant for real-estate businesses that want to capture leads through landing pages and ads.

Typical flow:

1. create a public form or capture workflow
2. configure fields and submission rules
3. publish the form
4. collect lead submissions
5. sync them to the CRM
6. trigger automation and assignments

---

## 15. Tutorial: camera uploader tool

There is a helper tool under `tools/camera-uploader/`.

### Purpose

This tool uploads photos from a PC camera folder to the Rosium CRM so they appear under Site Cameras.

### How it works

- the admin creates a camera in the CRM and receives a camera key
- the uploader script watches a folder of photos generated by a 4G camera
- it sends new photos to the CRM backend
- the CRM marks the camera offline if no images are received for a while

### Setup

```bash
python3 upload_photos.py --folder "D:/CameraPhotos" --key rck_xxxxxxxx --dry-run
python3 upload_photos.py --folder "D:/CameraPhotos" --key rck_xxxxxxxx
```

### Scheduling

On Linux/macOS with cron:

```bash
0 * * * * /usr/bin/python3 /path/to/upload_photos.py --folder "/path/to/photos" --key rck_xxxxxxxx >> ~/rosium-camera.log 2>&1
```

This is useful for on-site coverage, remote monitoring, and construction progress documentation.

---

## 16. Tutorial: deployment

The repo includes a full deployment setup.

### Deployment model

The project is deployed as a single application bundle containing both the frontend and backend.

The repo describes a deployment to an EC2 server with:

- nginx
- pm2
- PostgreSQL
- static frontend hosting through nginx
- backend process on port 4300

### Deployment files

- `DEPLOY.md`
- `deploy.sh`
- `deploy/server-setup.sh`
- `ecosystem.config.cjs`
- `deploy/nginx-console.conf`

### Typical deployment flow

```bash
git pull
./deploy.sh
```

The project README points out that the frontend is built and then served as static files, while the backend remains as a Node/Express service.

### Deploy notes

Important production cautions from the docs:

- memory is a real constraint on the server
- `VITE_API_BASE_URL` is compiled into the build and cannot be changed later without rebuilding
- `ENCRYPTION_KEY` should never change after it has been used because it affects stored secret data
- webhooks must be registered carefully with the correct public URLs

---

## 17. Security and operational notes

The project is a serious internal business platform, not a toy demo. The repo explicitly warns about several important production considerations:

- do not leave default JWT secret values in production
- keep `ENCRYPTION_KEY` stable once used
- use real Meta app credentials and public HTTPS endpoints
- do not use fake SMS or fake payment logic outside development
- manage all external integrations via secure credentials and environment variables

The repo also notes that some parts are intentionally mock or not fully wired for production in order to keep the project focused. The README says:

- OTPs are returned as `dev_otp` outside production
- payment flow for `mode: "online"` records a payment without verifying it

This behavior is intentional for development and local testing; in production, the platform expects real providers and real verification workflows.

---

## 18. Module summary table

| Module | Purpose | Main features |
|---|---|---|
| CRM | sales and lead ops | leads, stages, automations, integrations, follow-ups |
| Operations | property transactions | projects, plots, bookings, wallet, payouts |
| HRMS | workforce management | attendance, leave, payroll, payslips |
| Tasks | team coordination | kanban tasks, assignment, role scope |
| Platform | admin governance | roles, audit logs, settings, notifications |
| Partner App API | mobile / field access | partner login, bookings, attendance, property data |
| Integrations | system connectivity | Meta, WhatsApp, email, telephony |

---

## 19. Running in production

For deployment, the repo is designed around a production-like environment with:

- a PostgreSQL database
- a backend service running on port 4300
- a static frontend served by nginx
- TLS and domain configuration
- PM2 process management
- environment files configured for production values

The `DEPLOY.md` file shows a realistic EC2 production deployment pattern and is a good reference when moving from local development to a live environment.

---

## 20. Recommended development workflow

If you are contributing to this project, the typical local workflow is:

1. clone the repo
2. install frontend dependencies at the root
3. install backend dependencies in `server/`
4. create the PostgreSQL database
5. set environment variables in `server/.env`
6. run Prisma migrations
7. seed demo data
8. start backend
9. start frontend
10. test flows in CRM, operations, and HRMS modules

It is advisable to keep the backend and frontend versions aligned and follow the server README for integration-specific tasks before testing external providers.

---

## 21. Conclusion

Rosium Platform is a business operating system for a real-estate and property management company. It is not just a website or a simple CRM; it is a full platform that integrates:

- sales and lead lifecycle management
- property projects and booking operations
- workforce HR, payroll, and attendance
- internal admin governance, settings, and workflows
- partner/mobile experiences via a dedicated API
- integrations with modern business tools such as Meta, WhatsApp, email, and telephony

The repository is substantial and already organized as a production-oriented monorepo with real business logic, deployment automation, and a clear backend/frontend split.

For a team running a property business or a real-estate operations company, this project is designed to centralize the operational data and business rules that normally live across disconnected systems.

---

## 22. Quick start checklist

Use this checklist for a fast local setup:

```bash
# root
npm install

# backend
cd server
cp .env.example .env
npm install
npm run prisma:migrate
npm run prisma:seed
npm run dev

# frontend (new terminal)
cd ..
cp .env.example .env
npm run dev
```

Then open:

- frontend: `http://localhost:5273`
- backend: `http://localhost:4300`

Log in with the seeded admin credentials or use the partner app authentication flow described in the backend docs.

---

## 23. Additional documentation in this repo

This project already contains useful reference documents beyond this write-up:

- `README.md` — project overview
- `server/README.md` — backend architecture and detailed platform logic
- `DEPLOY.md` — production deployment instructions
- `tools/camera-uploader/README.md` — camera photo upload integration

This new document complements them by giving a readable, end-to-end explanation for developers, operators, and project stakeholders.

---

## 24. Suggested next steps

If you intend to extend or maintain the project, the best next tasks are:

1. review the Prisma schema to understand the database domain model
2. inspect the route files under `server/src/routes/` to map modules to endpoints
3. inspect the service files under `server/src/services/` to understand the business logic
4. review admin permissions to match role-based access to actual screens
5. test the lead and booking lifecycle end-to-end
6. verify webhook and integration flows before production rollout
7. set up secure secrets and TLS for public deployment

This is a proper business platform, so documentation and operational discipline matter as much as code quality.

---

End of project documentation.
