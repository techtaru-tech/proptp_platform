# Deploying to rosium.techtaru.in

GitHub → `git pull` → `./deploy.sh`. This repo holds **both** halves — the React frontend and
the Express API — so one deploy builds and ships both.

| | |
|---|---|
| Server | `ec2-user@65.2.106.176` (Amazon Linux 2023) |
| App directory | `/home/ec2-user/rosium` |
| Backend port | `127.0.0.1:4300` (never exposed publicly) |
| Process manager | pm2, app name `rosium-backend` |
| Web server | nginx, `/etc/nginx/conf.d/rosium.conf` |
| Database | local PostgreSQL, database `rosium_platform` |
| Frontend | built to `dist/`, served as static files by nginx |

**This box is shared.** taskflow and the ShreeRam platform already run on it, on their own
ports and databases. Rosium is the third, which is why it has its own port (4300), its own
database, its own pm2 process and its own nginx server block — nothing here touches the
neighbours. The memory note below is not optional advice.

## First time

```bash
# 1. DNS — point rosium.techtaru.in at 65.2.106.176
# 2. GitHub → repo → Settings → Deploy keys → add the box's public key (read-only is enough)
#    The box already holds keys for other repos, so give this one its own host alias in
#    ~/.ssh/config:
#
#      Host github-rosium
#        HostName github.com
#        IdentityFile ~/.ssh/rosium_deploy
#        IdentitiesOnly yes

# 3. On the server
ssh -i ~/.ssh/taskflow-backend-key.pem ec2-user@65.2.106.176
git clone git@github-rosium:techtaru-tech/rosium-platform.git ~/rosium
cd ~/rosium && ./deploy/server-setup.sh
```

`server-setup.sh` makes sure swap exists, creates the database and user, installs the nginx
config, and prints the `DATABASE_URL` to paste in. It is safe to re-run.

Then, by hand:

```bash
cp server/.env.example server/.env && nano server/.env   # DATABASE_URL + fresh secrets
echo 'VITE_API_BASE_URL=https://rosium.techtaru.in/api' > .env.production

./deploy.sh                                # builds both halves and starts pm2
cd server && npx prisma db seed && cd ..    # first time only — creates the admin user
sudo certbot --nginx -d rosium.techtaru.in  # TLS
pm2 startup                                 # run the line it prints, then:
pm2 save
```

## Every deploy after that

```bash
# local
git push origin main

# server
ssh -i ~/.ssh/taskflow-backend-key.pem ec2-user@65.2.106.176
cd rosium && ./deploy.sh
```

## Things that bite

**Memory is the real constraint.** The box has 911 MB of RAM and now runs three apps plus
Postgres. `vite build` is the heaviest thing that happens here and will be OOM-killed without
swap — `server-setup.sh` ensures 2 GB. If a deploy dies mid-build, check `free -h` and
`sudo swapon --show` first. `max_memory_restart` in `ecosystem.config.cjs` is set to 250M so a
leak in this process restarts it rather than dragging the neighbours down with it.

**`VITE_API_BASE_URL` is compiled in, not read at runtime.** Change it and you must rebuild —
editing `.env.production` alone does nothing to a build that already happened.

**`ENCRYPTION_KEY` can only be set once.** Every stored third-party credential (Meta app
secret, Airphone token, WhatsApp token, Brevo key) is encrypted with it. Change it later and
they all become unreadable and have to be re-entered.

**Every webhook URL is derived from `PUBLIC_BASE_URL`.** After the first deploy, register all
four with their providers:

| Provider | Where | URL |
|---|---|---|
| Meta Lead Ads | App → Webhooks → Page | `/api/webhook/meta` |
| WhatsApp | App → WhatsApp → Configuration | `/api/webhook/whatsapp/<accountId>` |
| Airphone | Portal | `/api/webhook/airphone/<token>` and `.../call-log` |
| Brevo | Inbound parsing | `/api/webhook/email/<token>/inbound` |

The exact URLs are shown, with copy buttons, on each integration's settings screen.

**Health check:** `https://rosium.techtaru.in/api/health` → `{"ok":true}`
