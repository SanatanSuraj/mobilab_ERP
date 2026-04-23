#!/usr/bin/env bash
# promote-replica.sh — Phase 4 §4.4 Gate 18 "DR drill" / production DR primary promotion.
#
# Extracts the "Production DR (primary crash)" procedure from
# docs/runbooks/backup-dr.md into a scripted form so launch-day / incident
# response does not require copy-pasting 14 commands from a runbook.
#
# Usage:
#   CONFIRM_DR=1 ./ops/dr/promote-replica.sh \
#       --replica-host postgres-replica.prod.internal \
#       --primary-host postgres-primary.prod.internal
#
#   # Dry run — prints every step it would take but performs no mutating action:
#   ./ops/dr/promote-replica.sh \
#       --replica-host postgres-replica.prod.internal \
#       --primary-host postgres-primary.prod.internal \
#       --dry-run
#
# Paranoia gate:
#   The script refuses to run unless CONFIRM_DR=1 is exported. This is a
#   one-way operation; once the replica is promoted it cannot rejoin the
#   original primary as a follower without a fresh base backup.
#
# Required env vars:
#   CONFIRM_DR=1          — explicit acknowledgement that this is a DR event.
# Optional env vars:
#   SSH_USER              — ssh user for both hosts (default: current user).
#   SSH_OPTS              — extra ssh options (default: "-o StrictHostKeyChecking=accept-new").
#   PG_SUPERUSER          — postgres superuser name used with sudo -u (default: postgres).
#   INCIDENT_ID           — opaque string included in every structured log line
#                           so the output is grep-able from the incident ticket.
#
# Output:
#   One JSON object per step on stdout (UTC timestamp, step name, status, detail).
#   Human-readable prose is printed on stderr so stdout stays machine-parseable.
#
# Exit codes:
#   0  — promotion succeeded (or was already done, when --dry-run is not set).
#   1  — user error (missing flags, CONFIRM_DR not set).
#   2  — SSH / psql step failed; the script aborts without running later steps.
#
# Steps executed (in order):
#   1. sanity_check_local  — verify ssh + psql clients exist locally.
#   2. sanity_check_hosts  — reach both hosts over ssh.
#   3. detect_already_promoted — skip promotion if replica has pg_is_in_recovery() = false.
#   4. capture_replication_state — snapshot replica lag + slot state for the incident log.
#   5. promote_replica     — run `sudo -u postgres pg_ctl promote` on --replica-host.
#   6. wait_for_writable   — poll until pg_is_in_recovery() returns false.
#   7. report_next_steps   — print the manual actions operator still owns
#                            (DATABASE_URL rotation, replacement replica build,
#                            freeze release, etc.).
#
# This script does NOT:
#   - Rotate DATABASE_URL / DATABASE_DIRECT_URL — that is app-deployment-specific
#     and must be done by the deploy owner. The final step prints the exact list
#     of follow-ups the operator owns.
#   - Set tenant_status.global_freeze — that is an application-level call that
#     requires an ADMIN_JWT; see the §stock-drift / DR runbook.
#   - Rebuild the old primary. DO NOT let the old primary rejoin as primary;
#     that is a split-brain risk. See docs/runbooks/backup-dr.md.
#
# Shellcheck-clean: the intent is that `shellcheck ops/dr/promote-replica.sh`
# produces no warnings.

set -euo pipefail
IFS=$'\n\t'

# ─── CLI parsing ────────────────────────────────────────────────────────────
REPLICA_HOST=""
PRIMARY_HOST=""
DRY_RUN=0

usage() {
  cat >&2 <<'USAGE'
Usage: promote-replica.sh --replica-host HOST --primary-host HOST [--dry-run]

Environment:
  CONFIRM_DR=1  (required unless --dry-run)
  SSH_USER, SSH_OPTS, PG_SUPERUSER, INCIDENT_ID (optional)

Promotes the named Postgres replica to a standalone primary. One-way
operation. See docs/runbooks/backup-dr.md for the full procedure.
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

# Paranoia gate — CONFIRM_DR=1 is required for any run that would actually
# mutate the cluster. A dry-run is allowed without it so operators can rehearse
# the sequence without typing CONFIRM_DR= into their history.
if [[ "${DRY_RUN}" -eq 0 && "${CONFIRM_DR:-0}" != "1" ]]; then
  echo "refusing to run: export CONFIRM_DR=1 to acknowledge this is a one-way DR event" >&2
  echo "(use --dry-run to rehearse without the paranoia gate)" >&2
  exit 1
fi

SSH_USER="${SSH_USER:-$USER}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=accept-new -o ConnectTimeout=10}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
INCIDENT_ID="${INCIDENT_ID:-dr-$(date -u +%Y%m%dT%H%M%SZ)}"

# ─── Structured logging ─────────────────────────────────────────────────────
# json_log STATUS STEP DETAIL — emits a single JSON line to stdout.
# DETAIL must not contain embedded double quotes; caller escapes them.
json_log() {
  local status="$1"
  local step="$2"
  local detail="${3:-}"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"ts":"%s","incident_id":"%s","script":"promote-replica","step":"%s","status":"%s","dry_run":%s,"replica_host":"%s","primary_host":"%s","detail":"%s"}\n' \
    "${ts}" "${INCIDENT_ID}" "${step}" "${status}" \
    "$([[ "${DRY_RUN}" -eq 1 ]] && echo true || echo false)" \
    "${REPLICA_HOST}" "${PRIMARY_HOST}" "${detail}"
}

