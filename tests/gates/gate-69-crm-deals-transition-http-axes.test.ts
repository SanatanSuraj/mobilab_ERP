/**
 * Gate 69 — POST /crm/deals/:id/transition: full HTTP axis matrix.
 *
 * Deal stage transitions are the CRM's state machine — the correctness
 * of this endpoint decides whether a deal can proceed to CLOSED_WON,
 * fall back to DISCOVERY, or get archived. Gate 46 covers the 20×20
 * transition matrix at the service layer; this gate layers HTTP-level
 * concerns on top.
 *
 * Allowed transitions (apps/api/src/modules/crm/deals.service.ts:51):
 *   DISCOVERY   → PROPOSAL | CLOSED_LOST
 *   PROPOSAL    → NEGOTIATION | CLOSED_LOST | DISCOVERY
 *   NEGOTIATION → CLOSED_WON | CLOSED_LOST | PROPOSAL
 *   CLOSED_*    → (terminal)
 *
 * The schema requires `expectedVersion` — an optimistic-lock integer
 * the client must echo from the most recent GET. If the deal's current
 * version in the DB is different, we 409. That's the concurrency axis.
 *
 * CLOSED_LOST further requires `lostReason` at the service layer — a
 * sad-path we want to cover end-to-end through HTTP too.
 *
 * Pipeline:
 *   authGuard → requireFeature("module.crm") → requirePermission("deals:transition")
 *   → IdParamSchema.parse() → TransitionDealStageSchema.parse()
 *   → deals.transitionStage()
 *
 * Roles with deals:transition: SUPER_ADMIN, SALES_MANAGER.
 * Roles without: SALES_REP, MANAGEMENT, FINANCE, PRODUCTION_MANAGER, QC_INSPECTOR.
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
import { AUDIENCE, type Role } from "@instigenie/contracts";
import { DEV_ORG_ID } from "./_helpers.js";

let harness: HttpHarness;

beforeAll(async () => {
  harness = await createHttpHarness();
}, 30_000);

afterAll(async () => {
  await harness.close();
});

const TITLE_PREFIX = "gate69-";

async function purge(): Promise<void> {
  await withOrg(harness.pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      ["00000000-0000-0000-0000-00000000b004"], // SALES_MANAGER
    );
    await client.query(
      `DELETE FROM deals WHERE title LIKE 'gate69-%'`,
    );
  });
}

beforeEach(purge);
afterEach(purge);

/**
 * Seed a fresh DISCOVERY deal and return its id + version. Uses
 * SALES_MANAGER so the same token can both create and later transition.
 */
async function seedDeal(tag: string): Promise<{
  id: string;
  version: number;
  tok: string;
}> {
  const tok = await harness.tokenForRole("SALES_MANAGER");
  const res = await harness.post<{
    id: string;
    version: number;
  }>("/crm/deals", {
    token: tok,
    body: {
      title: `${TITLE_PREFIX}${tag}`,
      company: "GateCorp",
      contactName: "Gate Tester",
      value: "100000",
    },
  });
  expect(res.statusCode).toBe(201);
  return { id: res.body.id, version: res.body.version, tok };
}

