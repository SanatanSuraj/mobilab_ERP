#!/usr/bin/env bash
# One-time initial Let's Encrypt cert acquisition.
#
# nginx can't start without TLS cert files at the configured path, but
# Let's Encrypt can't issue a cert until nginx is reachable on port 80.
# We break the chicken-and-egg by:
#   1. Generating a throwaway self-signed cert so nginx starts.
#   2. Starting nginx with the dummy cert.
#   3. Replacing the dummy cert with a real Let's Encrypt cert (HTTP-01
#      via the /.well-known/acme-challenge/ webroot).
#   4. Reloading nginx to pick up the real cert.
#
# After this script runs successfully ONCE, the certbot container handles
# all future renewals automatically. You only run this again if you wipe
# the `letsencrypt` named volume.
#
# Usage:
#   bash ops/nginx/init-letsencrypt.sh           # production (real cert)
#   STAGING=1 bash ops/nginx/init-letsencrypt.sh # staging (test rate-limit-safe)
#
# Run STAGING=1 first if you're testing — Let's Encrypt rate-limits
# production cert issuance to 5 attempts per week per domain. Staging
# certs aren't browser-trusted but verify the plumbing works.

set -euo pipefail

cd "$(dirname "$0")/../.."

if [ ! -f .env.production ]; then
  echo "[init-letsencrypt] FATAL: .env.production not found in $(pwd)" >&2
  exit 1
fi

# Read DOMAIN + ACME_EMAIL from .env.production without exporting everything.
DOMAIN=$(grep -E '^DOMAIN=' .env.production | cut -d= -f2-)
EMAIL=$(grep -E '^ACME_EMAIL=' .env.production | cut -d= -f2-)

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "[init-letsencrypt] FATAL: DOMAIN or ACME_EMAIL missing in .env.production" >&2
  exit 1
fi

STAGING_FLAG=""
if [ "${STAGING:-0}" = "1" ]; then
  STAGING_FLAG="--staging"
  echo "[init-letsencrypt] STAGING mode — issued cert will NOT be browser-trusted"
fi

DC="docker compose -f ops/compose/docker-compose.single-box.yml --env-file .env.production"

echo "[init-letsencrypt] DOMAIN=$DOMAIN  EMAIL=$EMAIL"

# Step 1 — dummy self-signed cert so nginx can start with TLS config loaded.
echo "[init-letsencrypt] (1/4) creating dummy self-signed cert…"
$DC run --rm --entrypoint "sh -c \"
  mkdir -p /etc/letsencrypt/live/$DOMAIN &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out    /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj   '/CN=localhost'
\"" certbot

# Step 2 — start nginx with the dummy cert. Need api+web up because of
# nginx's `depends_on: condition: service_healthy`.
echo "[init-letsencrypt] (2/4) starting nginx (and its dependencies)…"
$DC up -d nginx

# Wait for port 80 to actually accept connections from the public internet.
echo "[init-letsencrypt] waiting for port 80…"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "http://$DOMAIN/healthz" >/dev/null 2>&1; then
    echo "[init-letsencrypt] port 80 reachable from outside"
    break
  fi
  sleep 2
done

# Step 3 — wipe dummy, request real cert via HTTP-01.
echo "[init-letsencrypt] (3/4) wiping dummy and requesting real cert…"
$DC run --rm --entrypoint "sh -c \"
  rm -rf /etc/letsencrypt/live/$DOMAIN \
         /etc/letsencrypt/archive/$DOMAIN \
         /etc/letsencrypt/renewal/$DOMAIN.conf
\"" certbot

$DC run --rm --entrypoint "" certbot \
  certbot certonly --webroot -w /var/www/certbot \
    $STAGING_FLAG \
    --email "$EMAIL" \
    --agree-tos --no-eff-email --force-renewal \
    -d "$DOMAIN"

# Step 4 — reload nginx so it picks up the real cert.
echo "[init-letsencrypt] (4/4) reloading nginx with real cert…"
$DC exec nginx nginx -s reload

echo "[init-letsencrypt] done."
echo "[init-letsencrypt] Verify: curl -fsS https://$DOMAIN/healthz"
echo "[init-letsencrypt] Cert auto-renews via the certbot service (12h check loop)."
