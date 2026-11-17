#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Organizational AI Support Desk & File Hub — Official Production Installer
# ==============================================================================
# Usage:
#   curl -fsSL https://YOUR-DOMAIN/install.sh | sudo bash
#   sudo bash install.sh [--version X.Y.Z] [--dir /opt/supportdesk] [--local]
# ==============================================================================

DEFAULT_INSTALL_DIR="/opt/supportdesk"
DEFAULT_RELEASE_BASE="https://github.com/your-org/supportdesk/releases/download"
DEFAULT_IMAGE_REPO="ghcr.io/your-org/supportdesk"
FALLBACK_VERSION="0.1.0"

INSTALL_DIR="${SUPPORTDESK_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
GITHUB_REPO="${SUPPORTDESK_GITHUB_REPO:-}"
GITHUB_BRANCH="${SUPPORTDESK_GITHUB_BRANCH:-main}"
RELEASE_BASE="${SUPPORTDESK_RELEASE_BASE:-$DEFAULT_RELEASE_BASE}"
IMAGE_REPO="${SUPPORTDESK_IMAGE_REPO:-$DEFAULT_IMAGE_REPO}"
TARGET_VERSION=""
LOCAL_MODE="false"
NON_INTERACTIVE="false"
SOURCE_FROM_GIT="false"
GENERATED_SUPERADMIN_PW=""

if [ -t 1 ]; then
  C_RESET='\033[0m'
  C_BLUE='\033[1;34m'
  C_GREEN='\033[0;32m'
  C_YELLOW='\033[1;33m'
  C_RED='\033[0;31m'
  C_BOLD='\033[1m'
else
  C_RESET='' C_BLUE='' C_GREEN='' C_YELLOW='' C_RED='' C_BOLD=''
fi

log()  { printf '%b[installer]%b %s\n' "$C_BLUE" "$C_RESET" "$1"; }
ok()   { printf '%b[installer][OK]%b %s\n' "$C_GREEN" "$C_RESET" "$1"; }
warn() { printf '%b[installer][WARN]%b %s\n' "$C_YELLOW" "$C_RESET" "$1" >&2; }
err()  { printf '%b[installer][ERROR]%b %s\n' "$C_RED" "$C_RESET" "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
SupportDesk Official Installer

Usage:
  install.sh [options]

Options:
  --repo <owner/repo>  GitHub repository slug (sets release download & GHCR image path automatically)
  --branch <name>      GitHub branch to clone if no published release tarball exists (default: main)
  --version <X.Y.Z>    Pin a specific release version (never 'latest')
  --dir <path>         Target installation directory (default: /opt/supportdesk)
  --registry <url>     Custom container image registry prefix (e.g. registry.example.com/org)
  --mirror <base_url>  Custom release artifact mirror base URL
  --local              Install from local repository directory without downloading from GitHub
  --non-interactive    Run unattended using existing .env or environment defaults
  -h, --help           Show this help message
EOF
}

apply_github_repo_defaults() {
  local repo="$1"
  if [ -n "$repo" ]; then
    local repo_lower
    repo_lower="$(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]')"
    if [ "$RELEASE_BASE" = "$DEFAULT_RELEASE_BASE" ]; then
      RELEASE_BASE="https://github.com/${repo}/releases/download"
    fi
    if [ "$IMAGE_REPO" = "$DEFAULT_IMAGE_REPO" ]; then
      IMAGE_REPO="ghcr.io/${repo_lower}"
    fi
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) GITHUB_REPO="${2:-}"; shift 2 ;;
    --branch) GITHUB_BRANCH="${2:-main}"; shift 2 ;;
    --version) TARGET_VERSION="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --registry) IMAGE_REPO="${2%/}/supportdesk"; shift 2 ;;
    --mirror) RELEASE_BASE="${2%/}"; shift 2 ;;
    --local) LOCAL_MODE="true"; shift ;;
    --non-interactive) NON_INTERACTIVE="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown option: $1 (use --help for usage)" ;;
  esac
done

apply_github_repo_defaults "$GITHUB_REPO"

if [ "$TARGET_VERSION" = "latest" ]; then
  err "Refusing 'latest' tag. Specify a pinned semantic version (e.g. --version 0.1.0)."
fi

# ==============================================================================
# Helper Functions
# ==============================================================================

tty_read() {
  local prompt="$1"
  local var_name="$2"
  local default="${3:-}"
  local input=""
  if [ "$NON_INTERACTIVE" = "true" ]; then
    printf -v "$var_name" '%s' "$default"
    return 0
  fi
  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$prompt" "$default" >/dev/tty
  else
    printf '%s: ' "$prompt" >/dev/tty
  fi
  IFS= read -r input </dev/tty || input=""
  if [ -z "$input" ]; then
    input="$default"
  fi
  printf -v "$var_name" '%s' "$input"
}

tty_read_secret() {
  local prompt="$1"
  local var_name="$2"
  local input=""
  if [ "$NON_INTERACTIVE" = "true" ]; then
    printf -v "$var_name" '%s' ""
    return 0
  fi
  printf '%s: ' "$prompt" >/dev/tty
  IFS= read -rs input </dev/tty || input=""
  printf '\n' >/dev/tty
  printf -v "$var_name" '%s' "$input"
}

