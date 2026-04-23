# automate.md — End-to-end pipeline completion plan

This doc covers every row in the O2C / P2P / M2M audit that is not ✅ already-automated, broken into three independent tracks that can run in parallel once Track 1 establishes the event bus conventions.

| Track | Category | Rows | Coverage in this doc |
|-------|----------|-----:|-----------------------|
| 1 | 🟡 manual (state-change exists, no automation/events) | 13 | Parts A – E |
| 2 | ❌ missing (no schema, no service, no module) | 9 | Parts F – H |
| 3 | 🟠 stubs (partial implementation, not wired end-to-end) | 2 | Parts I – J |

> **Why Track 1 first**: 10 of its 13 items share the same root cause — state transitions silently update a row without emitting an outbox event. Fixing that unblocks 4 handler families that already exist and ship as dead code today, *and* establishes the emit/handler/gate conventions Tracks 2 and 3 rely on.

---

# Track 1 — 🟡 Manual state/task automation

> **Scope**: the 13 rows flagged 🟡 **manual** in the audit (steps 2, 3, 5, 9, 11, 12, 14, 16, 18, 21, 22, 26, 27).

---

## Part A — State of play (what the code actually does today)

**Confirmed by grep across `apps/api/src/modules/`** (see `packages/db/src/outbox.ts` for the helper signature):

### Outbox emitters in the API — only 2
| File | Line | Event |
|------|-----:|-------|
| `crm/quotations.service.ts` | 285 | `quotation.sent` |
| `qc/certs.service.ts` | 291 | `qc_cert.issued` |

### Event handlers already registered in `apps/worker/src/handlers/index.ts`
| Event | Handlers | Emitter status |
|-------|----------|----------------|
| `deal.won` | `production.createWorkOrder`, `procurement.createMrpIndent` | ❌ **orphaned — never emitted by API** |
| `qc_inward.passed` | `inventory.recordStockIn`, `finance.draftPurchaseInvoice` | ❌ orphaned |
| `qc_final.passed` | `inventory.recordFinishedGoods`, `finance.notifyValuation`, `crm.notifySales` | ❌ orphaned |
| `qc_cert.issued` | `compliance.enqueuePdfRender` | ✅ wired |
| `delivery_challan.confirmed` | `inventory.recordDispatch`, `finance.generateEwb`, `crm.whatsappNotify` | ❌ orphaned |

**The gap in one sentence**: 4 of 5 handler families are dead code because their upstream service method does not call `enqueueOutbox`. Adding those 4 emit sites closes 5+ manual-item loops in ~200 LOC.

---

## Part B — Classification of the 13 🟡 items

### B.1 — Fully automate (5 items)
Convert from manual UI click to zero-human-action. Handler fires on an upstream event that is already (or will soon be) emitted.

| # | Manual step today | Trigger event | Resulting handler action |
|---|-------------------|---------------|--------------------------|
| 5 | Open approval for SENT quote | `quotation.submitted_for_approval` *(new)* | `approvals.openTicket` |
| 9 | Reserve inventory on SO confirmation | `sales_order.confirmed` *(new)* | `inventory.reserveForSo` |
| 11 | Kick off MRP indent after deal win | `deal.won` *(new emit; handler exists)* | `procurement.createMrpIndent` |
| 18 | Release work order after deal win | `deal.won` *(same)* | `production.createWorkOrder` |
| 26 | Raise sales invoice on dispatch | `sales_order.dispatched` *(new)* | `finance.draftSalesInvoice` |

### B.2 — Stay manual, but emit an event (8 items)
Humans still decide the action. But publishing an event turns the action into a broadcast that every downstream module can react to — no more tight coupling, no more "oh we forgot to tell the ledger".

| # | Manual action | Emits |
|---|---------------|-------|
| 2 | Lead → Deal convert (`leads.service.ts:convert`) | `lead.converted` |
| 3 | Deal stage advance (`deals.service.ts:transitionStage`) | `deal.stage_changed` + on CLOSED_WON also `deal.won` |
| 12 | PO create (`purchase-orders.service.ts:create`) | `po.issued` |
| 14 | GRN post (`grns.service.ts:post`) | `grn.posted` |
| 16 | Incoming QC pass (`inspections.service.ts:pass`) | `qc_inward.passed` *(handler exists)* |
| 21 | Production stage advance (`work-orders.service.ts:transitionStage`) | `wo.stage_changed` |
| 22 | Final QC pass (`inspections.service.ts:pass`) | `qc_final.passed` *(handler exists)* |
| 27 | Payment apply (`payments.service.ts:apply`) | `payment.received` |

