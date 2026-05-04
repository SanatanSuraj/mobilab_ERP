#!/usr/bin/env bash
#
# Apply the bootstrap SQL layer (init + triggers + roles + rls + seed)
# against a managed Postgres (Neon, Supabase, RDS, …). This is the
# managed-services equivalent of apply-to-running.sh, which only works
# against a local Docker container.
#
# Use case: spinning up a fresh production database on a managed provider.
# Run this ONCE before pnpm migrate:prod.
#
# Usage:
#   PG_URL="postgresql://USER:PWD@HOST/DB?sslmode=require" \
#       bash ops/sql/apply-to-managed.sh
#
# Or, with the .env already on disk:
#   set -a; . ops/compose/.env; set +a
#   PG_URL="$DATABASE_DIRECT_URL" bash ops/sql/apply-to-managed.sh
#
# Important:
#   - PG_URL MUST be the DIRECT URL (not pooled). Several SQL files run
#     pl/pgsql DO blocks and CREATE EXTENSION which need a stable session;
#     PgBouncer-style poolers will rotate the backend mid-statement.
#   - Idempotent: every file uses CREATE … IF NOT EXISTS / DROP … IF EXISTS
#     / ON CONFLICT … so re-runs are safe.
#   - SEED_ONLY=1 to apply only the seed/ layer (mirrors apply-to-running.sh).

set -euo pipefail

if [ -z "${PG_URL:-}" ]; then
  echo "[apply] error: PG_URL not set." >&2
  echo "[apply] usage: PG_URL=postgresql://... bash $0" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "[apply] error: psql not found on PATH." >&2
  echo "[apply] install with: sudo apt-get install -y postgresql-client" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_ONLY="${SEED_ONLY:-0}"

# Redact password for log output.
redact() {
  echo "$1" | sed -E 's#(://[^:]+:)[^@]+(@)#\1***\2#'
}

echo "[apply] target = $(redact "$PG_URL")"

apply_one() {
  local file="$1" label="$2"
  echo "[apply] $label: $(basename "$file")"
  psql "$PG_URL" \
    --set ON_ERROR_STOP=1 \
    --no-psqlrc \
    --quiet \
    -f "$file"
}

apply_dir() {
  local dir="$1" label="$2"
  if [ ! -d "$dir" ]; then
    echo "[apply] $label: $dir missing, skipping"
    return 0
  fi
  local found=0
  for f in "$dir"/*.sql; do
    [ -f "$f" ] || continue
    found=1
    apply_one "$f" "$label"
  done
  if [ "$found" -eq 0 ]; then
    echo "[apply] $label: no .sql files in $dir"
  fi
}

if [ "$SEED_ONLY" != "1" ]; then
  apply_dir "$SCRIPT_DIR/init"     "init"
  apply_dir "$SCRIPT_DIR/triggers" "triggers"

  # Roles BEFORE rls — several rls files GRANT to instigenie_app /
  # instigenie_vendor, which don't exist on a fresh cluster otherwise.
  for role_file in \
    "$SCRIPT_DIR/seed/99-app-role.sql" \
    "$SCRIPT_DIR/seed/98-vendor-role.sql" ; do
    [ -f "$role_file" ] || continue
    apply_one "$role_file" "roles"
  done

  apply_dir "$SCRIPT_DIR/rls" "rls"
fi
apply_dir "$SCRIPT_DIR/seed" "seed"

echo "[apply] done — next: pnpm migrate:prod"
