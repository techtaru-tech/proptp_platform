#!/bin/bash
# One-time setup on the EC2 box. Run once, as ec2-user, before the first ./deploy.sh.
# Safe to re-run: every step checks before acting.
set -euo pipefail

APP_DIR="/home/ec2-user/shreeram"
# Uses the `github-shreeram` alias in ~/.ssh/config, which points at this repo's own
# deploy key — the box already has a different key for the taskflow repo.
REPO="git@github-shreeram:techtaru-tech/shreeram-platform.git"
DB_NAME="shreeram_platform"
DB_USER="shreeram"

echo "==> Swap (this box has under 1 GB of RAM; a Vite build will OOM without it)"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile > /dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  echo "    2 GB swap added"
else
  echo "    already present"
fi

echo "==> Database"
if ! sudo -u postgres psql -lqt | cut -d '|' -f1 | grep -qw "$DB_NAME"; then
  DB_PASS=$(openssl rand -hex 16)
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  echo "    created. DATABASE_URL for server/.env:"
  echo "    DATABASE_URL=\"postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public\""
else
  echo "    $DB_NAME already exists"
fi

echo "==> Clone"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
else
  echo "    already cloned"
fi

mkdir -p /home/ec2-user/logs "$APP_DIR/server/uploads"

echo "==> nginx"
if [ ! -f /etc/nginx/conf.d/shreeram.conf ]; then
  sudo cp "$APP_DIR/deploy/nginx-shreeram.conf" /etc/nginx/conf.d/shreeram.conf
  sudo nginx -t && sudo systemctl reload nginx
  echo "    installed"
else
  echo "    conf already in place"
fi

cat <<'NEXT'

==> Remaining, by hand:
  1. server/.env      — copy server/.env.example, paste the DATABASE_URL above,
                        and generate fresh secrets:
                          openssl rand -hex 32   # JWT_SECRET
                          openssl rand -hex 32   # ENCRYPTION_KEY
  2. .env.production  — VITE_API_BASE_URL=https://shreeram.techtaru.in/api
  3. ./deploy.sh      — first run builds and starts everything
  4. TLS              — sudo certbot --nginx -d shreeram.techtaru.in
  5. pm2 on boot      — pm2 startup   (run the line it prints)   then   pm2 save
NEXT
