/**
 * Gate 67 — POST /approvals/:id/act: full HTTP axis matrix.
 *
 * HTTP counterpart to Gate 62 (service-layer concurrent approval race).
 *
 * Gate 62 proves the race-safety invariants at the service + DB + audit
 * layers. Gate 67 proves the HTTP pipeline around it:
 *   • authGuard + requirePermission("approvals:act") ordering
 *   • IdParamSchema UUID validation on :id
 *   • ApprovalActPayloadSchema validation on the body
 *   • NotFoundError → 404 on missing requests
 *   • ValidationError / ConflictError surfacing through the error mapper
 *
 * Workflow engine: we POST /approvals (as SALES_MANAGER) to seed a fresh
 * PENDING request for a work_order at amount=250000 INR — this lands on
 * a single-step PRODUCTION_MANAGER chain. Then we drive POST /approvals/
 * :id/act from PRODUCTION_MANAGER.
 *
 * Cleanup: deterministic entity ids (…006700…) purged per-test under
 * withOrg() since approval_requests is RLS-forced.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { withOrg } from "@instigenie/db";
import {
  createHttpHarness,
  type HttpHarness,
} from "./_http-harness.js";
import { DEV_ORG_ID } from "./_helpers.js";

let harness: HttpHarness;

beforeAll(async () => {
  harness = await createHttpHarness();
}, 30_000);

afterAll(async () => {
  await harness.close();
});

function gate67EntityId(suffix: string): string {
  // 4-char suffix keeps us inside the 36-char UUID shape. `0067` namespace.
  return `00000000-0000-0000-0000-0000006700${suffix.padStart(2, "0")}`;
}

async function purge(): Promise<void> {
  await withOrg(harness.pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      ["00000000-0000-0000-0000-00000000b004"], // SALES_MANAGER
    );
    await client.query(
      `DELETE FROM approval_requests WHERE entity_id::text LIKE '00000000-0000-0000-0000-0000006700%'`,
    );
  });
}

beforeEach(purge);
afterEach(purge);

/**
 * Seed a fresh PENDING work-order approval request and return its id.
 * 250_000 INR lands on a 1-step PRODUCTION_MANAGER chain so one act()
 * finalises the request cleanly.
 */
async function seedRequest(suffix: string): Promise<string> {
  const smTok = await harness.tokenForRole("SALES_MANAGER");
  const res = await harness.post<{ request: { id: string } }>(
    "/approvals",
    {
      token: smTok,
      body: {
        entityType: "work_order",
        entityId: gate67EntityId(suffix),
        amount: "250000",
        currency: "INR",
      },
    },
  );
  expect(res.statusCode).toBe(201);
  return res.body.request.id;
}

