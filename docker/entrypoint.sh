#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Running versioned Drizzle migrations..."
  node ./node_modules/tsx/dist/cli.mjs ./scripts/migrate.ts
fi

if [ "${RUN_BOOTSTRAP_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Running idempotent Super Admin & RBAC bootstrap..."
  node ./node_modules/tsx/dist/cli.mjs ./scripts/bootstrap.ts
fi

exec "$@"
