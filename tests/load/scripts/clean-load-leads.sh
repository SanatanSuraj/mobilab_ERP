#!/usr/bin/env bash
# Purge every lead created by scenario 04-crm-leads-create.js.
#
# Each lead is tagged `source = 'LOAD_TEST'`. The `instigenie_app` role
# is RLS-scoped so it can't see cross-tenant rows; we go through the
# docker container as the superuser instead. Cheap cleanup for dev —
# keeps the leads-list scenario from reading a 50k-row table on reruns.
set -euo pipefail

CONTAINER="${INSTIGENIE_PG_CONTAINER:-instigenie-postgres}"
DB_USER="${INSTIGENIE_PG_USER:-instigenie}"
DB_NAME="${INSTIGENIE_PG_DB:-instigenie}"

docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "DELETE FROM leads WHERE source = 'LOAD_TEST';"

docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
  "DELETE FROM outbox.events WHERE payload::text LIKE '%\"LOAD_TEST\"%';"
