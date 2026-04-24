# ADR 0001 — Work Order state machine: 15-state spec, 7-state schema, gate-owned reference

- **Status:** Accepted
- **Date:** 2026-04-24
- **Deciders:** Production platform, QC platform
- **Supersedes:** —
- **Superseded by:** —

## Context

`ARCHITECTURE.md` §13.2.1 ("Work Order Lifecycle — 15 states, matches prototype") declares the
authoritative production work-order lifecycle: 13 happy-path states (`DRAFT → PENDING_APPROVAL →
APPROVED → PENDING_RM → RM_ISSUED → RM_QC_IN_PROGRESS → IN_PROGRESS → ASSEMBLY_COMPLETE →
QC_HANDOVER_PENDING → QC_IN_PROGRESS → QC_COMPLETED → {COMPLETED | PARTIAL_COMPLETE}`) plus two
transversal states (`ON_HOLD`, `CANCELLED`). The architecture also names a **single source of
truth** file:

> State transition matrix lives in `packages/core/production/src/wo.state-machine.ts` — single
> source of truth.

The actual shipped production schema (`ops/sql/init/05-production.sql:196-206`) enforces only **7**
states today:

```sql
CHECK (status IN (
  'PLANNED',
  'MATERIAL_CHECK',
  'IN_PROGRESS',
  'QC_HOLD',
  'REWORK',
  'COMPLETED',
  'CANCELLED'
))
```

The `packages/core/production/src/wo.state-machine.ts` file named in ARCHITECTURE.md **does not
exist** in the tree. There is therefore no single-source-of-truth module for the WO transition
matrix — Phase 2 services (`work-orders.service.ts`, approvals, track-1 handlers) ad-hoc the
7-state rules inline at call sites.

This is a latent drift risk. Two concrete failure modes:

1. A well-meaning contributor adds a 16th state by ALTERing the CHECK constraint (or edits §13.2.1
   to match something easier to ship) without noticing the other side exists. There is no CI gate
   to catch it.
2. Phase 3 authors arrive, discover the 15-state spec, try to implement transitions against it,
   and silently write states the DB rejects at INSERT time — caught only by integration tests
   that happen to exercise the new edge.

We need (a) an executable reference for the 15-state design we are committing to, (b) a clearly
named bridge to the 7-state shipped schema, and (c) a written acknowledgment that the drift is
intentional and phased, so neither side gets "fixed" in isolation.

## Decision

**Phase 2 (current): ship the 7-state CHECK. Keep the 15-state design as an executable
specification inside the test suite. Do not yet create `packages/core/production/src/wo.state-machine.ts`.**

Concretely:

1. **The 15-state reference lives at
   [`tests/gates/wo-state-machine-225.spec.ts`](../../tests/gates/wo-state-machine-225.spec.ts).**
   This spec contains a pure `WorkOrderStateMachine` class with the canonical 46-edge `ALLOWED`
   transition table and exhaustively asserts all 15 × 15 = 225 transition attempts — 46 allowed
   edges succeed, the remaining 179 throw `StateTransitionError` with `code=invalid_state_transition`.
   It also pins the concurrent-write invariants (exactly-one-winner via optimistic locking,
   no intermediate state leakage to the outbox) that any future implementation must preserve.

2. **The 7-state schema remains authoritative for Phase 2 DB writes.** The gate does not require
   the DB to enforce the 15-state matrix today. Services continue to hand-roll the 7-state
   transitions; the 15-state matrix is a forward-looking contract, not a live constraint.

3. **Phase 3 promotion path:** when a Phase 3 ticket adopts any of the 8 states absent from the
   shipped schema (`PENDING_APPROVAL`, `APPROVED`, `PENDING_RM`, `RM_ISSUED`,
   `RM_QC_IN_PROGRESS`, `ASSEMBLY_COMPLETE`, `QC_HANDOVER_PENDING`, `QC_IN_PROGRESS`,
   `QC_COMPLETED`, `PARTIAL_COMPLETE`, `ON_HOLD`), the work item MUST:
   - Port the `ALLOWED` table from `wo-state-machine-225.spec.ts` into
     `packages/core/production/src/wo.state-machine.ts` **without modification** — the gate
     becomes the compile-time reference the service consumes.
   - ALTER the CHECK constraint in a migration, in the same PR.
   - Delete the ADR note below ("current 7-state truncation") and update ARCHITECTURE.md to drop
     the gate-as-source-of-truth footnote.
   - Keep the 225-case gate passing at every step.

4. **Drift detection:** until the promotion lands, any change to the declared 15-state set must
   touch `wo-state-machine-225.spec.ts`. The gate's fixture drift detection means a rogue add or
   rename will fail CI. Any change to the 7-state CHECK must touch
   `ops/sql/init/05-production.sql` — by policy those PRs get extra review from production
   platform owners.

## Alternatives considered

**A. Implement `packages/core/production/src/wo.state-machine.ts` now, keep the 7-state CHECK.**
Rejected: a module that enumerates 15 states while the DB accepts only 7 is a footgun. The first
service to `import { ALLOWED }` and drive a transition would crash at INSERT time, moving the
drift from "known and bounded" to "surprising to the runtime."

**B. Enlarge the CHECK to 15 states now, backfill `status` in existing rows.**
Rejected: no service emits the 8 missing states yet, so every new state would be a dead column
value. Worse, the RLS/audit columns, `hold_reasons` FK, and approval-chain wiring that
ARCHITECTURE.md §13.2.1 requires for `ON_HOLD`, `PARTIAL_COMPLETE`, and post-`RM_ISSUED`
`CANCELLED` are Phase 3 work. Shipping the CHECK first would give us a schema that advertises a
capability the rest of the system does not deliver.

**C. Shrink ARCHITECTURE.md §13.2.1 to the 7-state reality.**
Rejected: the 15-state design is the ISO 13485 / 21 CFR Part 820 production-controls narrative
we committed to. Trimming the doc to match the current schema would erase the future contract
that Phase 3 is building against — and the prototype has already walked the full 15-state path,
so the states are not speculative.

## Consequences

**Positive:**

- The 15-state matrix is executable and under CI coverage today (225 + 3 race tests, ~175 ms).
- No service can silently violate the 15-state design without also modifying the gate.
- No migration, no RLS re-review, no cross-service coordination is required in Phase 2.
- The promotion to `packages/core/production/src/wo.state-machine.ts` becomes a near-copy-paste:
  the `ALLOWED` table is already written in a form a pure module can consume.

**Negative:**

- The single-source-of-truth line in ARCHITECTURE.md §13.2.1 is, until Phase 3, aspirational.
  Readers must follow the ADR trail to understand why.
- Production code paths that see an unfamiliar string in `status` today will get a DB
  CHECK-constraint violation rather than a typed `StateTransitionError` — not yet uniform.
- We accept the risk that a Phase 3 team rediscovers the matrix from scratch instead of reusing
  the gate's table; the ADR + pointer in ARCHITECTURE.md footnote is the mitigation.

## References

- `ARCHITECTURE.md` §13.2.1 (15-state lifecycle, lines 1641–1668)
- `ops/sql/init/05-production.sql:196-206` (7-state CHECK constraint)
- `tests/gates/wo-state-machine-225.spec.ts` (executable 15-state reference, 225-case matrix,
  50-way race test)
- `apps/api/src/modules/production/work-orders.service.ts` (Phase 2 service; 7-state in-code)