**Key insight**: four of the eight B.2 emits already have live consumers in the worker. Writing the emit line is literally the only missing thing.

---

## Part C — Phased plan

### Phase 1 — Publish the 10 missing outbox events (week 1, API-only)

**Pattern to copy** from `apps/api/src/modules/crm/quotations.service.ts:284-296`:

```ts
import { enqueueOutbox } from "@instigenie/db";
// ... inside a withRequest(req, pool, async (client) => { ... }) block:
if (result.stage === "CLOSED_WON") {
  await enqueueOutbox(client, {
    aggregateType: "deal",
    aggregateId: id,
    eventType: "deal.won",
    payload: { /* matches DealWonPayload in apps/worker/src/handlers/types.ts */ },
    idempotencyKey: `deal.won:${id}:v${result.version}`,
  });
}
```

**Rules every emit site must follow**:
1. Call inside the same `withRequest` client so the event is written in the same txn as the domain change (the whole point of the outbox pattern — see `packages/db/src/outbox.ts` comment).
2. `idempotencyKey` pattern: `<event>:<aggregateId>:v<version>` so retries after a 409/network blip dedupe via `ON CONFLICT DO NOTHING`.
3. Payload must match the Zod contract in `packages/contracts/src/events.ts` (add one schema per new event type).
4. Trace-id propagation is free — `withRequest` already sets `audit.log.trace_id`; the outbox row picks it up through the same client.

**Edits, one per service** (10 emits total):

| # | File:method | Guarded on | Event | Payload contract |
|---|-------------|-----------|-------|------------------|
| 1 | `crm/leads.service.ts:convert` | always | `lead.converted` | `LeadConvertedPayload` (new) |
| 2 | `crm/deals.service.ts:transitionStage` | always | `deal.stage_changed` | `DealStageChangedPayload` (new) |
| 3 | `crm/deals.service.ts:transitionStage` | `stage === "CLOSED_WON"` | `deal.won` | `DealWonPayload` (exists — `apps/worker/src/handlers/types.ts:144`) |
| 4 | `crm/quotations.service.ts:transition` | `status === "AWAITING_APPROVAL"` | `quotation.submitted_for_approval` | `QuotationApprovalRequestedPayload` (new) |
| 5 | `crm/sales-orders.service.ts:transitionStatus` | `status === "CONFIRMED"` | `sales_order.confirmed` | `SalesOrderConfirmedPayload` (new) |
| 6 | `crm/sales-orders.service.ts:transitionStatus` | `status === "DISPATCHED"` | `sales_order.dispatched` | `SalesOrderDispatchedPayload` (new) |
| 7 | `procurement/purchase-orders.service.ts:create` | always | `po.issued` | `PoIssuedPayload` (new) |
| 8 | `procurement/grns.service.ts:post` | always | `grn.posted` | `GrnPostedPayload` (new) |
| 9 | `qc/inspections.service.ts:pass` | `inspection.source === "GRN"` → `qc_inward.passed`; `"WO"` → `qc_final.passed` | (existing) | `QcInwardPassedPayload` / `QcFinalPassedPayload` (exist) |
| 10 | `production/work-orders.service.ts:transitionStage` | always | `wo.stage_changed` | `WoStageChangedPayload` (new) |
| 11 | `finance/payments.service.ts:apply` | always | `payment.received` | `PaymentReceivedPayload` (new) |

(10 emit lines; row 9 covers two events because the same method fires different ones depending on `inspection.source`.)

**Phase 1 acceptance**:
- [ ] `grep -rn enqueueOutbox apps/api/src/modules/` returns ≥ 10 call sites (was 2).
- [ ] Every emit has an `idempotencyKey`; none pass `undefined`.
- [ ] New payload Zod schemas land in `packages/contracts/src/events.ts` and are re-exported from `apps/worker/src/handlers/types.ts`.
- [ ] `tests/gates/gate-22-arch3-outbox-e2e.test.ts` still passes (no regression on existing outbox invariants).
- [ ] `audit.log.trace_id` on the new outbox rows matches the trace_id of the domain-table INSERT in the same request.

### Phase 2 — Add 4 new handlers (week 2-3)

