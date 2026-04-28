#!/usr/bin/env bash
# Strict validation of .env.production. Exits non-zero on the first failure.
# Usage: bash ops/scripts/validate-env.sh [path/to/env]
set -euo pipefail

ENV_FILE="${1:-.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FAIL: $ENV_FILE not found" >&2
  exit 1
fi

# Load without exporting to caller; export inside this subshell only.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "  ok: $*"; }

REQUIRED=(
  VERSION
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD
  DATABASE_URL DATABASE_DIRECT_URL
  REDIS_BULL_PASSWORD REDIS_CACHE_PASSWORD
  REDIS_BULL_URL REDIS_CACHE_URL
  JWT_SECRET JWT_ISSUER
  API_PUBLIC_URL WEB_PUBLIC_URL
)

echo "1) Presence check"
for v in "${REQUIRED[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    fail "$v is missing or empty"
  fi
  ok "$v set"
done

echo "2) JWT_SECRET strength"
jwt_len=${#JWT_SECRET}
[[ $jwt_len -ge 32 ]] || fail "JWT_SECRET length $jwt_len < 32"
ok "JWT_SECRET length $jwt_len"

echo "3) Redis URL format"
for u in "$REDIS_BULL_URL" "$REDIS_CACHE_URL"; do
  [[ "$u" =~ ^redis://:[^:@/]+@[^:/]+:[0-9]+/[0-9]+$ ]] \
    || fail "Redis URL not in form redis://:PASS@HOST:PORT/DB — got: $u"
done
ok "redis URLs well-formed"

echo "4) Postgres URL format"
for u in "$DATABASE_URL" "$DATABASE_DIRECT_URL"; do
  [[ "$u" =~ ^postgres://[^:]+:[^@]+@[^:/]+:[0-9]+/[^?]+ ]] \
    || fail "Postgres URL malformed: $u"
done
ok "postgres URLs well-formed"

echo "5) DATABASE_DIRECT_URL must NOT route through pgbouncer"
# Mirrors packages/db/src/direct-url.ts assertDirectPgUrl() heuristics:
# port 6432 is the conventional pgbouncer port; hostnames containing
# 'bouncer' or 'pgbouncer' are also rejected.
direct_port=$(echo "$DATABASE_DIRECT_URL" | sed -E 's#.*@[^:]+:([0-9]+)/.*#\1#')
direct_host=$(echo "$DATABASE_DIRECT_URL" | sed -E 's#.*@([^:/]+):.*#\1#')
[[ "$direct_port" != "6432" ]] || fail "DATABASE_DIRECT_URL points at port 6432 (pgbouncer). Must use direct PG port (typically 5432)."
[[ ! "$direct_host" =~ (bouncer|pgbouncer) ]] || fail "DATABASE_DIRECT_URL hostname '$direct_host' looks like a pooler. Must point at primary directly."
ok "DATABASE_DIRECT_URL uses direct port $direct_port and host $direct_host"

echo "6) Strict separation: DATABASE_URL vs DATABASE_DIRECT_URL"
# In a stack with PgBouncer they MUST differ. In this stack (no PgBouncer)
# they're allowed to be equal — same pg primary, different intent. We only
# warn so an audit reviewer can spot intent.
if [[ "$DATABASE_URL" == "$DATABASE_DIRECT_URL" ]]; then
  echo "  warn: DATABASE_URL == DATABASE_DIRECT_URL (acceptable only without PgBouncer)"
else
  ok "DATABASE_URL and DATABASE_DIRECT_URL differ"
fi

echo "7) Public URLs are absolute https://"
for u in "$API_PUBLIC_URL" "$WEB_PUBLIC_URL"; do
  [[ "$u" =~ ^https?://[^/]+ ]] || fail "Public URL not absolute: $u"
  if [[ ! "$u" =~ ^https:// ]]; then
    echo "  warn: $u is not https — only acceptable for internal staging"
  fi
done
ok "public URLs absolute"

echo "8) No localhost in pooled/cluster URLs"
for v in DATABASE_URL DATABASE_DIRECT_URL REDIS_BULL_URL REDIS_CACHE_URL; do
  if [[ "${!v}" =~ (localhost|127\.0\.0\.1) ]]; then
    fail "$v contains localhost/127.0.0.1 — production should use service DNS or in-network names"
  fi
done
ok "no localhost in cluster URLs"

echo "9) VERSION not 'latest'"
[[ "$VERSION" != "latest" ]] || fail "VERSION=latest is forbidden in production (rollbacks become ambiguous)"
ok "VERSION pinned: $VERSION"

echo "PASS"