generate_hex() {
  openssl rand -hex 32
}

generate_password() {
  local core
  core="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 14)"
  printf '%sA1!z' "$core"
}

validate_password_strength() {
  local pw="$1"
  [ "${#pw}" -ge 10 ] || return 1
  printf '%s' "$pw" | grep -q '[A-Za-z]' || return 1
  printf '%s' "$pw" | grep -q '[0-9]' || return 1
  return 0
}

get_env_val() {
  local env_path="$1"
  local key="$2"
  local default="${3:-}"
  if [ ! -f "$env_path" ]; then
    printf '%s' "$default"
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" "$env_path" | tail -n1 || true)"
  if [ -z "$line" ]; then
    printf '%s' "$default"
    return 0
  fi
  local val="${line#*=}"
  val="${val%\"}"
  val="${val#\"}"
  val="${val%\'}"
  val="${val#\'}"
  printf '%s' "$val"
}

set_env_val() {
  local env_path="$1"
  local key="$2"
  local val="$3"
  local tmp
  tmp="$(mktemp "${env_path}.tmp.XXXXXX")"
  chmod 600 "$tmp"
  cp "$env_path" "$tmp"
  K="$key" V="$val" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"]; found = 0 }
    index($0, k "=") == 1 { print k "=\"" v "\""; found = 1; next }
    { print }
    END { if (!found) print k "=\"" v "\"" }
  ' "$tmp" > "${tmp}.out"
  chmod 600 "${tmp}.out"
  mv "${tmp}.out" "$env_path"
  rm -f "$tmp"
}

save_state() {
  local state_file="${INSTALL_DIR}/.install-state"
  local key="$1"
  local val="$2"
  touch "$state_file"
  chmod 600 "$state_file"
  set_env_val "$state_file" "$key" "$val"
}

load_state() {
  local state_file="${INSTALL_DIR}/.install-state"
  local key="$1"
  local default="${2:-}"
  get_env_val "$state_file" "$key" "$default"
}

# ==============================================================================
# Step 1-7: Host Preflight & Prerequisite Checks
# ==============================================================================

preflight_checks() {
  log "1/8 Checking operating system, architecture, privileges & hardware..."

  local os_name arch_name
  os_name="$(uname -s)"
  [ "$os_name" = "Linux" ] || err "Unsupported OS '$os_name'. Linux is required."

  arch_name="$(uname -m)"
  case "$arch_name" in
    x86_64|amd64|aarch64|arm64) ;;
    *) err "Unsupported CPU architecture '$arch_name'. Supported: x86_64 (amd64), aarch64 (arm64)." ;;
  esac

  if [ "$(id -u)" -ne 0 ]; then
    err "Root privileges are required. Re-run with: sudo bash install.sh"
  fi

  local distro_id="unknown" distro_ver="unknown"
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    distro_id="${ID:-unknown}"
    distro_ver="${VERSION_ID:-unknown}"
  fi

  case "$distro_id" in
    ubuntu|debian|rocky|almalinux|rhel|centos|fedora)
      ok "Detected Linux distro: ${distro_id} ${distro_ver} (${arch_name})"
      ;;
    *)
      warn "Distribution '${distro_id}' is not in the tested tier (Ubuntu/Debian/RHEL-family). Continuing cautiously."
      ;;
  esac

  # Disk space check (>= 5 GB free recommended)
  local parent_dir avail_kb avail_gb
  parent_dir="$(dirname "$INSTALL_DIR")"
  mkdir -p "$parent_dir"
  avail_kb="$(df -Pk "$parent_dir" | awk 'NR==2 {print $4}')"
  avail_gb="$((avail_kb / 1024 / 1024))"
  if [ "$avail_kb" -lt 3145728 ]; then
    err "Insufficient free disk space on ${parent_dir}: ~${avail_gb}GB free (minimum 3GB, recommended >= 5GB)."
  elif [ "$avail_kb" -lt 5242880 ]; then
    warn "Low disk space on ${parent_dir}: ~${avail_gb}GB free (recommended >= 5GB)."
  else
    ok "Disk space check passed (~${avail_gb}GB free)."
  fi

  # Memory check (>= 1500 MB recommended)
  if [ -r /proc/meminfo ]; then
    local mem_kb mem_mb
    mem_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
    mem_mb="$((mem_kb / 1024))"
    if [ "$mem_mb" -lt 950 ]; then
      err "Insufficient RAM (${mem_mb}MB detected). Minimum 1GB RAM (2GB+ recommended) required."
    elif [ "$mem_mb" -lt 1800 ]; then
      warn "Detected ${mem_mb}MB RAM. 2GB+ RAM is recommended for PDF/DOCX RAG indexing."
    else
      ok "Memory check passed (${mem_mb}MB RAM)."
    fi
  fi

  # Port 80 / 443 check
  if command -v ss >/dev/null 2>&1; then
    local busy_ports=""
    for p in 80 443; do
      if ss -ltnH "sport = :$p" 2>/dev/null | grep -q ":$p"; then
        busy_ports="${busy_ports} ${p}"
      fi
    done
    if [ -n "$busy_ports" ]; then
      warn "Port(s)${busy_ports} already in use. Ensure no conflicting nginx/apache/caddy occupies ports 80/443 unless upgrading existing SupportDesk."
    else
      ok "Ports 80 and 443 are available."
    fi
  fi
}

