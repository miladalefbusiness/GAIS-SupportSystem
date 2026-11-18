#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { printf '[devops:check] %s\n' "$1"; }
err() { printf '[devops:check][ERROR] %s\n' "$1" >&2; exit 1; }

log "1/6 Checking executable permissions & shell syntax..."
for f in install.sh bin/supportdesk docker/entrypoint.sh docker/postgres-init.sh docker/proxy-entrypoint.sh scripts/devops-check.sh; do
  [ -f "$f" ] || err "Missing required script: $f"
  [ -x "$f" ] || chmod +x "$f"
done
bash -n install.sh bin/supportdesk scripts/devops-check.sh
sh -n docker/*.sh

log "2/6 Scanning tracked source directories for accidental plaintext secrets..."
if grep -rnE '(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY)' \
  app src scripts docker bin install.sh .github README.md INSTALL.md CLI.md UPDATE.md DEPLOYMENT.md SECURITY.md TROUBLESHOOTING.md 2>/dev/null; then
  err "Potential secret token or private key detected in repository files!"
fi
[ ! -f .env ] || log "Note: local .env exists (will be excluded from release tarballs & git sync)."

log "3/6 Generating Next.js route types & running strict TypeScript check..."
npx next typegen
npx tsc --noEmit

log "4/6 Running ESLint..."
npm run lint

log "5/6 Running deployment CLI & Phase 1 verification tests..."
npx vitest run --maxWorkers=1 tests/deployment-cli.test.ts tests/phase1.test.ts

log "6/6 Validating Docker Compose syntax (if Docker is installed)..."
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  SQL_PASSWORD=test_sql_pw_12345 \
  SQL_ADMIN_PASSWORD=test_admin_pw_12345 \
  POSTGRES_PASSWORD=test_pg_pw_12345 \
  BETTER_AUTH_SECRET=0123456789abcdef0123456789abcdef \
  APP_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  APP_HMAC_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  APP_URL=https://support.example.com \
  APP_VERSION=0.1.0 \
  docker compose -f docker-compose.yml config -q
fi

log "All DevOps pre-handover checks PASSED."
