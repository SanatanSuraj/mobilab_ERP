#!/bin/sh
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

set -euo pipefail

# Prefer psql-with-password, same env as the primary init sequence.
: "${POSTGRES_USER:=mobilab}"
: "${POSTGRES_DB:=mobilab}"

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
apply_dir /docker-entrypoint-initdb.d/03-rls      "rls"
apply_dir /docker-entrypoint-initdb.d/04-seed     "seed"

echo "[init] all bootstrap SQL applied."
