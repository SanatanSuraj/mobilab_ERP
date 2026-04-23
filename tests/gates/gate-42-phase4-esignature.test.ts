/**
 * Gate 42 — ARCHITECTURE.md Phase 4 §4.2 / §9.5 "Electronic Signature Flow".
 *
 * Proves that any approval step with `requires_e_signature = true`
 * gates advancement behind a real 21 CFR Part 11-style signature:
 *
 *   1. The user MUST re-type their password. The server bcrypt.compares
 *      against user_identities.password_hash — zero trust in the
 *      existing session cookie alone.
 *   2. On match, the action proceeds AND an HMAC-SHA256 hash of
 *      (reason || user_identity_id || actedAt), keyed with
 *      ESIGNATURE_PEPPER, is stored on BOTH the approval_steps row
 *      and the workflow_transitions audit row so an auditor can
 *      recompute from disclosed inputs.
 *   3. On mismatch, the whole act() call is rejected with
 *      UnauthorizedError BEFORE any state change — no PENDING→APPROVED
 *      transition on the step, no workflow_transitions APPROVE row.
 *   4. Backward-compat: non-e-signature steps still advance without
 *      any password field, so the §3.3 3-tier work_order/PO chains
 *      don't regress.
 *
 * Scenarios:
 *   42.1  missing password on requires-e-sig step → ValidationError,
 *         step stays PENDING.
 *   42.2  missing payload, password present → ValidationError,
 *         step stays PENDING.
 *   42.3  WRONG password → UnauthorizedError, step stays PENDING, no
 *         APPROVE transition row appended.
 *   42.4  correct password → APPROVED, hash stored on step + the
 *         matching workflow_transitions row; recomputing HMAC-SHA256
 *         against the DB-visible inputs reproduces the same hex,
 *         proving auditability.
 *   42.5  requires_e_signature=false steps ignore the e-sig block
 *         even when an EsignatureService is injected (the PM step of
 *         a work_order chain advances without any password).
 *   42.6  boot misconfig — ApprovalsService without an injected
 *         EsignatureService fails closed on a requires-e-sig step
 *         with ValidationError (NOT "silently succeed" or "500").
 *   42.7  session carrying identityId=null (pre-§4.2 token or
 *         vendor-admin) → UnauthorizedError; server cannot resolve
 *         the password_hash so it must refuse.
 *
 * Cleanup: gate-42 entity_ids use the ...42xx suffix; beforeEach
 * truncates the slice so re-runs don't collide.
 */

import { createHmac } from "node:crypto";
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
import { EsignatureService } from "@instigenie/api/esignature";
import {
  AUDIENCE,
  type Permission,
  type Role,
} from "@instigenie/contracts";
import {
  UnauthorizedError,
  ValidationError,
} from "@instigenie/errors";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

// ── Dev seed fixtures (ops/sql/seed/03-dev-org-users.sql) ─────────────
// The QC inspector's identity + per-tenant user row + password.
const USER_ID = "00000000-0000-0000-0000-00000000b009";
const IDENTITY_ID = "00000000-0000-0000-0000-00000000f009";
const PASSWORD = "instigenie_dev_2026";
const WRONG_PASSWORD = "incorrect-password-42";
// Production-manager fixtures for the non-e-sig backward-compat test.
const PM_USER_ID = "00000000-0000-0000-0000-00000000b007";
const PM_IDENTITY_ID = "00000000-0000-0000-0000-00000000f007";
const SALES_MGR_USER_ID = "00000000-0000-0000-0000-00000000b004";
const SALES_MGR_IDENTITY_ID = "00000000-0000-0000-0000-00000000f004";

const TEST_PEPPER = "gate-42-test-pepper-7ad4e59c-do-not-use-in-prod";

type ServiceReq = Parameters<ApprovalsService["createRequest"]>[0];

/**
 * Build a minimal RequestUser stub. The service reads only
 * { id, orgId, roles, identityId, permissions }; everything else is
 * covered by the `as unknown as` cast.
 */
function makeRequest(args: {
  userId: string;
  identityId: string | null;
  role: Role;
}): ServiceReq {
  const perms = new Set<Permission>([
    "approvals:read",
    "approvals:request",
    "approvals:act",
    "approvals:cancel",
  ]);
  return {
    user: {
      id: args.userId,
      identityId: args.identityId,
      orgId: DEV_ORG_ID,
      email: `${args.role.toLowerCase()}@instigenie.local`,
      roles: [args.role],
      permissions: perms,
      audience: AUDIENCE.internal,
    },
  } as unknown as ServiceReq;
}

function qcRequest(identityId: string | null = IDENTITY_ID): ServiceReq {
  return makeRequest({ userId: USER_ID, identityId, role: "QC_INSPECTOR" });
}

