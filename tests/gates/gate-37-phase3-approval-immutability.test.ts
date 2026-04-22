/**
 * Gate 37 — ARCHITECTURE.md Phase 3 §3.8: "approval workflow
 * immutability — APPROVED / REJECTED steps return 409 on mutation,
 * logged".
 *
 * Gate 28 proved the happy-path state machine and some per-transition
 * guards. Gate 37 locks in the *post-terminal immutability contract*:
 *
 *   Once a request reaches a terminal state (APPROVED, REJECTED, or
 *   CANCELLED) it is permanently frozen. Every subsequent mutation —
 *   act(), cancelRequest(), parallel attempts by the same role — MUST
 *   raise ConflictError, and ConflictError MUST carry HTTP status 409.
 *   The workflow_transitions audit log MUST NOT gain rows from
 *   failed attempts; the approval_requests / approval_steps rows MUST
 *   remain byte-identical across the attempt.
 *
 * This gate is the API consumer's written guarantee that a displayed
 * "APPROVED" stamp cannot be silently toggled, and an audit reader
 * cannot find a mutation-attempt trail that leaked past the check.
 *
 * ─── Scenarios ───────────────────────────────────────────────────────
 *
 *   1. Terminal=APPROVED freezes the request:
 *        • re-act() → ConflictError (409)
 *        • cancelRequest() → ConflictError (409)
 *        • 10 parallel act() attempts → all 10 ConflictError (409)
 *        • workflow_transitions row count unchanged after all attempts
 *        • approval_requests.status / completed_at / completed_by stable
 *        • approval_steps rows stable
 *
 *   2. Terminal=REJECTED freezes the request:
 *        • re-act() on the rejected step → ConflictError
 *        • act() on the still-PENDING later step → ConflictError
 *          (the *request* is terminal, not just this step)
 *        • cancelRequest() → ConflictError
 *        • transition count unchanged
 *
 *   3. Terminal=CANCELLED freezes the request:
 *        • act() → ConflictError
 *        • cancelRequest() again → ConflictError
 *        • transition count unchanged
 *
 *   4. ConflictError carries status=409 and code="conflict" — the API
 *      layer uses these to render RFC 7807 Problem+JSON.
 *
 * Cleanup: every request uses a deterministic entity_id prefix
 *   (UUIDs ending in ...37xx) and beforeEach deletes them.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import pg from "pg";
import { withOrg } from "@instigenie/db";
import { ApprovalsService } from "@instigenie/api/approvals";
import {
  AUDIENCE,
  type Permission,
  type Role,
} from "@instigenie/contracts";
import { ConflictError } from "@instigenie/errors";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

// Dev seed users (ops/sql/seed/03-dev-org-users.sql).
const USERS = {
  SALES_REP: "00000000-0000-0000-0000-00000000b003",
  SALES_MANAGER: "00000000-0000-0000-0000-00000000b004",
  FINANCE: "00000000-0000-0000-0000-00000000b005",
  PRODUCTION_MANAGER: "00000000-0000-0000-0000-00000000b007",
  MANAGEMENT: "00000000-0000-0000-0000-00000000b002",
} as const;

type ServiceReq = Parameters<ApprovalsService["createRequest"]>[0];

function makeRequest(role: keyof typeof USERS): ServiceReq {
  const perms = new Set<Permission>([
    "approvals:read",
    "approvals:request",
    "approvals:act",
    "approvals:cancel",
  ]);
  return {
    user: {
      id: USERS[role],
      orgId: DEV_ORG_ID,
      email: `${role.toLowerCase()}@mobilab.local`,
      roles: [role] as Role[],
      permissions: perms,
      audience: AUDIENCE.internal,
    },
  } as unknown as ServiceReq;
}

/** Deterministic gate-37 entity ids so cleanup can find them. */
function gate37EntityId(suffix: string): string {
  return `00000000-0000-0000-0000-0000003700${suffix}`;
}

/** Snapshot comparable fields of a request/step/transition set. */
interface Snapshot {
  requestStatus: string;
  completedAt: string | null;
  completedBy: string | null;
  currentStep: number | null;
  updatedAt: string;
  stepSummary: Array<{
    stepNumber: number;
    status: string;
    actedBy: string | null;
    actedAt: string | null;
  }>;
  transitionCount: number;
  transitionActions: string[];
}

