# Management CLI Reference (`supportdesk`)

Installed globally at `/usr/local/bin/supportdesk` (linked to `bin/supportdesk`).

## General Operations

| Command | Description |
|---|---|
| `supportdesk help` | Display all commands and syntax |
| `supportdesk version` | Print currently pinned `APP_VERSION` |
| `supportdesk status` | Show container states (`compose ps`) and live `/api/health/ready` JSON |
| `supportdesk health` | Validate `.env`, PostgreSQL readiness, `/api/health/ready`, RAG worker heartbeat (`/tmp/supportdesk-worker-heartbeat`), and HTTPS reachability |
| `supportdesk logs [service]` | Follow logs for `app`, `worker`, `postgres` (or `db`), `proxy`, or `all` |
| `supportdesk start` | Ensure storage/backup permissions, start all services, wait for `/api/health/ready` |
| `supportdesk stop` | Gracefully stop all running containers without removing volumes |
| `supportdesk restart [service]` | Restart all containers or a single service (`app`, `worker`, `postgres`, `proxy`) and verify readiness |
| `supportdesk config` | Display non-secret configuration summary and interactively edit Domain/APP_URL/TZ/Max Upload/ACME, AI Provider (with `ai-sync --overwrite`), SMTP/SMS integrations, or Super Admin credentials (username, email, display name & password) |

---

## Installation, Repair & Lifecycle

| Command | Description |
|---|---|
| `supportdesk install` | Launch interactive `install.sh --local --dir <ROOT_DIR>` |
| `supportdesk install --non-interactive` | Idempotent unattended setup using existing `.env` (or generating secure `.env` if absent) |
| `supportdesk repair` | Non-destructive repair: validates `compose config`, fixes `.env` (`600`) & `backups/` (`700`) permissions, validates `.env`, ensures DB/app/worker/proxy are running, runs pending migrations (`scripts/migrate.ts`), and checks health |
| `supportdesk reinstall [--version X.Y.Z]` | Rebuilds/pulls and recreates `app` and `worker` containers cleanly while preserving **ALL** PostgreSQL volumes (`pg_data`), uploaded files (`storage_data`), `.env`, and TLS certs |
| `supportdesk reset --destroy-data` | **DESTRUCTIVE**: Explicitly asks you to type `DESTROY ALL DATA`, then deletes containers, `pg_data`, `storage_data`, host storage files, and `caddy_data` |

---

## Versioned Updates

```bash
supportdesk update --check
supportdesk update --version 0.2.0
supportdesk update --version 0.2.0 --registry mirror.example.com/org
```

- Refuses `latest` tags; requires a pinned semantic version (`--version X.Y.Z`).
- Verifies `release-manifest.json`, `supportdesk-vX.Y.Z.tar.gz`, and `SHA256SUMS` when available from `RELEASE_BASE_URL`.
- Automatically takes a full pre-update backup (`supportdesk backup --all`) before changing any files or containers.
- Automatically rolls back `APP_VERSION` and restarts the previous `app`/`worker` containers if container startup or `/api/health/ready` fails.

---

## Backup & Restore

| Command | Description |
|---|---|
| `supportdesk backup` / `supportdesk backup --all` | Full backup bundle (PostgreSQL dump + persistent storage + manifest + sanitized config metadata) with `.sha256` sidecar and retention pruning |
| `supportdesk backup --database` | Database-only verified backup bundle |
| `supportdesk backup --files` | Persistent storage-only verified backup bundle |
| `supportdesk backup list` | List backups with size, UTC timestamp, and SHA256 verification status |
| `supportdesk backup prune [--keep N]` | Prune oldest backups keeping newest `N` (defaults to `BACKUP_RETENTION_COUNT=14`) |
| `supportdesk restore [--file path.tar.gz]` | Interactive or direct restore: verifies `.sha256`, inspects `manifest.json`, requires typing `RESTORE`, stops `app`/`worker`, restores DB (`ON_ERROR_STOP=1`) and storage, restarts services, and verifies `/api/health/ready` |

---

## Administrator Management (`admin`)

Password hashes are **never** printed or returned by any command. All administrative mutations write structured audit logs and revoke active sessions when disabling, renaming, or resetting passwords.

| Command | Description |
|---|---|
| `supportdesk admin list` | Table output of staff/admin accounts, statuses, roles, and `mustChangePassword` flags |
| `supportdesk admin create [--username U --email E --name N --role super_admin\|dept_manager\|operator\|file_operator\|viewer --generate-password]` | Create a new administrator interactively or via flags |
| `supportdesk admin update [--username U --new-username U2 --email E --name N --generate-password]` | Edit an admin or Super Admin's username, email, display name, and/or password interactively or via flags (syncs `.env` for primary Super Admin and revokes sessions) |
| `supportdesk admin reset-password [--username U] [--generate-password] [--force-change]` | Reset administrator password securely via stdin or generated one-time password, and revoke all active sessions |
| `supportdesk admin disable [--username U] [--force]` | Suspend an administrator account and revoke all active sessions (blocks disabling the last active Super Admin unless `--force` is given) |
| `supportdesk admin enable [--username U]` | Re-enable a suspended administrator account |
| `supportdesk admin force-password-change [--username U]` | Set `mustChangePassword=true` and revoke active sessions so the user must change password at next login |
