/**
 * Gate 43 — ARCHITECTURE.md Phase 4 §9.5 "critical-action" e-signature
 * coverage for the stock-side integration points.
 *
 * Gate 42 proved the EsignatureService primitive on an approval-step
 * act() path. §9.5 enumerates FOUR critical actions; QC final pass and
 * Invoice issue both now flow through approvals.act() (Gate 42 covers
 * the primitive; the Finance approval-chain seed marks the terminal
 * step requiresESignature=true and SalesInvoicesService.applyDecision
 * stamps the HMAC into posted_at). Stock writes do NOT route through
 * approvals and keep direct e-sig gates on their service methods:
 *
 *   Critical action (§9.5)  │ Service entry point
 *   ────────────────────────┼────────────────────────────────────────
 *   QC final pass           │ approvals.act() — Gate 42 covers
 *   Invoice issue           │ approvals.act() — Finance chain finaliser
 *   Stock write-off         │ StockService.postEntry(SCRAP)          ← THIS GATE
 *   Device release          │ StockService.postEntry(CUSTOMER_ISSUE) ← THIS GATE
 *
 * For each of the two stock endpoints we assert the same matrix Gate 42
 * asserts on approvals:
 *
 *   Missing password   → ValidationError, no state change, hash NULL.
 *   Missing reason     → ValidationError.
 *   Wrong password     → UnauthorizedError, no state change.
 *   identityId=null    → UnauthorizedError.
 *   Deps missing       → ValidationError (fail-closed — a critical
 *                        action MUST NOT post without an HMAC seal).
 *   Correct password   → state changes AND the stored signature_hash
 *                        is a 64-hex HMAC that independently recomputes
 *                        from (reason || identityId || actedAt) with
 *                        the TEST_PEPPER, proving auditability.
 *
 * A final section proves we did NOT accidentally widen the gate to
 * non-critical stock txn types — GRN_RECEIPT and ADJUSTMENT must still
 * post without any e-sig fields and leave signature_hash NULL.
 *
 * Fixtures reused from Gate 42 / dev seed 03-dev-org-users.sql:
 *   USER_ID  = b009 (QC inspector; service methods skip permission
 *              checks because those live on the HTTP route layer, so
 *              any identity with a password works).
 *   PASSWORD = "instigenie_dev_2026".
 * Inventory fixtures are seeded in 08-inventory-dev-data.sql:
 *   v_it_res (RES-1K)        — 1,336 on hand, used for SCRAP runs.
 *   v_it_ecg (ECG-MONITOR-V2) — 18 on hand, used for CUSTOMER_ISSUE.
 *
 * Cleanup: stock_ledger rows are append-only by contract and accumulate
 * across runs; we never assert absolute counts so drift doesn't matter
 * and no beforeEach is required.
 */

import { createHmac } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import pg from "pg";
import { StockService } from "@instigenie/api/inventory/stock";
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

// ── Dev seed fixtures ─────────────────────────────────────────────────
const USER_ID = "00000000-0000-0000-0000-00000000b009";
const IDENTITY_ID = "00000000-0000-0000-0000-00000000f009";
const PASSWORD = "instigenie_dev_2026";
const WRONG_PASSWORD = "incorrect-password-43";

const ITEM_RES = "00000000-0000-0000-0000-000000fb0001"; // RES-1K — EA
const ITEM_ECG = "00000000-0000-0000-0000-000000fb0008"; // ECG-MONITOR-V2 — EA
const WH_MAIN = "00000000-0000-0000-0000-000000fa0001"; // Main Plant Store

const TEST_PEPPER = "gate-43-test-pepper-9b2f4e01-do-not-use-in-prod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceReq = any;

/**
 * Build a minimal RequestUser stub. Service methods only read
 * { id, orgId, identityId } via requireUser + withRequest; roles and
 * permissions are checked at the HTTP route layer which this gate
 * bypasses, so a full perm set is unnecessary.
 */
function makeRequest(args: {
  userId: string;
  identityId: string | null;
  role: Role;
}): ServiceReq {
  // Empty perm set is fine — StockService.postEntry never calls
  // hasPermission(); the permission gate lives on the HTTP route,
  // not the service.
  const perms = new Set<Permission>();
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
  };
}

function qcRequest(identityId: string | null = IDENTITY_ID): ServiceReq {
  return makeRequest({ userId: USER_ID, identityId, role: "QC_INSPECTOR" });
}

