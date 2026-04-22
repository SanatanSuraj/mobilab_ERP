/**
 * Gate 28 — ARCHITECTURE.md Phase 3 §3.3 "Approval Workflows".
 *
 * Proves the chain engine resolves the right chain per band, walks steps
 * in order, enforces role gates, honours e-signature requirements, and
 * writes an append-only workflow_transitions audit trail.
 *
 * Scenarios:
 *
 *   1. Chain resolution — the right band wins:
 *        • <5L work_order   → PM only (1 step)
 *        • 5L-20L           → PM → FIN (2 steps)
 *        • ≥20L             → PM → FIN → MGMT (3 steps)
 *
 *   2. Full 3-tier walk — create a ₹25L work_order, approve step 1 as
 *      PM, step 2 as FIN, step 3 as MGMT; at each hop, current_step
 *      advances and a workflow_transitions row is written.
 *
 *   3. Reject short-circuits — rejecting at step 1 moves the request
 *      straight to REJECTED with current_step=NULL.
 *
 *   4. Role guard — a FINANCE user acting on a PM step gets ForbiddenError.
 *
 *   5. E-signature — device_qc_final chain requires `requires_e_signature`;
 *      missing payload raises ValidationError, present payload produces a
 *      hex SHA-256 hash stored on the step.
 *
 *   6. Deal discount gate — creating a deal_discount with amount ≤ 15
 *      raises ValidationError (no chain needed for small discounts).
 *
 *   7. Duplicate pending — creating a second request for the same
 *      (entity_type, entity_id) while one is PENDING raises ConflictError.
 *
 *   8. Concurrent approvers on the same step — 5 parallel act() calls
 *      by the same-role user; exactly one lands, the rest see
 *      StateTransitionError / ConflictError (the step isn't PENDING any
 *      more after the winner commits).
 *
 *   9. Cancel by requester — SALES_REP who created the request can cancel
 *      their own PENDING request; a STORES user who didn't create it and
 *      lacks approvals:cancel gets ForbiddenError.
 *
 * Cleanup: stamps every request under a deterministic entity_id prefix
 * (UUIDs ending in ...28xx) and truncates approval_requests rows whose
 * entity_id starts with the gate-28 marker on beforeEach.
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
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "@instigenie/errors";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

// Dev seed users (ops/sql/seed/03-dev-org-users.sql). Pick one user per role.
const USERS = {
  SALES_REP: "00000000-0000-0000-0000-00000000b003",
  SALES_MANAGER: "00000000-0000-0000-0000-00000000b004",
  FINANCE: "00000000-0000-0000-0000-00000000b005",
  PRODUCTION_MANAGER: "00000000-0000-0000-0000-00000000b007",
  QC_INSPECTOR: "00000000-0000-0000-0000-00000000b009",
  MANAGEMENT: "00000000-0000-0000-0000-00000000b002",
  STORES: "00000000-0000-0000-0000-00000000b00b",
} as const;

type ServiceReq = Parameters<ApprovalsService["createRequest"]>[0];

function makeRequest(role: keyof typeof USERS): ServiceReq {
  // Give the user every approvals perm their role holds in ROLE_PERMISSIONS.
  // The service checks specific perms (e.g. approvals:cancel) via user.permissions.
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

function makeRequestWithoutCancel(role: keyof typeof USERS): ServiceReq {
  const perms = new Set<Permission>([
    "approvals:read",
    "approvals:request",
    "approvals:act",
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

/** Deterministic gate-28 entity ids so cleanup can find them. */
function gate28EntityId(suffix: string): string {
  return `00000000-0000-0000-0000-0000002800${suffix}`;
}