install_host_packages() {
  log "2/8 Checking required host packages & Docker Engine..."

  local missing_pkgs=()
  for bin in curl openssl tar gzip; do
    command -v "$bin" >/dev/null 2>&1 || missing_pkgs+=("$bin")
  done

  if [ "${#missing_pkgs[@]}" -gt 0 ]; then
    log "Installing missing system packages: ${missing_pkgs[*]}..."
    if command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing_pkgs[@]}" ca-certificates gnupg
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y -q "${missing_pkgs[@]}" ca-certificates
    elif command -v yum >/dev/null 2>&1; then
      yum install -y -q "${missing_pkgs[@]}" ca-certificates
    else
      err "Cannot automatically install missing packages (${missing_pkgs[*]}). Install them manually and re-run."
    fi
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "Docker not found. Installing official Docker Engine & Compose plugin..."
    if command -v apt-get >/dev/null 2>&1; then
      . /etc/os-release
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/${ID}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
      DEBIAN_FRONTEND=noninteractive apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    elif command -v dnf >/dev/null 2>&1; then
      dnf -y install dnf-plugins-core
      dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
      dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    else
      err "Automatic Docker installation is unsupported on this OS. Install Docker Engine + Compose v2 manually."
    fi
    systemctl enable --now docker || true
  fi

  if command -v systemctl >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
    systemctl start docker || true
  fi

  docker info >/dev/null 2>&1 || err "Docker daemon is not running or inaccessible."
  docker compose version >/dev/null 2>&1 || err "Docker Compose v2 plugin is required ('docker compose version' failed)."
  ok "Docker Engine and Docker Compose v2 are ready."
}

# ==============================================================================
# Step 8-12: Release Download, Checksum Verification & Directory Prep
# ==============================================================================

