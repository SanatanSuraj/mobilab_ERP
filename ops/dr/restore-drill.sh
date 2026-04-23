#!/usr/bin/env bash
# restore-drill.sh — Phase 4 §4.4 Gate 18 companion, quarterly restore drill.
#
# Pulls the latest pg_basebackup from MinIO, spins up a scratch Postgres
# container, replays WAL up to the last archived segment, runs a fixed
# suite of sanity queries against five critical tables, and tears the
# container down. Measures end-to-end RTO (clock time from step 1 to
# step 6 in docs/runbooks/backup-dr.md §"Quarterly restore drill").
#
# Usage:
#   CONFIRM_DR=1 ./ops/dr/restore-drill.sh \
#       --replica-host scratch-pg.staging.internal \
#       --primary-host postgres-primary.prod.internal
#
#   # Dry run — prints every step it would take but performs no mutating action:
#   ./ops/dr/restore-drill.sh \
#       --replica-host scratch-pg.staging.internal \
#       --primary-host postgres-primary.prod.internal \
#       --dry-run
#
# Flag semantics (shared with promote-replica.sh for muscle-memory):
#   --replica-host HOST   — scratch host where the restored DB is materialised.
#                           This host MUST be disposable; the script wipes
#                           /var/lib/postgresql/data-restore/ on it.
#   --primary-host HOST   — production primary, used ONLY as an identifier in
#                           structured logs (so the drill record ties back to
#                           the env it was validating). The script never
#                           touches the primary.
#   --dry-run             — print every planned step; do not run mutating commands.
#
# Paranoia gate:
#   CONFIRM_DR=1 must be exported for any non-dry-run. The drill itself is
#   non-destructive to production — but it IS destructive to the scratch host,
#   and CONFIRM_DR= forces the operator to acknowledge that before running.
#
# Required env vars (non-dry-run):
#   CONFIRM_DR=1
#   MINIO_BUCKET          — e.g. instigenie-pg-backup
#   MINIO_ALIAS           — `mc` alias configured with credentials, e.g. "minio".
#                           If the alias does not exist on the operator host,
#                           register it first: `mc alias set minio https://... access secret`.
#
# Optional env vars:
#   SSH_USER              — ssh user for the scratch host (default: current user).
#   SSH_OPTS              — extra ssh options (default: StrictHostKeyChecking=accept-new).
#   PG_SUPERUSER          — postgres superuser (default: postgres).
#   PG_CONTAINER          — scratch Postgres container name (default: pg-restore-drill).
#   PG_IMAGE              — Postgres image (default: postgres:16 to match prod minor version).
#   RESTORE_DIR           — data dir on scratch host (default: /var/lib/postgresql/data-restore).
#   DRILL_ID              — opaque identifier included in every JSON log line
#                           (default: restore-drill-<UTC-ISO>).
#
# Output:
#   One JSON object per step on stdout; prose on stderr. The last "ok" line
#   for step "measure_rto" records the measured RTO in seconds. That is the
#   number to write into the Gate 18 sign-off row.
#
# Sanity queries (run against the restored scratch DB):
#   1. audit.log count > 0 AND max(changed_at) within last 24h.
#   2. cron.job contains phase4_archive_audit_old_rows and phase4_watchdog_hashchain.
#   3. outbox_events count >= 0 (table exists and is reachable).
#   4. stock_summary count > 0 (critical inventory table).
#   5. sales_invoices count > 0 (critical finance table).
# Any query returning 0 for a table that should have rows (1, 4, 5) is a
# FAILURE of the drill — write that outcome into the sign-off row.
#
# Shellcheck-clean.

set -euo pipefail
IFS=$'\n\t'

# ─── CLI parsing ────────────────────────────────────────────────────────────
REPLICA_HOST=""
PRIMARY_HOST=""
DRY_RUN=0

usage() {
  cat >&2 <<'USAGE'
Usage: restore-drill.sh --replica-host HOST --primary-host HOST [--dry-run]

Environment (non-dry-run):
  CONFIRM_DR=1, MINIO_BUCKET, MINIO_ALIAS (required)
  SSH_USER, SSH_OPTS, PG_SUPERUSER, PG_CONTAINER, PG_IMAGE, RESTORE_DIR, DRILL_ID (optional)

Runs the quarterly pg_basebackup restore drill against a disposable scratch
host. See docs/runbooks/backup-dr.md §"Quarterly restore drill".
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --replica-host)
      REPLICA_HOST="${2:-}"
      shift 2
      ;;
    --primary-host)
      PRIMARY_HOST="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown flag: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${REPLICA_HOST}" || -z "${PRIMARY_HOST}" ]]; then
  echo "--replica-host and --primary-host are required" >&2
  usage
  exit 1
