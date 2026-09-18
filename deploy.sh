#!/bin/bash
# Rosium platform — pull, build, migrate, restart. Run on the server: ./deploy.sh
#
# Both halves live in this one repo:
#   frontend  -> built to dist/ and served as static files by nginx
#   backend   -> built to server/dist/ and run by pm2, proxied at /api
set -euo pipefail

APP_DIR="/home/ec2-user/rosium"
PM2_NAME="rosium-backend"

cd "$APP_DIR"

echo "==> Pulling latest code..."
git pull origin main

echo "==> Backend: dependencies..."
cd "$APP_DIR/server"
# Dev deps are needed: the build runs tsc, and prisma is a devDependency.
npm ci

echo "==> Backend: Prisma client..."
npx prisma generate

echo "==> Backend: migrations..."
npx prisma migrate deploy

echo "==> Backend: build..."
npm run build

echo "==> Frontend: dependencies..."
cd "$APP_DIR"
npm ci

echo "==> Frontend: build..."
# Vite inlines VITE_* at build time, so .env.production must exist before this runs.
npm run build

echo "==> Restarting backend..."
if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env
else
  pm2 start ecosystem.config.cjs
  pm2 save
fi

echo "==> Health check..."
sleep 2
curl -fsS http://127.0.0.1:4300/api/health && echo

echo "==> Done."
pm2 status
