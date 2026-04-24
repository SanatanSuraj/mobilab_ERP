/**
 * Work-order state machine — 15-state reference (225-pair matrix) +
 * 50-way concurrent race proving optimistic lock + transactional outbox.
 *
 * ── Two invariants, two halves ────────────────────────────────────────────────
 *
 *   A. Model correctness — the 15-state work-order lifecycle documented in
 *      ARCHITECTURE.md §13.2.1 (lines 1641–1668) is modeled here as an
 *      explicit state machine. All 15 × 15 = 225 (from, to) pairs are
 *      generated; each is asserted to either:
 *
 *        • succeed and return the target state (46 allowed edges), or
 *        • throw StateTransitionError with code "invalid_state_transition"
 *          and status 409 (the remaining 179 forbidden edges — including
 *          every self-transition, every outbound from the three terminal
 *          states, and the structural prohibitions documented in §13.2.1).
 *
 *      `StateTransitionError` is `ConflictError` with the specialised
 *      code — see packages/errors/src/index.ts:162-169. That code is what
 *      the frontend maps to "invalid state" vs. a generic 409 retry.
 *
 *      ARCHITECTURE.md §13.2.1:1668 says "State transition matrix lives in
 *      `packages/core/production/src/wo.state-machine.ts` — single source
 *      of truth." That module does not yet exist in the repo (the current
 *      implementation in apps/api/src/modules/production/work-orders.*
 *      operates on the narrower 7-state enum declared in
 *      packages/contracts/src/production.ts:73 and enforced by the DB
 *      CHECK at ops/sql/init/05-production.sql:197-206). The ALLOWED
 *      table below IS therefore the source of truth until that module
 *      lands; when it does, replace the local class with an import from
 *      it and this spec becomes a regression gate on the shared module.
 *
 *   B. Concurrency safety — racing 50 clients who all believe they hold
 *      the same expectedVersion on the same WO must produce exactly ONE
 *      successful transition; the other 49 must each see a
 *      version_conflict (UPDATE affects zero rows because the row's
 *      version has already advanced). The outbox must contain exactly
 *      ONE event for that transition — never 50 and never 0 — because
 *      the enqueue sits inside the same transaction as the UPDATE: a
 *      rollback on the lock-miss atomically throws away the outbox row.
 *
 *      The race uses PLANNED → MATERIAL_CHECK on the current 7-state
 *      enum (the DB CHECK constraint would reject any of the wider
 *      15-state names). The mechanism under test — optimistic locking
 *      on `version` + transactional outbox — is identical regardless of
 *      enum width; when the 15-state migration lands, the race test
 *      swaps status labels and keeps its invariants.
 *
 *      Why we don't test via WorkOrdersService.advanceStage(): that path
 *      uses setStatus() which is deliberately unconditional — see
 *      work-orders.repository.ts:385 "flip status atomically without
 *      version check". The optimistic-lock invariant lives on
 *      updateWithVersion() (repository.ts:320-366), which mirrors the
 *      raw SQL used here. Driving the raw SQL keeps the test scoped to
 *      the mechanism instead of entangling it with the WIP-stage switch.
 *
 * ── Fixtures ──────────────────────────────────────────────────────────────────
 *
 *   Race test inserts into work_orders directly. Uses the seeded ECG
 *   product (fc0001) + its ACTIVE BOM v3 (fc0101) — same pair gate-58
 *   uses. Every race WO carries `notes = 'wo-sm-225 race'` so beforeEach
 *   DELETEs cannot touch fixtures owned by other gates.
 *
 *   Cleanup removes outbox rows first (via event_type + the WO's id) then
 *   the WO header. wip_stages have ON DELETE CASCADE so we don't seed
 *   them for the race — the state-transition test doesn't read stages.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { StateTransitionError } from "@instigenie/errors";
import { enqueueOutbox, withOrg } from "@instigenie/db";
import { installNumericTypeParser } from "@instigenie/db";
import { DATABASE_URL, DEV_ORG_ID, waitForPg } from "./_helpers.js";

// ─────────────────────────────────────────────────────────────────────────────
// A. 15-STATE REFERENCE MODEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The 15 work-order states per ARCHITECTURE.md §13.2.1:
 *
 *   DRAFT
 *     └── PENDING_APPROVAL          (submit — §3.3 approval chain)
 *            └── APPROVED           (on final approver sign)
 *                   └── PENDING_RM  (auto — awaits material issue)
 *                          └── RM_ISSUED      (stores confirms issue)
 *                                 └── RM_QC_IN_PROGRESS   (IQC gate)
 *                                        └── IN_PROGRESS  (first stage logged)
 *                                               └── ASSEMBLY_COMPLETE   (L4 done)
 *                                                      └── QC_HANDOVER_PENDING
 *                                                             └── QC_IN_PROGRESS  (L5 FINAL_QC)
 *                                                                    └── QC_COMPLETED
 *                                                                           ├── COMPLETED
 *                                                                           └── PARTIAL_COMPLETE
 *
 *   Transversal:
 *     ── ON_HOLD     (management block — hold_reason + signature)
 *     ── CANCELLED   (terminal)
 */
