# Rosium Platform

The admin panel and API behind Rosium Developers — CRM, property operations and HRMS on one
database, serving both a React admin panel and the Flutter partner app.

| | |
|---|---|
| Frontend | React 19 + Vite + TypeScript + Tailwind, `src/` |
| Backend | Express 5 + Prisma + PostgreSQL, `server/` |
| Deploy | nginx + pm2 on EC2 — see [DEPLOY.md](DEPLOY.md) |

## What is in it

**CRM** — leads, pipelines with a drag-and-drop board, follow-ups, public lead-capture forms,
automation rules, AI SDR agents, email sequences, call history, WhatsApp conversations, and a
live Meta Lead Ads webhook.

**Operations** — projects and their plots, plot holds, bookings with their full ledger side
effects (investment, commission, referral bonuses), payments, investments, wallet and KYC
approvals, payouts and commission statements, support tickets.

**HRMS** — attendance with geo-fencing, corrections, leave requests and balances, payroll runs
and payslips.

**Tasks** — work assigned across the team, with a kanban board. Visibility is scoped by role:
an admin sees everything, an agent or leader sees their team's, an employee sees their own.

**Platform** — role-based panel access (a panel role is a list of modules, enforced on both
sides), an audit trail of every mutation, organisation settings, notifications and broadcasts.

## Two API surfaces, one database

| Surface | Audience | Shape |
|---|---|---|
| `/api/*` | React admin panel | camelCase, numeric status codes, matching `src/types/index.ts` |
| `/api/v1/app/*` | Flutter partner app | snake_case, string enums |

Each has its own serializer (`server/src/services/adminMappers.ts` and `appMappers.ts`) and
neither is derived from the other. Anything an API exposes that the database does not store is
computed once in `server/src/services/derive.ts` and used by both, so the two surfaces cannot
disagree about a number.

Business logic with side effects lives in one place too: `server/src/services/bookings.ts` is
the only thing that creates a `Booking`, so the app's booking screen and the admin's "record
deposit" action produce identical ledger rows.

## Running it locally

Needs Node 20+ and a local PostgreSQL.

```bash
# Backend
cd server
cp .env.example .env          # set DATABASE_URL and generate the two secrets
npm install
npm run prisma:migrate        # creates the tables
npm run prisma:seed           # reference data + demo partners, projects, bookings
npm run dev                   # http://localhost:4300

# Frontend, from the repo root
cp .env.example .env          # VITE_API_BASE_URL=http://localhost:4300/api
npm install
npm run dev                   # http://localhost:5273
```

The seed prints the admin sign-in it created. Partners sign in to the app API with any seeded
phone plus the `dev_otp` the OTP endpoint returns outside production.

`server/README.md` covers the backend in depth, including what Meta requires on their side
before real leads arrive.

## Not wired, on purpose

No SMS provider (OTPs are returned as `dev_otp` rather than faked as "sent") and no payment
gateway (`mode: "online"` records a payment without verifying one). Both are single, clearly
marked functions.