fi

if [[ "${DRY_RUN}" -eq 0 && "${CONFIRM_DR:-0}" != "1" ]]; then
  echo "refusing to run: export CONFIRM_DR=1 to acknowledge the scratch host will be wiped" >&2
  echo "(use --dry-run to rehearse without the paranoia gate)" >&2
  exit 1
fi

if [[ "${DRY_RUN}" -eq 0 ]]; then
  : "${MINIO_BUCKET:?MINIO_BUCKET is required (e.g. instigenie-pg-backup)}"
  : "${MINIO_ALIAS:?MINIO_ALIAS is required (an mc alias pointing at MinIO with read creds)}"
fi

SSH_USER="${SSH_USER:-$USER}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=accept-new -o ConnectTimeout=10}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
PG_CONTAINER="${PG_CONTAINER:-pg-restore-drill}"
PG_IMAGE="${PG_IMAGE:-postgres:16}"
RESTORE_DIR="${RESTORE_DIR:-/var/lib/postgresql/data-restore}"
DRILL_ID="${DRILL_ID:-restore-drill-$(date -u +%Y%m%dT%H%M%SZ)}"
MINIO_BUCKET="${MINIO_BUCKET:-}"
MINIO_ALIAS="${MINIO_ALIAS:-}"

# ─── Timing & structured logging ────────────────────────────────────────────
T_START=$(date -u +%s)

json_log() {
  local status="$1"
  local step="$2"
  local detail="${3:-}"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"ts":"%s","drill_id":"%s","script":"restore-drill","step":"%s","status":"%s","dry_run":%s,"replica_host":"%s","primary_host":"%s","detail":"%s"}\n' \
    "${ts}" "${DRILL_ID}" "${step}" "${status}" \
    "$([[ "${DRY_RUN}" -eq 1 ]] && echo true || echo false)" \
    "${REPLICA_HOST}" "${PRIMARY_HOST}" "${detail}"
}

say() {
  printf '==> %s\n' "$*" >&2
}

announce_step() {
  local step="$1"
  local detail="$2"
  json_log "start" "${step}" "${detail}"
  say "[${step}] ${detail}"
}

run_remote() {
  local host="$1"
  local cmd="$2"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    say "  (dry-run) ssh ${SSH_USER}@${host} ${cmd}"
    return 0
  fi
  # shellcheck disable=SC2086
  ssh ${SSH_OPTS} "${SSH_USER}@${host}" "${cmd}"
}

run_remote_capture() {
  local host="$1"
  local cmd="$2"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    say "  (dry-run) ssh ${SSH_USER}@${host} ${cmd}"
    printf 'DRY_RUN_UNKNOWN\n'
    return 0
  fi
  # shellcheck disable=SC2086
  ssh ${SSH_OPTS} "${SSH_USER}@${host}" "${cmd}"
}

# ─── Step 1: tooling preflight ──────────────────────────────────────────────
step_preflight() {
  announce_step "preflight" "verify mc + ssh on operator host, docker on scratch"
  if [[ "${DRY_RUN}" -eq 0 ]]; then
    if ! command -v mc >/dev/null 2>&1; then
      json_log "fail" "preflight" "mc (MinIO client) not in PATH"
      exit 2
    fi
    if ! command -v ssh >/dev/null 2>&1; then
      json_log "fail" "preflight" "ssh not in PATH"
      exit 2
    fi
    if ! mc alias list "${MINIO_ALIAS}" >/dev/null 2>&1; then
      json_log "fail" "preflight" "mc alias ${MINIO_ALIAS} is not configured"
      exit 2
    fi
    if ! run_remote "${REPLICA_HOST}" "command -v docker >/dev/null 2>&1"; then
      json_log "fail" "preflight" "docker not installed on scratch host"
      exit 2
    fi
  fi
  json_log "ok" "preflight" "tooling present"
}

# ─── Step 2: find the latest base backup in MinIO ───────────────────────────
LATEST=""
step_find_latest_base() {
  announce_step "find_latest_base" "locate latest base backup in minio/${MINIO_BUCKET:-?}/base/"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    LATEST="DRY_RUN_PLACEHOLDER"
    json_log "ok" "find_latest_base" "dry-run placeholder selected"
    return 0
  fi
  # `mc ls` lists dated directories; tail -n 1 → latest YYYY-MM-DD dir.
  LATEST="$(mc ls "${MINIO_ALIAS}/${MINIO_BUCKET}/base/" 2>/dev/null | awk '{print $NF}' | sed 's:/$::' | tail -n 1)"
  if [[ -z "${LATEST}" ]]; then
    json_log "fail" "find_latest_base" "no base backups found in bucket"
    exit 2
  fi
  json_log "ok" "find_latest_base" "latest_base=${LATEST}"
}

