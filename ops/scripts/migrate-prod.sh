#!/usr/bin/env bash
#
# Production migration applier — runs schema + ONLY prod-safe seed files.
# Skips every dev-only seed (test orgs, fixture CRM data, dev subscriptions)
# so the worker's bootstrap-policy production guard doesn't refuse to start.
#
# Layers applied (in order):
#   init/      — schemas, extensions, tables
#   triggers/  — outbox, audit, updated_at
#   rls/       — row-level security policies
#   seed/      — 00-roles, 01-permissions, 02-role-permissions, 05-plans-catalog
#                (and any other file matching the PROD_SEED_PATTERN below)
#
# Usage (against running prod stack):
#   PG_CONTAINER=erp-postgres POSTGRES_USER=postgres POSTGRES_DB=instigenie \
#     bash ops/scripts/migrate-prod.sh

set -euo pipefail

CONTAINER="${PG_CONTAINER:-erp-postgres}"
DB="${POSTGRES_DB:-instigenie}"
DB_USER="${POSTGRES_USER:-postgres}"

# Production-safe seed files. Add to this list if you create new
# permission/role/plan-catalog seeds that must run in prod. Anything
# referencing dev/test fixture data MUST NOT be added here.
PROD_SEEDS=(
  "00-roles.sql"
  "01-permissions.sql"
  "02-role-permissions.sql"
  "05-plans-catalog.sql"
)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../sql" && pwd)"

apply_file() {
  local f="$1" label="$2"
  echo "[migrate-prod] $label: $(basename "$f")"
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB" -v ON_ERROR_STOP=1 -q < "$f"
}

apply_dir() {
  local dir="$1" label="$2"
  for f in "$dir"/*.sql; do
    [ -f "$f" ] || continue
    apply_file "$f" "$label"
  done
}

if ! docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB" -q 2>/dev/null; then
  echo "[migrate-prod] error: postgres not reachable in container '$CONTAINER'" >&2
  exit 1
fi

apply_dir "$ROOT/init"      "init"
apply_dir "$ROOT/triggers"  "triggers"
apply_dir "$ROOT/rls"       "rls"

for name in "${PROD_SEEDS[@]}"; do
  apply_file "$ROOT/seed/$name" "seed"
done

echo "[migrate-prod] done"