Existing handler files that just start firing for free once Phase 1 lands:
- `apps/worker/src/handlers/deal-won.ts` ← unblocked by emit #3
- `apps/worker/src/handlers/qc-inward-passed.ts` ← unblocked by emit #9 (GRN branch)
- `apps/worker/src/handlers/qc-final-passed.ts` ← unblocked by emit #9 (WO branch)
- (`delivery_challan.confirmed` handlers stay outside this doc — delivery-challan module is partly stub and lives in the 🟠 track.)

New handler files to write (model after `apps/worker/src/handlers/deal-won.ts`):

1. **`apps/worker/src/handlers/sales-order-confirmed.ts`** (consumes event #5)
   - `inventory.reserveForSo` — insert `reservations` rows for every SO line, linking to `sales_order_id` and `version`.
   - Handler is idempotent via `outbox.handler_runs` — no `ON CONFLICT` needed on the insert.

2. **`apps/worker/src/handlers/sales-order-dispatched.ts`** (consumes event #6)
   - `finance.draftSalesInvoice` — insert `sales_invoices` row in `DRAFT` status using numbering helper in `finance/numbering.ts`.
   - `inventory.commitReservation` — flip matching `reservations.status` from `ALLOCATED` → `DISPATCHED`.

3. **`apps/worker/src/handlers/quotation-approval-requested.ts`** (consumes event #4)
   - `approvals.openTicket` — insert an `approval_tickets` row pointing at the quotation, routed by rules in `apps/api/src/modules/approvals/`.
   - Note: if that module already opens tickets synchronously on AWAITING_APPROVAL today, delete the synchronous call first — two code paths creating the same ticket is worse than either one alone.

4. **`apps/worker/src/handlers/payment-received.ts`** (consumes event #11)
   - `finance.applyToCustomerLedger` — INSERT into `customer_ledger`.
   - `finance.maybeSettleInvoice` — if the applied amount fully covers the invoice, flip `sales_invoices.status` to `PAID`.

**Registration**: append each `(eventType, handlerName, handler)` row to `HANDLER_CATALOGUE` in `apps/worker/src/handlers/index.ts`. Handler names are the idempotency key — pick them once and never rename.

Handlers that **do not** need a new file in Phase 2 (covered by later work):
- `deal.stage_changed`, `lead.converted`, `po.issued`, `grn.posted`, `wo.stage_changed` — these events are emitted in Phase 1 but have no consumer yet. That's fine: the outbox row is written, `handler_runs` simply has zero rows for it. They become useful in the next track (❌ missing items) when credit-check, vendor-advance, GL, etc. come online.

**Phase 2 acceptance**:
- [ ] `HANDLER_CATALOGUE.length` increased by the new handler-count (expect +5: 1 new for #4, 2 for #6, 1 for #5, 2 for #11 — tune based on final count).
- [ ] Every new `handlerName` is unique in `HANDLER_CATALOGUE` (prevents idempotency-ledger collisions — see `apps/worker/src/handlers/index.ts:16-18`).
- [ ] Each handler is re-runnable — calling it twice with the same `outboxId` must produce zero extra rows (rely on `outbox.handler_runs` slotting in `runner.ts`, don't hand-roll ON CONFLICT).

### Phase 3 — Gate tests, one per (event, handler) pair (week 4)

Mirror `tests/gates/gate-38-phase3-event-handlers.test.ts` and `gate-22-arch3-outbox-e2e.test.ts`:

1. Seed fixture one transition away from the trigger state.
2. Hit the HTTP endpoint (not the service directly) — that's what catches "emit was added to the service but the route skips it" regressions.
3. Poll `outbox.events WHERE idempotency_key = <expected>` until found, with a 5s budget.
4. Poll `outbox.handler_runs WHERE outbox_id = <...> AND status = 'SUCCESS'` for every handler registered in `HANDLER_CATALOGUE` for that event type.
5. Assert the downstream DB effect (reservation row / draft invoice / indent / WO) exists and has the expected shape.

Gates to add, one per emit (naming continues from existing `gate-39-*` ceiling):

| Gate | Covers |
|------|--------|
| `gate-40-lead-converted.test.ts` | emit #1 (no handler yet → just assert outbox row) |
| `gate-41-deal-stage-changed.test.ts` | emit #2 (outbox-only, same caveat) |
| `gate-42-deal-won-api-e2e.test.ts` | emits #3 through handlers to `work_orders` and `indents` |
| `gate-43-quotation-approval-requested.test.ts` | emit #4 → approval ticket row |
| `gate-44-so-confirmed-reserves.test.ts` | emit #5 → `reservations` rows |
| `gate-45-so-dispatched-invoices.test.ts` | emit #6 → `sales_invoices` DRAFT row |
| `gate-46-po-issued.test.ts` | emit #7 (outbox-only until vendor-advance handlers land) |
| `gate-47-grn-posted.test.ts` | emit #8 (outbox-only until GRN-accounting handler lands) |
| `gate-48-qc-inward-api-e2e.test.ts` | emit #9a → `stock_ledger` + draft purchase invoice |
| `gate-49-qc-final-api-e2e.test.ts` | emit #9b → FG stock + valuation notify |
| `gate-50-wo-stage-changed.test.ts` | emit #10 (outbox-only for now) |
| `gate-51-payment-received.test.ts` | emit #11 → ledger + maybe-settle |

**Phase 3 acceptance**:
- [ ] All 12 gates pass locally against a fresh pg+redis stack (see `docker-compose.dev.yml`).
- [ ] CI `pnpm test:gates` runtime grows by < 90s (handler polling budget × 12 gates, parallelized).
- [ ] A clean E2E smoke: POST `/crm/leads` → convert → deal → CLOSED_WON → wait 3s → `work_orders` and `indents` have rows — **no manual step in between**. (Previous preview runs required manually clicking through every stage.)

---

## Part D — Cross-cutting risks & decisions

1. **`DealWonPayload` demands `productId`/`bomId`/`bomVersionLabel`/`quantity`**, but the `deals` schema has no BOM linkage today. Emit #3 must source these from somewhere. Decision: **source from the linked ACCEPTED quotation's primary line** (`quotations.deal_id` FK already exists). Fall back to throwing `ValidationError("deal cannot be won without a linked accepted quotation")` if none — this doubles as a data-integrity guard and is cheaper than a schema migration.

2. **Ordering across aggregates is not guaranteed.** `listen-notify` dispatches in outbox-row order per-aggregate; handlers for `deal.won` may run before or after handlers for `quotation.converted` on the same deal. Every handler must be safe under either order.

3. **Double-emit safety on version conflicts.** If the service throws `ConflictError` after `enqueueOutbox` has already been called, the txn rolls back and the outbox row never commits — `enqueueOutbox` is write-only-on-commit by design. No extra guard needed. But: emit _after_ the domain write, not before, so a version-conflict `throw` short-circuits cleanly.

4. **Approval module overlap.** Before writing `quotation-approval-requested.ts`, grep `apps/api/src/modules/approvals/` for any sync code that creates tickets on AWAITING_APPROVAL today. If found, port that logic into the handler and delete the sync path — one code path per side-effect.

5. **Trace-id continuity.** `withRequest` sets the PG session var `audit.log.trace_id` via the middleware in `apps/api/src/modules/shared/with-request.ts`. The `outbox.events` trigger reads that same session var when firing `pg_notify`, so the downstream BullMQ job inherits it. Phase 1 gate tests should assert: `traceparent` on the POST request → `audit.log.trace_id` on the domain INSERT == `outbox.events.trace_id` == handler-run log line's `trace_id`.

---

## Part E — Exit criteria (what "manual automated" means)

All 13 🟡 rows end up in one of two states:

- **Category B.1 (5 rows, fully auto)**: zero user action after the upstream click. Clicking "Won" on a deal triggers WO + MRP indent. Clicking "Confirm" on an SO reserves stock. Clicking "Dispatch" drafts the invoice. Clicking "Send" on a quote opens the approval ticket.
- **Category B.2 (8 rows, event-emitting)**: still a human click, but every click broadcasts on the bus. Downstream modules can consume without touching the emitting service. The platform moves from "5 cross-module hand-offs" to "15+".

After Track 1 lands, the remaining gaps in the O2C pipeline fall into Tracks 2 and 3 below. Neither is a prerequisite for completing Track 1 — but Track 1 *is* a prerequisite for Tracks 2 and 3, because they both rely on the outbox-event conventions set up in Track 1.

---

# Track 2 — ❌ Missing modules (9 rows)

> **Scope**: 9 rows in the audit with **no schema, no service, no module**. These are not automation tasks — they are new-module build tasks. Each one slots into the event bus established by Track 1.
>
> **Rows covered**: credit check, availability/ATP, COGS planning, vendor advance/AP on PO, GRN accounting, WIP tracking, material issue, FG valuation, COGS booking on dispatch.

## Part F — State of play (what does NOT exist today)

Confirmed by grep across `ops/sql/init/` and `apps/api/src/modules/`:

| Missing concern | Table today | Service today | Verdict |
|-----------------|-------------|---------------|---------|
| Credit limits / credit check | ❌ none (`credit_limit` / `credit_check` return no matches) | ❌ none | greenfield |
| Availability / ATP | no `atp` / `availability` table; `stock_summary` + `stock_reservations` exist but no ATP view | ❌ none | compose from existing |
| COGS planning | ❌ no `cogs_estimates` | ❌ none | greenfield |
| Vendor advance / AP on PO issue | `vendor_ledger` exists (07-finance.sql:284), `purchase_invoices` exists (:155) — but no advance flow | ❌ `purchase-orders.service.ts:create` does not touch vendor ledger | extend |
| GRN accounting (inventory + AP posting on receipt) | `stock_ledger` (03-inventory.sql:151) and `vendor_ledger` exist | ❌ `grns.service.ts:post` does not insert ledger rows | extend |
| WIP tracking | `wip_stages` table exists (05-production.sql:251), populated by `wip_stage_templates` | ❌ no service advances WO through stages; no UI to log transitions | extend |
| Material issue from stores | no dedicated `material_issues` table; would reduce `stock_ledger` | ❌ none | greenfield |
| FG valuation | `stock_ledger` can carry cost columns but no service posts FG valuation on WO close | ❌ none | extend |
| COGS booking on dispatch | no `cogs_entries` table; no GL either (see Track 3) | ❌ none | greenfield |

Translation: 4 genuinely greenfield (credit, COGS planning, material issue, COGS booking), 5 extensions of existing tables.

## Part G — Classification by effort / ordering

### G.1 — Composable from existing tables (fast, ~1 week each)
Modules whose data model already exists and just need a service + routes + event emits.

| # | Module | What to add | Consumes | Emits |
|---|--------|-------------|----------|-------|
| F1 | ATP / availability | view `v_item_availability = stock_summary.qty_on_hand - stock_reservations.qty_active`; service method `inventory.checkAtp(itemId, qty)` | `sales_order.confirmed` handler calls it | `sales_order.stock_flagged` when ATP < qty |
| F2 | Vendor advance / AP on PO | `purchase-orders.service.ts:create` extension — on PO issue with `advance_pct > 0`, insert `vendor_ledger` debit row | `po.issued` (from Track 1) | `vendor.advance_posted` |
| F3 | GRN accounting | `grns.service.ts:post` extension — insert `stock_ledger` IN row + `vendor_ledger` credit (if GRN triggers AP) | `grn.posted` (from Track 1) | `stock.received`, `ap.grn_accrued` |
| F4 | WIP tracking | `work-orders.service.ts:transitionStage` extension — advance `wip_stages.status` per `wip_stage_templates` | `wo.stage_changed` (from Track 1) | `wo.stage_completed` per stage |
| F5 | FG valuation | handler on `wo.completed` — insert `stock_ledger` IN row for the finished good at standard cost from BOM | `wo.completed` (new — emit from T1.10) | `fg.valued` |

### G.2 — Greenfield schema + module (slower, ~2 weeks each)
Need new tables, new services, new routes, new contracts.

| # | Module | New tables | Trigger | Emits |
|---|--------|------------|---------|-------|
| F6 | Credit check | `customer_credit_limits(org_id, customer_id, limit, currency)`; `customer_credit_holds(customer_id, amount, reason)` | `sales_order.confirmed` handler (from T1 emit #5) | `sales_order.credit_blocked` if over limit |
| F7 | COGS planning | `cogs_estimates(quotation_id, estimated_cogs, margin_pct)` | `quotation.submitted_for_approval` (from T1 emit #4) | `quotation.costed` |
| F8 | Material issue | `material_issues(org_id, wo_id, item_id, qty, issued_at, issued_by)`; view over `stock_ledger` | on `wo.started` (new — add to T1 emit #10) | `material.issued` |
| F9 | COGS booking | `cogs_entries(org_id, sales_order_id, item_id, qty, cost, booked_at)` | `sales_order.dispatched` handler (from T1 emit #6) | `cogs.booked` (consumed by Track 3 GL posting) |

## Part H — Phased plan (Track 2)

### Phase 2.1 — Schema migrations (week 5)
One SQL migration per new/extended table. Numbering continues from `19-phase4-audit-trace-id.sql` → `20-credit-limits.sql`, `21-cogs-estimates.sql`, `22-material-issues.sql`, `23-cogs-entries.sql`. Extensions (ATP view, `wip_stages` status enum) fold into a single `24-track2-extensions.sql`.

Every migration follows the house rules:
- `CREATE TABLE IF NOT EXISTS`
- `org_id uuid NOT NULL REFERENCES tenants.orgs(id)` plus org-scoped indexes
- Zod contract in `packages/contracts/src/<domain>.ts` alongside

### Phase 2.2 — Services + routes (weeks 6-7)
One service file per module, mirroring the pattern used by `apps/api/src/modules/inventory/reservations.service.ts` (service + repo + routes + contracts).

New service files:
- `apps/api/src/modules/finance/credit-limits.service.ts`
- `apps/api/src/modules/finance/cogs.service.ts` (handles both planning and booking)
- `apps/api/src/modules/inventory/availability.service.ts`
- `apps/api/src/modules/inventory/material-issues.service.ts`

Extensions to existing services (no new file):
- `procurement/purchase-orders.service.ts:create` → vendor-advance path
- `procurement/grns.service.ts:post` → stock/ledger accounting
- `production/work-orders.service.ts:transitionStage` → WIP stage progression + `wo.started`/`wo.completed` emits

### Phase 2.3 — Handlers (weeks 8-9)
New worker handlers in `apps/worker/src/handlers/`:
- `sales-order-confirmed.ts` gains 2 more handlers: `finance.creditCheck` and `inventory.checkAtp` (joins `inventory.reserveForSo` from Track 1 Phase 2)
- `wo-completed.ts` → `inventory.fgValuation`
- `wo-started.ts` → `inventory.materialIssue`
- `sales-order-dispatched.ts` gains `finance.bookCogs`
- `quotation-approval-requested.ts` gains `finance.plannedCogs`

Register every new `(eventType, handlerName)` pair in `HANDLER_CATALOGUE`.

### Phase 2.4 — Gate tests (week 10)
Parallel to Track 1 Phase 3 numbering:
- `gate-52-credit-check.test.ts` — SO confirmed for customer over limit → `sales_order.credit_blocked` row
- `gate-53-atp-check.test.ts` — SO confirmed when stock < qty → `sales_order.stock_flagged`
- `gate-54-cogs-planning.test.ts` — quote AWAITING_APPROVAL → `cogs_estimates` row
- `gate-55-cogs-booking.test.ts` — SO dispatched → `cogs_entries` row
- `gate-56-vendor-advance.test.ts` — PO with `advance_pct > 0` → vendor_ledger debit
- `gate-57-grn-accounting.test.ts` — GRN posted → stock_ledger IN + vendor_ledger credit
- `gate-58-wip-tracking.test.ts` — WO stage advance → `wip_stages.status` flips
- `gate-59-material-issue.test.ts` — WO started → stock_ledger OUT rows per BOM line
- `gate-60-fg-valuation.test.ts` — WO completed → stock_ledger IN for FG at BOM cost

## Track 2 exit criteria

- [ ] 9 ❌ rows flip to ✅ in the audit table.
- [ ] Every Track 2 handler is registered in `HANDLER_CATALOGUE` and has a gate.
- [ ] A fresh run of the E2E smoke (lead → dispatch) produces: reservation row, credit-check pass, ATP pass, MRP indent, WO, WIP stage transitions, material issue, FG valuation row, sales invoice, COGS entry — with **zero manual intervention** between the initial deal-won click and the dispatch click.
- [ ] `stock_ledger` has a single consistent view of every in/out (receipts from GRN, issues to WIP, FG posts on WO close, outs on dispatch).

---

# Track 3 — 🟠 Stub completion (2 rows)

> **Scope**: 2 rows in the audit with partial implementations — code exists but the loop is not closed. Rows: **pick/pack/dispatch** and **GL / P&L / BS**.

## Part I — State of play

### 🟠 #24 Pick / Pack / Dispatch (delivery challan)
**What exists**:
- Worker handlers in `apps/worker/src/handlers/delivery-challan-confirmed.ts`: `inventory.recordDispatch`, `finance.generateEwb`, `crm.whatsappNotify`.
- Event type `delivery_challan.confirmed` is wired into `HANDLER_CATALOGUE`.
- `apps/web/src/lib/events.ts` references the event name for UI display.

**What's missing**:
- No `delivery_challans` table in `ops/sql/init/` (grep returned zero matches in API module code).
- No `apps/api/src/modules/delivery-challan/` module — no routes, no service, no repo.
- No emitter of `delivery_challan.confirmed` anywhere in the API (matches "orphaned handler family" pattern from Track 1).
- No pick list, no pack list, no vehicle/driver assignment UI.

Classification: the handler was built speculatively; the upstream module was never built. In other words, this is really a **❌ missing disguised as a stub** — call it 🟠 because the handler is a real foothold.

### 🟠 #28 GL / P&L / Balance Sheet
**What exists**:
- `customer_ledger` (07-finance.sql:245) — per-customer debits/credits for invoices + payments.
- `vendor_ledger` (:284) — per-vendor side of AP.
- `payments` (:324) — cash events.

**What's missing**:
- No `chart_of_accounts`, no `gl_entries`, no `journal_entries` — grep confirmed.
- No double-entry posting engine. The two ledger tables are sub-ledgers; a true GL that sums to a balance sheet does not exist.
- No period-close mechanism, no trial balance view, no P&L query.

Classification: 🟠 because customer_ledger + vendor_ledger together already capture ~60% of the ledger data needed. The gap is a unified GL that rolls both up (plus inventory, COGS, cash) into account-based posting.

## Part J — Phased plan (Track 3)

### Phase 3.1 — Delivery challan module (weeks 11-12)

New schema (`25-delivery-challans.sql`):
```sql
CREATE TABLE IF NOT EXISTS delivery_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES tenants.orgs(id),
  pid text NOT NULL,                       -- DC-YYYY-NNNN
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id),
  status text NOT NULL                     -- DRAFT | PICKED | PACKED | CONFIRMED | DELIVERED
    CHECK (status IN ('DRAFT','PICKED','PACKED','CONFIRMED','DELIVERED')),
  vehicle_number text,
  driver_name text,
  vehicle_departed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  -- standard audit columns ...
);

CREATE TABLE IF NOT EXISTS delivery_challan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES tenants.orgs(id),
  delivery_challan_id uuid NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES items(id),
  quantity numeric(14,4) NOT NULL,
  uom text NOT NULL,
  warehouse_id uuid REFERENCES warehouses(id),
  UNIQUE (delivery_challan_id, line_no)
);
```

New module `apps/api/src/modules/delivery-challan/`:
- `routes.ts` — POST/GET/PATCH for DC; POST transition (DRAFT→PICKED→PACKED→CONFIRMED).
- `service.ts` — state machine; on CONFIRMED calls `enqueueOutbox` with `delivery_challan.confirmed` (closes the handler loop).
- `repository.ts` — standard repo pattern.

Integration with `sales-orders.service.ts`:
- `sales_order.dispatched` handler (Track 1 Phase 2) creates the DRAFT `delivery_challan` automatically — so the picking flow has a starting row without manual DC creation.

Gate tests:
- `gate-61-dc-state-machine.test.ts` — DRAFT→PICKED→PACKED→CONFIRMED transitions.
- `gate-62-dc-confirmed-fires-ewb.test.ts` — on CONFIRMED, EWB handler runs; stock_ledger has OUT row.

### Phase 3.2 — Unified GL (weeks 13-16)

New schema (`26-general-ledger.sql`):
```sql
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES tenants.orgs(id),
  code text NOT NULL,                      -- e.g. 1100, 2100, 4000, 5000
  name text NOT NULL,
  type text NOT NULL                       -- ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
    CHECK (type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS gl_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES tenants.orgs(id),
  pid text NOT NULL,                       -- JRN-YYYY-NNNN
  source_event_id uuid REFERENCES outbox.events(id),
  source_type text NOT NULL,               -- e.g. 'sales_invoice','payment','cogs','grn'
  source_id uuid NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  period text NOT NULL,                    -- YYYY-MM
  narration text,
  UNIQUE (org_id, source_type, source_id)  -- idempotency: one journal per source
);

CREATE TABLE IF NOT EXISTS gl_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES tenants.orgs(id),
  journal_id uuid NOT NULL REFERENCES gl_journals(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  debit numeric(14,2) NOT NULL DEFAULT 0,
  credit numeric(14,2) NOT NULL DEFAULT 0,
  CHECK ((debit = 0) <> (credit = 0)),     -- each row is exactly one side
  UNIQUE (journal_id, line_no)
);
```

Posting engine `apps/api/src/modules/finance/gl.service.ts`:
- `gl.post(sourceType, sourceId, entries[])` — writes one journal + ≥2 entries, asserts `SUM(debit) = SUM(credit)`.
- Idempotent via `(org_id, source_type, source_id)` unique constraint.

**Handlers that post to GL** (these are the glue between existing events and the new ledger):

| Event | Journal source | Debit | Credit |
|-------|----------------|-------|--------|
| `sales_invoice.posted` *(new emit from sales-invoices.service.ts)* | sales_invoice | Accounts Receivable (customer) | Revenue |
| `payment.received` (Track 1) | payment | Bank | Accounts Receivable |
| `grn.posted` (Track 1) | grn | Inventory | Accrued AP |
| `purchase_invoice.posted` *(new)* | purchase_invoice | Accrued AP | Accounts Payable (vendor) |
| `cogs.booked` (Track 2 F9) | cogs | COGS | Inventory |
| `wo.completed` (Track 2 F5) | fg_valuation | Finished Goods Inventory | WIP Inventory |

Each handler lives in its own file (`gl-post-sales-invoice.ts`, `gl-post-payment.ts`, etc.) and is registered in `HANDLER_CATALOGUE`.

Reporting views:
- `v_trial_balance` — per account: `SUM(debit) - SUM(credit)` from `gl_entries` for a period.
- `v_pl` — `INCOME` accounts vs `EXPENSE` accounts for a period.
- `v_balance_sheet` — `ASSET` accounts vs `LIABILITY + EQUITY` accounts at a point in time.

Routes under `apps/api/src/modules/finance/`:
- `GET /finance/trial-balance?period=YYYY-MM`
- `GET /finance/pl?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /finance/balance-sheet?as_of=YYYY-MM-DD`

Gate tests:
- `gate-63-gl-balance.test.ts` — every journal sums to zero; `SUM(debits) = SUM(credits)` across all entries for the org.
- `gate-64-gl-idempotent.test.ts` — re-firing a `payment.received` event does not double-post.
- `gate-65-trial-balance-matches-ledgers.test.ts` — TB's AR balance == sum of `customer_ledger` open items; TB's AP balance == sum of `vendor_ledger` open items.

## Track 3 exit criteria

- [ ] `delivery_challan.confirmed` is emitted by the API (closes the orphaned-handler loop that's existed since the handler was first written).
- [ ] Every business event that touches money (6 listed above) produces a journal with debits = credits.
- [ ] Trial balance reconciles to the sub-ledgers (customer_ledger, vendor_ledger, stock_ledger at cost).
- [ ] A clean smoke: fresh org → lead → dispatch → payment → pulling trial balance shows every movement posted with no unbalanced or orphaned entries.

---

# Part K — Overall dependency map

```
Track 1 (🟡, weeks 1-4)
  └── publishes 10 events, adds 4 handlers, 12 gates
        │
        ├── Track 2 (❌, weeks 5-10)  ← relies on T1 events as triggers
        │     └── 4 greenfield + 5 extensions, 9 gates
        │
        └── Track 3 (🟠, weeks 11-16) ← relies on T1 + T2 events as GL sources
              └── delivery-challan module + unified GL, 5 gates
```

**Critical path sequencing**:
1. Track 1 must finish Phase 1 (events published) before Tracks 2/3 can add handlers — otherwise handlers have nothing to consume.
2. Track 2 F9 (COGS booking) blocks Track 3 Phase 3.2's `cogs.booked → GL` handler.
3. Track 3 Phase 3.1 (delivery-challan module) blocks the already-built `delivery_challan.confirmed` handlers from ever running in production.

**Parallelizable**:
- Track 2 schema migrations (Phase 2.1) can start as soon as Track 1 Phase 1 emits are code-reviewed — no runtime dependency.
- Track 3 Phase 3.1 (delivery-challan) has no dependency on Track 2 — can run in parallel from week 5.

**Total elapsed**: ~16 weeks if serialized across the 3 tracks with modest parallelism; tighter with more engineers. Track 1 alone (the "manual automation" the doc was originally scoped to) is ~4 weeks.
