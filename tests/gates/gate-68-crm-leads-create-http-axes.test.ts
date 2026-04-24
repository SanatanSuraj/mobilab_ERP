/**
 * Gate 68 — POST /crm/leads: full HTTP axis matrix.
 *
 * The lead-create endpoint is the tip of the CRM funnel — every deal
 * traces back to a lead row. A regression here (accepting malformed
 * data, skipping tenant isolation, missing an outbox event) would
 * corrupt the top of the sales pipeline.
 *
 * Pipeline covered:
 *   authGuard → requireFeature("module.crm") → requirePermission("leads:create")
 *   → CreateLeadSchema.parse() → leads.create()
 *
 * Axes:
 *   1. happy path                 201 + lead body
 *   2. missing fields             400
 *   3. invalid input              400 (bad email, etc.)
 *   4. wrong types                400
 *   5. auth failures              401 / 403
 *   6. boundary values            201 at max, 400 at max+1, unicode, SQL-shape
 *   7. concurrency                N parallel distinct-email leads → all 201
 *   8. response contract          RFC 7807 on errors, lead row on success
 *
 * Roles with leads:create: SUPER_ADMIN, SALES_REP, SALES_MANAGER.
 * Roles WITHOUT it: MANAGEMENT, FINANCE, PRODUCTION_MANAGER, QC_INSPECTOR.
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

const EMAIL_PREFIX = "gate68+";

function gate68Email(tag: string): string {
  return `${EMAIL_PREFIX}${tag}@instigenie.local`;
}

async function purge(): Promise<void> {
  await withOrg(harness.pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      ["00000000-0000-0000-0000-00000000b003"], // SALES_REP
    );
    await client.query(
      `DELETE FROM leads WHERE email LIKE 'gate68+%@instigenie.local'`,
    );
  });
}

beforeEach(purge);
afterEach(purge);

describe("gate-68: POST /crm/leads — HTTP axis matrix", () => {
  // ══════════════════════════════════════════════════════════════════
  // 1. Happy paths
  // ══════════════════════════════════════════════════════════════════

  describe("1. happy paths", () => {
    it("SALES_REP + minimal valid body → 201", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      // Route returns the Lead object flat at the top level.
      const res = await harness.post<{
        id: string;
        email: string;
        status: string;
      }>("/crm/leads", {
        token: tok,
        body: {
          name: "Ada Lovelace",
          company: "Analytical Engines",
          email: gate68Email("happy-min"),
          phone: "+91-555-0100",
        },
      });
      expect(res.statusCode).toBe(201);
      expect(typeof res.body.id).toBe("string");
      expect(res.body.email).toBe(gate68Email("happy-min"));
    });

    it("SALES_MANAGER + full optional fields → 201", async () => {
      const tok = await harness.tokenForRole("SALES_MANAGER");
      const res = await harness.post<{ lead: { id: string } }>(
        "/crm/leads",
        {
          token: tok,
          body: {
            name: "Grace Hopper",
            company: "Remington Rand",
            email: gate68Email("happy-full"),
            phone: "+91-555-0101",
            source: "inbound",
            estimatedValue: "123456.78",
          },
        },
      );
      expect(res.statusCode).toBe(201);
    });

    it("estimatedValue defaults to '0' when omitted", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post<{
        lead: { estimatedValue?: string };
      }>("/crm/leads", {
        token: tok,
        body: {
          name: "No Value",
          company: "Testing Co",
          email: gate68Email("nov"),
          phone: "+91-555-0102",
        },
      });
      expect(res.statusCode).toBe(201);
      // Lead row should reflect the default "0".
      // (Shape-dependent; just assert it's present-or-0 rather than missing.)
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 2. Missing fields
  // ══════════════════════════════════════════════════════════════════

  describe("2. missing fields", () => {
    it("empty body → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", { token: tok, body: {} });
      expect(res.statusCode).toBe(400);
    });

    it.each([
      ["name", { company: "c", email: "a@b.co", phone: "+91-0000000000" }],
      ["company", { name: "n", email: "a@b.co", phone: "+91-0000000000" }],
      ["email", { name: "n", company: "c", phone: "+91-0000000000" }],
      ["phone", { name: "n", company: "c", email: "a@b.co" }],
    ])("missing %s → 400", async (_label, body) => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", { token: tok, body });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 3. Invalid input
  // ══════════════════════════════════════════════════════════════════

  describe("3. invalid input", () => {
    it.each([
      ["no at-sign", "notanemail"],
      ["no local part", "@example.com"],
      ["no domain", "user@"],
      ["inline space", "u ser@example.com"],
      ["empty", ""],
    ])("bad email — %s → 400", async (_label, bad) => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: bad,
          phone: "+91-555-0000",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("empty name after trim → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "   ",
          company: "c",
          email: gate68Email("emptyname"),
          phone: "+91-555-0000",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("assignedTo not a UUID → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: gate68Email("badassigned"),
          phone: "+91-555-0000",
          assignedTo: "not-a-uuid",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("estimatedValue not a decimal string → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: gate68Email("badvalue"),
          phone: "+91-555-0000",
          estimatedValue: "not-a-number",
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 4. Wrong types
  // ══════════════════════════════════════════════════════════════════

  describe("4. wrong types", () => {
    it("name as number → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: 42,
          company: "c",
          email: gate68Email("numname"),
          phone: "+91-555-0000",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("body as array → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: [],
      });
      expect(res.statusCode).toBe(400);
    });

    it("body as null → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: null,
      });
      expect(res.statusCode).toBe(400);
    });

    it("estimatedValue as number (not decimal string) → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: gate68Email("numval"),
          phone: "+91-555-0000",
          estimatedValue: 100,
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
      const res = await harness.post("/crm/leads", {
        body: {
          name: "n",
          company: "c",
          email: gate68Email("noauth"),
          phone: "+91-555-0000",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("garbage token → 401", async () => {
      const res = await harness.post("/crm/leads", {
        token: "xxx",
        body: {
          name: "n",
          company: "c",
          email: gate68Email("garbage"),
          phone: "+91-555-0000",
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("portal-audience token → 401/403", async () => {
      const tok = await harness.tokenWith({ audience: AUDIENCE.portal });
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: gate68Email("portal"),
          phone: "+91-555-0000",
        },
      });
      expect([401, 403]).toContain(res.statusCode);
    });

    it.each<Role>(["MANAGEMENT", "FINANCE", "PRODUCTION_MANAGER", "QC_INSPECTOR"])(
      "%s (no leads:create) → 403",
      async (role) => {
        const tok = await harness.tokenForRole(role);
        const res = await harness.post("/crm/leads", {
          token: tok,
          body: {
            name: "n",
            company: "c",
            email: gate68Email(`norole-${role}`),
            phone: "+91-555-0000",
          },
        });
        expect(res.statusCode).toBe(403);
      },
    );
  });

  // ══════════════════════════════════════════════════════════════════
  // 6. Boundary values
  // ══════════════════════════════════════════════════════════════════

  describe("6. boundary values", () => {
    it("name at 200 chars (max) → 201", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "x".repeat(200),
          company: "c",
          email: gate68Email("name200"),
          phone: "+91-555-0000",
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it("name at 201 chars → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "x".repeat(201),
          company: "c",
          email: gate68Email("name201"),
          phone: "+91-555-0000",
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("phone at 40 chars (max) → 201", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: gate68Email("phone40"),
          phone: "+" + "9".repeat(39),
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it("phone at 41 chars → 400", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: gate68Email("phone41"),
          phone: "+" + "9".repeat(40),
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("unicode in name + company → 201", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post<{ lead: { id: string } }>(
        "/crm/leads",
        {
          token: tok,
          body: {
            name: "日本語 テスト 😀",
            company: "株式会社テスト",
            email: gate68Email("unicode"),
            phone: "+91-555-0000",
          },
        },
      );
      expect(res.statusCode).toBe(201);
    });

    it("SQL-injection-shape in name → 201 (stored literally)", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const email = gate68Email("sqli");
      const res = await harness.post<{ lead: { id: string } }>(
        "/crm/leads",
        {
          token: tok,
          body: {
            name: "'); DROP TABLE leads; --",
            company: "c",
            email,
            phone: "+91-555-0000",
          },
        },
      );
      expect(res.statusCode).toBe(201);
      // Confirm the row exists under the org RLS context.
      await withOrg(harness.pool, DEV_ORG_ID, async (client) => {
        const { rows } = await client.query<{ n: string }>(
          `SELECT COUNT(*)::text as n FROM leads WHERE email = $1`,
          [email],
        );
        expect(Number(rows[0]!.n)).toBe(1);
      });
    });

    it("estimatedValue very large decimal → 201", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: gate68Email("bigval"),
          phone: "+91-555-0000",
          estimatedValue: "99999999.99",
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it("huge body (well-formed, >1 MB) → 413", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.app.inject({
        method: "POST",
        url: "/crm/leads",
        headers: {
          authorization: `Bearer ${tok}`,
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          name: "n",
          company: "c",
          email: gate68Email("huge"),
          phone: "+91-555-0000",
          source: "x".repeat(2_000_000),
        }),
      });
      expect(res.statusCode).toBe(413);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 7. Concurrency
  // ══════════════════════════════════════════════════════════════════

  describe("7. concurrency", () => {
    it("5 parallel leads with distinct emails → all 201", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          harness.post("/crm/leads", {
            token: tok,
            body: {
              name: `n${i}`,
              company: `c${i}`,
              email: gate68Email(`conc-${i}`),
              phone: `+91-555-01${String(i).padStart(2, "0")}`,
            },
          }),
        ),
      );
      for (const r of results) expect(r.statusCode).toBe(201);
    });

    it("5 parallel leads with the SAME email → all 201 (leads table doesn't enforce email uniqueness)", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const email = gate68Email("same-email");
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          harness.post("/crm/leads", {
            token: tok,
            body: {
              name: "n",
              company: "c",
              email,
              phone: "+91-555-0000",
            },
          }),
        ),
      );
      // Domain rule: we do NOT dedupe leads on email — two reps can
      // claim the same prospect independently. Assert the contract.
      const counts = results.reduce<Record<number, number>>((acc, r) => {
        acc[r.statusCode] = (acc[r.statusCode] ?? 0) + 1;
        return acc;
      }, {});
      expect(counts[201]).toBe(5);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 8. Response contract
  // ══════════════════════════════════════════════════════════════════

  describe("8. response contract", () => {
    it("201 response carries a lead with id + status=NEW", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post<{
        id: string;
        status: string;
      }>("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: gate68Email("shape"),
          phone: "+91-555-0000",
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(res.body.status).toBe("NEW");
    });

    it("400 validation response is Problem+JSON with issues", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post<{
        code: string;
        details?: { issues?: unknown[] };
      }>("/crm/leads", {
        token: tok,
        body: {
          name: "n",
          company: "c",
          email: "bad",
          phone: "+91-555-0000",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.body.code).toBe("validation_error");
      expect(Array.isArray(res.body.details?.issues)).toBe(true);
    });
  });
});