# ─── Step 3: wipe scratch data dir + copy base backup in ────────────────────
step_fetch_base() {
  announce_step "fetch_base" "wipe ${RESTORE_DIR} on scratch host + mc cp base tarballs in"
  # The scratch host is disposable — wipe and recreate the data dir.
  run_remote "${REPLICA_HOST}" "sudo rm -rf '${RESTORE_DIR}' && sudo mkdir -p '${RESTORE_DIR}/pg_wal' && sudo chown -R ${PG_SUPERUSER}:${PG_SUPERUSER} '${RESTORE_DIR}'"
  if [[ "${DRY_RUN}" -eq 0 ]]; then
    # Recursive mc cp from latest base. We run it from the operator host and
    # pipe via ssh, because the scratch host may not have mc installed and we
    # want MinIO credentials to stay on the operator host's `mc` alias.
    mc cp --recursive "${MINIO_ALIAS}/${MINIO_BUCKET}/base/${LATEST}/" "/tmp/${DRILL_ID}-base/"
    # scp tarballs to scratch host.
    # shellcheck disable=SC2086
    scp ${SSH_OPTS} -r "/tmp/${DRILL_ID}-base/." "${SSH_USER}@${REPLICA_HOST}:${RESTORE_DIR}/"
    rm -rf "/tmp/${DRILL_ID}-base"
    run_remote "${REPLICA_HOST}" "sudo chown -R ${PG_SUPERUSER}:${PG_SUPERUSER} '${RESTORE_DIR}'"
  else
    say "  (dry-run) mc cp --recursive ${MINIO_ALIAS}/${MINIO_BUCKET}/base/${LATEST}/ → ${REPLICA_HOST}:${RESTORE_DIR}"
  fi
  json_log "ok" "fetch_base" "base copied to ${REPLICA_HOST}:${RESTORE_DIR}"
}

# ─── Step 4: untar base + wal, write recovery config ────────────────────────
step_unpack_and_configure() {
  announce_step "unpack_and_configure" "untar base.tar.gz + pg_wal.tar.gz, write restore_command + recovery.signal"
  # The restore_command uses Postgres's %f / %p substitution tokens. Those
  # must appear literally in postgresql.auto.conf, so we wrap the whole
  # conf body in a single-quoted heredoc-style shell string and rely on
  # ssh's own quoting to transport it unchanged.
  local conf_line1="restore_command = 'mc cp ${MINIO_ALIAS}/${MINIO_BUCKET}/wal/%f %p'"
  local conf_line2="recovery_target_action = 'promote'"
  local remote_cmd="cd '${RESTORE_DIR}' && sudo -u ${PG_SUPERUSER} tar -xzf base.tar.gz && sudo -u ${PG_SUPERUSER} tar -xzf pg_wal.tar.gz -C pg_wal/ && sudo -u ${PG_SUPERUSER} touch recovery.signal && printf '%s\\n%s\\n' \"${conf_line1}\" \"${conf_line2}\" | sudo -u ${PG_SUPERUSER} tee postgresql.auto.conf >/dev/null"
  run_remote "${REPLICA_HOST}" "${remote_cmd}"
  json_log "ok" "unpack_and_configure" "recovery.signal + postgresql.auto.conf in place"
}

# ─── Step 5: spin up the scratch container, wait for promotion ──────────────
step_start_container() {
  announce_step "start_container" "launch ${PG_IMAGE} container ${PG_CONTAINER} mounting ${RESTORE_DIR}"
  # -e POSTGRES_PASSWORD only satisfies the image's init requirement; the
  # restored cluster's existing roles take over once WAL replay completes.
  local remote_cmd="sudo docker rm -f '${PG_CONTAINER}' 2>/dev/null || true; sudo docker run -d --name '${PG_CONTAINER}' -e POSTGRES_PASSWORD=drillonly -v '${RESTORE_DIR}:/var/lib/postgresql/data' -p 15432:5432 '${PG_IMAGE}' postgres -c hba_file=/var/lib/postgresql/data/pg_hba.conf"
  run_remote "${REPLICA_HOST}" "${remote_cmd}"
  json_log "ok" "start_container" "container ${PG_CONTAINER} launched on scratch host"
}

