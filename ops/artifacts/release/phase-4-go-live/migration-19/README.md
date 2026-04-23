# Migration 19 — Audit trace_id column

## Status: APPLIED to dev

- `audit-log-schema-after.txt` — `\d audit.log` showing the `trace_id`
  column (10th column, type `text`, nullable).
- `audit-log-columns.txt` — columns-only projection confirming
  `ordinal_position` = 10 for `trace_id`.
- `audit-tg-log-function.txt` — the `audit.tg_log()` trigger function
  is SECURITY DEFINER so it can read the `app.current_trace_id` GUC
  set by the API per-request.

## Source

`ops/sql/init/19-phase4-audit-trace-id.sql`. Idempotent: re-applies
cleanly with `ADD COLUMN IF NOT EXISTS` + `CREATE OR REPLACE FUNCTION`.

## Gate-47 alignment

`tests/gates/gate-47-audit-trail-count.test.ts` is now strict:
`trace_id` is in the required-column allowlist and the per-mutation
assertion `expect(row.trace_id).toBe(TRACE_ID)` is unconditional. Before
this migration the test had a `schema.hasTraceId` escape hatch; that is
now removed so a missing `trace_id` column breaks the test at discovery
time with a direct pointer back to this migration.

## Deploy plan for staging/prod

1. `psql -h postgres-primary.<env> -U postgres -d instigenie < ops/sql/init/19-phase4-audit-trace-id.sql`.
2. Restart the API rollout — startup already reads `APP_TRACE_ID_GUC`
   and calls `SET app.current_trace_id = $1` per request.
3. Verify: emit one audited mutation (e.g. `POST /api/crm/leads` with a
   `traceparent` header) and `SELECT trace_id FROM audit.log ORDER BY
   changed_at DESC LIMIT 1` — should return the 32-char trace id.
