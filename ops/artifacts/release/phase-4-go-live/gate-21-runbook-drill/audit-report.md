# Gate 21 — Runbook cross-reference audit
Run: 2026-04-23T09:34:48Z

Each entry in `ops/runbook-drills/gate-21-failure-injection.md` drill
matrix references a `docs/runbooks/critical-alerts.md#<anchor>` heading.
This script verifies every referenced anchor resolves to a real `## §<name>`
heading in that file.

## Drill-matrix anchor resolution

- [x] `#outbox-dead-letter` → `docs/runbooks/critical-alerts.md:25`
- [x] `#stock-drift` → `docs/runbooks/critical-alerts.md:83`
- [x] `#audit-chain-break` → `docs/runbooks/critical-alerts.md:164`
- [x] `#bullmq-critical-backlog` → `docs/runbooks/critical-alerts.md:249`
- [x] `#redis-bull-memory` → `docs/runbooks/critical-alerts.md:304`
- [x] `#backup-missed` → `docs/runbooks/critical-alerts.md:357`
- [x] `#minio-node-down` → `docs/runbooks/critical-alerts.md:593`
- [x] `#listen-notify-split-brain` → `docs/runbooks/critical-alerts.md:609`
- [x] `#pg-replica-lag` → `docs/runbooks/critical-alerts.md:408`

## Supplementary runbook files referenced from the drill matrix

- `docs/runbooks/minio-3-node-cluster.md` — OK
- `docs/runbooks/pgbouncer-replica.md` — OK
- `docs/runbooks/backup-dr.md` — OK
- `docs/runbooks/alertmanager-routing.md` — OK
- `docs/runbooks/pre-launch-checklist.md` — OK
- `ops/dr/promote-replica.sh` — OK+EXECUTABLE
- `ops/dr/restore-drill.sh` — OK+EXECUTABLE

## Conclusion

All 9 drill-matrix anchors resolve. All 5 supplementary runbooks + 2 DR
scripts are present and the DR scripts are executable. Gate 21 static
preconditions pass; the runtime drill (physical injection + paging)
must still be executed against staging with on-call engineer sign-off
per the drill matrix instructions.
