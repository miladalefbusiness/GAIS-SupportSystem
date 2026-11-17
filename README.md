# Organizational AI Support Desk & File Hub
### سامانه پشتیبانی هوشمند سازمانی و مخزن فایل اشتراکی

Self-hosted organizational support platform combining an **Enterprise CRAG Knowledge Desk**, **Customer Portal (National ID + Password Auth & Ticket Threads)**, **Operator Workspace**, **Departmental Shared File Hub**, and **Super Admin Console**.

---

## One-Command Installation (Production Linux VPS)

Run the official installer on **Ubuntu 22.04+/24.04, Debian 12+, Rocky/AlmaLinux 9+, or Fedora** (no manual Node.js, PostgreSQL, or Docker setup required):

### Option 1 — Direct from Your GitHub Repository (`main` branch)

Replace `<GITHUB_USER>/<REPO>` with your GitHub repository slug:

```bash
curl -fsSL https://raw.githubusercontent.com/<GITHUB_USER>/<REPO>/main/install.sh | sudo bash -s -- --repo <GITHUB_USER>/<REPO>
```

### Option 2 — From a Tagged GitHub Release (SHA256-Verified Bundle + Prebuilt Image)

```bash
curl -fsSL https://github.com/<GITHUB_USER>/<REPO>/releases/latest/download/install.sh | sudo bash -s -- --repo <GITHUB_USER>/<REPO>
```

### Option 3 — From a Local Cloned Repository

```bash
git clone https://github.com/<GITHUB_USER>/<REPO>.git /opt/supportdesk-src
cd /opt/supportdesk-src
sudo bash install.sh --local --dir /opt/supportdesk
```

---

## What the Interactive Installer Prompts You For

When the one-command installer runs, it automatically verifies OS/arch, disk/RAM, ports `80`/`443`, installs Docker Engine + Compose v2 if missing, and launches a resumable interactive wizard asking for:

1. **Domain & Locale**:
   - Domain / subdomain (e.g. `support.example.com`, or `localhost` for local testing)
   - Public `APP_URL`, Timezone (`TZ`, default `Asia/Tehran`), Max Upload MB (`MAX_UPLOAD_MB`, default `25`)
2. **Automatic HTTPS (Caddy + Let's Encrypt)**:
   - ACME TLS notification email (`ACME_EMAIL`) — automatically issues and renews HTTPS certificates once DNS points to the server
3. **Initial Super Admin Account**:
   - `SUPERADMIN_USERNAME` (editable anytime later via CLI)
   - `SUPERADMIN_EMAIL` and Display Name (`SUPERADMIN_NAME`)
   - `SUPERADMIN_PASSWORD` (enter a custom password or auto-generate a strong one displayed once at completion)
4. **PostgreSQL + pgvector Database**:
   - **Bundled PostgreSQL 16 + pgvector** (recommended, internal Docker network only, auto-generated strong DB passwords)
   - **External PostgreSQL** (`SQL_HOST`, `SQL_PORT`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`)
5. **Enterprise RAG & AI Provider (Optional at Install)**:
   - Configure **Native Gemini** or any **OpenAI-compatible `AI_BASE_URL`**, API key (encrypted with `AES-256-GCM`), chat model, and embedding model — or skip and configure later in Super Admin UI or `supportdesk config`
6. **Optional Integrations**:
   - **SMTP**, **SMS OTP Webhook**, or **S3-compatible Object Storage**

All generated cryptographic secrets (`BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `APP_HMAC_KEY`) are written to `/opt/supportdesk/.env` with `chmod 600`. Migrations (`scripts/migrate.ts`), Super Admin bootstrap (`scripts/bootstrap.ts`), `/api/health/ready`, and `/usr/local/bin/supportdesk` are verified automatically before reporting success.

---

## Editing Super Admin Credentials & Variables via CLI

Once installed, the global `supportdesk` CLI is available anywhere on the host (`sudo supportdesk ...`):

### Interactive Configuration Editor (Domain, AI, SMTP/SMS, Super Admin)

```bash
supportdesk config
```

Select option **`4) Super Admin Credentials (Username, Email, Display Name & Password)`** to edit the Super Admin username, email, display name, or password interactively — or select options `1`–`3` to update `DOMAIN_NAME`, `APP_URL`, `TZ`, `MAX_UPLOAD_MB`, `ACME_EMAIL`, AI keys/models, SMTP, or SMS settings and apply them automatically.

### Direct CLI Commands for Super Admin & Staff Accounts

```bash
# List administrator accounts (password hashes are never shown)
supportdesk admin list

# Edit Super Admin username, email, display name, and/or password interactively
supportdesk admin update

# Or pass explicit flags directly:
supportdesk admin update --username superadmin --new-username owner_admin --email owner@example.com
supportdesk admin reset-password --username owner_admin --force-change

# Create another administrator, suspend/re-enable, or require password change
supportdesk admin create
supportdesk admin disable --username old_admin
supportdesk admin enable --username old_admin
supportdesk admin force-password-change --username owner_admin
```

> Changing a username or resetting a password automatically revokes active login sessions in PostgreSQL, updates `.env` bootstrap metadata when editing the primary Super Admin, and writes an audit log entry.

---

## Deploying & Publishing Releases via GitHub

1. **Push your repository to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial production release"
   git branch -M main
   git remote add origin https://github.com/<GITHUB_USER>/<REPO>.git
   git push -u origin main
   ```
2. **Publish a versioned GitHub Release (triggers `.github/workflows/release.yml`)**:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   GitHub Actions automatically:
   - Builds and pushes multi-arch (`linux/amd64`, `linux/arm64`) pinned Docker images to `ghcr.io/<github_user>/<repo>:0.1.0`
   - Packages `supportdesk-v0.1.0.tar.gz`, `release-manifest.json`, `install.sh`, and `SHA256SUMS` to the GitHub Release page
3. **Update an existing server to a new pinned release**:
   ```bash
   supportdesk update --check
   supportdesk update --version 0.2.0
   ```
   (`update` automatically takes a full `supportdesk backup --all` first, verifies SHA256 checksums, runs migrations, and rolls back automatically if `/api/health/ready` fails.)

---

## Everyday Operations & Documentation

| Guide | Topics Covered |
|---|---|
| [`INSTALL.md`](./INSTALL.md) | Server requirements, flags (`--repo`, `--branch`, `--version`, `--local`), and wizard flow |
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