function pmRequest(): ServiceReq {
  return makeRequest({
    userId: PM_USER_ID,
    identityId: PM_IDENTITY_ID,
    role: "PRODUCTION_MANAGER",
  });
}

function salesMgrRequest(): ServiceReq {
  return makeRequest({
    userId: SALES_MGR_USER_ID,
    identityId: SALES_MGR_IDENTITY_ID,
    role: "SALES_MANAGER",
  });
}

/** Deterministic gate-42 entity ids so cleanup can find them. */
function gate42EntityId(suffix: string): string {
  return `00000000-0000-0000-0000-0000004200${suffix}`;
}

/**
 * Recomputes the expected HMAC-SHA256 exactly the way EsignatureService
 * does it so Gate 42.4 can assert determinism against a known hash
 * (without reaching into the service's private fields).
 */
function recomputeHash(args: {
  reason: string;
  identityId: string;
  actedAt: string;
  pepper: string;
}): string {
  const mac = createHmac("sha256", args.pepper);
  mac.update(args.reason);
  mac.update("\x00");
  mac.update(args.identityId);
  mac.update("\x00");
  mac.update(args.actedAt);
  return mac.digest("hex");
}

describe("gate-42 (arch phase 4.2): electronic signature flow", () => {
  let pool: pg.Pool;
  let esignature: EsignatureService;
  let approvalsWithEsig: ApprovalsService;
  let approvalsWithoutEsig: ApprovalsService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    esignature = new EsignatureService({ pool, pepper: TEST_PEPPER });
    approvalsWithEsig = new ApprovalsService({ pool, esignature });
    // Bare-pool overload so we can exercise the "boot misconfig" path.
    approvalsWithoutEsig = new ApprovalsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `SELECT set_config('app.current_user', $1, true)`,
        [USER_ID],
      );
      // Deleting requests cascades into approval_steps + workflow_transitions.
      await client.query(
        `DELETE FROM approval_requests WHERE entity_id::text LIKE '00000000-0000-0000-0000-0000004200%'`,
      );
    });
  });

  // ── 42.1 missing password ─────────────────────────────────────────────

  it("42.1 rejects act() on requires-e-sig step when password is missing", async () => {
    const entityId = gate42EntityId("01");
    const detail = await approvalsWithEsig.createRequest(qcRequest(), {
      entityType: "device_qc_final",
      entityId,
      currency: "INR",
    });
    expect(detail.steps[0]!.requiresESignature).toBe(true);

    await expect(
      approvalsWithEsig.act(qcRequest(), detail.request.id, {
        action: "APPROVE",
        comment: "cleared",
        eSignaturePayload: "I certify device release.",
        // no eSignaturePassword
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // Step stayed PENDING.
    const after = await approvalsWithEsig.getRequestDetail(
      qcRequest(),
      detail.request.id,
    );
    expect(after.steps[0]!.status).toBe("PENDING");
    expect(after.transitions.find((t) => t.action === "APPROVE")).toBeUndefined();
  });

  // ── 42.2 missing payload ──────────────────────────────────────────────

  it("42.2 rejects act() on requires-e-sig step when payload is missing", async () => {
    const entityId = gate42EntityId("02");
    const detail = await approvalsWithEsig.createRequest(qcRequest(), {
      entityType: "device_qc_final",
      entityId,
      currency: "INR",
    });
    await expect(
      approvalsWithEsig.act(qcRequest(), detail.request.id, {
        action: "APPROVE",
        comment: "cleared",
        // no eSignaturePayload
        eSignaturePassword: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await approvalsWithEsig.getRequestDetail(
      qcRequest(),
      detail.request.id,
    );
    expect(after.steps[0]!.status).toBe("PENDING");
  });

  // ── 42.3 wrong password ───────────────────────────────────────────────

  it("42.3 rejects act() with UnauthorizedError on wrong password and does not advance", async () => {
    const entityId = gate42EntityId("03");
    const detail = await approvalsWithEsig.createRequest(qcRequest(), {
      entityType: "device_qc_final",
      entityId,
      currency: "INR",
    });

    await expect(
      approvalsWithEsig.act(qcRequest(), detail.request.id, {
        action: "APPROVE",
        comment: "cleared",
        eSignaturePayload: "I certify device release.",
        eSignaturePassword: WRONG_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const after = await approvalsWithEsig.getRequestDetail(
      qcRequest(),
      detail.request.id,
    );
    // Step still PENDING, request still PENDING, no APPROVE in log.
    expect(after.steps[0]!.status).toBe("PENDING");
    expect(after.request.status).toBe("PENDING");
    expect(after.request.currentStep).toBe(1);
    expect(after.transitions.map((t) => t.action)).toEqual(["CREATE"]);
    expect(after.steps[0]!.eSignatureHash).toBeNull();
  });

  // ── 42.4 correct password → happy path + hash reproducibility ─────────

  it("42.4 advances on correct password and stores a reproducible HMAC hash on step + transition", async () => {
    const entityId = gate42EntityId("04");
    const reason = "I, QC Inspector, certify device 42-04 passes final QC.";
    const detail = await approvalsWithEsig.createRequest(qcRequest(), {
      entityType: "device_qc_final",
      entityId,
      currency: "INR",
    });

    const actStart = Date.now();
    const after = await approvalsWithEsig.act(
      qcRequest(),
      detail.request.id,
      {
        action: "APPROVE",
        comment: "cleared",
        eSignaturePayload: reason,
        eSignaturePassword: PASSWORD,
      },
    );
    const actEnd = Date.now();

    expect(after.request.status).toBe("APPROVED");
    const step = after.steps[0]!;
    expect(step.status).toBe("APPROVED");
    expect(step.eSignatureHash).toMatch(/^[0-9a-f]{64}$/);
    // Transition also carries the same hash (same actedAt, same inputs).
    const approveTxn = after.transitions.find((t) => t.action === "APPROVE");
    expect(approveTxn).toBeDefined();
    expect(approveTxn!.eSignatureHash).toBe(step.eSignatureHash);

    // Reproduce the hash independently: pull actedAt off the step and
    // HMAC-SHA256 with our TEST_PEPPER. Must match exactly.
    expect(step.actedAt).not.toBeNull();
    const expected = recomputeHash({
      reason,
      identityId: IDENTITY_ID,
      actedAt: step.actedAt!,
      pepper: TEST_PEPPER,
    });
    expect(step.eSignatureHash).toBe(expected);

    // actedAt is within the wall-clock window of the call — sanity-check
    // that the server picked it, not the client.
    const acted = new Date(step.actedAt!).getTime();
    expect(acted).toBeGreaterThanOrEqual(actStart - 1000);
    expect(acted).toBeLessThanOrEqual(actEnd + 1000);
  });

  // ── 42.5 non-e-sig step backward compat ───────────────────────────────

  it("42.5 non-e-sig steps advance without a password even with esignature injected", async () => {
    // work_order PM step (<5L chain) does NOT require e-signature.
    const entityId = gate42EntityId("05");
    const detail = await approvalsWithEsig.createRequest(salesMgrRequest(), {
      entityType: "work_order",
      entityId,
      amount: "250000", // 2.5L → PM-only chain
      currency: "INR",
    });
    expect(detail.steps).toHaveLength(1);
    expect(detail.steps[0]!.requiresESignature).toBe(false);

    const after = await approvalsWithEsig.act(
      pmRequest(),
      detail.request.id,
      {
        action: "APPROVE",
        comment: "PM ok",
        // No payload, no password — and that's fine.
      },
    );
    expect(after.request.status).toBe("APPROVED");
    expect(after.steps[0]!.eSignatureHash).toBeNull();
    const approveTxn = after.transitions.find((t) => t.action === "APPROVE")!;
    expect(approveTxn.eSignatureHash).toBeNull();
  });

  // ── 42.6 fail-closed when EsignatureService not injected ──────────────

  it("42.6 fails closed on requires-e-sig step when EsignatureService is absent", async () => {
    const entityId = gate42EntityId("06");
    const detail = await approvalsWithoutEsig.createRequest(qcRequest(), {
      entityType: "device_qc_final",
      entityId,
      currency: "INR",
    });

    // Even with BOTH payload and password, the missing dep means the
    // server cannot verify; must reject, not silently advance.
    await expect(
      approvalsWithoutEsig.act(qcRequest(), detail.request.id, {
        action: "APPROVE",
        comment: "cleared",
        eSignaturePayload: "I certify device release.",
        eSignaturePassword: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const after = await approvalsWithoutEsig.getRequestDetail(
      qcRequest(),
      detail.request.id,
    );
    expect(after.steps[0]!.status).toBe("PENDING");
    expect(after.request.status).toBe("PENDING");
  });

  // ── 42.7 session without identityId ──────────────────────────────────

  it("42.7 rejects with UnauthorizedError when the session has no identityId", async () => {
    const entityId = gate42EntityId("07");
    const detail = await approvalsWithEsig.createRequest(
      qcRequest(),
      {
        entityType: "device_qc_final",
        entityId,
        currency: "INR",
      },
    );

    await expect(
      approvalsWithEsig.act(qcRequest(null), detail.request.id, {
        action: "APPROVE",
        comment: "cleared",
        eSignaturePayload: "I certify device release.",
        eSignaturePassword: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const after = await approvalsWithEsig.getRequestDetail(
      qcRequest(),
      detail.request.id,
    );
    expect(after.steps[0]!.status).toBe("PENDING");
  });
});
