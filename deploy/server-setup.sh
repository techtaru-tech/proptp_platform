#!/bin/bash
# One-time setup on the EC2 box. Run once, as ec2-user, after cloning the repo and before the
# first ./deploy.sh. Safe to re-run: every step checks before acting.
#
#   git clone https://github.com/techtaru-tech/proptp_platform.git ~/propto-crm
#   cd ~/propto-crm && ./deploy/server-setup.sh
set -euo pipefail

APP_DIR="/home/ec2-user/propto-crm"
DOMAIN="demo.proptocrm.com"
PORT=4700
DB_NAME="propto_crm"
DB_USER="propto_crm"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@proptocrm.com}"

cd "$APP_DIR"

echo "==> Swap (this box has under 1 GB of RAM and runs several apps; a Vite build will OOM without it)"
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

mkdir -p /home/ec2-user/logs "$APP_DIR/server/uploads"

echo "==> Database"
NEW_DB=0
if ! sudo -u postgres psql -lqt | cut -d '|' -f1 | grep -qw "$DB_NAME"; then
  DB_PASS=$(openssl rand -hex 16)
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" > /dev/null
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" > /dev/null
  NEW_DB=1
  echo "    created $DB_NAME"
else
  echo "    $DB_NAME already exists"
fi

echo "==> server/.env"
if [ ! -f server/.env ]; then
  if [ "$NEW_DB" != "1" ]; then
    echo "    the database exists but server/.env does not — create server/.env by hand (copy server/.env.example)"
    exit 1
  fi
  ADMIN_PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
  cat > server/.env <<ENV
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME?schema=public"
PORT=$PORT
NODE_ENV=production
CLIENT_ORIGIN="https://$DOMAIN"
PUBLIC_BASE_URL="https://$DOMAIN"
JWT_SECRET="$(openssl rand -hex 32)"
JWT_EXPIRES_IN="30d"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
ORG_TIME_ZONE="Asia/Kolkata"
SEED_MODE=production
SEED_ADMIN_EMAIL="$ADMIN_EMAIL"
SEED_ADMIN_PASSWORD="$ADMIN_PASS"
META_WEBHOOK_VERIFY_TOKEN="$(openssl rand -hex 16)"
ENV
  chmod 600 server/.env
  echo "    written (secrets generated; the file is not in git)"
  echo "    ADMIN LOGIN  ->  $ADMIN_EMAIL  /  $ADMIN_PASS"
else
  echo "    already in place"
fi

echo "==> .env.production (frontend build-time config)"
if [ ! -f .env.production ]; then
  echo "VITE_API_BASE_URL=https://$DOMAIN/api" > .env.production
  echo "    written"
else
  echo "    already in place"
fi

echo "==> nginx"
if [ ! -f /etc/nginx/conf.d/propto-crm.conf ]; then
  sudo cp "$APP_DIR/deploy/nginx-propto.conf" /etc/nginx/conf.d/propto-crm.conf
  sudo nginx -t && sudo systemctl reload nginx
  echo "    installed"
else
  echo "    conf already in place"
fi

cat <<NEXT

==> Remaining:
  1. ./deploy.sh       — first run builds and starts everything
  2. Seed (once)       — cd server && npx ts-node --transpile-only prisma/seed.ts   (SEED_MODE=production is in .env)
  3. TLS               — sudo certbot --nginx -d $DOMAIN
  4. pm2 on boot       — pm2 save   (pm2 startup is already set up on this box)
NEXT
