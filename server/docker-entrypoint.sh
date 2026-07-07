#!/bin/sh
set -eu

# Create/refresh the dashboard superuser from env (optional but recommended).
if [ -n "${PB_ADMIN_EMAIL:-}" ] && [ -n "${PB_ADMIN_PASSWORD:-}" ]; then
  /pb/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" \
    --dir /pb/pb_data \
    --migrationsDir /pb/pb_migrations \
    --hooksDir /pb/pb_hooks
fi

exec /pb/pocketbase serve \
  --http 0.0.0.0:8090 \
  --dir /pb/pb_data \
  --migrationsDir /pb/pb_migrations \
  --hooksDir /pb/pb_hooks
