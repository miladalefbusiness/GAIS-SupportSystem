# Versioned Updates & Rollback Guide (`UPDATE.md`)

## Core Update Policy

1. **Pinned Versions Only**: Production deployments always pin an explicit version (`APP_VERSION=0.1.0` -> `0.2.0`). The `:latest` image tag is rejected by both `install.sh` and `supportdesk update`.
2. **Pre-Update Backup Guarantee**: Every `supportdesk update --version X.Y.Z` runs `supportdesk backup --all` before pulling images or modifying `.env`.
3. **Immutable Image + Bundle Verification**: When hosted on a GitHub Release (`RELEASE_BASE_URL`), `supportdesk update` downloads `release-manifest.json`, `supportdesk-vX.Y.Z.tar.gz`, and `SHA256SUMS` and verifies SHA256 checksums before extracting updated Compose, Caddy, migration, and script files (preserving `.env`, `data/`, and `backups/`).
4. **Shared Image Across App & Worker**: Both `app` and `worker` run the exact same `${APP_IMAGE}:${APP_VERSION}` image tag, preventing schema/worker version drift.

---

## Checking for Updates

```bash
supportdesk update --check
```

## Performing an Upgrade

```bash
supportdesk update --version 0.2.0
```

To pull images from a private mirror registry during an update:

```bash
supportdesk update --version 0.2.0 --registry registry.example.com/your-org
```

## What Happens During `supportdesk update`

1. Verifies the target version is valid and not `latest`.
2. Fetches and SHA256-verifies `release-manifest.json` and `supportdesk-vX.Y.Z.tar.gz` (if `RELEASE_BASE_URL` is reachable).
3. Executes `supportdesk backup --all` to snapshot PostgreSQL and `/var/lib/supportdesk/storage`.
4. Updates `APP_VERSION` in `.env` cleanly without touching secrets or user data.
5. Pulls the new pinned image (or builds locally if source Dockerfile is present and pull fails).
6. Starts `app` (running `scripts/env-check.ts`, `scripts/migrate.ts`, and idempotent `scripts/bootstrap.ts`) and `worker`.
7. Polls `http://127.0.0.1:3000/api/health/ready` and updates `proxy`.

---

## Automatic & Manual Rollback

If container startup or `/api/health/ready` fails on the new version:
- `supportdesk update` automatically reverts `APP_VERSION` in `.env` to the previous version and restarts the prior `app` and `worker` containers.
- On every successful upgrade, `.last-good-version` is saved so you can run a one-command rollback later:

```bash
supportdesk rollback
# Or roll back to an explicit version + database/storage snapshot:
supportdesk rollback --version 0.1.0 --backup /opt/supportdesk/backups/supportdesk_backup_<TIMESTAMP>_all.tar.gz
```

- **GitHub Release Channel Rollback**: Trigger `.github/workflows/rollback.yml` (`workflow_dispatch`) to demote a faulty release to `prerelease: true` and re-promote the verified known-good release as `latest`.
- **Database Schema Note**: Forward Drizzle migrations are not automatically reversed. If a failed release modified PostgreSQL tables incompatibly, restore the pre-update snapshot via `supportdesk rollback --backup ...` or:

```bash
supportdesk backup list
supportdesk restore --file /opt/supportdesk/backups/supportdesk_backup_<TIMESTAMP>_all.tar.gz
```
