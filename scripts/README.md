# ERP simulation harness

`erp_simulation.py` runs a full lifecycle simulation against the live API:

```
Onboarding → CRM → Sales Order → Manufacturing → Procurement
        → Inventory → Finance → Dispatch → Portal
        → Edge cases → Concurrency → Security
```

It uses **real APIs only** — no mocks. Each step is recorded with
expected vs. actual; the final report is both a console table and an
optional JSON file you can ingest in CI.

## Prerequisites

- Python 3.9+
- Local stack running:
  ```sh
  pnpm infra:up        # postgres + redis + others
  pnpm dev             # api on :4000, web on :3000
  ```
- The dev seed users (`admin@instigenie.local`, `prodmgr@instigenie.local`,
  `finance@instigenie.local` — all with password `instigenie_dev_2026`)
  must exist. They're seeded by `ops/sql/seed/03-dev-org-users.sql`.

## Install

```sh
python3 -m pip install --user requests
```

## Run

One command, all defaults:

```sh
python3 scripts/erp_simulation.py
```

With a JSON report (CI-friendly):

```sh
python3 scripts/erp_simulation.py --report-json /tmp/erp_sim.json
```

Faster smoke run (skip the slower probe phases):

```sh
python3 scripts/erp_simulation.py --skip-edge-cases --skip-concurrency
```

Against a deployed environment:

```sh
ERP_BASE_URL=https://staging.instigenie.dev \
ERP_EMAIL=qa@yourcompany.com \
ERP_PASSWORD='your-staging-pw' \
python3 scripts/erp_simulation.py --report-json /tmp/staging.json
```

## Config

Every flag also reads from an env var:

