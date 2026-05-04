#!/usr/bin/env bash
#
# Production bootstrap — runs ONCE on a fresh Postgres data volume.
#
# Mounted at /docker-entrypoint-initdb.d/00-apply-prod.sh by the
# `postgres` service in ops/compose/docker-compose.single-box.yml.
# Replaces the dev bootstrap (00-apply-all.sh) for production:
#
#   - Applies init/, triggers/, roles, rls/ (same as dev)
#   - Applies ONLY prod-safe seed files (skips dev-org / fixture data)
#   - Rotates the app + vendor role passwords from env vars
#     (APP_DB_PASSWORD, VENDOR_DB_PASSWORD) — the role SQL ships with
#     a placeholder password "instigenie_dev" that must NOT survive
#     into production.
#   - Replays every ops/sql/migrations/*.sql file and populates
#     schema_migrations so `pnpm migrate:status` from a dev machine
#     reports up-to-date.
#
# Order matters — init/triggers must exist before roles can GRANT on
# them; roles must exist before rls can GRANT EXECUTE; seed files
# reference the public/audit/outbox tables created in init/.
#
# Idempotent: every SQL file uses CREATE … IF NOT EXISTS / ALTER ROLE
# / ON CONFLICT, so a re-run on a non-empty volume is safe.
#
# SHEBANG NOTE: bash, not /bin/sh. Debian's /bin/sh is dash and does
# not support `set -o pipefail`.

set -euo pipefail

: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=instigenie}"

# Required app + vendor role passwords. Refuse to bootstrap without
# them — silent fallback to the dev placeholder is exactly the kind of
# regression that broke RLS in the past.
if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "[bootstrap] FATAL: APP_DB_PASSWORD is not set" >&2
  exit 1
fi
if [ -z "${VENDOR_DB_PASSWORD:-}" ]; then
  echo "[bootstrap] FATAL: VENDOR_DB_PASSWORD is not set" >&2
  exit 1
fi

INITDB_ROOT="/docker-entrypoint-initdb.d"
INIT_DIR="$INITDB_ROOT/01-init"
TRIGGERS_DIR="$INITDB_ROOT/02-triggers"
RLS_DIR="$INITDB_ROOT/03-rls"
SEED_DIR="$INITDB_ROOT/04-seed"
MIGRATIONS_DIR="$INITDB_ROOT/05-migrations"

PSQL=(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
            --set ON_ERROR_STOP=1 --no-psqlrc --quiet)

apply_dir() {
  local dir="$1" label="$2"
  if [ ! -d "$dir" ]; then
    echo "[bootstrap] $label: $dir missing, skipping"
    return 0
  fi
  for f in "$dir"/*.sql; do
    [ -f "$f" ] || continue
    echo "[bootstrap] $label: $(basename "$f")"
    "${PSQL[@]}" -f "$f"
  done
}

apply_file() {
  local f="$1" label="$2"
  if [ ! -f "$f" ]; then
    echo "[bootstrap] $label: $f missing, skipping"
    return 0
  fi
  echo "[bootstrap] $label: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
}

# ─── 1. init + triggers ─────────────────────────────────────────────
apply_dir "$INIT_DIR"     "init"
apply_dir "$TRIGGERS_DIR" "triggers"

# ─── 2. roles (must exist before rls/ can GRANT to them) ────────────
apply_file "$SEED_DIR/99-app-role.sql"    "roles"
apply_file "$SEED_DIR/98-vendor-role.sql" "roles"

# Rotate role passwords away from the dev placeholder shipped in the
# role SQL. We pipe the SQL via stdin (psql -f -) because `-c` does NOT
# process :'var' substitutions — only -f does. The `\set` directive
# quote-escapes safely; ALTER ROLE … PASSWORD does not log the value.
echo "[bootstrap] roles: rotating instigenie_app password from env"
"${PSQL[@]}" -v app_pw="$APP_DB_PASSWORD" -f - <<'SQL'
ALTER ROLE instigenie_app WITH PASSWORD :'app_pw';
SQL
echo "[bootstrap] roles: rotating instigenie_vendor password from env"
"${PSQL[@]}" -v vendor_pw="$VENDOR_DB_PASSWORD" -f - <<'SQL'
ALTER ROLE instigenie_vendor WITH PASSWORD :'vendor_pw';
SQL

# ─── 3. rls policies ────────────────────────────────────────────────
apply_dir "$RLS_DIR" "rls"

# ─── 4. prod-safe seeds only ────────────────────────────────────────
# Skipped: 03-dev-org-users, 04-crm-dev-data, 06-dev-subscription,
# 07-dev-vendor-admin — these create fixture tenants and would
# violate the worker's bootstrap-policy production guard.
PROD_SEEDS=(
  "00-roles.sql"
  "01-permissions.sql"
  "02-role-permissions.sql"
  "05-plans-catalog.sql"
)
for name in "${PROD_SEEDS[@]}"; do
  apply_file "$SEED_DIR/$name" "seed"
done

# ─── 5. forward migrations (versioned) ──────────────────────────────
# Replay ops/sql/migrations/*.sql in lex order and record each file in
# schema_migrations so future `pnpm migrate:up` calls from a developer
# machine see them as already applied. Mirrors the runner's contract
# at packages/db/src/migrate/runner.ts.
if [ -d "$MIGRATIONS_DIR" ]; then
  echo "[bootstrap] migrations: ensuring schema_migrations ledger"
  "${PSQL[@]}" <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     text PRIMARY KEY,
  name        text NOT NULL,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
SQL

  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$f" ] || continue
    base="$(basename "$f" .sql)"
    version="${base%%_*}"            # 0001_foo  → 0001
    name="${base#*_}"                # 0001_foo  → foo
    name="${name//_/ }"              # underscores → spaces (matches runner)
    sum="$(sha256sum "$f" | awk '{print $1}')"

    echo "[bootstrap] migrations: $version $name"
    "${PSQL[@]}" -v ON_ERROR_STOP=1 -1 \
      -v ver="$version" -v nm="$name" -v cs="$sum" -f "$f"
    # Same -c vs -f gotcha applies — pipe the INSERT via stdin so psql
    # processes :'ver' / :'nm' / :'cs' substitutions.
    "${PSQL[@]}" -v ver="$version" -v nm="$name" -v cs="$sum" -f - <<'SQL'
INSERT INTO public.schema_migrations (version, name, checksum)
VALUES (:'ver', :'nm', :'cs')
ON CONFLICT (version) DO UPDATE
  SET checksum = EXCLUDED.checksum,
      applied_at = now();
SQL
  done
fi

echo "[bootstrap] all production bootstrap SQL applied."
