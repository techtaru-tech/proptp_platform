# Deploying to shreeram.techtaru.in

Same shape as the taskflow backend already on this box: GitHub → `git pull` → `./deploy.sh`.
The difference is that this repo holds **both** halves — the React frontend and the Express
API — so one deploy builds and ships both.

| | |
|---|---|
| Server | `ec2-user@65.2.106.176` (Amazon Linux 2023, shared with taskflow) |
| App directory | `/home/ec2-user/shreeram` |
| Backend port | `127.0.0.1:4100` (taskflow keeps its own; never exposed publicly) |
| Process manager | pm2, app name `shreeram-backend` |
| Web server | nginx, `/etc/nginx/conf.d/shreeram.conf` |
| Database | local PostgreSQL 15, database `shreeram_platform` |
| Frontend | built to `dist/`, served as static files by nginx |

## First time

```bash
# 1. DNS — already done: shreeram.techtaru.in -> 65.2.106.176
# 2. GitHub → repo → Settings → Deploy keys → add the box's public key
#    (~/.ssh/shreeram_deploy.pub on the server; read-only is enough)

# 2. On the server
ssh -i ~/.ssh/taskflow-backend-key.pem ec2-user@65.2.106.176
git clone git@github-shreeram:techtaru-tech/shreeram-platform.git ~/shreeram
cd ~/shreeram && ./deploy/server-setup.sh
```

`server-setup.sh` adds swap, creates the database and user, installs the nginx config, and
prints the `DATABASE_URL` to paste in. It is safe to re-run.

Then, by hand:

```bash
cp server/.env.example server/.env && nano server/.env   # DATABASE_URL + fresh secrets
echo 'VITE_API_BASE_URL=https://shreeram.techtaru.in/api' > .env.production

./deploy.sh                                  # builds both halves and starts pm2
cd server && npx prisma db seed && cd ..     # first time only — creates the admin user
sudo certbot --nginx -d shreeram.techtaru.in # TLS
pm2 startup                                  # run the line it prints, then:
pm2 save
```

## Every deploy after that

```bash
# local
git push origin main

# server
ssh -i ~/.ssh/taskflow-backend-key.pem ec2-user@65.2.106.176
cd shreeram && ./deploy.sh
```

## Things that bite

**Swap is not optional.** The box has 911 MB of RAM and already runs taskflow. `vite build`
will be OOM-killed without it. `server-setup.sh` adds 2 GB.

**`VITE_API_BASE_URL` is compiled in, not read at runtime.** Change it and you must rebuild —
editing `.env.production` alone does nothing to a build that already happened.

**`ENCRYPTION_KEY` can only be set once.** Every stored third-party credential (Meta app
secret, Airphone token, WhatsApp token, Brevo key) is encrypted with it. Change it later and
they all become unreadable and have to be re-entered.

**Every webhook URL is derived from `PUBLIC_BASE_URL`.** After the first deploy, re-register
all four with their providers, because they currently point at a dev tunnel:

| Provider | Where | URL |
|---|---|---|
| Meta Lead Ads | App → Webhooks → Page | `/api/webhook/meta` |
| WhatsApp | App → WhatsApp → Configuration | `/api/webhook/whatsapp/<accountId>` |
| Airphone | Portal | `/api/webhook/airphone/<token>` and `.../call-log` |
| Brevo | Inbound parsing | `/api/webhook/email/<token>/inbound` |

The exact URLs are shown, with copy buttons, on each integration's settings screen.

**Health check:** `https://shreeram.techtaru.in/api/health` → `{"ok":true}`