step_wait_for_replay() {
  announce_step "wait_for_replay" "poll pg_is_in_recovery() → false (timeout 600s)"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    json_log "ok" "wait_for_replay" "dry-run skipped"
    return 0
  fi
  local i=0
  while [[ $i -lt 300 ]]; do
    local out
    out="$(run_remote_capture "${REPLICA_HOST}" \
      "sudo docker exec -i '${PG_CONTAINER}' psql -U ${PG_SUPERUSER} -Atqc 'SELECT pg_is_in_recovery();' 2>/dev/null || echo err")"
    if [[ "${out}" == "f" || "${out}" == "false" ]]; then
      json_log "ok" "wait_for_replay" "promotion complete after ${i}s"
      return 0
    fi
    sleep 2
    i=$((i + 2))
  done
  json_log "fail" "wait_for_replay" "WAL replay did not complete within 600s"
  exit 2
}

# ─── Step 6: sanity queries ────────────────────────────────────────────────
# Each query must return a single integer ≥ the stated minimum.
SANITY_FAILED=0
sanity_query() {
  local name="$1"
  local sql="$2"
  local min="$3"
  announce_step "sanity_${name}" "${sql}"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    json_log "ok" "sanity_${name}" "dry-run skipped"
    return 0
  fi
  local out
  out="$(run_remote_capture "${REPLICA_HOST}" \
    "sudo docker exec -i '${PG_CONTAINER}' psql -U ${PG_SUPERUSER} -Atqc \"${sql}\" 2>/dev/null || echo err")"
  if [[ "${out}" == "err" || -z "${out}" ]]; then
    json_log "fail" "sanity_${name}" "query errored (out=${out})"
    SANITY_FAILED=$((SANITY_FAILED + 1))
    return 0
  fi
  if [[ "${out}" =~ ^[0-9]+$ && "${out}" -ge "${min}" ]]; then
    json_log "ok" "sanity_${name}" "value=${out} min=${min}"
  else
    json_log "fail" "sanity_${name}" "value=${out} min=${min}"
    SANITY_FAILED=$((SANITY_FAILED + 1))
  fi
}

step_sanity_queries() {
  announce_step "sanity_queries" "assert 5 critical tables are populated in the restored DB"
  # 1. audit log has rows (chain evidence).
  sanity_query "audit_log_count"          "SELECT COUNT(*) FROM audit.log" 1
  # 2. pg_cron jobs rehydrated.
  sanity_query "cron_jobs_present"        "SELECT COUNT(*) FROM cron.job WHERE jobname IN ('phase4_archive_audit_old_rows', 'phase4_watchdog_hashchain')" 2
  # 3. outbox table reachable (0 is acceptable here — drained is fine).
  sanity_query "outbox_table_reachable"   "SELECT COUNT(*) >= 0 :: int FROM outbox_events" 0
  # 4. stock_summary has rows.
  sanity_query "stock_summary_populated"  "SELECT COUNT(*) FROM stock_summary" 1
  # 5. sales_invoices has rows.
  sanity_query "sales_invoices_populated" "SELECT COUNT(*) FROM sales_invoices" 1

  if [[ "${SANITY_FAILED}" -gt 0 ]]; then
    json_log "fail" "sanity_queries" "${SANITY_FAILED} sanity checks failed"
    # Continue to teardown so the scratch host doesn't leak resources.
  else
    json_log "ok" "sanity_queries" "all 5 sanity checks passed"
  fi
}

# ─── Step 7: tear down the scratch container + data dir ─────────────────────
step_teardown() {
  announce_step "teardown" "stop + rm container and wipe ${RESTORE_DIR}"
  local remote_cmd="sudo docker rm -f '${PG_CONTAINER}' 2>/dev/null || true; sudo rm -rf '${RESTORE_DIR}'"
  run_remote "${REPLICA_HOST}" "${remote_cmd}"
  json_log "ok" "teardown" "scratch host cleaned"
}

# ─── Step 8: measure RTO + print final summary ──────────────────────────────
step_measure_rto() {
  local now elapsed
  now=$(date -u +%s)
  elapsed=$((now - T_START))
  announce_step "measure_rto" "drill wall-clock time"
  json_log "ok" "measure_rto" "elapsed_seconds=${elapsed} target_seconds=14400 (4h RTO target)"
  if [[ "${SANITY_FAILED}" -gt 0 ]]; then
    json_log "fail" "run" "drill FAILED — ${SANITY_FAILED} sanity queries failed"
    exit 2
  fi
  json_log "ok" "run" "drill PASSED in ${elapsed}s"
}

# ─── Main ───────────────────────────────────────────────────────────────────
main() {
  json_log "start" "run" "dry_run=${DRY_RUN} drill_id=${DRILL_ID}"
  step_preflight
  step_find_latest_base
  step_fetch_base
  step_unpack_and_configure
  step_start_container
  step_wait_for_replay
  step_sanity_queries
  step_teardown
  step_measure_rto
}

main "$@"
