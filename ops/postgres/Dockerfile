# Postgres 16 with pg_cron — Phase 4.2 compliance & archive scheduling.
#
# Why: ARCHITECTURE.md §4.2 requires two recurring jobs that run entirely
# inside the database:
#
#   1. Daily verifyQcCertChain() across every org — raises
#      erp_audit_chain_break if any row's forward SHA-256 link is
#      broken.
#   2. Daily archive sweep — rolls audit_log + stock_ledger rows
#      older than 90 days into MinIO JSONL, detaches the partition,
#      and DROPs it.
#
# Both are declared as SQL functions and scheduled via
# cron.schedule(...) in ops/sql/init/18-phase4-pg-cron.sql. pg_cron is
# Debian-packaged as `postgresql-16-cron`; alpine's apk repo doesn't
# carry it, so we switch to the bookworm-based official image for the
# build tree. Phase 4.3 production hardening will move to a managed
# Postgres (RDS/Aurora/CloudNativePG) which provides pg_cron natively.
#
# Required postgres.conf additions — wired via the `command:` block in
# docker-compose.dev.yml, NOT baked here:
#   - shared_preload_libraries = 'pg_cron'
#   - cron.database_name       = 'instigenie'

FROM postgres:16-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-cron \
 && rm -rf /var/lib/apt/lists/*
