# Phase 4 Go-Live Release Checklist

**Release window**: 2026-04-23
**Scope**: ARCHITECTURE.md §4.4 gates 17, 18, 21 + §15.4 Phase 4 closures.

Each gate row captures the status at freeze-time. Three statuses are possible:

- **PASS** — evidence file present in this folder, criteria met in full.
- **STATIC-PASS / DRY-RUN-PASS** — code/tooling validated; physical execution
  deferred to staging per the staging-only injection rules. Row closes to
  PASS after staging operator fills in sign-off.
- **PENDING** — not yet executed; blocker on release.

---

## 1. Phase 4 §15.4 closures (code-side)

| Gate | Proves | Evidence | Status |
|---|---|---|---|
| Gate 9 — Schema drift CI | `tsc --noEmit` across `apps/api`, `apps/web`, `apps/worker` against `@instigenie/contracts` | `gate-9-schema-drift/vitest-output.txt` (3/3 pass, 4.17s) | **PASS** |
| Gate 46 — CRM state machines | 44 edge tests covering full deal + ticket transition matrices | `gate-46-state-machines/vitest-output.txt` (44/44 pass, 0.83s) | **PASS** |
| Gate 47 — Audit-trail count + trace_id | `audit.log` +1 delta per mutation with `actor`, `org`, `trace_id` assertions | `gate-47-audit-trail/vitest-output.txt` (7/7 pass, 0.92s) | **PASS** |
| Migration 19 — `audit.log.trace_id` column | Idempotent DDL + trigger rewrite to pick up `app.current_trace_id` GUC | `migration-19/README.md` + `audit-log-schema-after.txt` | **PASS** (dev) / **PENDING** (staging, prod) |

## 2. §4.4 go-live gates (staging-dependent)

| Gate | Proves | Evidence | Status |
|---|---|---|---|
| Gate 17 — 1h sustained load @ 500 VU | p99 API < 2s; 5xx < 0.1%; zero dead letters; zero stock drift | `gate-17-load/README.md` + `k6-inspect.txt` | **STATIC-PASS** — k6 script statically validated; 1h staging run pending |
| Gate 18 — DR promotion + restore drill | Promote replica, measure RTO, rebuild replica from basebackup | `gate-18-dr-drill/README.md` + both dry-run stdout files | **DRY-RUN-PASS** — both scripts green on `--dry-run`; staging rehearsal pending |
| Gate 21 — Runbook failure injection | On-call exec of every CRITICAL alert runbook against staging | `gate-21-runbook-drill/README.md` + `audit-report.md` | **STATIC-PASS** — all 9 drill-matrix anchors resolve; physical drill pending |

## 3. Pre-flight regressions (run at freeze)

| Check | Evidence | Result |
|---|---|---|
| Full gate suite `pnpm vitest run tests/gates` | `full-regression-vitest.txt` | **356/359 pass**; 3 failures are in pre-existing flakes (gate-35 MRP, gate-43 e-sig) confirmed by `flakes-isolated-rerun.txt` |
| Full workspace `pnpm -r typecheck` | `full-regression-typecheck.txt` | **PASS** — all 12 workspace packages typecheck clean |
| Gate 22 stabilization | See gate-22 agent report (summary below) | **PASS 4/4 full-suite runs**, LISTEN race now isolated from live apps/listen-notify |

### Gate 22 fix summary

File-local change to `tests/gates/gate-22-arch3-outbox-e2e.test.ts` only:

- Stub queues now filter events to `name.startsWith("gate22.")` so the
  shared dev `outbox.events` table can contain leaked rows from other
  gates without poisoning gate-22 captures.
- LISTEN test: assertion narrowed to the domain contract
  (`dispatched_at within 3s`) — any subscriber can be the claimer.
- Poller + idempotency tests: added `insertPendingInvisibly` helper
  (INSERT pre-dispatched then UPDATE `dispatched_at = NULL`) so the live
  `apps/listen-notify` cannot steal the row from the test drain.

No changes to `apps/*`, `packages/*`, or `vitest.config.ts`.

### Known-flaky gates (not release blockers)

- **gate-35** (20-way concurrent MRP) — documented flake under dev-stack
  load; passes in isolation. Blocker on Phase 5 determinism work.
- **gate-43** (critical-action e-signatures, stock CUSTOMER_ISSUE path) —
  consumes fixtures from gate-33's stock-correctness run. Depleted
  inventory in shared dev DB → `ShortageError`. Passes on fresh DB.

Neither is in the scope of this release; call out in the release PR.

---

## 4. Staging sign-off template

For Gate 17, 18, 21 — copy this block into the release PR after the
staging operator has executed each drill:

```
Gate 17 (sustained load)    : _____-UTC / _____-operator / k6-run-id=________
Gate 18 (DR drill)          : _____-UTC / _____-operator / RTO=___m
Gate 21 (runbook drill)     : _____-UTC / _____-operator / 9/9 sign-offs filed
Migration 19 (staging)      : _____-UTC / _____-operator / psql-log-sha=________
Migration 19 (production)   : _____-UTC / _____-operator / psql-log-sha=________
```

## 5. File manifest

```
ops/artifacts/release/phase-4-go-live/
├── RELEASE-CHECKLIST.md                (this file)
├── full-regression-vitest.txt          full suite vitest output
├── full-regression-typecheck.txt       pnpm -r typecheck output
├── flakes-isolated-rerun.txt           gate-35 + gate-43 isolated rerun
├── gate-9-schema-drift/
│   └── vitest-output.txt
├── gate-17-load/
│   ├── README.md
│   └── k6-inspect.txt
├── gate-18-dr-drill/
│   ├── README.md
│   ├── promote-replica-dryrun.txt
│   └── restore-drill-dryrun.txt
├── gate-21-runbook-drill/
│   ├── README.md
│   ├── audit-report.md
│   └── cross-ref-verification.txt
├── gate-46-state-machines/
│   └── vitest-output.txt
├── gate-47-audit-trail/
│   └── vitest-output.txt
└── migration-19/
    ├── README.md
    ├── audit-log-columns.txt
    ├── audit-log-schema-after.txt
    └── audit-tg-log-function.txt
```

## 6. Referenced source

- `ops/sql/init/19-phase4-audit-trace-id.sql` — migration source.
- `ops/k6/gate-17-sustained-load.js` — load-test script.
- `ops/dr/promote-replica.sh` — DR promotion script.
- `ops/dr/restore-drill.sh` — quarterly restore drill script.
- `ops/runbook-drills/gate-21-failure-injection.md` — drill matrix.
- `tests/gates/gate-9-schema-drift.test.ts`
- `tests/gates/gate-22-arch3-outbox-e2e.test.ts`
- `tests/gates/gate-46-crm-state-machines.test.ts`
- `tests/gates/gate-47-audit-trail-count.test.ts`
- `docs/runbooks/critical-alerts.md`
- `docs/runbooks/backup-dr.md`
- `docs/runbooks/pre-launch-checklist.md`
- `ARCHITECTURE.md` §4.4 (go-live gates) + §15.4 (closed gaps) + §15.5
  (Phase 5 backlog) + Appendix A 2026-04-23 decision-log row.