const WO_STATES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "PENDING_RM",
  "RM_ISSUED",
  "RM_QC_IN_PROGRESS",
  "IN_PROGRESS",
  "ASSEMBLY_COMPLETE",
  "QC_HANDOVER_PENDING",
  "QC_IN_PROGRESS",
  "QC_COMPLETED",
  "COMPLETED",
  "PARTIAL_COMPLETE",
  "ON_HOLD",
  "CANCELLED",
] as const;
type WoState = (typeof WO_STATES)[number];

/**
 * Transition table — 46 allowed edges, 179 forbidden.
 *
 * Design notes per ARCHITECTURE.md §13.2.1:
 *
 *   • PENDING_APPROVAL can send the WO back to DRAFT (rejection loop) —
 *     this is the only "reverse" edge on the forward DAG. Every other
 *     non-ON_HOLD/CANCELLED edge moves strictly forward through the
 *     approval → issue → build → QC → close pipeline.
 *
 *   • ON_HOLD is a transversal state: enterable from every *active*
 *     state (DRAFT through QC_COMPLETED) and exitable back to any of
 *     those same active states (resume) or to CANCELLED (abort). It is
 *     NOT reachable from terminals (COMPLETED / PARTIAL_COMPLETE /
 *     CANCELLED). Resume-to-previous-state is tracked off-table by the
 *     hold record metadata; from the pure state-machine perspective all
 *     12 resume targets are structurally valid.
 *
 *   • QC_COMPLETED is the branch point: it fans out to COMPLETED (all
 *     devices pass) or PARTIAL_COMPLETE (some scrapped, rest released),
 *     plus ON_HOLD. It explicitly CANNOT transition to CANCELLED —
 *     §13.2.1 says the final split is binary pass/partial once QC is
 *     complete; cancellation must happen earlier in the pipeline.
 *
 *   • COMPLETED / PARTIAL_COMPLETE / CANCELLED are terminal — outbound
 *     edges empty, including self-loops.
 *
 *   • CANCELLED is accessible from every pre-QC_COMPLETED state;
 *     §13.2.1 notes that post-RM_ISSUED cancellation requires a
 *     supervisor override with finance sign-off, but that's an
 *     application-layer authorization check, not a state-machine
 *     restriction — the edge itself is valid in the DAG.
 */