resolve_target_version() {
  if [ -n "$TARGET_VERSION" ]; then
    printf '%s' "$TARGET_VERSION"
    return 0
  fi

  local script_dir=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    script_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi

  if [ "$LOCAL_MODE" = "true" ] && [ -n "$script_dir" ] && [ -f "${script_dir}/package.json" ]; then
    grep '"version"' "${script_dir}/package.json" | head -n1 | sed -E 's/.*"version": *"([^"]+)".*/\1/'
    return 0
  fi

  if [ -f "${INSTALL_DIR}/.env" ]; then
    local existing_ver
    existing_ver="$(get_env_val "${INSTALL_DIR}/.env" APP_VERSION "")"
    if [ -n "$existing_ver" ]; then
      printf '%s' "$existing_ver"
      return 0
    fi
  fi

  local api_url latest_ver=""
  api_url="$(printf '%s' "$RELEASE_BASE" | sed -E 's|https://github.com/([^/]+/[^/]+)/releases/download|https://api.github.com/repos/\1/releases/latest|')"
  if [ "$api_url" != "$RELEASE_BASE" ]; then
    latest_ver="$(curl -fsSL --max-time 6 "$api_url" 2>/dev/null | grep '"tag_name"' | head -n1 | sed -E 's/.*"tag_name": *"v?([^"]+)".*/\1/' || true)"
  fi
  if [ -n "$latest_ver" ] && [ "$latest_ver" != "latest" ]; then
    printf '%s' "$latest_ver"
  else
    printf '%s' "$FALLBACK_VERSION"
  fi
}

prepare_release_files() {
  log "3/8 Preparing application release in ${INSTALL_DIR}..."
  mkdir -p "$INSTALL_DIR" "${INSTALL_DIR}/data/storage" "${INSTALL_DIR}/backups"
  chmod 750 "${INSTALL_DIR}/data/storage"
  chmod 700 "${INSTALL_DIR}/backups"

  TARGET_VERSION="$(resolve_target_version)"

  local script_dir=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    script_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi

  if [ "$LOCAL_MODE" = "true" ]; then
    [ -n "$script_dir" ] || err "--local requires running install.sh from the repository directory."
    log "Target release version: v${TARGET_VERSION}"
    if [ "$script_dir" != "$INSTALL_DIR" ]; then
      log "Copying local release files from ${script_dir} to ${INSTALL_DIR} (preserving .env, data/, backups/)..."
      tar -C "$script_dir" \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='.next' \
        --exclude='.env' \
        --exclude='data' \
        --exclude='backups' \
        --exclude='tsconfig.tsbuildinfo' \
        -cf - . | tar -C "$INSTALL_DIR" -xf -
    fi
  else
    if [ -z "$GITHUB_REPO" ] && [ "$RELEASE_BASE" = "$DEFAULT_RELEASE_BASE" ]; then
      if [ "$NON_INTERACTIVE" = "true" ]; then
        err "Specify --repo <owner/repo> or --mirror <url> or --local when running non-interactively."
      fi
      printf '\n' >/dev/tty
      tty_read "GitHub repository (owner/repo, e.g. myuser/supportdesk)" GITHUB_REPO ""
      [ -n "$GITHUB_REPO" ] || err "GitHub repository (owner/repo) is required when not using --local."
      apply_github_repo_defaults "$GITHUB_REPO"
      TARGET_VERSION="$(resolve_target_version)"
    fi

    log "Target release version: v${TARGET_VERSION}"
    local stage_dir tarball sums_file tarball_name
    stage_dir="$(mktemp -d)"
    trap 'rm -rf "$stage_dir"' RETURN
    tarball_name="supportdesk-v${TARGET_VERSION}.tar.gz"
    tarball="${stage_dir}/${tarball_name}"
    sums_file="${stage_dir}/SHA256SUMS"

    log "Checking published GitHub Release bundle at ${RELEASE_BASE}/v${TARGET_VERSION}/${tarball_name}..."
    if curl -fsSL "${RELEASE_BASE}/v${TARGET_VERSION}/${tarball_name}" -o "$tarball" 2>/dev/null \
      && curl -fsSL "${RELEASE_BASE}/v${TARGET_VERSION}/SHA256SUMS" -o "$sums_file" 2>/dev/null; then
      (
        cd "$stage_dir"
        grep -E "[[:space:]](\./)?${tarball_name}$" SHA256SUMS > tarball.sha256 \
          || err "No checksum entry for ${tarball_name} in SHA256SUMS."
        sha256sum -c tarball.sha256 >/dev/null
      ) || err "Release archive checksum verification FAILED!"
      ok "Release SHA256 integrity verified."
      tar -xzf "$tarball" -C "$INSTALL_DIR"
    elif [ -n "$GITHUB_REPO" ]; then
      warn "No published release archive found at ${RELEASE_BASE}/v${TARGET_VERSION}; cloning https://github.com/${GITHUB_REPO}.git (branch: ${GITHUB_BRANCH}) and building container locally..."
      if ! command -v git >/dev/null 2>&1; then
        if command -v apt-get >/dev/null 2>&1; then
          DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git
        elif command -v dnf >/dev/null 2>&1; then
          dnf install -y -q git
        elif command -v yum >/dev/null 2>&1; then
          yum install -y -q git
        else
          err "git is required to clone https://github.com/${GITHUB_REPO}.git"
        fi
      fi
      git clone --depth 1 --branch "$GITHUB_BRANCH" "https://github.com/${GITHUB_REPO}.git" "${stage_dir}/src" \
        || err "Failed to clone https://github.com/${GITHUB_REPO}.git (branch: ${GITHUB_BRANCH})."
      if [ -f "${stage_dir}/src/package.json" ]; then
        TARGET_VERSION="$(grep '"version"' "${stage_dir}/src/package.json" | head -n1 | sed -E 's/.*"version": *"([^"]+)".*/\1/' || echo "$TARGET_VERSION")"
      fi
      tar -C "${stage_dir}/src" \
        --exclude='.git' \
        --exclude='.env' \
        --exclude='data' \
        --exclude='backups' \
        -cf - . | tar -C "$INSTALL_DIR" -xf -
      SOURCE_FROM_GIT="true"
      ok "Cloned repository source into ${INSTALL_DIR} (version ${TARGET_VERSION})."
    else
      err "Failed to download release archive from ${RELEASE_BASE}/v${TARGET_VERSION}/${tarball_name}. Provide --repo <owner/repo> or --local."
    fi

    rm -rf "$stage_dir"
    trap - RETURN
  fi

  chmod +x "${INSTALL_DIR}/bin/supportdesk" "${INSTALL_DIR}/docker/"*.sh 2>/dev/null || true
  if [ -f "${INSTALL_DIR}/install.sh" ]; then
    chmod +x "${INSTALL_DIR}/install.sh"
  fi
  ln -sf "${INSTALL_DIR}/bin/supportdesk" /usr/local/bin/supportdesk
  ok "Installed global CLI command: /usr/local/bin/supportdesk"
}

# ==============================================================================
# Step 13-15: Resumable Interactive Setup Wizard & .env Creation
# ==============================================================================

check_domain_dns() {
  local domain="$1"
  if [ "$domain" = "localhost" ] || [[ "$domain" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    return 0
  fi
  local resolved_ips="" public_ip=""
  resolved_ips="$(getent ahosts "$domain" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
  public_ip="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$resolved_ips" ]; then
    warn "DNS lookup for '${domain}' returned no records yet. Ensure an A/AAAA record points to this server before Caddy requests HTTPS certificates."
  elif [ -n "$public_ip" ] && ! printf '%s' "$resolved_ips" | grep -qw "$public_ip"; then
    warn "Domain '${domain}' resolves to (${resolved_ips}), while server public IP appears to be ${public_ip}. Verify DNS and ports 80/443."
  else
    ok "DNS resolution for '${domain}' verified (${resolved_ips})."
  fi
}

run_setup_wizard() {
  log "4/8 Running production configuration wizard..."

  local env_file="${INSTALL_DIR}/.env"
  local use_existing_env="false"

  if [ -f "$env_file" ]; then
    if [ "$NON_INTERACTIVE" = "true" ]; then
      use_existing_env="true"
      ok "Preserving existing ${env_file} (non-interactive mode)."
    else
      warn "Existing configuration detected at ${env_file}."
      local answer=""
      tty_read "Keep existing .env configuration and resume/apply without overwriting? (yes/no)" answer "yes"
      if [ "$answer" = "yes" ] || [ "$answer" = "y" ]; then
        use_existing_env="true"
        ok "Preserving existing ${env_file}."
      else
        cp "$env_file" "${env_file}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
        chmod 600 "${env_file}.bak."*
      fi
    fi
  fi

  if [ "$use_existing_env" = "true" ]; then
    set_env_val "$env_file" APP_VERSION "$TARGET_VERSION"
    chmod 600 "$env_file"
    return 0
  fi

  cp "${INSTALL_DIR}/.env.example" "$env_file"
  chmod 600 "$env_file"

  # Defaults / state resume (non-secret values only)
  local domain app_url tz max_upload_mb acme_email db_mode
  local sql_host sql_port sql_db sql_user sql_pass sql_admin_user sql_admin_pass
  local super_user super_email super_name super_pw_mode super_pw super_pw_confirm
  local ai_now ai_base_url ai_key ai_chat_model ai_embed_model
  local cfg_extra smtp_host smtp_port smtp_user smtp_pass smtp_from otp_mode sms_url sms_key storage_drv s3_ep s3_reg s3_bkt s3_ak s3_sk

  domain="$(load_state WIZ_DOMAIN "localhost")"
  tz="$(load_state WIZ_TZ "Asia/Tehran")"
  max_upload_mb="$(load_state WIZ_MAX_UPLOAD "25")"
  acme_email="$(load_state WIZ_ACME_EMAIL "")"
  db_mode="$(load_state WIZ_DB_MODE "bundled")"
  super_user="$(load_state WIZ_SUPER_USER "superadmin")"
  super_email="$(load_state WIZ_SUPER_EMAIL "admin@support.example.com")"
  super_name="$(load_state WIZ_SUPER_NAME "مدیر ارشد سامانه")"

  if [ "$NON_INTERACTIVE" != "true" ]; then
    printf '\n%b--- 1. Domain, URL & System Locale ---%b\n' "$C_BOLD" "$C_RESET" >/dev/tty
    tty_read "Domain or subdomain (use 'localhost' for local-only testing)" domain "$domain"
    save_state WIZ_DOMAIN "$domain"
    if [ "$domain" = "localhost" ]; then
      app_url="http://localhost:3000"
    else
      app_url="https://${domain}"
      check_domain_dns "$domain"
    fi
    tty_read "Public APP_URL" app_url "$app_url"
    tty_read "Timezone (TZ)" tz "$tz"
    save_state WIZ_TZ "$tz"
    tty_read "Max file upload size in MB" max_upload_mb "$max_upload_mb"
    save_state WIZ_MAX_UPLOAD "$max_upload_mb"

    if [ "$domain" != "localhost" ]; then
      printf '\n%b--- 2. Automatic HTTPS (Let'\''s Encrypt via Caddy) ---%b\n' "$C_BOLD" "$C_RESET" >/dev/tty
      printf 'Note: Ports 80 and 443 must reach this server and DNS must point to it.\n' >/dev/tty
      tty_read "ACME TLS certificate notification email (optional)" acme_email "${acme_email:-$super_email}"
      save_state WIZ_ACME_EMAIL "$acme_email"
    fi

    printf '\n%b--- 3. Initial Super Admin Account ---%b\n' "$C_BOLD" "$C_RESET" >/dev/tty
    tty_read "Super Admin username" super_user "$super_user"
    save_state WIZ_SUPER_USER "$super_user"
    tty_read "Super Admin email" super_email "$super_email"
    save_state WIZ_SUPER_EMAIL "$super_email"
    tty_read "Super Admin display name" super_name "$super_name"
    save_state WIZ_SUPER_NAME "$super_name"
    tty_read "Generate a strong random Super Admin password automatically? (yes/no)" super_pw_mode "yes"
    if [ "$super_pw_mode" = "no" ] || [ "$super_pw_mode" = "n" ]; then
      while true; do
        tty_read_secret "Enter Super Admin password (min 10 chars, letter + digit)" super_pw
        tty_read_secret "Confirm Super Admin password" super_pw_confirm
        if [ "$super_pw" != "$super_pw_confirm" ]; then
          warn "Passwords do not match. Please try again."
          continue
        fi
        if ! validate_password_strength "$super_pw"; then
          warn "Password does not satisfy minimum policy (10+ characters with at least 1 letter and 1 digit)."
          continue
        fi
        break
      done
    else
      super_pw="$(generate_password)"
      GENERATED_SUPERADMIN_PW="$super_pw"
    fi

    printf '\n%b--- 4. PostgreSQL Database Configuration ---%b\n' "$C_BOLD" "$C_RESET" >/dev/tty
    printf '  1) Bundled PostgreSQL 16 + pgvector container (Recommended)\n' >/dev/tty
    printf '  2) External PostgreSQL server (with pgvector + pg_trgm extensions)\n' >/dev/tty
    local db_choice="1"
    [ "$db_mode" = "external" ] && db_choice="2"
    tty_read "Database choice (1 or 2)" db_choice "$db_choice"
    if [ "$db_choice" = "2" ]; then
      db_mode="external"
      save_state WIZ_DB_MODE "external"
      tty_read "External PostgreSQL host" sql_host "127.0.0.1"
      tty_read "External PostgreSQL port" sql_port "5432"
      tty_read "Database name" sql_db "supportdesk"
      tty_read "Application DB username" sql_user "supportdesk_app"
      tty_read_secret "Application DB password" sql_pass
      tty_read "Migration/Admin DB username" sql_admin_user "$sql_user"
      tty_read_secret "Migration/Admin DB password (blank to reuse app DB password)" sql_admin_pass
      [ -z "$sql_admin_pass" ] && sql_admin_pass="$sql_pass"
    else
      db_mode="bundled"
      save_state WIZ_DB_MODE "bundled"
      sql_host="postgres"
      sql_port="5432"
      sql_db="supportdesk"
      sql_user="supportdesk_app"
      sql_pass="$(generate_hex)"
      sql_admin_user="supportdesk_admin"
      sql_admin_pass="$(generate_hex)"
    fi

    printf '\n%b--- 5. Enterprise RAG & AI Provider Settings ---%b\n' "$C_BOLD" "$C_RESET" >/dev/tty
    tty_read "Configure AI provider credentials now? (yes/no — can also be set later in Super Admin UI)" ai_now "no"
    if [ "$ai_now" = "yes" ] || [ "$ai_now" = "y" ]; then
      tty_read "AI Base URL (leave blank for native Google Gemini API, or enter OpenAI-compatible base URL)" ai_base_url ""
      tty_read_secret "AI API Key" ai_key
      if [ -n "$ai_base_url" ]; then
        tty_read "Chat Model" ai_chat_model "gpt-4o-mini"
        tty_read "Embedding Model (optional)" ai_embed_model "text-embedding-3-small"
      else
        tty_read "Gemini Chat Model" ai_chat_model "gemini-4-hydrogen"
        tty_read "Gemini Embedding Model (optional)" ai_embed_model "text-embedding-004"
      fi
    fi

    printf '\n%b--- 6. Optional Integrations (SMTP / SMS / S3 Storage) ---%b\n' "$C_BOLD" "$C_RESET" >/dev/tty
    tty_read "Configure SMTP, SMS webhook, or S3 storage now? (yes/no)" cfg_extra "no"
    if [ "$cfg_extra" = "yes" ] || [ "$cfg_extra" = "y" ]; then
      tty_read "SMTP Host (leave blank to skip)" smtp_host ""
      if [ -n "$smtp_host" ]; then
        tty_read "SMTP Port" smtp_port "587"
        tty_read "SMTP Username" smtp_user ""
        tty_read_secret "SMTP Password" smtp_pass
        tty_read "SMTP From Address" smtp_from "noreply@${domain}"
      fi
      tty_read "OTP Provider (disabled | sms_webhook)" otp_mode "disabled"
      if [ "$otp_mode" = "sms_webhook" ]; then
        tty_read "SMS Webhook URL" sms_url ""
        tty_read_secret "SMS API Key" sms_key
      fi
      tty_read "File Storage Driver (local | s3)" storage_drv "local"
      if [ "$storage_drv" = "s3" ]; then
        tty_read "S3 Endpoint URL" s3_ep ""
        tty_read "S3 Region" s3_reg "us-east-1"
        tty_read "S3 Bucket" s3_bkt ""
        tty_read "S3 Access Key ID" s3_ak ""
        tty_read_secret "S3 Secret Access Key" s3_sk
      fi
    fi
  else
    # Non-interactive secure defaults
    app_url="${APP_URL:-http://localhost:3000}"
    domain="${DOMAIN_NAME:-localhost}"
    db_mode="${DB_MODE:-bundled}"
    sql_host="${SQL_HOST:-postgres}"
    sql_port="${SQL_PORT:-5432}"
    sql_db="${SQL_DB_NAME:-supportdesk}"
    sql_user="${SQL_USER:-supportdesk_app}"
    sql_pass="${SQL_PASSWORD:-$(generate_hex)}"
    sql_admin_user="${SQL_ADMIN_USER:-supportdesk_admin}"
    sql_admin_pass="${SQL_ADMIN_PASSWORD:-$(generate_hex)}"
    super_pw="${SUPERADMIN_PASSWORD:-$(generate_password)}"
    GENERATED_SUPERADMIN_PW="$super_pw"
  fi

  # Write core & generated cryptographic secrets cleanly
  set_env_val "$env_file" NODE_ENV "production"
  set_env_val "$env_file" APP_VERSION "$TARGET_VERSION"
  set_env_val "$env_file" APP_IMAGE "$IMAGE_REPO"
  set_env_val "$env_file" RELEASE_BASE_URL "$RELEASE_BASE"
  set_env_val "$env_file" DOMAIN_NAME "${domain:-localhost}"
  set_env_val "$env_file" APP_URL "${app_url:-http://localhost:3000}"
  set_env_val "$env_file" ACME_EMAIL "${acme_email:-}"
  set_env_val "$env_file" TZ "${tz:-Asia/Tehran}"
  set_env_val "$env_file" MAX_UPLOAD_MB "${max_upload_mb:-25}"

  set_env_val "$env_file" DB_MODE "${db_mode:-bundled}"
  set_env_val "$env_file" SQL_HOST "$sql_host"
  set_env_val "$env_file" SQL_PORT "$sql_port"
  set_env_val "$env_file" SQL_DB_NAME "$sql_db"
  set_env_val "$env_file" SQL_USER "$sql_user"
  set_env_val "$env_file" SQL_PASSWORD "$sql_pass"
  set_env_val "$env_file" SQL_ADMIN_USER "$sql_admin_user"
  set_env_val "$env_file" SQL_ADMIN_PASSWORD "$sql_admin_pass"
  set_env_val "$env_file" POSTGRES_DB "$sql_db"
  set_env_val "$env_file" POSTGRES_USER "$sql_admin_user"
  set_env_val "$env_file" POSTGRES_PASSWORD "$sql_admin_pass"

  set_env_val "$env_file" BETTER_AUTH_SECRET "$(generate_hex)"
  set_env_val "$env_file" APP_ENCRYPTION_KEY "$(generate_hex)"
  set_env_val "$env_file" APP_HMAC_KEY "$(generate_hex)"

  set_env_val "$env_file" SUPERADMIN_USERNAME "${super_user:-superadmin}"
  set_env_val "$env_file" SUPERADMIN_EMAIL "${super_email:-admin@support.example.com}"
  set_env_val "$env_file" SUPERADMIN_NAME "${super_name:-مدیر ارشد سامانه}"
  set_env_val "$env_file" SUPERADMIN_PASSWORD "$super_pw"

  if [ -n "${ai_base_url:-}" ]; then set_env_val "$env_file" AI_BASE_URL "$ai_base_url"; fi
  if [ -n "${ai_key:-}" ]; then
    if [ -n "${ai_base_url:-}" ]; then
      set_env_val "$env_file" AI_API_KEY "$ai_key"
    else
      set_env_val "$env_file" GEMINI_API_KEY "$ai_key"
    fi
  fi
  if [ -n "${ai_chat_model:-}" ]; then set_env_val "$env_file" AI_CHAT_MODEL "$ai_chat_model"; fi
  if [ -n "${ai_embed_model:-}" ]; then set_env_val "$env_file" AI_EMBEDDING_MODEL "$ai_embed_model"; fi

  if [ -n "${smtp_host:-}" ]; then
    set_env_val "$env_file" SMTP_HOST "$smtp_host"
    set_env_val "$env_file" SMTP_PORT "${smtp_port:-587}"
    set_env_val "$env_file" SMTP_USER "${smtp_user:-}"
    set_env_val "$env_file" SMTP_PASSWORD "${smtp_pass:-}"
    set_env_val "$env_file" SMTP_FROM "${smtp_from:-}"
  fi
  if [ "${otp_mode:-disabled}" = "sms_webhook" ]; then
    set_env_val "$env_file" OTP_PROVIDER "sms_webhook"
    set_env_val "$env_file" OTP_SMS_WEBHOOK_URL "${sms_url:-}"
    set_env_val "$env_file" OTP_SMS_API_KEY "${sms_key:-}"
  fi
  if [ "${storage_drv:-local}" = "s3" ]; then
    set_env_val "$env_file" STORAGE_DRIVER "s3"
    set_env_val "$env_file" S3_ENDPOINT "${s3_ep:-}"
    set_env_val "$env_file" S3_REGION "${s3_reg:-}"
    set_env_val "$env_file" S3_BUCKET "${s3_bkt:-}"
    set_env_val "$env_file" S3_ACCESS_KEY_ID "${s3_ak:-}"
    set_env_val "$env_file" S3_SECRET_ACCESS_KEY "${s3_sk:-}"
  fi

  chmod 600 "$env_file"
  ok "Generated production configuration at ${env_file} (mode 600)."
}

# ==============================================================================
# Step 16-24: Image Pull/Build, DB Init, Migrations, Bootstrap & Health Checks
# ==============================================================================

deploy_and_verify() {
  local env_file="${INSTALL_DIR}/.env"
  local db_mode
  db_mode="$(get_env_val "$env_file" DB_MODE bundled)"

  local compose_args=(-f "${INSTALL_DIR}/docker-compose.yml")
  if [ "$db_mode" = "external" ]; then
    compose_args+=(-f "${INSTALL_DIR}/docker-compose.external-db.yml")
  fi
  compose_args+=(--env-file "$env_file")

  log "5/8 Preparing container images (APP_VERSION=${TARGET_VERSION})..."
  if [ "$LOCAL_MODE" = "true" ] || [ "$SOURCE_FROM_GIT" = "true" ]; then
    docker compose "${compose_args[@]}" build app
  else
    if ! docker compose "${compose_args[@]}" pull app worker; then
      warn "Pre-built image pull failed; building image locally from source bundle..."
      docker compose "${compose_args[@]}" build app
    fi
  fi
  docker compose "${compose_args[@]}" pull proxy >/dev/null 2>&1 || true

  log "6/8 Validating production environment inside container..."
  docker compose "${compose_args[@]}" run --rm --no-deps -T -e VALIDATE_ENV_ON_START=false --entrypoint "" app \
    node ./node_modules/tsx/dist/cli.mjs ./scripts/env-check.ts

  log "7/8 Starting PostgreSQL, applying Drizzle migrations & initializing Super Admin..."
  if [ "$db_mode" != "external" ]; then
    docker compose "${compose_args[@]}" pull postgres >/dev/null 2>&1 || true
    docker compose "${compose_args[@]}" up -d postgres
    local pg_user pg_db count=0
    pg_user="$(get_env_val "$env_file" POSTGRES_USER supportdesk_admin)"
    pg_db="$(get_env_val "$env_file" POSTGRES_DB supportdesk)"
    until docker compose "${compose_args[@]}" exec -T postgres pg_isready -U "$pg_user" -d "$pg_db" >/dev/null 2>&1; do
      count=$((count + 1))
      [ "$count" -lt 30 ] || err "PostgreSQL did not become healthy within 60 seconds."
      sleep 2
    done
    ok "PostgreSQL is healthy."
  fi

  docker compose "${compose_args[@]}" run --rm --no-deps -T -e VALIDATE_ENV_ON_START=false --entrypoint "" app \
    node ./node_modules/tsx/dist/cli.mjs ./scripts/migrate.ts

  docker compose "${compose_args[@]}" run --rm --no-deps -T -e VALIDATE_ENV_ON_START=false --entrypoint "" app \
    node ./node_modules/tsx/dist/cli.mjs ./scripts/bootstrap.ts

  docker compose "${compose_args[@]}" run --rm --no-deps -T -e VALIDATE_ENV_ON_START=false --entrypoint "" app \
    node ./node_modules/tsx/dist/cli.mjs ./scripts/admin-cli.ts ai-sync || true

  log "8/8 Starting app, RAG background worker & HTTPS reverse proxy..."
  docker compose "${compose_args[@]}" up -d app worker proxy

  local retries=45 c=0
  while [ "$c" -lt "$retries" ]; do
    if docker compose "${compose_args[@]}" exec -T app wget -qO- http://127.0.0.1:3000/api/health/ready >/dev/null 2>&1; then
      break
    fi
    c=$((c + 1))
    sleep 2
  done
  [ "$c" -lt "$retries" ] || err "Application failed readiness check at /api/health/ready. Inspect logs via: supportdesk logs app"

  # Clear resumable install state ONLY after full verified readiness
  rm -f "${INSTALL_DIR}/.install-state"

  local domain app_url super_user
  domain="$(get_env_val "$env_file" DOMAIN_NAME localhost)"
  app_url="$(get_env_val "$env_file" APP_URL http://localhost:3000)"
  super_user="$(get_env_val "$env_file" SUPERADMIN_USERNAME superadmin)"

  printf '\n%b====================================================================%b\n' "$C_GREEN" "$C_RESET"
  printf '%b SupportDesk Installation Completed & Verified!%b\n' "$C_GREEN" "$C_RESET"
  printf '%b====================================================================%b\n' "$C_GREEN" "$C_RESET"
  printf '  Install Directory : %s\n' "$INSTALL_DIR"
  printf '  Pinned Version    : v%s\n' "$TARGET_VERSION"
  printf '  Public URL        : %s\n' "$app_url"
  printf '  Super Admin User  : %s\n' "$super_user"
  if [ -n "$GENERATED_SUPERADMIN_PW" ]; then
    printf '  Initial Password  : %s  (SAVE NOW — shown once; change on first login)\n' "$GENERATED_SUPERADMIN_PW"
  fi
  printf '\nUseful Management Commands:\n'
  printf '  supportdesk status         Show container states & readiness\n'
  printf '  supportdesk health         Run DB, worker, app & HTTPS checks\n'
  printf '  supportdesk config         Edit Domain, AI, SMTP/SMS, or Super Admin variables\n'
  printf '  supportdesk admin update   Edit Super Admin username, email, name, or password\n'
  printf '  supportdesk logs all       Stream live container logs\n'
  printf '  supportdesk backup --all   Create checksummed full backup\n'
  printf '  supportdesk help           Show all lifecycle commands\n'
  printf '%b====================================================================%b\n' "$C_GREEN" "$C_RESET"
}

main() {
  preflight_checks
  install_host_packages
  prepare_release_files
  run_setup_wizard
  deploy_and_verify
}

main "$@"