| Flag | Env var | Default |
|---|---|---|
| `--base-url` | `ERP_BASE_URL` | `http://localhost:4000` |
| `--email` | `ERP_EMAIL` | `admin@instigenie.local` |
| `--password` | `ERP_PASSWORD` | `instigenie_dev_2026` |
| `--report-json` | — | (none) |
| `--skip-edge-cases` | — | off |
| `--skip-concurrency` | — | off |
| `--timeout` | — | `15.0` (seconds, per request) |
| `--max-retries` | — | `2` (5xx only — 4xx is the server's last word) |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Every recorded step is `PASS` (or `SKIP` with a documented reason — never silent) |
| `1` | At least one `FAIL` or `ERROR` |
| `2` | Could not start (API unreachable, login refused, etc.) |

CI can wire this into a step-fails-if-non-zero gate.

## Output

### Console

Every step prints a one-liner like:

```
  ✓ [phase_5_procurement] create_po: id=a6e6504b… status=DRAFT
  ✓ [phase_5_procurement] add_po_line: id=e698b3c7…
  ✓ [phase_5_procurement] submit_po: status=PENDING_APPROVAL
  ✓ [phase_5_procurement] approve_po: final=APPROVED
```

Followed by:

```
┌── Summary ────────────────────────────────────────
│  PASS: 32
│  FAIL: 1
│ ERROR: 0
│  SKIP: 6
└───────────────────────────────────────────────────

┌── By phase ───────────────────────────────────────
│ phase_1_onboarding                  PASS=3
│ phase_2_crm                         PASS=3  SKIP=1
│ phase_3_sales_order                 PASS=1
│ ... etc
└───────────────────────────────────────────────────

┌── Failures ───────────────────────────────────────
│ [phase_8_finance] verify_ledger: invoice_rows=1 payment_rows=0
└───────────────────────────────────────────────────

VERDICT: ⚠️ PARTIAL FAILURE
```

### JSON (`--report-json`)

```json
{
  "summary": {
    "passed": 32, "failed": 1, "errored": 0, "skipped": 6,
    "verdict": "⚠️ PARTIAL FAILURE"
  },
  "by_phase": { "phase_1_onboarding": { "PASS": 3 }, ... },
  "state": {
    "lead_id": "...", "deal_id": "...", "quotation_id": "...",
    "sales_order_id": "...", "po_id": "...", "invoice_id": "...",
    "payment_id": "..."
  },
  "results": [
    {
      "phase": "phase_8_finance",
      "step": "verify_ledger",
      "action": "GET /finance/customer-ledger",
      "expected": "1 INVOICE + 1 RECEIPT row",
      "actual": "invoice_rows=1 payment_rows=0",
      "status": "FAIL",
      "notes": ""
    },
    ...
  ],
  "failures": [...]
}
```

## What the harness covers

| # | Phase | What's exercised |
|---|---|---|
| 1 | Onboarding | `POST /onboarding/start` (idempotent) + `GET /onboarding` + caches the seeded `warehouse/item/account/vendor` IDs |
| 2 | CRM | Create Lead → Deal → Quotation (with line items, real money) |
| 3 | Sales Order | Create SO from quotation; verifies the `quotationId` linkage |
| 4 | Manufacturing | Create WO + submit-for-approval + approve via the central `/approvals` engine, walking the role chain (PRODUCTION_MANAGER → FINANCE) |
| 5 | Procurement | Indent + PO + line + submit + chain-approve |
| 6 | Inventory | Create + post GRN; **diffs `stock/summary` before/after** to verify ledger integrity (qty up by exactly received qty) |
| 7 | Finished goods | (skipped, see below) |
| 8 | Finance | Create invoice + submit-for-posting + chain-approve to POSTED + record CUSTOMER_RECEIPT payment + **verify customer-ledger rows for both invoice and payment exist** |
| 9 | Dispatch | (skipped — no `/dispatch` route in current API) |
| 10 | Portal | Invite a CUSTOMER user (re-uses `/admin/users/invite`); confirms `/portal/me` rejects an INTERNAL JWT (audience isolation) |
| 11 | Edge cases | Double-submit a PO (expect 409), invalid lead payload (expect 400), garbage JWT (expect 401) |
| 12 | Concurrency | 5 parallel APPROVE actions on the same step — exactly one must win, others must be rejected |
| 13 | Security | `x-org-id` header tampering ignored (JWT org wins); `priv_esc` SUPER_ADMIN tries to act on a PRODUCTION_MANAGER step → expect 403 |

## What's intentionally skipped (and why)

These are recorded as `SKIP` with a precise reason in the report. They aren't failures — they're scope boundaries:

- **WO stage advance** (`phase_4`): requires a `wip_stage_template` per product family. Adding one is a domain decision, not a harness concern.
- **WO consumption / finished-goods stock** (`phase_6`/`phase_7`): depends on the stage-advance flow above plus reservations. Wire those once stage advance is exercised.
- **Quotation submit/approve**: the current SO flow accepts a quotation in any state, so we test the SO direct path instead.
- **Dispatch** (`phase_9`): no `/dispatch` route. The likely model is `POST /crm/sales-orders/:id/transition` to a SHIPPED state plus a `stock_ledger` ISSUE — neither is unambiguously "dispatch" so we don't guess.
- **Portal login** (`phase_10`): would require accepting the invite + setting a password, which we don't replicate to keep the harness re-runnable without polluting state. Audience-isolation is tested instead (the part that's actually security-relevant).

## Idempotency

The harness is safe to re-run against a tenant that has already been
through it. Onboarding-start returns the existing row; new entities
(lead/deal/quotation/PO/invoice/payment) are created fresh on each run
with random suffixes (`Sim Lead a1b2c3d4`) so duplicates never collide.

The seeded sample data (`WH-MAIN`, `SKU-0001`, `Sample Customer Co`,
`V-0001`) is reused — never re-created — because `/onboarding/start` is
idempotent server-side.

## Adding a phase

1. Add a method `phase_N_name(self)` to `ERPSimulation`.
2. Append `"phase_N_name"` to `PHASES`.
3. Use `self._record(...)` for every observation. Status must be one of
   `PASS / FAIL / SKIP / ERROR`. SKIP needs a reason in `actual`.
4. Read/write `self.state` for cross-phase IDs.
5. Use `self._try_approve_with_role_chain(approval_id, {role: email})`
   to handle multi-step approval chains automatically.
