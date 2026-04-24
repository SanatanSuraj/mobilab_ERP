/**
 * Gate 62 — Concurrent approval act: DB-audit-trail invariant under races.
 *
 * TESTING_PLAN.md §3.3 / §6 priority gap:
 *   "Concurrent approval act race — two authed clients → simultaneous
 *    POST /approvals/:id/act — assert exactly one APPROVED decision at
 *    both the service-response layer AND the workflow_transitions audit
 *    layer."
 *
 * Gate 28 §8 already proves the SAME-user racing case (5 parallel act()
 * calls by one user → 1 winner, 4 ConflictError). What Gate 28 does NOT
 * cover, and what §6 specifically flags as missing:
 *
 *   (A) Two DIFFERENT users, both holding the step's role, racing
 *       APPROVE on the same step. This is the realistic production race
 *       — two managers see the same inbox item and click approve at
 *       once.
 *
 *   (B) APPROVE vs REJECT — two approvers race but one clicks APPROVE
 *       and the other clicks REJECT. The loser must get ConflictError;
 *       the winner's decision is what persists. The state machine must
 *       not silently accept both.
 *
 * In both cases we assert the invariant at THREE layers so a regression
 * can't slip past by just the service returning correctly:
 *
 *   1. Service — exactly one act() resolves, the other rejects with
 *      ConflictError. Never ValidationError, never some unrelated
 *      class — that's the contract the API handlers translate to 409.
 *   2. approval_steps — the contested step row has exactly one
 *      non-PENDING decision (acted_by / acted_at / status).
 *   3. workflow_transitions — exactly one APPROVE-or-REJECT transition
 *      row for the contested step, because workflow_transitions is the
 *      append-only audit log and a double-write there would leave an
 *      auditor unable to tell who really approved.
 *
 * Dev seed gives us two users per role (03-dev-org-users.sql):
 *   PRODUCTION_MANAGER: b007 + b101
 *   FINANCE:            b005 + b10a
 *   MANAGEMENT:         b002 + b10c
 * We use PRODUCTION_MANAGER for a single-step work_order approval
 * (amount <5L) because that chain has only one PM step — the entire
 * request finalises on the first (and only) act(), which makes the
 * "exactly one decision" assertion crisp.
 *
 * Cleanup: uses deterministic gate-62 entity ids (...6200...) and
 * wipes under withOrg() because approval_requests is RLS-forced.
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

// Dev seed users (ops/sql/seed/03-dev-org-users.sql). Two per role so we
// can race two DIFFERENT identities rather than duplicating one user.
const USERS = {
  SALES_MANAGER: "00000000-0000-0000-0000-00000000b004",
  PM_A: "00000000-0000-0000-0000-00000000b007",
  PM_B: "00000000-0000-0000-0000-00000000b101",
} as const;

type ServiceReq = Parameters<ApprovalsService["createRequest"]>[0];

function makeReq(userId: string, role: Role): ServiceReq {
  const perms = new Set<Permission>([
    "approvals:read",
    "approvals:request",
    "approvals:act",
    "approvals:cancel",
  ]);
  return {
    user: {
      id: userId,
      orgId: DEV_ORG_ID,
      email: `${role.toLowerCase()}@instigenie.local`,
      roles: [role],
      permissions: perms,
      audience: AUDIENCE.internal,
    },
  } as unknown as ServiceReq;
}

/** Deterministic gate-62 entity ids so cleanup can find them. */
function gate62EntityId(suffix: string): string {
  return `00000000-0000-0000-0000-0000006200${suffix}`;
}