describe("gate-28 (arch phase 3.3): approval workflows", () => {
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
      // Deleting requests cascades into approval_steps + workflow_transitions.
      await client.query(
        `DELETE FROM approval_requests WHERE entity_id::text LIKE '00000000-0000-0000-0000-0000002800%'`,
      );
    });
  });

  // ── 1. Chain resolution ──────────────────────────────────────────────────

  describe("1. chain resolution", () => {
    it("picks PM-only chain for <5L work_order", async () => {
      const entityId = gate28EntityId("01");
      const detail = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "250000", // 2.5L
          currency: "INR",
        },
      );
      expect(detail.steps).toHaveLength(1);
      expect(detail.steps[0]!.roleId).toBe("PRODUCTION_MANAGER");
      expect(detail.request.status).toBe("PENDING");
      expect(detail.request.currentStep).toBe(1);
    });

    it("picks PM → FIN chain for 5L-20L work_order", async () => {
      const entityId = gate28EntityId("02");
      const detail = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "750000", // 7.5L
          currency: "INR",
        },
      );
      expect(detail.steps).toHaveLength(2);
      expect(detail.steps.map((s) => s.roleId)).toEqual([
        "PRODUCTION_MANAGER",
        "FINANCE",
      ]);
    });

    it("picks PM → FIN → MGMT chain for >=20L work_order", async () => {
      const entityId = gate28EntityId("03");
      const detail = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "2500000", // 25L
          currency: "INR",
        },
      );
      expect(detail.steps).toHaveLength(3);
      expect(detail.steps.map((s) => s.roleId)).toEqual([
        "PRODUCTION_MANAGER",
        "FINANCE",
        "MANAGEMENT",
      ]);
    });
  });

  // ── 2. Full 3-tier walk ──────────────────────────────────────────────────

  describe("2. full 3-tier walk", () => {
    it("approves step-by-step until APPROVED and logs each transition", async () => {
      const entityId = gate28EntityId("10");
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

      // Step 1 — PM approves.
      const afterPm = await approvals.act(
        makeRequest("PRODUCTION_MANAGER"),
        requestId,
        { action: "APPROVE", comment: "PM ok" },
      );
      expect(afterPm.request.currentStep).toBe(2);
      expect(afterPm.request.status).toBe("PENDING");
      expect(afterPm.steps.find((s) => s.stepNumber === 1)!.status).toBe(
        "APPROVED",
      );

      // Step 2 — FIN approves.
      const afterFin = await approvals.act(
        makeRequest("FINANCE"),
        requestId,
        { action: "APPROVE", comment: "budget ok" },
      );
      expect(afterFin.request.currentStep).toBe(3);
      expect(afterFin.request.status).toBe("PENDING");

      // Step 3 — MGMT approves; request is now APPROVED.
      const afterMgmt = await approvals.act(
        makeRequest("MANAGEMENT"),
        requestId,
        { action: "APPROVE", comment: "signed off" },
      );
      expect(afterMgmt.request.status).toBe("APPROVED");
      expect(afterMgmt.request.currentStep).toBeNull();
      expect(afterMgmt.request.completedAt).not.toBeNull();
      expect(afterMgmt.request.completedBy).toBe(USERS.MANAGEMENT);

      // Transition log: CREATE + 3×APPROVE, in order.
      expect(afterMgmt.transitions.map((t) => t.action)).toEqual([
        "CREATE",
        "APPROVE",
        "APPROVE",
        "APPROVE",
      ]);
      expect(afterMgmt.transitions.map((t) => t.toStatus)).toEqual([
        "PENDING",
        "APPROVED",
        "APPROVED",
        "APPROVED",
      ]);
    });
  });

  // ── 3. Reject short-circuits ─────────────────────────────────────────────

  describe("3. reject short-circuits", () => {
    it("finalises to REJECTED at the rejecting step, later steps stay PENDING", async () => {
      const entityId = gate28EntityId("20");
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

      const afterPm = await approvals.act(
        makeRequest("PRODUCTION_MANAGER"),
        requestId,
        { action: "REJECT", comment: "capacity full" },
      );
      expect(afterPm.request.status).toBe("REJECTED");
      expect(afterPm.request.currentStep).toBeNull();
      expect(afterPm.steps.find((s) => s.stepNumber === 1)!.status).toBe(
        "REJECTED",
      );
      // Later steps remain PENDING because the request short-circuited.
      expect(afterPm.steps.find((s) => s.stepNumber === 2)!.status).toBe(
        "PENDING",
      );
      expect(afterPm.steps.find((s) => s.stepNumber === 3)!.status).toBe(
        "PENDING",
      );

      // Cannot act further — request is terminal.
      await expect(
        approvals.act(makeRequest("FINANCE"), requestId, {
          action: "APPROVE",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  // ── 4. Role guard ────────────────────────────────────────────────────────

  describe("4. role guard", () => {
    it("FINANCE cannot approve a step assigned to PRODUCTION_MANAGER", async () => {
      const entityId = gate28EntityId("30");
      const detail = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "250000",
          currency: "INR",
        },
      );
      await expect(
        approvals.act(makeRequest("FINANCE"), detail.request.id, {
          action: "APPROVE",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // ── 5. E-signature required ──────────────────────────────────────────────

  describe("5. e-signature for device_qc_final", () => {
    it("rejects act() without an eSignaturePayload when the step requires one", async () => {
      const entityId = gate28EntityId("40");
      const detail = await approvals.createRequest(
        makeRequest("QC_INSPECTOR"),
        {
          entityType: "device_qc_final",
          entityId,
          currency: "INR",
        },
      );
      expect(detail.steps[0]!.requiresESignature).toBe(true);
      await expect(
        approvals.act(makeRequest("QC_INSPECTOR"), detail.request.id, {
          action: "APPROVE",
          comment: "looks good",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("accepts act() with a payload and stores a SHA-256 hex hash", async () => {
      const entityId = gate28EntityId("41");
      const detail = await approvals.createRequest(
        makeRequest("QC_INSPECTOR"),
        {
          entityType: "device_qc_final",
          entityId,
          currency: "INR",
        },
      );
      const after = await approvals.act(
        makeRequest("QC_INSPECTOR"),
        detail.request.id,
        {
          action: "APPROVE",
          comment: "device cleared",
          eSignaturePayload: "I, QC Inspector, certify device release.",
        },
      );
      expect(after.request.status).toBe("APPROVED");
      const step = after.steps[0]!;
      expect(step.eSignatureHash).toMatch(/^[0-9a-f]{64}$/);
      // Transition also carries the hash.
      const approveTxn = after.transitions.find((t) => t.action === "APPROVE")!;
      expect(approveTxn.eSignatureHash).toBe(step.eSignatureHash);
    });
  });

  // ── 6. Deal discount gate ────────────────────────────────────────────────

  describe("6. deal_discount ≤15% is refused", () => {
    it("raises ValidationError for 10% discount", async () => {
      const entityId = gate28EntityId("50");
      await expect(
        approvals.createRequest(makeRequest("SALES_MANAGER"), {
          entityType: "deal_discount",
          entityId,
          amount: "10",
          currency: "INR",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("accepts a 20% discount and picks SALES_MANAGER → FINANCE chain", async () => {
      const entityId = gate28EntityId("51");
      const detail = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "deal_discount",
          entityId,
          amount: "20",
          currency: "INR",
        },
      );
      expect(detail.steps.map((s) => s.roleId)).toEqual([
        "SALES_MANAGER",
        "FINANCE",
      ]);
    });
  });

  // ── 7. Duplicate pending ─────────────────────────────────────────────────

  describe("7. one pending request per entity", () => {
    it("raises ConflictError when a second PENDING request is created", async () => {
      const entityId = gate28EntityId("60");
      await approvals.createRequest(makeRequest("SALES_MANAGER"), {
        entityType: "work_order",
        entityId,
        amount: "100000",
        currency: "INR",
      });
      await expect(
        approvals.createRequest(makeRequest("SALES_MANAGER"), {
          entityType: "work_order",
          entityId,
          amount: "100000",
          currency: "INR",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("allows a new request after the prior one is CANCELLED", async () => {
      const entityId = gate28EntityId("61");
      const first = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "100000",
          currency: "INR",
        },
      );
      await approvals.cancelRequest(
        makeRequest("SALES_MANAGER"),
        first.request.id,
        "revised scope",
      );
      const second = await approvals.createRequest(
        makeRequest("SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "100000",
          currency: "INR",
        },
      );
      expect(second.request.id).not.toBe(first.request.id);
      expect(second.request.status).toBe("PENDING");
    });
  });

  // ── 8. Concurrency ───────────────────────────────────────────────────────

  describe("8. concurrent act on the same step", () => {
    it("exactly one approver wins; the rest see ConflictError", async () => {
      const entityId = gate28EntityId("70");
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

      const attempts = 5;
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, () =>
          approvals.act(makeRequest("PRODUCTION_MANAGER"), requestId, {
            action: "APPROVE",
          }),
        ),
      );
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(attempts - 1);
      for (const r of rejected) {
        const reason = (r as PromiseRejectedResult).reason;
        expect(reason).toBeInstanceOf(ConflictError);
      }

      // Request is now APPROVED (single-step chain).
      const final = (fulfilled[0] as PromiseFulfilledResult<
        Awaited<ReturnType<ApprovalsService["act"]>>
      >).value;
      expect(final.request.status).toBe("APPROVED");
    });
  });

  // ── 9. Cancellation ──────────────────────────────────────────────────────

  describe("9. cancel by requester vs non-requester", () => {
    it("allows the original requester to cancel their own request", async () => {
      const entityId = gate28EntityId("80");
      const detail = await approvals.createRequest(
        makeRequestWithoutCancel("SALES_REP"),
        {
          entityType: "work_order",
          entityId,
          amount: "100000",
          currency: "INR",
        },
      );
      // SALES_REP has no approvals:cancel perm — but they created this
      // request, so service lets them cancel their own.
      const cancelled = await approvals.cancelRequest(
        makeRequestWithoutCancel("SALES_REP"),
        detail.request.id,
        "no longer needed",
      );
      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.cancellationReason).toBe("no longer needed");
    });

    it("rejects cancel from a different user without approvals:cancel", async () => {
      const entityId = gate28EntityId("81");
      const detail = await approvals.createRequest(
        makeRequestWithoutCancel("SALES_REP"),
        {
          entityType: "work_order",
          entityId,
          amount: "100000",
          currency: "INR",
        },
      );
      await expect(
        approvals.cancelRequest(
          makeRequestWithoutCancel("STORES"),
          detail.request.id,
          "not mine",
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