# say ANNOUNCEMENT — human-readable prose for the incident ticket, on stderr.
say() {
  printf '==> %s\n' "$*" >&2
}

# announce_step prints both the machine record and the human prose. Use it
# before every action so the incident log has the intent even if the action
# then fails.
announce_step() {
  local step="$1"
  local detail="$2"
  json_log "start" "${step}" "${detail}"
  say "[${step}] ${detail}"
}

# run_remote HOST CMD — runs CMD on HOST via ssh, or prints it in --dry-run.
# Returns the exit code of the remote command (or 0 in dry-run).
run_remote() {
  local host="$1"
  local cmd="$2"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    say "  (dry-run) ssh ${SSH_USER}@${host} ${cmd}"
    return 0
  fi
  # shellcheck disable=SC2086 # SSH_OPTS is deliberately word-split
  ssh ${SSH_OPTS} "${SSH_USER}@${host}" "${cmd}"
}

# run_remote_capture HOST CMD — same as run_remote, but captures stdout to
# the caller's stdout. In dry-run mode emits a placeholder that callers
# should treat as "unknown".
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

# ─── Step 1: local sanity ───────────────────────────────────────────────────
step_sanity_check_local() {
  announce_step "sanity_check_local" "verify ssh and date are installed on the operator host"
  if ! command -v ssh >/dev/null 2>&1; then
    json_log "fail" "sanity_check_local" "ssh not in PATH"
    exit 2
  fi
  if ! command -v date >/dev/null 2>&1; then
    json_log "fail" "sanity_check_local" "date not in PATH"
    exit 2
  fi
  json_log "ok" "sanity_check_local" "ssh and date available"
}

# ─── Step 2: host reachability ──────────────────────────────────────────────
step_sanity_check_hosts() {
  announce_step "sanity_check_hosts" "confirm ssh reaches replica and primary hosts"
  # shellcheck disable=SC2086
  if [[ "${DRY_RUN}" -eq 0 ]]; then
    if ! ssh ${SSH_OPTS} -o BatchMode=yes "${SSH_USER}@${REPLICA_HOST}" 'true' 2>/dev/null; then
      json_log "fail" "sanity_check_hosts" "cannot ssh to replica"
      exit 2
    fi
    # Primary is allowed to be unreachable — this IS a DR event, the primary
    # might be on fire. We record the state but do not abort.
    if ! ssh ${SSH_OPTS} -o BatchMode=yes "${SSH_USER}@${PRIMARY_HOST}" 'true' 2>/dev/null; then
      json_log "warn" "sanity_check_hosts" "primary unreachable (expected during DR)"
    else
      json_log "ok" "sanity_check_hosts" "both hosts reachable"
    fi
  else
    json_log "ok" "sanity_check_hosts" "dry-run skipped"
  fi
}

# ─── Step 3: detect already-promoted replica (idempotency) ──────────────────
# Returns 0 if the replica is still in recovery (i.e. promotion needed),
# 1 if the replica has already been promoted.
ALREADY_PROMOTED=0
step_detect_already_promoted() {
  announce_step "detect_already_promoted" "check pg_is_in_recovery() on replica"
  local out
  out="$(run_remote_capture "${REPLICA_HOST}" \
    "sudo -u ${PG_SUPERUSER} psql -Atqc 'SELECT pg_is_in_recovery();'" \
    2>/dev/null || echo ERR)"
  case "${out}" in
    f|false)
      ALREADY_PROMOTED=1
      json_log "skip" "detect_already_promoted" "replica is already a standalone primary"
      ;;
    t|true)
      json_log "ok" "detect_already_promoted" "replica is in recovery; promotion required"
      ;;
    DRY_RUN_UNKNOWN)
      json_log "ok" "detect_already_promoted" "dry-run; assuming promotion required"
      ;;
    *)
      json_log "fail" "detect_already_promoted" "unexpected psql output: ${out}"
      exit 2
      ;;
  esac
}

