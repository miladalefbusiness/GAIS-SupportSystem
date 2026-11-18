# DevOps Engineering, CI/CD Pipeline & Safe Handover Guide (`DEVOPS.md`)

This repository enforces a gated DevOps lifecycle covering **local sandbox verification**, **continuous integration**, **container smoke testing**, **immutable multi-arch release publishing**, and **automated + server-side rollback**.

---

## 1. Local Edit -> Verify -> Handover Workflow

Before pushing changes to `main` or cutting a release tag, always run the full pre-handover gate locally:

```bash
npm run devops:check
```

`scripts/devops-check.sh` enforces:
1. Executable permissions and syntax checks (`bash -n install.sh bin/supportdesk scripts/devops-check.sh`, `sh -n docker/*.sh`).
2. Secret-leak scan across tracked directories (`ghp_*`, `github_pat_*`, private keys).
3. `npx next typegen && npx tsc --noEmit` (zero TypeScript errors across app, scripts, and tests).
4. `npm run lint` (zero ESLint errors).
5. `npx vitest run --maxWorkers=1 tests/deployment-cli.test.ts tests/phase1.test.ts` (real PostgreSQL migration/CLI/crypto/RBAC tests).
6. `docker compose -f docker-compose.yml config -q` validation (when Docker is available).

---

## 2. GitHub Actions CI/CD Workflows

| Workflow | File | Trigger | Purpose |
|---|---|---|---|
| **CI Quality Gate** | `.github/workflows/ci.yml` | `push: main`, `pull_request: main`, `workflow_dispatch` | Runs shell checks, `tsc`, `eslint`, Next.js build, PostgreSQL 16 (`pgvector`) integration tests, and live single-arch container readiness smoke tests (`/api/health/ready`). |
| **Gated Versioned Release** | `.github/workflows/release.yml` | `push: tags v*.*.*`, `workflow_dispatch` | Runs `pre-release-gate` + `container-smoke-verify` first; only after live container `/api/health/ready` passes does it build & push multi-arch (`linux/amd64`, `linux/arm64`) images to GHCR, generate `SHA256SUMS`, and publish the GitHub Release. |
| **Production Rollback** | `.github/workflows/rollback.yml` | `workflow_dispatch` | Verifies the target known-good release assets, demotes a faulty release (`prerelease: true`) so `install.sh` / `supportdesk update --check` never serve it as latest, and promotes the target version to `latest`. |

### Multi-Arch Docker Build Architecture (`Dockerfile`)
- `deps`, `builder`, and cross-arch `prod-deps` execute natively on `$BUILDPLATFORM` (`linux/amd64`) using `npm --os=linux --cpu=$NPM_CPU --libc=musl --ignore-scripts` for target architectures (`x64` / `arm64`), avoiding QEMU user-mode Node/npm deadlocks while producing clean target-architecture `node_modules` inside `runner`.
- `runner` runs as non-root `nextjs:nodejs` (`UID/GID 1001`) under `tini`, validating `.env`, applying Drizzle migrations, and bootstrapping Super Admin before serving port `3000`.

---

## 3. Safe Handover & Release Steps

1. Run local verification:
   ```bash
   npm run devops:check
   ```
2. Push verified changes to `main` (triggers `.github/workflows/ci.yml`).
3. Wait for `ci.yml` (`quality-and-build`, `integration-tests`, `container-smoke-test`) to pass completely.
4. Bump `package.json` version (e.g. `0.2.0`), commit, and create/push annotated semantic tag:
   ```bash
   git tag -a v0.2.0 -m "SupportDesk v0.2.0"
   git push origin v0.2.0
   ```
5. Verify `.github/workflows/release.yml` completes all 3 jobs (`pre-release-gate`, `container-smoke-verify`, `release`) and publishes `install.sh`, `supportdesk-v0.2.0.tar.gz`, `release-manifest.json`, and `SHA256SUMS`.

---

## 4. Rollback Procedures

### A. Channel Rollback (GitHub Releases)
Trigger `.github/workflows/rollback.yml` (`workflow_dispatch`) via GitHub UI or API:
- `target_version`: known-good version (e.g. `0.1.0`)
- `broken_version`: faulty version to demote (e.g. `0.2.0`)
- `reason`: short incident explanation

### B. Server Rollback (Deployed Host)
On any deployed server:
```bash
# Automatically roll back to the previous recorded working version:
supportdesk rollback

# Or roll back to an explicit version (and optionally restore DB + storage snapshot):
supportdesk rollback --version 0.1.0
supportdesk rollback --version 0.1.0 --backup /opt/supportdesk/backups/supportdesk_backup_<STAMP>_all.tar.gz
```
Automatic rollback also triggers inside `supportdesk update` whenever container startup or `/api/health/ready` fails after upgrading.