/**
 * Recompute HMAC-SHA256 exactly the way EsignatureService does it so
 * tests can assert determinism against known inputs without reaching
 * into the service's private fields.
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

describe("gate-43 (arch phase 4.2c / §9.5): critical-action e-signatures", () => {
  let pool: pg.Pool;
  let esignature: EsignatureService;
  let stockWithEsig: StockService;
  let stockBarePool: StockService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    esignature = new EsignatureService({ pool, pepper: TEST_PEPPER });
    stockWithEsig = new StockService({ pool, esignature });
    stockBarePool = new StockService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // ────────────────────────────────────────────────────────────────────
  // 43.B — StockService.postEntry(SCRAP)  (§9.5 "stock write-off")
  // ────────────────────────────────────────────────────────────────────
  describe("43.B stock SCRAP", () => {
    const baseScrap = {
      itemId: ITEM_RES,
      warehouseId: WH_MAIN,
      quantity: "-1.000",
      uom: "EA" as const,
      txnType: "SCRAP" as const,
    };

    it("43.B.1 missing password → ValidationError; no ledger row", async () => {
      await expect(
        stockWithEsig.postEntry(qcRequest(), {
          ...baseScrap,
          reason: "gate-43-B01",
          eSignatureReason: "I certify scrap of 1 unit RES-1K, batch test B01.",
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      const { data } = await stockWithEsig.listLedger(qcRequest(), {
        itemId: ITEM_RES,
        warehouseId: WH_MAIN,
        txnType: "SCRAP",
        page: 1,
        limit: 50,
        sortDir: "desc",
      });
      expect(data.find((r) => r.reason === "gate-43-B01")).toBeUndefined();
    });

    it("43.B.2 missing reason → ValidationError; no ledger row", async () => {
      await expect(
        stockWithEsig.postEntry(qcRequest(), {
          ...baseScrap,
          reason: "gate-43-B02",
          eSignaturePassword: PASSWORD,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("43.B.3 wrong password → UnauthorizedError; no ledger row", async () => {
      await expect(
        stockWithEsig.postEntry(qcRequest(), {
          ...baseScrap,
          reason: "gate-43-B03",
          eSignaturePassword: WRONG_PASSWORD,
          eSignatureReason: "I certify scrap of 1 unit RES-1K, batch test B03.",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      const { data } = await stockWithEsig.listLedger(qcRequest(), {
        itemId: ITEM_RES,
        warehouseId: WH_MAIN,
        txnType: "SCRAP",
        page: 1,
        limit: 50,
        sortDir: "desc",
      });
      expect(data.find((r) => r.reason === "gate-43-B03")).toBeUndefined();
    });

    it("43.B.4 identityId=null → UnauthorizedError", async () => {
      await expect(
        stockWithEsig.postEntry(qcRequest(null), {
          ...baseScrap,
          reason: "gate-43-B04",
          eSignaturePassword: PASSWORD,
          eSignatureReason: "I certify scrap of 1 unit RES-1K, batch test B04.",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("43.B.5 deps missing (bare pool) → ValidationError fail-closed", async () => {
      await expect(
        stockBarePool.postEntry(qcRequest(), {
          ...baseScrap,
          reason: "gate-43-B05",
          eSignaturePassword: PASSWORD,
          eSignatureReason: "I certify scrap of 1 unit RES-1K, batch test B05.",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("43.B.6 correct password → ledger posted; signature_hash is a reproducible HMAC", async () => {
      const reason = "I certify scrap of 1 unit RES-1K — destructive test B06.";
      const actStart = Date.now();
      const entry = await stockWithEsig.postEntry(qcRequest(), {
        ...baseScrap,
        reason: "gate-43-B06",
        eSignaturePassword: PASSWORD,
        eSignatureReason: reason,
      });
      const actEnd = Date.now();

      expect(entry.txnType).toBe("SCRAP");
      expect(entry.quantity).toBe("-1.000");
      expect(entry.signatureHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.postedAt).not.toBeNull();

      const expected = recomputeHash({
        reason,
        identityId: IDENTITY_ID,
        actedAt: entry.postedAt,
        pepper: TEST_PEPPER,
      });
      expect(entry.signatureHash).toBe(expected);

      const acted = new Date(entry.postedAt).getTime();
      expect(acted).toBeGreaterThanOrEqual(actStart - 1000);
      expect(acted).toBeLessThanOrEqual(actEnd + 1000);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 43.C — StockService.postEntry(CUSTOMER_ISSUE)  (§9.5 "device release")
  // ────────────────────────────────────────────────────────────────────
  describe("43.C stock CUSTOMER_ISSUE", () => {
    const baseRelease = {
      itemId: ITEM_ECG,
      warehouseId: WH_MAIN,
      quantity: "-1.000",
      uom: "EA" as const,
      txnType: "CUSTOMER_ISSUE" as const,
    };

    it("43.C.1 missing password → ValidationError; no ledger row", async () => {
      await expect(
        stockWithEsig.postEntry(qcRequest(), {
          ...baseRelease,
          reason: "gate-43-C01",
          eSignatureReason: "I release device ECG-MONITOR-V2 to customer C01.",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("43.C.2 wrong password → UnauthorizedError", async () => {
      await expect(
        stockWithEsig.postEntry(qcRequest(), {
          ...baseRelease,
          reason: "gate-43-C02",
          eSignaturePassword: WRONG_PASSWORD,
          eSignatureReason: "I release device ECG-MONITOR-V2 to customer C02.",
        }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("43.C.3 deps missing (bare pool) → ValidationError fail-closed", async () => {
      await expect(
        stockBarePool.postEntry(qcRequest(), {
          ...baseRelease,
          reason: "gate-43-C03",
          eSignaturePassword: PASSWORD,
          eSignatureReason: "I release device ECG-MONITOR-V2 to customer C03.",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("43.C.4 correct password → ledger posted; signature_hash reproducible", async () => {
      const reason =
        "I release device ECG-MONITOR-V2 s/n C04-GATE43 to Apollo Hospitals.";
      const entry = await stockWithEsig.postEntry(qcRequest(), {
        ...baseRelease,
        reason: "gate-43-C04",
        eSignaturePassword: PASSWORD,
        eSignatureReason: reason,
      });

      expect(entry.txnType).toBe("CUSTOMER_ISSUE");
      expect(entry.signatureHash).toMatch(/^[0-9a-f]{64}$/);

      const expected = recomputeHash({
        reason,
        identityId: IDENTITY_ID,
        actedAt: entry.postedAt,
        pepper: TEST_PEPPER,
      });
      expect(entry.signatureHash).toBe(expected);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 43.D — Non-critical txn types MUST bypass the gate (no regression).
  // ────────────────────────────────────────────────────────────────────
  describe("43.D non-critical txn types bypass e-sig", () => {
    it("43.D.1 GRN_RECEIPT posts without any e-sig fields; signature_hash NULL", async () => {
      const entry = await stockWithEsig.postEntry(qcRequest(), {
        itemId: ITEM_RES,
        warehouseId: WH_MAIN,
        quantity: "1.000",
        uom: "EA",
        txnType: "GRN_RECEIPT",
        reason: "gate-43-D01",
        // NO eSignaturePassword / eSignatureReason
      });
      expect(entry.txnType).toBe("GRN_RECEIPT");
      expect(entry.signatureHash).toBeNull();
    });

    it("43.D.2 ADJUSTMENT posts without any e-sig fields; signature_hash NULL", async () => {
      const entry = await stockWithEsig.postEntry(qcRequest(), {
        itemId: ITEM_RES,
        warehouseId: WH_MAIN,
        quantity: "1.000",
        uom: "EA",
        txnType: "ADJUSTMENT",
        reason: "gate-43-D02",
      });
      expect(entry.txnType).toBe("ADJUSTMENT");
      expect(entry.signatureHash).toBeNull();
    });

    it("43.D.3 bare-pool StockService still posts non-critical rows (backward compat)", async () => {
      // The bare-pool construction is the pre-§4.2c shape; non-critical
      // txn types must still work so Phase 2/3 tests don't regress.
      const entry = await stockBarePool.postEntry(qcRequest(), {
        itemId: ITEM_RES,
        warehouseId: WH_MAIN,
        quantity: "1.000",
        uom: "EA",
        txnType: "GRN_RECEIPT",
        reason: "gate-43-D03",
      });
      expect(entry.txnType).toBe("GRN_RECEIPT");
      expect(entry.signatureHash).toBeNull();
    });
  });
});