# ─── Step 4: capture replication state for the incident record ──────────────
step_capture_replication_state() {
  announce_step "capture_replication_state" "snapshot replication lag + slot state for incident ticket"
  local lag slots
  lag="$(run_remote_capture "${REPLICA_HOST}" \
    "sudo -u ${PG_SUPERUSER} psql -Atqc \"SELECT COALESCE(EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int, -1);\"" \
    2>/dev/null || echo unknown)"
  # Primary may be dead — ignore failure, just record the snapshot attempt.
  slots="$(run_remote_capture "${PRIMARY_HOST}" \
    "sudo -u ${PG_SUPERUSER} psql -Atqc \"SELECT slot_name || ':' || active FROM pg_replication_slots;\" 2>/dev/null || echo unreachable" \
    2>/dev/null || echo unreachable)"
  json_log "ok" "capture_replication_state" "replica_lag_seconds=${lag} primary_slots=${slots}"
}

# ─── Step 5: promote the replica ────────────────────────────────────────────
step_promote_replica() {
  if [[ "${ALREADY_PROMOTED}" -eq 1 ]]; then
    json_log "skip" "promote_replica" "already promoted; nothing to do"
    return 0
  fi
  announce_step "promote_replica" "run pg_ctl promote on ${REPLICA_HOST} (IRREVERSIBLE)"
  # pg_ctl needs -D; rely on the PG distribution's default env (PGDATA set in
  # the postgres user's profile). Using `pg_promote()` would require a live
  # connection which we are about to lose; pg_ctl is the traditional path and
  # the one in the runbook.
  if ! run_remote "${REPLICA_HOST}" \
       "sudo -u ${PG_SUPERUSER} pg_ctl promote -D \"\$PGDATA\""; then
    json_log "fail" "promote_replica" "pg_ctl promote returned non-zero"
    exit 2
  fi
  json_log "ok" "promote_replica" "pg_ctl promote succeeded"
}

# ─── Step 6: wait for the replica to accept writes ──────────────────────────
step_wait_for_writable() {
  announce_step "wait_for_writable" "poll pg_is_in_recovery() until false (timeout 120s)"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    json_log "ok" "wait_for_writable" "dry-run skipped"
    return 0
  fi
  local i=0
  while [[ $i -lt 60 ]]; do
    local out
    out="$(run_remote_capture "${REPLICA_HOST}" \
      "sudo -u ${PG_SUPERUSER} psql -Atqc 'SELECT pg_is_in_recovery();'" \
      2>/dev/null || echo '')"
    if [[ "${out}" == "f" || "${out}" == "false" ]]; then
      json_log "ok" "wait_for_writable" "replica is now a standalone primary after ${i}s"
      return 0
    fi
    sleep 2
    i=$((i + 2))
  done
  json_log "fail" "wait_for_writable" "replica still in recovery after 120s"
  exit 2
}

# ─── Step 7: print the manual follow-ups ────────────────────────────────────
step_report_next_steps() {
  announce_step "report_next_steps" "emit the human-owned follow-up checklist"
  # These are deliberately not automated — see the header DO-NOT list.
  cat >&2 <<NEXT

Manual follow-ups owned by the operator (NOT done by this script):
  1. Rotate DATABASE_URL + DATABASE_DIRECT_URL in every app deployment
     to point at ${REPLICA_HOST}. Expect ~30s of 5xx during pool rotation.
  2. Confirm outbox drain — watch erp_outbox_pending_age_max_seconds on
     Grafana; it should drop back below 30s within 2 minutes.
  3. Provision a replacement replica from the latest pg_basebackup. Do
     NOT let ${PRIMARY_HOST} rejoin as a primary — rebuild it.
  4. Close the incident ticket with: INCIDENT_ID=${INCIDENT_ID},
     measured RTO (minutes between freeze and first successful write),
     link to this script's stdout (incident log).
  5. If this was the Gate 18 drill: append the RTO to
     ops/runbook-drills/gate-21-failure-injection.md and to
     docs/runbooks/pre-launch-checklist.md Gate 18 sign-off row.

NEXT
  json_log "ok" "report_next_steps" "printed manual follow-up list"
}

# ─── Main ───────────────────────────────────────────────────────────────────
main() {
  json_log "start" "run" "dry_run=${DRY_RUN} confirm_dr=${CONFIRM_DR:-0}"
  step_sanity_check_local
  step_sanity_check_hosts
  step_detect_already_promoted
  step_capture_replication_state
  step_promote_replica
  step_wait_for_writable
  step_report_next_steps
  json_log "ok" "run" "promotion procedure complete"
}

main "$@"
