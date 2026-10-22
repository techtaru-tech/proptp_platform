# Deploying to portal.techtaru.in

GitHub → `git pull` → `./deploy.sh`. This repo holds **both** halves — the React frontend and
the Express API — so one deploy builds and ships both.

| | |
|---|---|
| URL | https://portal.techtaru.in |
| Server | `ec2-user@65.2.106.176` (Amazon Linux 2023) |
| App directory | `/home/ec2-user/techtaru-portal` |
| Backend port | `127.0.0.1:4600` (never exposed publicly) |
| Process manager | pm2, app name `techtaru-portal-backend` |
| Web server | nginx, `/etc/nginx/conf.d/techtaru-portal.conf` |
| Database | local PostgreSQL, database `techtaru_portal` |
| Frontend | built to `dist/`, served as static files by nginx |

**This box is shared.** Other apps already run on it, each on its own port and database
(4100, 4300, 4400, 4500). TechTaru portal is one more, which is why it has its own port (4600),
its own database, its own pm2 process and its own nginx server block — nothing here touches the
neighbours. The box has well under 1 GB of RAM, so a 2 GB swap file is required for the builds.

## First time

```bash
# 1. DNS — an A record for portal.techtaru.in pointing at 65.2.106.176
# 2. GitHub → repo → Settings → Deploy keys → add the box's public key (read-only is enough).
#    Give this repo its own host alias in ~/.ssh/config on the box:
#
#      Host github-techtaru-portal
#        HostName github.com
#        User git
#        IdentityFile ~/.ssh/techtaru_portal_deploy
#        IdentitiesOnly yes

# 3. On the server
ssh -i ~/.ssh/taskflow-backend-key.pem ec2-user@65.2.106.176
git clone git@github-techtaru-portal:techtaru-tech/techtaru-portal.git ~/techtaru-portal
cd ~/techtaru-portal && ./deploy/server-setup.sh   # swap, database, server/.env, nginx
./deploy.sh                                        # install, migrate, build, start
cd server && npx ts-node --transpile-only prisma/seed.ts   # once: reference data + the admin
sudo certbot --nginx -d portal.techtaru.in         # TLS
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
cd ~/techtaru-portal && ./deploy.sh
```

It pulls, installs, applies migrations, builds both halves, restarts pm2 and checks `/api/health`.

## Memory

The builds need more heap than the box has free, so `deploy.sh` raises Node's heap and relies on
swap. If a build is killed ("Killed" / exit 137), check `free -m` and `swapon --show` first.

## Rolling back

```bash
cd ~/techtaru-portal && git log --oneline | head     # pick the last good commit
git checkout <commit> && ./deploy.sh
```

Migrations only move forward. Take a dump first if a deploy includes a destructive one:
`pg_dump techtaru_portal | gzip > ~/backups/techtaru_portal_$(date +%F).sql.gz`.

## Useful

```bash
pm2 logs techtaru-portal-backend --lines 100
pm2 status
sudo nginx -t && sudo systemctl reload nginx
tail -f /var/log/nginx/error.log
```
