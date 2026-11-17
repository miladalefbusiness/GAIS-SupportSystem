#!/bin/sh
set -eu

if [ "${VALIDATE_ENV_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] Validating environment configuration..."
  node ./node_modules/tsx/dist/cli.mjs ./scripts/env-check.ts
fi

if [ "${RUN_MIGRATIONS_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Applying versioned Drizzle PostgreSQL migrations..."
  node ./node_modules/tsx/dist/cli.mjs ./scripts/migrate.ts
fi

if [ "${RUN_BOOTSTRAP_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] Running idempotent Super Admin & RBAC bootstrap..."
  node ./node_modules/tsx/dist/cli.mjs ./scripts/bootstrap.ts
fi

exec "$@"
