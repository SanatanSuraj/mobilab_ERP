#!/usr/bin/env bash
#
# Bootstrap applier for docker-entrypoint-initdb.d.
#
# Postgres' docker-entrypoint.sh iterates the TOP-LEVEL of
# /docker-entrypoint-initdb.d/ only — it doesn't recurse into subdirectories.
# Our SQL is organised as init/ triggers/ rls/ seed/, each mounted as a
# subdirectory. This script runs them in the canonical order:
#
#   1. init/       — extensions, schemas
#   2. triggers/   — outbox notify, updated_at, audit
#   3. rls/        — row-level security policies
#   4. seed/       — roles, permissions, dev org
#
# Within each directory, files are applied in lexicographic order so filename
# prefixes (00-, 01-, 02-…) control execution order.
#
# SHEBANG NOTE: uses bash, not /bin/sh. The debian postgres image's /bin/sh
# is dash, which does not support `set -o pipefail` — the script failed on
# line 18 with "Illegal option -o pipefail" on fresh initdb, leaving the
# cluster with no application schema and no roles. Keep as bash.

set -euo pipefail

# Prefer psql-with-password, same env as the primary init sequence.
: "${POSTGRES_USER:=instigenie}"
: "${POSTGRES_DB:=instigenie}"

apply_dir() {
  dir="$1"
  label="$2"
  if [ ! -d "$dir" ]; then
    echo "[init] $label: $dir missing, skipping"
    return 0
  fi

  found=0
  for f in "$dir"/*.sql; do
    [ -f "$f" ] || continue
    found=1
    echo "[init] $label: applying $f"
    psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
         --set ON_ERROR_STOP=1 --no-psqlrc --quiet -f "$f"
  done

  if [ "$found" -eq 0 ]; then
    echo "[init] $label: no .sql files in $dir"
  fi
}

apply_dir /docker-entrypoint-initdb.d/01-init     "init"
apply_dir /docker-entrypoint-initdb.d/02-triggers "triggers"

# Roles must exist before RLS because several RLS scripts GRANT EXECUTE /
# GRANT SELECT to instigenie_app and instigenie_vendor (see
# ops/sql/rls/03-auth-cross-tenant.sql). We pull the role-creation files
# out of 04-seed early so those GRANTs resolve. The same files live in
# 04-seed so a plain directory scan still finds them on re-runs; ON CONFLICT /
# IF NOT EXISTS in the role DDL makes the second apply a no-op.
for role_file in \
  /docker-entrypoint-initdb.d/04-seed/99-app-role.sql \
  /docker-entrypoint-initdb.d/04-seed/98-vendor-role.sql ; do
  if [ -f "$role_file" ]; then
    echo "[init] roles: applying $role_file"
    psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
         --set ON_ERROR_STOP=1 --no-psqlrc --quiet -f "$role_file"
  fi
done

apply_dir /docker-entrypoint-initdb.d/03-rls      "rls"
apply_dir /docker-entrypoint-initdb.d/04-seed     "seed"

echo "[init] all bootstrap SQL applied."
