#!/usr/bin/env bash
set -euo pipefail

MIGRATE_URL="${DATABASE_DIRECT_URL:-$DATABASE_URL}"
echo "[start] running migrations"
DATABASE_URL="$MIGRATE_URL" pnpm --filter @spark/db db:migrate

echo "[start] starting api"
exec node apps/api/dist/index.js