const ALLOWED: Record<WoState, readonly WoState[]> = {
  DRAFT: ["PENDING_APPROVAL", "ON_HOLD", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "ON_HOLD", "CANCELLED"],
  APPROVED: ["PENDING_RM", "ON_HOLD", "CANCELLED"],
  PENDING_RM: ["RM_ISSUED", "ON_HOLD", "CANCELLED"],
  RM_ISSUED: ["RM_QC_IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  RM_QC_IN_PROGRESS: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["ASSEMBLY_COMPLETE", "ON_HOLD", "CANCELLED"],
  ASSEMBLY_COMPLETE: ["QC_HANDOVER_PENDING", "ON_HOLD", "CANCELLED"],
  QC_HANDOVER_PENDING: ["QC_IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  QC_IN_PROGRESS: ["QC_COMPLETED", "ON_HOLD", "CANCELLED"],
  QC_COMPLETED: ["COMPLETED", "PARTIAL_COMPLETE", "ON_HOLD"],
  COMPLETED: [],
  PARTIAL_COMPLETE: [],
  ON_HOLD: [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "PENDING_RM",
    "RM_ISSUED",
    "RM_QC_IN_PROGRESS",
    "IN_PROGRESS",
    "ASSEMBLY_COMPLETE",
    "QC_HANDOVER_PENDING",
    "QC_IN_PROGRESS",
    "QC_COMPLETED",
    "CANCELLED",
  ],
  CANCELLED: [],
};

/**
 * Pure reference state machine. `transition(from, to)` either returns the
 * new state (identity on `to`) or throws `StateTransitionError`.
 *
 * Intentionally minimal — no side effects, no DB, no clock. The 225-pair
 * matrix below exercises this class exhaustively.
 */
class WorkOrderStateMachine {
  constructor(private readonly allowed: Record<WoState, readonly WoState[]>) {}

  canTransition(from: WoState, to: WoState): boolean {
    return this.allowed[from].includes(to);
  }

  transition(from: WoState, to: WoState): WoState {
    if (!this.canTransition(from, to)) {
      throw new StateTransitionError(
        `cannot transition work order from ${from} to ${to}`,
      );
    }
    return to;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// B. RACE FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

// Seed fixtures (ops/sql/seed/10-production-dev-data.sql). Same product+BOM
// gate-58 relies on.
const SEED_PRODUCT_ECG = "00000000-0000-0000-0000-000000fc0001";
const SEED_BOM_ECG3 = "00000000-0000-0000-0000-000000fc0101";
const WO_RACE_TAG = "wo-sm-225 race";

// Dedicated event type so cleanup / assertions don't touch wo.stage_changed
// rows written by gate-58 or the production service.
const RACE_EVENT_TYPE = "wo.state_transition.gate-race-50";

/**
 * Insert a fresh WO in PLANNED, version=1 for a race. Using raw SQL so the
 * test stays scoped to the optimistic-lock mechanism (not the service's
 * WIP-stage-copy side effect).
 */
async function createRaceWorkOrder(
  pool: pg.Pool,
): Promise<{ id: string; pid: string }> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const pid = `PID-RACE-${suffix}`;
    const { rows } = await client.query<{
      id: string;
      pid: string;
      version: number;
    }>(
      `INSERT INTO work_orders (
         org_id, pid, product_id, bom_id, bom_version_label,
         quantity, priority, status, notes
       ) VALUES ($1, $2, $3, $4, 'v3', 1, 'NORMAL', 'PLANNED', $5)
       RETURNING id, pid, version`,
      [DEV_ORG_ID, pid, SEED_PRODUCT_ECG, SEED_BOM_ECG3, WO_RACE_TAG],
    );
    const row = rows[0]!;
    if (row.version !== 1) {
      throw new Error(
        `expected INSERT to yield version=1, got ${row.version}`,
      );
    }
    return { id: row.id, pid: row.pid };
  });
}

/**
 * One race contestant. Opens its own connection + transaction, attempts the
 * optimistic UPDATE (WHERE version = expectedVersion), emits one outbox row
 * inside the same txn on success, and COMMITs. On lock-miss (zero rows
 * updated because another contestant already bumped version) the helper
 * ROLLBACKs — which atomically discards any outbox row it would have
 * written, proving the "no intermediate state leaks" invariant.
 *
 * Returns `{ ok: true, newVersion }` on win or
 * `{ ok: false, reason: "version_conflict" }` on loss. The only other
 * outcome — thrown error — is propagated so genuine DB failures show up
 * as test failures rather than silent losers.
 *
 * We pin `app.current_org` via set_config(..., is_local=true) so RLS binds
 * to DEV_ORG_ID inside the transaction, then the LOCAL setting auto-clears
 * at COMMIT/ROLLBACK. Same pattern withOrg() uses — we don't call withOrg
 * directly because the helper needs to distinguish lock-miss (return a
 * sentinel) from genuine failures (rethrow), and withOrg collapses both
 * into a single rethrow.
 */
async function raceAttempt(
  pool: pg.Pool,
  woId: string,
  expectedVersion: number,
  fromStatus: string,
  toStatus: string,
): Promise<
  | { ok: true; newVersion: number }
  | { ok: false; reason: "version_conflict" }
> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org', $1, true)", [
      DEV_ORG_ID,
    ]);

    const { rows } = await client.query<{ version: number; status: string }>(
      `UPDATE work_orders
          SET status = $2
        WHERE id = $1 AND version = $3 AND deleted_at IS NULL
        RETURNING version, status`,
      [woId, toStatus, expectedVersion],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "version_conflict" };
    }

    const newVersion = rows[0]!.version;
    // Transactional outbox emit — same txn as the UPDATE. If anything
    // after this throws, the ROLLBACK below discards both the UPDATE and
    // the outbox row, preserving atomicity.
    //
    // Intentionally NO idempotency_key: if a bug ever let two attempts
    // write, we want to see two rows in outbox.events so the count
    // assertion exposes it. Idempotency keys would silently collapse
    // duplicates and mask the bug.
    await enqueueOutbox(client, {
      aggregateType: "work_order",
      aggregateId: woId,
      eventType: RACE_EVENT_TYPE,
      payload: {
        fromStatus,
        toStatus,
        newVersion,
      },
    });
    await client.query("COMMIT");
    return { ok: true, newVersion };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // swallow — the original error is the interesting one
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Pool sized for the race. `makeTestPool()` uses max=4 which would force
 * 50 attempts to serialize through the pool — still correct, but it
 * masks how much parallelism the optimistic lock actually absorbs. A
 * dedicated pool with max=50 lets all 50 run on distinct Postgres
 * backends so the race is genuine.
 */