describe("gate-62: concurrent approval act — two-user race + approve/reject race", () => {
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
      // The audit trigger wants app.current_user even for deletes — set
      // it so the cascade below doesn't raise.
      await client.query(
        `SELECT set_config('app.current_user', $1, true)`,
        [USERS.SALES_MANAGER],
      );
      await client.query(
        `DELETE FROM approval_requests WHERE entity_id::text LIKE '00000000-0000-0000-0000-0000006200%'`,
      );
    });
  });

  // ── A. Two distinct users with the same role race APPROVE ──────────────

  it(
    "two different PRODUCTION_MANAGERs race APPROVE → exactly one wins at service + DB + audit layers",
    async () => {
      const entityId = gate62EntityId("01");
      // Single-step PM chain (<5L) — the first act() both decides the
      // step AND finalises the request, so the "exactly one decision"
      // invariant maps cleanly onto both tables.
      const detail = await approvals.createRequest(
        makeReq(USERS.SALES_MANAGER, "SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "250000", // 2.5L → 1-step PM chain
          currency: "INR",
        },
      );
      const requestId = detail.request.id;
      expect(detail.steps).toHaveLength(1);
      expect(detail.steps[0]!.roleId).toBe("PRODUCTION_MANAGER");

      // Race: two *different* PM identities fire APPROVE concurrently.
      const results = await Promise.allSettled([
        approvals.act(makeReq(USERS.PM_A, "PRODUCTION_MANAGER"), requestId, {
          action: "APPROVE",
          comment: "PM A sign-off",
        }),
        approvals.act(makeReq(USERS.PM_B, "PRODUCTION_MANAGER"), requestId, {
          action: "APPROVE",
          comment: "PM B sign-off",
        }),
      ]);

      // Layer 1 — service response: exactly 1 fulfilled, 1 rejected.
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictError,
      );

      const winner = (
        fulfilled[0] as PromiseFulfilledResult<
          Awaited<ReturnType<ApprovalsService["act"]>>
        >
      ).value;
      expect(winner.request.status).toBe("APPROVED");
      // The winner's acted_by is whichever PM got the lock first — we
      // don't care which, only that it's exactly one of the two PMs and
      // is consistent across the step + transition rows.
      const winnerActedBy = winner.steps[0]!.actedBy!;
      expect([USERS.PM_A, USERS.PM_B]).toContain(winnerActedBy);

      // Layer 2 — approval_steps has exactly one non-PENDING decision.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const { rows: stepRows } = await client.query<{
          count: string;
          acted_by: string;
          status: string;
        }>(
          `SELECT COUNT(*)::text AS count,
                  bool_and(acted_by = $2) AS actor_consistent,
                  (array_agg(acted_by))[1] AS acted_by,
                  (array_agg(status))[1] AS status
             FROM approval_steps
            WHERE request_id = $1
              AND status <> 'PENDING'`,
          [requestId, winnerActedBy],
        );
        expect(stepRows[0]!.count).toBe("1");
        expect(stepRows[0]!.status).toBe("APPROVED");
        expect(stepRows[0]!.acted_by).toBe(winnerActedBy);
      });

      // Layer 3 — workflow_transitions append-only log has exactly one
      // APPROVE-or-REJECT row for this request (plus a CREATE row from
      // createRequest). A duplicate here would mean two auditable
      // actions resolved against one step — catastrophic in a legal
      // audit context.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const { rows: trans } = await client.query<{
          action: string;
          actor_id: string;
        }>(
          `SELECT action, actor_id FROM workflow_transitions
            WHERE request_id = $1
            ORDER BY created_at ASC`,
          [requestId],
        );
        // CREATE + exactly one APPROVE.
        expect(trans.map((t) => t.action)).toEqual(["CREATE", "APPROVE"]);
        // The APPROVE row's actor_id matches the winner.
        expect(trans[1]!.actor_id).toBe(winnerActedBy);
      });
    },
  );

  // ── B. APPROVE vs REJECT race ──────────────────────────────────────────

  it(
    "APPROVE vs REJECT race → exactly one decision lands and it is consistent across step + request + audit log",
    async () => {
      const entityId = gate62EntityId("02");
      const detail = await approvals.createRequest(
        makeReq(USERS.SALES_MANAGER, "SALES_MANAGER"),
        {
          entityType: "work_order",
          entityId,
          amount: "250000",
          currency: "INR",
        },
      );
      const requestId = detail.request.id;

      // PM_A clicks APPROVE, PM_B clicks REJECT — simultaneously.
      // Whichever takes the FOR UPDATE lock first writes their decision;
      // the loser sees the step as non-PENDING and gets ConflictError.
      const results = await Promise.allSettled([
        approvals.act(makeReq(USERS.PM_A, "PRODUCTION_MANAGER"), requestId, {
          action: "APPROVE",
          comment: "A approves",
        }),
        approvals.act(makeReq(USERS.PM_B, "PRODUCTION_MANAGER"), requestId, {
          action: "REJECT",
          comment: "B rejects",
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictError,
      );

      const winner = (
        fulfilled[0] as PromiseFulfilledResult<
          Awaited<ReturnType<ApprovalsService["act"]>>
        >
      ).value;
      // The winner determines the final request status — either all-A
      // (APPROVED) or all-B (REJECTED). It must never be a mixed state.
      expect(["APPROVED", "REJECTED"]).toContain(winner.request.status);
      const winnerStatus = winner.request.status;
      const winnerActedBy = winner.steps[0]!.actedBy!;
      const winnerAction = winnerStatus === "APPROVED" ? "APPROVE" : "REJECT";

      // Same three-layer audit:
      //   2) approval_steps — one decision, status matches winner.
      //   3) workflow_transitions — CREATE + exactly one winner action.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const { rows: stepRows } = await client.query<{
          count: string;
          status: string;
          acted_by: string;
        }>(
          `SELECT COUNT(*)::text AS count,
                  (array_agg(status))[1] AS status,
                  (array_agg(acted_by))[1] AS acted_by
             FROM approval_steps
            WHERE request_id = $1
              AND status <> 'PENDING'`,
          [requestId],
        );
        expect(stepRows[0]!.count).toBe("1");
        expect(stepRows[0]!.status).toBe(winnerStatus);
        expect(stepRows[0]!.acted_by).toBe(winnerActedBy);

        const { rows: trans } = await client.query<{
          action: string;
          actor_id: string;
          to_status: string;
        }>(
          `SELECT action, actor_id, to_status FROM workflow_transitions
            WHERE request_id = $1
            ORDER BY created_at ASC`,
          [requestId],
        );
        expect(trans.map((t) => t.action)).toEqual(["CREATE", winnerAction]);
        expect(trans[1]!.actor_id).toBe(winnerActedBy);
        expect(trans[1]!.to_status).toBe(winnerStatus);
      });

      // Request row agrees with the step + transition it persisted.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const { rows } = await client.query<{
          status: string;
          completed_by: string | null;
          current_step: number | null;
        }>(
          `SELECT status, completed_by, current_step FROM approval_requests WHERE id = $1`,
          [requestId],
        );
        expect(rows[0]!.status).toBe(winnerStatus);
        expect(rows[0]!.completed_by).toBe(winnerActedBy);
        expect(rows[0]!.current_step).toBeNull();
      });
    },
  );
});