async function snapshot(
  pool: pg.Pool,
  requestId: string,
): Promise<Snapshot> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    // Actor GUC not needed for pure reads.
    const { rows: reqRows } = await client.query<{
      status: string;
      completed_at: Date | null;
      completed_by: string | null;
      current_step: number | null;
      updated_at: Date;
    }>(
      `SELECT status, completed_at, completed_by, current_step, updated_at
         FROM approval_requests WHERE id = $1`,
      [requestId],
    );
    const req = reqRows[0]!;
    const { rows: stepRows } = await client.query<{
      step_number: number;
      status: string;
      acted_by: string | null;
      acted_at: Date | null;
    }>(
      `SELECT step_number, status, acted_by, acted_at
         FROM approval_steps WHERE request_id = $1 ORDER BY step_number`,
      [requestId],
    );
    const { rows: txnRows } = await client.query<{
      action: string;
    }>(
      `SELECT action FROM workflow_transitions
        WHERE request_id = $1 ORDER BY created_at, id`,
      [requestId],
    );
    return {
      requestStatus: req.status,
      completedAt: req.completed_at ? req.completed_at.toISOString() : null,
      completedBy: req.completed_by,
      currentStep: req.current_step,
      updatedAt: req.updated_at.toISOString(),
      stepSummary: stepRows.map((r) => ({
        stepNumber: r.step_number,
        status: r.status,
        actedBy: r.acted_by,
        actedAt: r.acted_at ? r.acted_at.toISOString() : null,
      })),
      transitionCount: txnRows.length,
      transitionActions: txnRows.map((r) => r.action),
    };
  });
}

