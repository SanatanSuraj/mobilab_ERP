# Gate 21 — Runbook failure-injection drill evidence

## Status at go-live freeze: STATIC-PASSING / RUNTIME-PENDING

- `audit-report.md` — cross-reference audit: all 9 drill-matrix anchors
  resolve to concrete `## §<name>` headings in
  `docs/runbooks/critical-alerts.md`; all 5 supplementary runbook files
  + 2 DR scripts are present; DR scripts are executable.
- `cross-ref-verification.txt` — raw anchor-resolution check (alternate
  format for machine-parseable audit).

## Deferred to staging

The 9 rows in `ops/runbook-drills/gate-21-failure-injection.md` drill
matrix each require a physical failure injection in `instigenie-staging`
with a PagerDuty-rotation engineer executing the linked runbook
end-to-end. Each row has a sign-off box. Gate 21 is CLOSED only when
every row carries a UTC-date + initials.

After drill completion:

1. Append a line to `docs/runbooks/pre-launch-checklist.md` Gate 21
   section with the drill window, tester, and any remediations filed.
2. Copy the filled-in drill matrix (with sign-off boxes populated) back
   into this directory as `drill-matrix-signed-off.md`.
3. Flip `RELEASE-CHECKLIST.md` Gate 21 row from `STATIC-PASSING` →
   `PASS/<date>/<operator>`.
