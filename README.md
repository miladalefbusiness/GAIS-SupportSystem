# Organizational AI Support Desk & File Hub (`GAIS-SupportSystem`)
### سامانه پشتیبانی هوشمند سازمانی و مخزن فایل اشتراکی

Self-hosted organizational support platform combining an **Enterprise CRAG Knowledge Desk**, **Customer Portal (National ID + Password Auth & Ticket Threads)**, **Operator Workspace**, **Departmental Shared File Hub**, and **Super Admin Console**.

---

## One-Command Installation (Production Linux VPS)

Supports **Ubuntu 22.04+/24.04, Debian 12+, Rocky/AlmaLinux 9+, and Fedora** — no manual Node.js, PostgreSQL, or Docker setup required.

### Option 1 — Public Repository (One-Click Install)

```bash
curl -fsSL https://raw.githubusercontent.com/miladalefbusiness/GAIS-SupportSystem/main/install.sh | sudo bash
```

Or from a published GitHub Release:

```bash
curl -fsSL https://github.com/miladalefbusiness/GAIS-SupportSystem/releases/latest/download/install.sh | sudo bash
```

### Option 2 — Private Repository (with Read-Only GitHub Token)

While `miladalefbusiness/GAIS-SupportSystem` is private, pass a read-only GitHub PAT via `GITHUB_TOKEN`:

```bash
export GITHUB_TOKEN="YOUR_READONLY_GITHUB_TOKEN"
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://raw.githubusercontent.com/miladalefbusiness/GAIS-SupportSystem/main/install.sh \
  | sudo -E bash
```

*(Note: `GITHUB_TOKEN` is used only in memory during download/clone and is never written to `.env` or disk.)*

### Option 3 — From a Local Cloned Repository

```bash
git clone https://github.com/miladalefbusiness/GAIS-SupportSystem.git /opt/supportdesk-src
cd /opt/supportdesk-src
sudo bash install.sh --local --dir /opt/supportdesk
```

---

## Interactive Setup Wizard (What the Installer Prompts You For)

Running the installer performs system preflight checks, installs Docker Engine + Compose v2 if missing, verifies release integrity (`SHA256SUMS` when installing a tagged release, or clones `main` cleanly), and walks you through an interactive setup wizard:

1. **Domain & Locale**:
   - `DOMAIN_NAME` (e.g. `support.example.com`, or `localhost` for local testing)
   - `APP_URL`, Timezone (`TZ`, default `Asia/Tehran`), Max Upload Size (`MAX_UPLOAD_MB`, default `25`)
2. **Automatic HTTPS (Caddy + Let's Encrypt)**:
   - `ACME_EMAIL` for automatic TLS certificate issuance and renewal (ports `80`/`443`)
3. **Initial Super Admin Account**:
   - `SUPERADMIN_USERNAME` (editable anytime later via CLI)
   - `SUPERADMIN_EMAIL` & Display Name (`SUPERADMIN_NAME`)
   - `SUPERADMIN_PASSWORD` (set manually with strength check or auto-generate a strong password printed once at completion)
4. **PostgreSQL + `pgvector` Database**:
   - **Bundled PostgreSQL 16 + `pgvector`** (recommended, internal Docker network only, auto-generated strong passwords)
   - **External PostgreSQL** (`SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`)
5. **Enterprise RAG & AI Provider (Optional at Install)**:
   - Native Google Gemini or any OpenAI-compatible `AI_BASE_URL`, API key (encrypted via `AES-256-GCM`), chat model, and embedding model — or skip and configure later in Super Admin UI or `supportdesk config`
6. **Optional Integrations**:
   - **SMTP**, **SMS OTP Webhook**, or **S3-compatible Object Storage**

All generated cryptographic secrets (`BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `APP_HMAC_KEY`) are written to `/opt/supportdesk/.env` (`chmod 600`). Database migrations, Super Admin bootstrap, `/api/health/ready`, and `/usr/local/bin/supportdesk` are verified before reporting success.

---

## Editing Super Admin Credentials & Variables via CLI

Once installed, manage everything from anywhere on the server with `supportdesk`:

### Interactive Configuration Editor (`supportdesk config`)

```bash
supportdesk config
```

Select from the interactive menu:
- `1)` Domain, `APP_URL`, Timezone, Max Upload & ACME Email
- `2)` AI Provider Settings (Base URL, API Key, Chat & Embedding Models)
- `3)` Optional Integrations (SMTP / SMS Webhook / S3)
- `4)` **Super Admin Credentials (Username, Email, Display Name & Password)**
- `5)` Validate `.env` only

### Direct Administrator Commands (`supportdesk admin`)

```bash
# List administrator accounts (password hashes are never shown)
supportdesk admin list

# Edit Super Admin username, email, display name, and/or password interactively:
supportdesk admin update

# Or update directly with flags:
supportdesk admin update --username superadmin --new-username owner_admin --email owner@example.com
supportdesk admin reset-password --username owner_admin --force-change

# Create, suspend, re-enable, or require password change on next login:
supportdesk admin create
supportdesk admin disable --username old_admin
supportdesk admin enable --username old_admin
supportdesk admin force-password-change --username owner_admin
```

---

## Deploying & Publishing Tagged Releases on GitHub

Pushing a version tag automatically runs `.github/workflows/release.yml`, which builds multi-arch (`linux/amd64`, `linux/arm64`) images on `ghcr.io/miladalefbusiness/gais-supportsystem` and attaches `install.sh`, `supportdesk-v<VERSION>.tar.gz`, `release-manifest.json`, and `SHA256SUMS` to GitHub Releases:

```bash
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

Upgrade any running production server cleanly with automatic pre-update backup and rollback protection:

```bash
supportdesk update --check
supportdesk update --version 0.2.0
```

---

## Documentation Index

| Guide | Topics Covered |
|---|---|
| [`INSTALL.md`](./INSTALL.md) | Server requirements, public/private repo install flags (`--repo`, `--branch`, `--token`, `--version`, `--local`) |
| [`CLI.md`](./CLI.md) | Complete reference for `supportdesk status\|health\|config\|admin\|backup\|restore\|update\|repair\|reinstall\|reset` |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Multi-container Docker Compose architecture (`postgres`, `app`, `worker`, `proxy`) |
| [`UPDATE.md`](./UPDATE.md) | Pinned version upgrade workflow and rollback rules |
| [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md) | Checksummed backup bundles, retention pruning, and verified restore |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) | Ports `80`/`443`, Let's Encrypt HTTPS, locked-out admin recovery, RAG worker queue |
| [`SECURITY.md`](./SECURITY.md) | RBAC, AES-256-GCM secret/national-ID encryption, network isolation & CLI security |

---

## خلاصه فارسی و توسعه محلی (Local Development)

پلتفرم مستقل، امن و خودمیزبان شامل چهار فضای کاری یکپارچه:
1. **پورتال عمومی پشتیبانی مشتریان** (`/`)
2. **میز کار اپراتورها** (`/workspace`)
3. **مخزن فایل اشتراکی سازمانی** (`/workspace`)
4. **پنل مدیریت ارشد (Super Admin)** (`/workspace`)

```bash
npm install
cp .env.example .env
# مقداردهی متغیرهای SQL_* و BETTER_AUTH_SECRET و SUPERADMIN_* در .env
npm run db:generate
npm run db:migrate
npm run db:bootstrap
npm run check
npm run dev
```