describe("gate-69: POST /crm/deals/:id/transition — HTTP axis matrix", () => {
  // ══════════════════════════════════════════════════════════════════
  // 1. Happy paths
  // ══════════════════════════════════════════════════════════════════

  describe("1. happy paths", () => {
    it("DISCOVERY → PROPOSAL → 200", async () => {
      const { id, version, tok } = await seedDeal("a1");
      const res = await harness.post<{ stage: string }>(
        `/crm/deals/${id}/transition`,
        { token: tok, body: { stage: "PROPOSAL", expectedVersion: version } },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.stage).toBe("PROPOSAL");
    });

    it("DISCOVERY → CLOSED_LOST + reason → 200", async () => {
      const { id, version, tok } = await seedDeal("a2");
      const res = await harness.post<{ stage: string }>(
        `/crm/deals/${id}/transition`,
        {
          token: tok,
          body: {
            stage: "CLOSED_LOST",
            expectedVersion: version,
            lostReason: "Competitor won on price",
          },
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.stage).toBe("CLOSED_LOST");
    });

    it("Chained: DISCOVERY → PROPOSAL → NEGOTIATION → CLOSED_LOST", async () => {
      // Note: CLOSED_WON requires a linked ACCEPTED quotation (deals.service
      // enforces it at transition time), so this chain tests the full forward
      // walk ending in CLOSED_LOST, which has no quotation dependency.
      let { id, version, tok } = await seedDeal("a3");
      let res = await harness.post<{ stage: string; version: number }>(
        `/crm/deals/${id}/transition`,
        { token: tok, body: { stage: "PROPOSAL", expectedVersion: version } },
      );
      expect(res.statusCode).toBe(200);
      version = res.body.version;

      res = await harness.post<{ stage: string; version: number }>(
        `/crm/deals/${id}/transition`,
        { token: tok, body: { stage: "NEGOTIATION", expectedVersion: version } },
      );
      expect(res.statusCode).toBe(200);
      version = res.body.version;

      res = await harness.post<{ stage: string; version: number }>(
        `/crm/deals/${id}/transition`,
        {
          token: tok,
          body: {
            stage: "CLOSED_LOST",
            expectedVersion: version,
            lostReason: "walked the full chain",
          },
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.stage).toBe("CLOSED_LOST");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 2. Missing fields
  // ══════════════════════════════════════════════════════════════════

  describe("2. missing fields", () => {
    it("empty body → 400", async () => {
      const { id, tok } = await seedDeal("b1");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("missing stage → 400", async () => {
      const { id, tok } = await seedDeal("b2");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("missing expectedVersion → 400", async () => {
      const { id, tok } = await seedDeal("b3");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 3. Invalid input
  // ══════════════════════════════════════════════════════════════════

  describe("3. invalid input", () => {
    it("stage not in enum → 400", async () => {
      const { id, version, tok } = await seedDeal("c1");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROSPECTING", expectedVersion: version },
      });
      expect(res.statusCode).toBe(400);
    });

    it("stage lowercase → 400 (strict enum)", async () => {
      const { id, version, tok } = await seedDeal("c2");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "proposal", expectedVersion: version },
      });
      expect(res.statusCode).toBe(400);
    });

    it("expectedVersion = 0 → 400 (must be positive)", async () => {
      const { id, tok } = await seedDeal("c3");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: 0 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("expectedVersion = -1 → 400 (must be positive)", async () => {
      const { id, tok } = await seedDeal("c4");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: -1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("expectedVersion = 1.5 → 400 (must be integer)", async () => {
      const { id, tok } = await seedDeal("c5");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: 1.5 },
      });
      expect(res.statusCode).toBe(400);
    });

    it(":id not a UUID → 400", async () => {
      const tok = await harness.tokenForRole("SALES_MANAGER");
      const res = await harness.post("/crm/deals/not-a-uuid/transition", {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("lostReason > 500 chars → 400", async () => {
      const { id, version, tok } = await seedDeal("c7");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: {
          stage: "CLOSED_LOST",
          expectedVersion: version,
          lostReason: "x".repeat(501),
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 4. Wrong types
  // ══════════════════════════════════════════════════════════════════

  describe("4. wrong types", () => {
    it("stage as number → 400", async () => {
      const { id, version, tok } = await seedDeal("d1");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: 3, expectedVersion: version },
      });
      expect(res.statusCode).toBe(400);
    });

    it("expectedVersion as string → 400", async () => {
      const { id, tok } = await seedDeal("d2");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: "1" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("lostReason as number → 400", async () => {
      const { id, version, tok } = await seedDeal("d3");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: {
          stage: "CLOSED_LOST",
          expectedVersion: version,
          lostReason: 42,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 5. Auth failures
  // ══════════════════════════════════════════════════════════════════

  describe("5. auth failures", () => {
    it("no auth → 401", async () => {
      const { id, version } = await seedDeal("e1");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        body: { stage: "PROPOSAL", expectedVersion: version },
      });
      expect(res.statusCode).toBe(401);
    });

    it("expired token → 401", async () => {
      const { id, version } = await seedDeal("e2");
      const tok = await harness.tokenWith({
        ttlSecOverride: -1,
        roles: ["SALES_MANAGER"],
        userId: "00000000-0000-0000-0000-00000000b004",
      });
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: version },
      });
      expect(res.statusCode).toBe(401);
    });

    it("portal-audience token → 401/403", async () => {
      const { id, version } = await seedDeal("e3");
      const tok = await harness.tokenWith({ audience: AUDIENCE.portal });
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: version },
      });
      expect([401, 403]).toContain(res.statusCode);
    });

    it.each<Role>(["SALES_REP", "MANAGEMENT", "FINANCE", "PRODUCTION_MANAGER", "QC_INSPECTOR"])(
      "%s (no deals:transition) → 403",
      async (role) => {
        const { id, version } = await seedDeal(`e-${role}`);
        const tok = await harness.tokenForRole(role);
        const res = await harness.post(`/crm/deals/${id}/transition`, {
          token: tok,
          body: { stage: "PROPOSAL", expectedVersion: version },
        });
        expect(res.statusCode).toBe(403);
      },
    );
  });

  // ══════════════════════════════════════════════════════════════════
  // 6. Business-rule failures
  // ══════════════════════════════════════════════════════════════════

  describe("6. business-rule failures", () => {
    it("deal not found → 404", async () => {
      const tok = await harness.tokenForRole("SALES_MANAGER");
      const ghost = "00000000-0000-0000-0000-000000006901";
      const res = await harness.post(`/crm/deals/${ghost}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: 1 },
      });
      expect(res.statusCode).toBe(404);
    });

    it("DISCOVERY → NEGOTIATION (not adjacent) → 400/409", async () => {
      // NEGOTIATION isn't reachable from DISCOVERY directly. The service
      // raises a state-machine error. Expect 400 (ValidationError) or
      // 409 (ConflictError) depending on the error class used.
      const { id, version, tok } = await seedDeal("f2");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "NEGOTIATION", expectedVersion: version },
      });
      expect([400, 409]).toContain(res.statusCode);
    });

    it("CLOSED_LOST without lostReason → 400", async () => {
      const { id, version, tok } = await seedDeal("f3");
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "CLOSED_LOST", expectedVersion: version },
      });
      expect(res.statusCode).toBe(400);
    });

    it("stale expectedVersion → 409 (optimistic lock)", async () => {
      const { id, version, tok } = await seedDeal("f4");
      // First transition bumps the version to version+1.
      const first = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: version },
      });
      expect(first.statusCode).toBe(200);

      // Second call with the OLD version must 409.
      const second = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "NEGOTIATION", expectedVersion: version },
      });
      expect(second.statusCode).toBe(409);
    });

    it("terminal state (CLOSED_LOST) → any transition → 400/409", async () => {
      // CLOSED_LOST is the simplest terminal state — unlike CLOSED_WON it
      // needs no quotation scaffolding, so we can drop into it in one step.
      let { id, version, tok } = await seedDeal("f5");
      const close = await harness.post<{ version: number }>(
        `/crm/deals/${id}/transition`,
        {
          token: tok,
          body: {
            stage: "CLOSED_LOST",
            expectedVersion: version,
            lostReason: "terminal-state test",
          },
        },
      );
      expect(close.statusCode).toBe(200);
      version = close.body.version;

      // Now try to transition out of CLOSED_LOST — terminal.
      const res = await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: version },
      });
      expect([400, 409]).toContain(res.statusCode);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 7. Concurrency
  // ══════════════════════════════════════════════════════════════════

  describe("7. concurrency", () => {
    it("two parallel transitions with same expectedVersion → one 200, one 409", async () => {
      const { id, version, tok } = await seedDeal("g1");
      const results = await Promise.all([
        harness.post(`/crm/deals/${id}/transition`, {
          token: tok,
          body: { stage: "PROPOSAL", expectedVersion: version },
        }),
        harness.post(`/crm/deals/${id}/transition`, {
          token: tok,
          body: { stage: "CLOSED_LOST", expectedVersion: version, lostReason: "race" },
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
    it("happy response carries updated deal with bumped version", async () => {
      const { id, version, tok } = await seedDeal("h1");
      const res = await harness.post<{
        id: string;
        stage: string;
        version: number;
      }>(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: version },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.stage).toBe("PROPOSAL");
      expect(res.body.version).toBeGreaterThan(version);
    });

    it("409 stale-version response is Problem+JSON", async () => {
      const { id, version, tok } = await seedDeal("h2");
      await harness.post(`/crm/deals/${id}/transition`, {
        token: tok,
        body: { stage: "PROPOSAL", expectedVersion: version },
      });
      const stale = await harness.post<{ code: string; status: number }>(
        `/crm/deals/${id}/transition`,
        {
          token: tok,
          body: { stage: "NEGOTIATION", expectedVersion: version },
        },
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.headers["content-type"]).toContain(
        "application/problem+json",
      );
    });
  });
});