describe("gate-37 (arch phase 3.8): approval post-terminal immutability", () => {
  let pool: pg.Pool;
  let approvals: ApprovalsService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    approvals = new ApprovalsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `SELECT set_config('app.current_user', $1, true)`,
        [USERS.MANAGEMENT],
      );
      await client.query(
        `DELETE FROM approval_requests WHERE entity_id::text LIKE '00000000-0000-0000-0000-0000003700%'`,
      );
    });
  });

  // ── 1. APPROVED is terminal ────────────────────────────────────────────

  describe("1. APPROVED freezes the request", () => {
    it("rejects every subsequent mutation with ConflictError (409) and leaves the audit log untouched", async () => {
      const entityId = gate37EntityId("10");

      // Walk a 3-step chain to APPROVED.
      const detail = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "2500000", // 25L → PM → FIN → MGMT
          currency: "INR",
        },
      );
      const requestId = detail.request.id;
      await approvals.act(makeRequest("PRODUCTION_MANAGER"), requestId, {
        action: "APPROVE",
      });
      await approvals.act(makeRequest("FINANCE"), requestId, {
        action: "APPROVE",
      });
      const final = await approvals.act(makeRequest("MANAGEMENT"), requestId, {
        action: "APPROVE",
      });
      expect(final.request.status).toBe("APPROVED");
      expect(final.request.currentStep).toBeNull();

      // Freeze snapshot after terminalisation.
      const frozen = await snapshot(pool, requestId);
      expect(frozen.requestStatus).toBe("APPROVED");
      expect(frozen.transitionActions).toEqual([
        "CREATE",
        "APPROVE",
        "APPROVE",
        "APPROVE",
      ]);

      // (a) re-act() as MANAGEMENT (the role that just terminalised) → 409
      const reactErr = await approvals
        .act(makeRequest("MANAGEMENT"), requestId, { action: "APPROVE" })
        .catch((e) => e);
      expect(reactErr).toBeInstanceOf(ConflictError);
      expect((reactErr as ConflictError).status).toBe(409);
      expect((reactErr as ConflictError).code).toMatch(
        /^(conflict|invalid_state_transition)$/,
      );

      // (b) re-act() as a role that never acted → still 409
      const reactStrangerErr = await approvals
        .act(makeRequest("PRODUCTION_MANAGER"), requestId, {
          action: "REJECT",
        })
        .catch((e) => e);
      expect(reactStrangerErr).toBeInstanceOf(ConflictError);
      expect((reactStrangerErr as ConflictError).status).toBe(409);

      // (c) cancelRequest() after APPROVED → 409
      const cancelErr = await approvals
        .cancelRequest(
          makeRequest("SALES_MANAGER"),
          requestId,
          "changed my mind",
        )
        .catch((e) => e);
      expect(cancelErr).toBeInstanceOf(ConflictError);
      expect((cancelErr as ConflictError).status).toBe(409);

      // (d) 10 parallel act() attempts → all 10 land in ConflictError
      const parallel = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          approvals.act(
            makeRequest(i % 2 === 0 ? "MANAGEMENT" : "FINANCE"),
            requestId,
            { action: i % 3 === 0 ? "REJECT" : "APPROVE" },
          ),
        ),
      );
      for (const result of parallel) {
        expect(result.status).toBe("rejected");
        const reason = (result as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(ConflictError);
        expect((reason as ConflictError).status).toBe(409);
      }

      // State must be byte-identical to the frozen snapshot.
      const after = await snapshot(pool, requestId);
      expect(after).toEqual(frozen);
    });
  });

  // ── 2. REJECTED is terminal ────────────────────────────────────────────

  describe("2. REJECTED freezes the request", () => {
    it("rejects act on the rejected step, act on later PENDING steps, and cancel — all with 409", async () => {
      const entityId = gate37EntityId("20");
      const detail = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "2500000",
          currency: "INR",
        },
      );
      const requestId = detail.request.id;

      // PM rejects at step 1 — later steps remain approval_steps.status=PENDING
      // but the *request* is terminal REJECTED.
      const afterReject = await approvals.act(
        makeRequest("PRODUCTION_MANAGER"),
        requestId,
        { action: "REJECT", comment: "capacity full" },
      );
      expect(afterReject.request.status).toBe("REJECTED");
      expect(afterReject.request.currentStep).toBeNull();
      // Sanity: later steps' DB rows stayed PENDING.
      expect(
        afterReject.steps.find((s) => s.stepNumber === 2)!.status,
      ).toBe("PENDING");
      expect(
        afterReject.steps.find((s) => s.stepNumber === 3)!.status,
      ).toBe("PENDING");

      const frozen = await snapshot(pool, requestId);
      expect(frozen.requestStatus).toBe("REJECTED");
      expect(frozen.transitionActions).toEqual(["CREATE", "REJECT"]);

      // (a) re-act on the REJECTED step by PM → 409
      const rereactErr = await approvals
        .act(makeRequest("PRODUCTION_MANAGER"), requestId, {
          action: "APPROVE",
        })
        .catch((e) => e);
      expect(rereactErr).toBeInstanceOf(ConflictError);
      expect((rereactErr as ConflictError).status).toBe(409);

      // (b) act on a later step that's still approval_steps.status=PENDING
      //     — FINANCE tries to rescue via step 2 → must still be 409 because
      //     the *request* is terminal.
      const finErr = await approvals
        .act(makeRequest("FINANCE"), requestId, { action: "APPROVE" })
        .catch((e) => e);
      expect(finErr).toBeInstanceOf(ConflictError);
      expect((finErr as ConflictError).status).toBe(409);

      // (c) cancelRequest → 409 (cannot cancel a terminal request)
      const cancelErr = await approvals
        .cancelRequest(
          makeRequest("SALES_MANAGER"),
          requestId,
          "undo the reject",
        )
        .catch((e) => e);
      expect(cancelErr).toBeInstanceOf(ConflictError);
      expect((cancelErr as ConflictError).status).toBe(409);

      const after = await snapshot(pool, requestId);
      expect(after).toEqual(frozen);
    });
  });

  // ── 3. CANCELLED is terminal ───────────────────────────────────────────

  describe("3. CANCELLED freezes the request", () => {
    it("rejects act and repeat cancel with 409 and leaves the audit log untouched", async () => {
      const entityId = gate37EntityId("30");
      const detail = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "2500000",
          currency: "INR",
        },
      );
      const requestId = detail.request.id;

      const cancelled = await approvals.cancelRequest(
        makeRequest("SALES_MANAGER"),
        requestId,
        "superseded",
      );
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.currentStep).toBeNull();

      const frozen = await snapshot(pool, requestId);
      expect(frozen.requestStatus).toBe("CANCELLED");
      expect(frozen.transitionActions).toEqual(["CREATE", "CANCEL"]);

      // (a) act() → 409
      const actErr = await approvals
        .act(makeRequest("PRODUCTION_MANAGER"), requestId, {
          action: "APPROVE",
        })
        .catch((e) => e);
      expect(actErr).toBeInstanceOf(ConflictError);
      expect((actErr as ConflictError).status).toBe(409);

      // (b) re-cancel → 409
      const recancelErr = await approvals
        .cancelRequest(makeRequest("SALES_MANAGER"), requestId, "again")
        .catch((e) => e);
      expect(recancelErr).toBeInstanceOf(ConflictError);
      expect((recancelErr as ConflictError).status).toBe(409);

      const after = await snapshot(pool, requestId);
      expect(after).toEqual(frozen);
    });
  });

  // ── 4. Error contract for API layer ────────────────────────────────────

  describe("4. ConflictError is the canonical 409", () => {
    it("every raised ConflictError is toProblem()-serialisable with status=409", async () => {
      const entityId = gate37EntityId("40");
      const detail = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "250000",
          currency: "INR",
        },
      );
      const requestId = detail.request.id;
      await approvals.act(makeRequest("PRODUCTION_MANAGER"), requestId, {
        action: "APPROVE",
      });

      // Drive a ConflictError.
      const err = (await approvals
        .act(makeRequest("PRODUCTION_MANAGER"), requestId, {
          action: "APPROVE",
        })
        .catch((e) => e)) as ConflictError;
      expect(err).toBeInstanceOf(ConflictError);

      const problem = err.toProblem();
      expect(problem.status).toBe(409);
      expect(problem.code).toMatch(
        /^(conflict|invalid_state_transition)$/,
      );
      expect(typeof problem.message).toBe("string");
      expect(problem.message.length).toBeGreaterThan(0);
    });
  });
});
