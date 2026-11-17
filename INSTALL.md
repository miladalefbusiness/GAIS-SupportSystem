# Installation Guide (`INSTALL.md`)

## Supported Server Requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| Operating System | Ubuntu 22.04+, Debian 12+, Rocky/AlmaLinux 9+, Fedora | Ubuntu 24.04 LTS |
| CPU Architecture | `x86_64` (`amd64`) or `aarch64` (`arm64`) | 2+ vCPU |
| RAM | 1.5 GB | 2–4 GB (for PDF/DOCX/XLSX RAG ingestion) |
| Free Disk Space | 5 GB | 20+ GB SSD (DB + uploaded files + backups) |
| Open Inbound Ports | `80/tcp`, `443/tcp`, `443/udp` | Direct A/AAAA DNS record pointing to server IP |

> You do **not** need to pre-install Node.js, PostgreSQL, Caddy, or Python on the host. `install.sh` checks and installs Docker Engine and Docker Compose v2 automatically on supported Linux distributions.

---

## Option A: One-Command Installation from GitHub (`main` branch)

Works immediately (automatically falls back to cloning `--branch main` and building the pinned container image if no Release bundle is published yet):

```bash
# Public repository:
curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/GAIS-SupportSystem/main/install.sh | sudo bash

# Private repository (token is kept in memory only, never saved to .env):
export GITHUB_TOKEN="YOUR_READONLY_GITHUB_TOKEN"
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://raw.githubusercontent.com/miladalefbusiness/GAIS-SupportSystem/main/install.sh \
  | sudo -E bash
```

## Option B: One-Command Installation from a Tagged GitHub Release

Downloads the `SHA256SUMS`-verified `supportdesk-vX.Y.Z.tar.gz` release bundle and pulls the prebuilt multi-arch `ghcr.io` image:

```bash
curl -fsSL https://github.com/miladalefbusiness/GAIS-SupportSystem/releases/latest/download/install.sh | sudo bash -s -- --version 0.1.0
```

## Option C: Installing from a Local Cloned Repository

```bash
git clone https://github.com/miladalefbusiness/GAIS-SupportSystem.git /opt/supportdesk-src
cd /opt/supportdesk-src
sudo bash install.sh --local --dir /opt/supportdesk
```

For unattended deployments with a pre-configured `/opt/supportdesk/.env`:

```bash
sudo bash install.sh --local --dir /opt/supportdesk --non-interactive
```

### Installer CLI Options

| Flag | Description |
|---|---|
| `--repo <owner/repo>` | GitHub repository slug (default: `miladalefbusiness/GAIS-SupportSystem`) |
| `--branch <name>` | Branch to clone when no published release tarball exists (default: `main`) |
| `--token <pat>` | Optional GitHub token for private repositories (also reads `GITHUB_TOKEN` env) |
| `--version <X.Y.Z>` | Pin a specific release version (refuses `latest`) |
| `--dir <path>` | Target installation directory (default: `/opt/supportdesk`) |
| `--registry <url>` | Custom container image registry mirror prefix |
| `--mirror <base_url>` | Custom release artifact mirror base URL |
| `--local` | Install from the local directory without downloading from GitHub |
| `--non-interactive` | Skip interactive prompts using existing `.env` or environment defaults |

---

## What `install.sh` Performs

1. **System Preflight Checks**: Verifies Linux OS, `amd64`/`arm64` architecture, `root`/`sudo`, minimum disk space and RAM, and checks ports `80`/`443`.
2. **Host Prerequisites**: Installs `curl`, `openssl`, `tar`, `gzip`, `ca-certificates`, `gnupg`, Docker Engine, and the Docker Compose v2 plugin if missing.
3. **Source / Release Acquisition**:
   - Checks `${RELEASE_BASE}/v${VERSION}/supportdesk-v${VERSION}.tar.gz` + `SHA256SUMS` and runs `sha256sum -c` before extraction.
   - If no GitHub Release tarball exists yet on `--repo`, cleanly clones the specified GitHub branch (`--branch`, default `main`) and builds the pinned container image locally.
4. **Global CLI Symlink**: Links `/usr/local/bin/supportdesk` so `supportdesk <command>` works from any directory.
5. **Resumable Setup Wizard**: Saves non-secret prompt answers in `.install-state` (`chmod 600`, deleted automatically after installation finishes) and prompts via `/dev/tty` for:
   - Domain / subdomain (`DOMAIN_NAME`) and public URL (`APP_URL`), timezone (`TZ`), upload limit (`MAX_UPLOAD_MB`)
   - ACME certificate email (`ACME_EMAIL`) for Caddy Let's Encrypt HTTPS
   - Initial Super Admin username, email, display name, and password (manual with strength check or randomly generated once)
   - Database mode: **Bundled PostgreSQL 16 + `pgvector`** (default, auto-generated strong passwords) or **External PostgreSQL** (`pgvector` + `pg_trgm` required)
   - Optional AI provider credentials (native Gemini or OpenAI-compatible `AI_BASE_URL`, encrypted into PostgreSQL via `admin-cli.ts ai-sync`)
   - Optional SMTP, SMS webhook (`OTP_PROVIDER=sms_webhook`), or S3 storage (`STORAGE_DRIVER=s3`)
6. **Environment Generation & Validation**: Generates 64-hex cryptographic secrets (`BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `APP_HMAC_KEY`), writes `.env` (`chmod 600`), never overwrites an existing `.env` without confirmation, and validates via `scripts/env-check.ts`.
7. **Database, Migrations & Bootstrap**: Starts PostgreSQL (`pg_isready`), runs `scripts/migrate.ts` (ensures `vector` & `pg_trgm` extensions + Drizzle migrations), runs `scripts/bootstrap.ts` (Super Admin & RBAC), and syncs AI settings.
8. **Service Startup & Readiness Check**: Starts `app`, `worker`, and `proxy`, then polls `http://127.0.0.1:3000/api/health/ready` before printing the final summary and management commands (`supportdesk config`, `supportdesk admin update`, etc.).