describe("gate-67: POST /approvals/:id/act — HTTP axis matrix", () => {
  // ══════════════════════════════════════════════════════════════════
  // 1. Happy paths
  // ══════════════════════════════════════════════════════════════════

  describe("1. happy paths", () => {
    it("APPROVE on a fresh PM-chain request → 200 with APPROVED", async () => {
      const reqId = await seedRequest("a1");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post<{
        request: { id: string; status: string };
      }>(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "APPROVE", comment: "signed off" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.request.status).toBe("APPROVED");
    });

    it("REJECT on a fresh PM-chain request → 200 with REJECTED", async () => {
      const reqId = await seedRequest("a2");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post<{
        request: { status: string };
      }>(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "REJECT", comment: "reason" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.request.status).toBe("REJECTED");
    });

    it("APPROVE without optional comment → 200", async () => {
      const reqId = await seedRequest("a3");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "APPROVE" },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 2. Missing fields
  // ══════════════════════════════════════════════════════════════════

  describe("2. missing fields", () => {
    it("empty body → 400", async () => {
      const reqId = await seedRequest("b1");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post<{ code: string }>(
        `/approvals/${reqId}/act`,
        { token: pmTok, body: {} },
      );
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("missing action → 400", async () => {
      const reqId = await seedRequest("b2");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { comment: "forgot the action" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 3. Invalid input
  // ══════════════════════════════════════════════════════════════════

  describe("3. invalid input", () => {
    it("action not in enum → 400", async () => {
      const reqId = await seedRequest("c1");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "MAYBE" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("action lowercase → 400 (strict enum)", async () => {
      const reqId = await seedRequest("c2");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "approve" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("non-UUID :id param → 400", async () => {
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post("/approvals/not-a-uuid/act", {
        token: pmTok,
        body: { action: "APPROVE" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("comment > 2000 chars → 400", async () => {
      const reqId = await seedRequest("c4");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "APPROVE", comment: "x".repeat(2001) },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 4. Wrong types
  // ══════════════════════════════════════════════════════════════════

  describe("4. wrong types", () => {
    it("action as number → 400", async () => {
      const reqId = await seedRequest("d1");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: 1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("action as null → 400", async () => {
      const reqId = await seedRequest("d2");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: null },
      });
      expect(res.statusCode).toBe(400);
    });

    it("comment as number → 400", async () => {
      const reqId = await seedRequest("d3");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "APPROVE", comment: 42 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 5. Auth failures
  // ══════════════════════════════════════════════════════════════════

  describe("5. auth failures", () => {
    it("no auth → 401", async () => {
      const reqId = await seedRequest("e1");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        body: { action: "APPROVE" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("expired token → 401", async () => {
      const reqId = await seedRequest("e2");
      const tok = await harness.tokenWith({
        ttlSecOverride: -1,
        roles: ["PRODUCTION_MANAGER"],
        userId: "00000000-0000-0000-0000-00000000b007",
      });
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: tok,
        body: { action: "APPROVE" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("role without approvals:act (QC_INSPECTOR has it, let's use a PORTAL token) → 401/403", async () => {
      // QC_INSPECTOR does have approvals:act so we use a portal-audience
      // token instead. Internal admin surface must reject cross-audience.
      const reqId = await seedRequest("e3");
      const tok = await harness.tokenWith({
        audience: "portal",
      });
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: tok,
        body: { action: "APPROVE" },
      });
      expect([401, 403]).toContain(res.statusCode);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 6. Business-rule failures through HTTP
  // ══════════════════════════════════════════════════════════════════

  describe("6. business-rule failures", () => {
    it("nonexistent :id → 404", async () => {
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const ghost = "00000000-0000-0000-0000-0000006700ff";
      const res = await harness.post<{ code: string; status: number }>(
        `/approvals/${ghost}/act`,
        { token: pmTok, body: { action: "APPROVE" } },
      );
      expect(res.statusCode).toBe(404);
    });

    it("already-approved request → 409 on second act", async () => {
      const reqId = await seedRequest("f1");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");

      const first = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "APPROVE" },
      });
      expect(first.statusCode).toBe(200);

      const second = await harness.post(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "APPROVE" },
      });
      // The request is no longer PENDING — second act must conflict.
      expect(second.statusCode).toBe(409);
    });

    it("wrong-role actor (SALES_REP) on a PM-chain step → 403 or 409", async () => {
      const reqId = await seedRequest("f2");
      // SALES_REP has approvals:act permission but their role doesn't
      // match the step's required role. The service raises a role-mismatch
      // error that the error mapper should translate to a client error.
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post(`/approvals/${reqId}/act`, {
        token: tok,
        body: { action: "APPROVE" },
      });
      // Depending on the service's error choice — ForbiddenError for
      // "not your step" vs. ConflictError for "no pending step for your
      // role" — both are acceptable 4xx signals. Assert either.
      expect([403, 409]).toContain(res.statusCode);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 7. Concurrency (HTTP layer)
  // ══════════════════════════════════════════════════════════════════

  describe("7. concurrency", () => {
    it("two parallel APPROVE calls on one step → exactly one 200, one 409", async () => {
      const reqId = await seedRequest("71");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const results = await Promise.all([
        harness.post(`/approvals/${reqId}/act`, {
          token: pmTok,
          body: { action: "APPROVE" },
        }),
        harness.post(`/approvals/${reqId}/act`, {
          token: pmTok,
          body: { action: "APPROVE" },
        }),
      ]);
      const ok = results.filter((r) => r.statusCode === 200);
      const conflict = results.filter((r) => r.statusCode === 409);
      expect(ok).toHaveLength(1);
      expect(conflict).toHaveLength(1);
    });

    it("APPROVE vs REJECT race → one wins, one 409", async () => {
      const reqId = await seedRequest("72");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const results = await Promise.all([
        harness.post(`/approvals/${reqId}/act`, {
          token: pmTok,
          body: { action: "APPROVE" },
        }),
        harness.post(`/approvals/${reqId}/act`, {
          token: pmTok,
          body: { action: "REJECT" },
        }),
      ]);
      const ok = results.filter((r) => r.statusCode === 200);
      const conflict = results.filter((r) => r.statusCode === 409);
      expect(ok).toHaveLength(1);
      expect(conflict).toHaveLength(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 8. Response contract
  // ══════════════════════════════════════════════════════════════════

  describe("8. response contract", () => {
    it("happy response echoes request + steps + transitions", async () => {
      const reqId = await seedRequest("81");
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const res = await harness.post<{
        request: { id: string; status: string };
        steps: unknown[];
        transitions?: unknown[];
      }>(`/approvals/${reqId}/act`, {
        token: pmTok,
        body: { action: "APPROVE" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.request.id).toBe(reqId);
      expect(Array.isArray(res.body.steps)).toBe(true);
    });

    it("404 response is Problem+JSON", async () => {
      const pmTok = await harness.tokenForRole("PRODUCTION_MANAGER");
      const ghost = "00000000-0000-0000-0000-0000006700fe";
      const res = await harness.post<{
        code: string;
        status: number;
        title: string;
      }>(`/approvals/${ghost}/act`, {
        token: pmTok,
        body: { action: "APPROVE" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.body.status).toBe(404);
    });
  });
});
