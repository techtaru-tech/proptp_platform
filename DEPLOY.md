# Deploying to demo.proptocrm.com

GitHub → `git pull` → `./deploy.sh`. This repo holds **both** halves — the React frontend and
the Express API — so one deploy builds and ships both.

| | |
|---|---|
| URL | https://demo.proptocrm.com |
| Server | `ec2-user@65.2.106.176` (Amazon Linux 2023) |
| App directory | `/home/ec2-user/propto-crm` |
| Backend port | `127.0.0.1:4700` (never exposed publicly) |
| Process manager | pm2, app name `propto-crm-backend` |
| Web server | nginx, `/etc/nginx/conf.d/propto-crm.conf` |
| Database | local PostgreSQL, database `propto_crm` |
| Frontend | built to `dist/`, served as static files by nginx |

**This box is shared.** Other apps already run on it, each on its own port and database
(4100, 4300, 4400, 4500, 4600). Propto CRM is one more, which is why it has its own port (4700),
its own database, its own pm2 process and its own nginx server block — nothing here touches the
neighbours. The box has well under 1 GB of RAM, so a 2 GB swap file is required for the builds.

## First time

```bash
# 1. DNS — an A record for demo.proptocrm.com pointing at 65.2.106.176
# 2. The repo is public, so the box clones it over HTTPS — no deploy key needed.

# 3. On the server
ssh -i ~/.ssh/taskflow-backend-key.pem ec2-user@65.2.106.176
git clone https://github.com/techtaru-tech/proptp_platform.git ~/propto-crm
cd ~/propto-crm && ./deploy/server-setup.sh   # swap, database, server/.env, nginx
./deploy.sh                                        # install, migrate, build, start
cd server && npx ts-node --transpile-only prisma/seed.ts   # once: reference data + the admin
sudo certbot --nginx -d demo.proptocrm.com         # TLS
pm2 save
```

`server-setup.sh` generates the database password, `JWT_SECRET` and `ENCRYPTION_KEY`, writes
`server/.env`, and prints the admin login once. `SEED_MODE=production` makes the seed create only
the pipelines, tags, email templates, property types and that admin — no demo data. Do **not** run
the seed without it on this server: the demo seed adds vendor logins with a known password.

**`ENCRYPTION_KEY` is set once.** Changing it makes every stored credential (WhatsApp, SMS, Meta,
email) unreadable. Keep a copy of `server/.env` somewhere safe.

## Every deploy

```bash
ssh -i ~/.ssh/taskflow-backend-key.pem ec2-user@65.2.106.176
cd ~/propto-crm && ./deploy.sh
```

It pulls, installs, applies migrations, builds both halves, restarts pm2 and checks `/api/health`.

## Memory

The builds need more heap than the box has free, so `deploy.sh` raises Node's heap and relies on
swap. If a build is killed ("Killed" / exit 137), check `free -m` and `swapon --show` first.

## Rolling back

```bash
cd ~/propto-crm && git log --oneline | head     # pick the last good commit
git checkout <commit> && ./deploy.sh
```

Migrations only move forward. Take a dump first if a deploy includes a destructive one:
`pg_dump propto_crm | gzip > ~/backups/propto_crm_$(date +%F).sql.gz`.

## Useful

```bash
pm2 logs propto-crm-backend --lines 100
pm2 status
sudo nginx -t && sudo systemctl reload nginx
tail -f /var/log/nginx/error.log
```