function makeRacePool(): pg.Pool {
  installNumericTypeParser();
  return new pg.Pool({
    connectionString: DATABASE_URL,
    max: 50,
    application_name: "instigenie-gates-wo-race-50",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: Matrix (225 pairs)
// ─────────────────────────────────────────────────────────────────────────────

describe("wo-state-machine-225: 15-state reference model (ARCHITECTURE.md §13.2.1)", () => {
  const machine = new WorkOrderStateMachine(ALLOWED);

  // Precompute the full 15×15 matrix once so every sub-describe works off
  // the same list and any single failure lands on a specific pair's entry.
  const MATRIX: { from: WoState; to: WoState; allowed: boolean }[] = [];
  for (const from of WO_STATES) {
    for (const to of WO_STATES) {
      MATRIX.push({ from, to, allowed: ALLOWED[from].includes(to) });
    }
  }

  it("matrix is exactly 15×15 = 225 pairs", () => {
    expect(WO_STATES).toHaveLength(15);
    expect(MATRIX).toHaveLength(225);
  });

  it("matrix partitions into 46 allowed + 179 forbidden", () => {
    const allowedCount = MATRIX.filter((m) => m.allowed).length;
    const forbiddenCount = MATRIX.filter((m) => !m.allowed).length;
    expect(allowedCount).toBe(46);
    expect(forbiddenCount).toBe(179);
    expect(allowedCount + forbiddenCount).toBe(225);
  });

  it("terminals (COMPLETED / PARTIAL_COMPLETE / CANCELLED) have zero outbound edges", () => {
    expect(ALLOWED.COMPLETED).toEqual([]);
    expect(ALLOWED.PARTIAL_COMPLETE).toEqual([]);
    expect(ALLOWED.CANCELLED).toEqual([]);
  });

  it("every state rejects self-transition (no idempotent same-state edges)", () => {
    for (const s of WO_STATES) {
      expect(machine.canTransition(s, s)).toBe(false);
    }
  });

  it("QC_COMPLETED cannot jump directly to CANCELLED (§13.2.1 binary split rule)", () => {
    expect(machine.canTransition("QC_COMPLETED", "CANCELLED")).toBe(false);
  });

  it("ON_HOLD is reachable from every active state (11 entry edges) and no terminal", () => {
    const activeStates: WoState[] = [
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "PENDING_RM",
      "RM_ISSUED",
      "RM_QC_IN_PROGRESS",
      "IN_PROGRESS",
      "ASSEMBLY_COMPLETE",
      "QC_HANDOVER_PENDING",
      "QC_IN_PROGRESS",
      "QC_COMPLETED",
    ];
    for (const s of activeStates) {
      expect(machine.canTransition(s, "ON_HOLD")).toBe(true);
    }
    // Terminals cannot enter ON_HOLD (no outbound edges at all).
    expect(machine.canTransition("COMPLETED", "ON_HOLD")).toBe(false);
    expect(machine.canTransition("PARTIAL_COMPLETE", "ON_HOLD")).toBe(false);
    expect(machine.canTransition("CANCELLED", "ON_HOLD")).toBe(false);
  });

  describe("46 allowed transitions succeed", () => {
    const allowedPairs = MATRIX.filter((m) => m.allowed);
    for (const { from, to } of allowedPairs) {
      it(`${from} → ${to}`, () => {
        expect(machine.transition(from, to)).toBe(to);
      });
    }
  });

  describe("179 forbidden transitions throw StateTransitionError (code='invalid_state_transition', status=409)", () => {
    const forbiddenPairs = MATRIX.filter((m) => !m.allowed);
    for (const { from, to } of forbiddenPairs) {
      it(`${from} ↛ ${to}`, () => {
        let caught: unknown = null;
        try {
          machine.transition(from, to);
        } catch (e) {
          caught = e;
        }
        expect(caught, `expected throw for ${from} → ${to}`).not.toBeNull();
        expect(caught).toBeInstanceOf(StateTransitionError);
        const err = caught as StateTransitionError;
        expect(err.code).toBe("invalid_state_transition");
        expect(err.status).toBe(409);
        // The message names both endpoints so the 409 tells the client what went wrong.
        expect(err.message).toContain(from);
        expect(err.message).toContain(to);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: 50-way concurrent race
// ─────────────────────────────────────────────────────────────────────────────

describe("wo-state-machine-225: 50 concurrent transitions on one work order", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeRacePool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Scoped cleanup. Outbox rows go first (no FK back to work_orders but we
  // still scope by aggregate_id so we don't touch gate-58's wo.stage_changed
  // rows or any other gate's emissions). Then the WO header. wip_stages
  // cascade on WO delete per ops/sql/init/05-production.sql.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type = $1
            AND aggregate_id IN (
              SELECT id FROM work_orders WHERE notes = $2
            )`,
        [RACE_EVENT_TYPE, WO_RACE_TAG],
      );
      await client.query(`DELETE FROM work_orders WHERE notes = $1`, [
        WO_RACE_TAG,
      ]);
    });
  });

  it("50-way race produces exactly one winner; 49 get version_conflict; outbox has exactly one event", async () => {
    const wo = await createRaceWorkOrder(pool);

    // Pre-condition: no outbox rows exist for this WO yet. outbox.events
    // has no RLS (it's cross-module infra — see ops/sql/init/02-triggers.sql)
    // so a bare pool.query is fine here.
    const { rows: pre } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbox.events WHERE aggregate_id = $1`,
      [wo.id],
    );
    expect(pre[0]!.count).toBe("0");

    // Fire 50 contestants all at expectedVersion=1 targeting MATERIAL_CHECK.
    const contestants = Array.from({ length: 50 }, () =>
      raceAttempt(pool, wo.id, 1, "PLANNED", "MATERIAL_CHECK"),
    );
    const results = await Promise.all(contestants);

    const winners = results.filter(
      (r): r is { ok: true; newVersion: number } => r.ok,
    );
    const losers = results.filter(
      (r): r is { ok: false; reason: "version_conflict" } => !r.ok,
    );

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(49);
    // Every loser reports the specific "version_conflict" sentinel — not some
    // other failure mode like deadlock, serialization error, or constraint
    // violation. The optimistic lock is the ONLY reason they lost.
    for (const l of losers) {
      expect(l).toEqual({ ok: false, reason: "version_conflict" });
    }
    // Winner reports the bumped version from tg_bump_version (ops/sql/triggers/04-crm.sql:12).
    expect(winners[0]!.newVersion).toBe(2);

    // Post-state: WO is at (status=MATERIAL_CHECK, version=2). Crucially
    // version is 2, NOT 51 — only one UPDATE committed. If the optimistic
    // lock had leaked, the trigger would have bumped version 50 times.
    //
    // work_orders is RLS-scoped — we must enter a withOrg() transaction so
    // app.current_org binds and the row becomes visible to the
    // instigenie_app (NOBYPASSRLS) role.
    const after = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const { rows } = await client.query<{
        status: string;
        version: number;
      }>(`SELECT status, version FROM work_orders WHERE id = $1`, [wo.id]);
      return rows;
    });
    expect(after[0]).toEqual({ status: "MATERIAL_CHECK", version: 2 });

    // Outbox: exactly one row. The 49 losers all ROLLBACKed, which
    // atomically discarded any outbox INSERT they would have made. If a
    // bug made outbox emission non-transactional, we'd see up to 50 rows
    // here — that failure would be loud.
    const { rows: evt } = await pool.query<{
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, aggregate_type, aggregate_id, payload
         FROM outbox.events
        WHERE aggregate_id = $1 AND event_type = $2`,
      [wo.id, RACE_EVENT_TYPE],
    );
    expect(evt).toHaveLength(1);
    expect(evt[0]!.aggregate_type).toBe("work_order");
    expect(evt[0]!.aggregate_id).toBe(wo.id);
    expect(evt[0]!.payload).toEqual({
      fromStatus: "PLANNED",
      toStatus: "MATERIAL_CHECK",
      newVersion: 2,
    });
  });

  it("three sequential 50-way races on the same WO emit exactly 3 outbox rows — no intermediate-state leakage across rounds", async () => {
    const wo = await createRaceWorkOrder(pool);

    // Round 1: version 1 → 2 (PLANNED → MATERIAL_CHECK)
    const round1 = await Promise.all(
      Array.from({ length: 50 }, () =>
        raceAttempt(pool, wo.id, 1, "PLANNED", "MATERIAL_CHECK"),
      ),
    );
    expect(round1.filter((r) => r.ok)).toHaveLength(1);
    expect(round1.filter((r) => !r.ok)).toHaveLength(49);

    // Round 2: version 2 → 3 (MATERIAL_CHECK → IN_PROGRESS)
    const round2 = await Promise.all(
      Array.from({ length: 50 }, () =>
        raceAttempt(pool, wo.id, 2, "MATERIAL_CHECK", "IN_PROGRESS"),
      ),
    );
    expect(round2.filter((r) => r.ok)).toHaveLength(1);
    expect(round2.filter((r) => !r.ok)).toHaveLength(49);

    // Round 3: version 3 → 4 (IN_PROGRESS → QC_HOLD)
    const round3 = await Promise.all(
      Array.from({ length: 50 }, () =>
        raceAttempt(pool, wo.id, 3, "IN_PROGRESS", "QC_HOLD"),
      ),
    );
    expect(round3.filter((r) => r.ok)).toHaveLength(1);
    expect(round3.filter((r) => !r.ok)).toHaveLength(49);

    // Post-state: exactly 3 version bumps (initial=1 → 4). work_orders is
    // RLS-scoped — must read through withOrg so instigenie_app sees the row.
    const after = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const { rows } = await client.query<{
        status: string;
        version: number;
      }>(`SELECT status, version FROM work_orders WHERE id = $1`, [wo.id]);
      return rows;
    });
    expect(after[0]).toEqual({ status: "QC_HOLD", version: 4 });

    // Outbox: exactly 3 rows total — one per round winner. 150 attempts in,
    // 3 events out. The ordering reflects the round ordering.
    const { rows: evt } = await pool.query<{
      payload: Record<string, unknown>;
    }>(
      `SELECT payload FROM outbox.events
        WHERE aggregate_id = $1 AND event_type = $2
        ORDER BY created_at ASC, id ASC`,
      [wo.id, RACE_EVENT_TYPE],
    );
    expect(evt).toHaveLength(3);
    expect(evt[0]!.payload).toMatchObject({
      fromStatus: "PLANNED",
      toStatus: "MATERIAL_CHECK",
      newVersion: 2,
    });
    expect(evt[1]!.payload).toMatchObject({
      fromStatus: "MATERIAL_CHECK",
      toStatus: "IN_PROGRESS",
      newVersion: 3,
    });
    expect(evt[2]!.payload).toMatchObject({
      fromStatus: "IN_PROGRESS",
      toStatus: "QC_HOLD",
      newVersion: 4,
    });
  });

  it("a stale-version attempt (expectedVersion behind reality) reports version_conflict and leaves no outbox trace", async () => {
    const wo = await createRaceWorkOrder(pool);

    // Advance the WO once so its version is now 2.
    const bootstrap = await raceAttempt(
      pool,
      wo.id,
      1,
      "PLANNED",
      "MATERIAL_CHECK",
    );
    expect(bootstrap).toEqual({ ok: true, newVersion: 2 });

    // A client holding the stale expectedVersion=1 tries to transition.
    const stale = await raceAttempt(
      pool,
      wo.id,
      1,
      "PLANNED",
      "IN_PROGRESS",
    );
    expect(stale).toEqual({ ok: false, reason: "version_conflict" });

    // The stale attempt did NOT touch anything: WO still at MATERIAL_CHECK
    // with version=2, and outbox has exactly one row (bootstrap's).
    // work_orders SELECT goes through withOrg so RLS binds.
    const after = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const { rows } = await client.query<{
        status: string;
        version: number;
      }>(`SELECT status, version FROM work_orders WHERE id = $1`, [wo.id]);
      return rows;
    });
    expect(after[0]).toEqual({ status: "MATERIAL_CHECK", version: 2 });

    const { rows: evt } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbox.events
        WHERE aggregate_id = $1 AND event_type = $2`,
      [wo.id, RACE_EVENT_TYPE],
    );
    expect(evt[0]!.count).toBe("1");
  });
});
