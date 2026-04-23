#!/usr/bin/env bash
#
# Apply schema + seed SQL against the already-running dev Postgres
# container. This is the post-bootstrap companion to 00-apply-all.sh.
#
# ─── Why this script exists ──────────────────────────────────────────
# Postgres' `docker-entrypoint.sh` runs files in
# /docker-entrypoint-initdb.d/ **only on first start** (empty data dir).
# Once the volume is initialised, adding a new DDL file or updating a
# seed doesn't replay automatically — the container skips initdb on
# subsequent boots. Options then are:
#
#   (a) `pnpm infra:reset && pnpm infra:up`  — wipes the volume, loses
#       local test data. Heavy-handed for a seed change.
#   (b) Manually `docker exec -i … psql -f …` each changed file.
#   (c) This script — replays the same layered order 00-apply-all.sh
#       uses, but against a running container. Every SQL file in the
#       tree is idempotent (CREATE … IF NOT EXISTS / DROP … IF EXISTS /
#       ON CONFLICT … DO UPDATE), so a full replay is safe.
#
# ─── Usage ────────────────────────────────────────────────────────────
#   pnpm db:migrate        # init + triggers + rls + seed
#   pnpm db:seed           # seed/ only (fast; for gate-51-style drift)
#
# Env overrides:
#   PG_CONTAINER    container name (default: instigenie-postgres)
#   POSTGRES_DB     database       (default: instigenie)
#   POSTGRES_USER   user           (default: instigenie)
#   SEED_ONLY=1     seed layer only
#
# ─── Idempotency guarantees (verified) ────────────────────────────────
#   init/      — CREATE TABLE IF NOT EXISTS everywhere; phase-4 files
#                use ALTER … ADD COLUMN IF NOT EXISTS.
#   triggers/  — DROP TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION.
#   rls/       — DROP POLICY IF EXISTS before CREATE POLICY;
#                DROP FUNCTION IF EXISTS before CREATE in auth helpers.
#   seed/      — INSERT … ON CONFLICT (id) DO UPDATE / DO NOTHING.

set -euo pipefail

CONTAINER="${PG_CONTAINER:-instigenie-postgres}"
DB="${POSTGRES_DB:-instigenie}"
DB_USER="${POSTGRES_USER:-instigenie}"
SEED_ONLY="${SEED_ONLY:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "[apply] error: docker not found on PATH." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[apply] error: container '$CONTAINER' is not running. Start it with 'pnpm infra:up'." >&2
  exit 1
fi

apply_dir() {
  local dir="$1"
  local label="$2"
  if [ ! -d "$dir" ]; then
    echo "[apply] $label: $dir missing, skipping"
    return 0
  fi
  local found=0
  for f in "$dir"/*.sql; do
    [ -f "$f" ] || continue
    found=1
    echo "[apply] $label: $(basename "$f")"
    docker exec -i "$CONTAINER" psql \
      --username "$DB_USER" --dbname "$DB" \
      --set ON_ERROR_STOP=1 --no-psqlrc --quiet < "$f"
  done
  if [ "$found" -eq 0 ]; then
    echo "[apply] $label: no .sql files in $dir"
  fi
}

run_sql() {
  local file="$1"
  local label="$2"
  echo "[apply] $label: $(basename "$file")"
  docker exec -i "$CONTAINER" psql \
    --username "$DB_USER" --dbname "$DB" \
    --set ON_ERROR_STOP=1 --no-psqlrc --quiet < "$file"
}

if [ "$SEED_ONLY" != "1" ]; then
  apply_dir "$SCRIPT_DIR/init"     "init"
  apply_dir "$SCRIPT_DIR/triggers" "triggers"

  # Mirror 00-apply-all.sh: apply role files (seed/99-app-role.sql,
  # seed/98-vendor-role.sql) BEFORE rls/, because several rls files
  # (03-auth-cross-tenant.sql, 15-audit-log-rls.sql) GRANT EXECUTE/SELECT
  # to instigenie_app and instigenie_vendor. On a fresh cluster those
  # roles don't exist yet and the GRANT would abort. Idempotent on
  # re-runs: CREATE ROLE IF NOT EXISTS inside the role files.
  for role_file in \
    "$SCRIPT_DIR/seed/99-app-role.sql" \
    "$SCRIPT_DIR/seed/98-vendor-role.sql" ; do
    [ -f "$role_file" ] || continue
    run_sql "$role_file" "roles"
  done

  apply_dir "$SCRIPT_DIR/rls"      "rls"
fi
apply_dir "$SCRIPT_DIR/seed"      "seed"

echo "[apply] done."
