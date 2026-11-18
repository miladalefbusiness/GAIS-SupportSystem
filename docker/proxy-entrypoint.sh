#!/bin/sh
set -eu

TEMPLATE="/etc/caddy/Caddyfile.template"
OUT="/tmp/Caddyfile"

if [ -n "${ACME_EMAIL:-}" ]; then
  GLOBAL_BLOCK="{
  email ${ACME_EMAIL}
}"
else
  GLOBAL_BLOCK=""
fi

awk -v blk="$GLOBAL_BLOCK" '{gsub(/__GLOBAL_OPTIONS__/, blk); print}' "$TEMPLATE" > "$OUT"
exec caddy run --config "$OUT" --adapter caddyfile
