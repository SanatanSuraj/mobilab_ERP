/**
 * Gate 66 — POST /admin/users/invite: full HTTP axis matrix.
 *
 * HTTP counterpart to Gate 64 (which exercises the service directly).
 *
 * Gate 64 proves the Zod schema and the service behavioural rules. Gate
 * 66 proves the *pipeline* — that the Fastify route-level preHandler
 * chain (authGuard → requirePermission("users:invite") → Zod parse →
 * service call → error mapper) wires together correctly and that every
 * failure mode surfaces the right HTTP status + RFC 7807 Problem+JSON
 * body.
 *
 * Why we need both:
 *   • Gate 64 catches service-layer bugs (duplicate-invite race,
 *     CUSTOMER-role reject, outbox enqueue).
 *   • Gate 66 catches HTTP-layer bugs — auth guard ordering, permission
 *     guard, audience fencing (portal token can't invite), content-type
 *     handling, body-limit, and the error mapper's status preservation.
 *
 * Axes (TESTING_PLAN.md §6):
 *   1. happy path                        → 201 + invitation body
 *   2. missing fields                    → 400 validation_error
 *   3. invalid input (email shapes)      → 400
 *   4. wrong types                       → 400
 *   5. auth failures                     → 401 / 403
 *   6. boundary values                   → 400 / 201 at thresholds
 *   7. concurrent requests               → exactly one 201, rest 409
 *   8. response contract                 → Problem+JSON on every error
 *
 * Cleanup: deterministic `gate66+…@instigenie.local` email prefix, purged
 * via withOrg() in beforeEach so each test starts with a clean slate.
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
  DEV_USERS,
  type HttpHarness,
} from "./_http-harness.js";
import { AUDIENCE, type Role } from "@instigenie/contracts";
import { DEV_ORG_ID } from "./_helpers.js";

// ── Shared harness ─────────────────────────────────────────────────────

let harness: HttpHarness;

beforeAll(async () => {
  harness = await createHttpHarness();
}, 30_000);

afterAll(async () => {
  await harness.close();
});

// ── Cleanup helpers ────────────────────────────────────────────────────

const EMAIL_PREFIX = "gate66+";

function gate66Email(tag: string): string {
  return `${EMAIL_PREFIX}${tag}@instigenie.local`;
}

async function purge(): Promise<void> {
  // Remove all gate66 invitations + outbox events so the partial unique
  // index on (org_id, email) active-invitations can't trip the next run.
  await withOrg(harness.pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      [DEV_USERS.MANAGEMENT.userId],
    );
    await client.query(
      `DELETE FROM user_invitations WHERE email LIKE 'gate66+%@instigenie.local'`,
    );
  });
  await harness.pool.query(
    `DELETE FROM outbox.events
      WHERE event_type = 'user.invite.created'
        AND payload->>'recipient' LIKE 'gate66+%@instigenie.local'`,
  );
}

beforeEach(purge);
afterEach(purge);

// ── Tests ──────────────────────────────────────────────────────────────

describe("gate-66: POST /admin/users/invite — HTTP axis matrix", () => {
  // ══════════════════════════════════════════════════════════════════
  // 1. Happy paths
  // ══════════════════════════════════════════════════════════════════

  describe("1. happy paths", () => {
    it("MANAGEMENT token + minimal valid body → 201 with invitation", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const email = gate66Email("happy-min");
      const res = await harness.post<{
        invitation: { email: string; status: string; roleId: string };
        devAcceptUrl?: string;
      }>("/admin/users/invite", {
        token: tok,
        body: { email, roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.invitation.email).toBe(email.toLowerCase());
      expect(res.body.invitation.status).toBe("PENDING");
      expect(res.body.invitation.roleId).toBe("SALES_REP");
    });

    it("SUPER_ADMIN token + full body → 201", async () => {
      const tok = await harness.tokenForRole("SUPER_ADMIN");
      const email = gate66Email("happy-superadmin");
      const res = await harness.post<{
        invitation: { email: string; roleId: string };
      }>("/admin/users/invite", {
        token: tok,
        body: {
          email,
          roleId: "FINANCE",
          name: "Grace Hopper",
          expiresInHours: 72,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.invitation.roleId).toBe("FINANCE");
    });

    it("email is lowercased server-side (uppercase input)", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const raw = gate66Email("MixedCase");
      const res = await harness.post<{ invitation: { email: string } }>(
        "/admin/users/invite",
        { token: tok, body: { email: raw, roleId: "SALES_REP" } },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.invitation.email).toBe(raw.toLowerCase());
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 2. Missing fields
  // ══════════════════════════════════════════════════════════════════

  describe("2. missing fields", () => {
    it("empty body → 400 validation_error", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post<{
        code: string;
        status: number;
      }>("/admin/users/invite", { token: tok, body: {} });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("missing email → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("missing roleId → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { email: gate66Email("no-role") },
      });
      expect(res.statusCode).toBe(400);
    });

    it("no body at all (not even an empty object) → 400", async () => {
      // Fastify will report FST_ERR_CTP_EMPTY_JSON_BODY when content-type
      // is JSON but the body is empty. The error mapper translates to 400.
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.app.inject({
        method: "POST",
        url: "/admin/users/invite",
        headers: {
          authorization: `Bearer ${tok}`,
          "content-type": "application/json",
        },
        payload: "",
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 3. Invalid input
  // ══════════════════════════════════════════════════════════════════

  describe("3. invalid input", () => {
    it.each([
      ["no at-sign", "notanemail"],
      ["no local", "@example.com"],
      ["no domain", "user@"],
      ["inline space", "u ser@example.com"],
      ["double at", "a@@b.com"],
      ["empty string", ""],
    ])("bad email — %s → 400", async (_label, bad) => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { email: bad, roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("roleId not in enum → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { email: gate66Email("badrole"), roleId: "SUPREME_LEADER" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("CUSTOMER role passes Zod but service rejects (ValidationError → 400)", async () => {
      // CUSTOMER is a valid Role in the enum but the service blocks it
      // to keep internal invites off the portal surface.
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post<{ code: string }>(
        "/admin/users/invite",
        {
          token: tok,
          body: { email: gate66Email("customer"), roleId: "CUSTOMER" },
        },
      );
      expect(res.statusCode).toBe(400);
    });

    it("unknown field (strict mode) → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: {
          email: gate66Email("extra"),
          roleId: "SALES_REP",
          isAdmin: true, // not in schema; strict() rejects
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 4. Wrong types
  // ══════════════════════════════════════════════════════════════════

  describe("4. wrong types", () => {
    it("email as number → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { email: 42, roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("roleId as number → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { email: gate66Email("roleint"), roleId: 7 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("body as array → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: [],
      });
      expect(res.statusCode).toBe(400);
    });

    it("body as null → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: null,
      });
      // JSON `null` → req.body is null → Zod rejects.
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 5. Auth failures
  // ══════════════════════════════════════════════════════════════════

  describe("5. auth failures", () => {
    it("no Authorization header → 401", async () => {
      const res = await harness.post<{ code: string; status: number }>(
        "/admin/users/invite",
        {
          body: { email: gate66Email("noauth"), roleId: "SALES_REP" },
        },
      );
      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe(401);
    });

    it("garbage token → 401", async () => {
      const res = await harness.post("/admin/users/invite", {
        token: "not-even-a-jwt",
        body: { email: gate66Email("garbage"), roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("token with wrong signature → 401", async () => {
      // Hand-forge a token with a wrong signature by tampering with the
      // payload. Decoding in verifyAccess must fail.
      const tok = await harness.tokenForRole("MANAGEMENT");
      const parts = tok.split(".");
      const tampered = `${parts[0]}.${parts[1]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      const res = await harness.post("/admin/users/invite", {
        token: tampered,
        body: { email: gate66Email("wrongsig"), roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("expired token → 401", async () => {
      // ttlSecOverride = -1 mints a token whose exp is already in the
      // past. verifyAccess() must reject it.
      const tok = await harness.tokenWith({ ttlSecOverride: -1 });
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { email: gate66Email("expired"), roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("portal (vendor/customer) audience token on internal route → 401/403", async () => {
      // Admin routes are internal-audience only. A portal-audience token
      // should not authorise regardless of the permissions claim.
      const tok = await harness.tokenWith({ audience: AUDIENCE.portal });
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { email: gate66Email("portal"), roleId: "SALES_REP" },
      });
      // authGuard rejects cross-audience tokens; may surface as 401 or 403.
      expect([401, 403]).toContain(res.statusCode);
    });

    it.each<Role>(["SALES_REP", "SALES_MANAGER", "FINANCE", "PRODUCTION_MANAGER", "QC_INSPECTOR"])(
      "%s token (no users:invite permission) → 403",
      async (role) => {
        const tok = await harness.tokenForRole(role);
        const res = await harness.post<{ code: string; status: number }>(
          "/admin/users/invite",
          {
            token: tok,
            body: { email: gate66Email(`norole-${role}`), roleId: "SALES_REP" },
          },
        );
        expect(res.statusCode).toBe(403);
      },
    );
  });

  // ══════════════════════════════════════════════════════════════════
  // 6. Boundary values
  // ══════════════════════════════════════════════════════════════════

  describe("6. boundary values", () => {
    it("email at 254 chars (max) → 201", async () => {
      // Prefix keeps `gate66+` so afterEach purges it.
      // Domain must be a valid TLD (2+ chars after final dot for Zod email).
      // `gate66+` = 7, `@instigenie.local` = 17 → need 254-24 = 230 in the
      // unique token portion.
      const pad = "a".repeat(230);
      const email = `gate66+${pad}@instigenie.local`;
      expect(email.length).toBe(254);
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { email, roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(201);
    });

    it("email at 255 chars (one over) → 400", async () => {
      const pad = "a".repeat(231); // 7 + 231 + 17 = 255
      const email = `gate66+${pad}@instigenie.local`;
      expect(email.length).toBe(255);
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: { email, roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("unicode name (preserved) → 201", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post<{
        invitation: { email: string };
      }>("/admin/users/invite", {
        token: tok,
        body: {
          email: gate66Email("unicode"),
          roleId: "SALES_REP",
          name: "日本語 テスト 😀 Emoji",
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it("SQL-injection-shaped name is stored as literal string → 201", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const email = gate66Email("sqli");
      const res = await harness.post<{
        invitation: { email: string };
      }>("/admin/users/invite", {
        token: tok,
        body: {
          email,
          roleId: "SALES_REP",
          name: "'); DROP TABLE user_invitations; --",
        },
      });
      // If we get 201 the parameterised query handled the hostile input.
      expect(res.statusCode).toBe(201);
      // And the invitation row is actually there — user_invitations is
      // RLS-forced, so we query under the org context. This doubles as
      // proof the table still exists (a successful DROP would tank the
      // SELECT with an undefined_table error).
      await withOrg(harness.pool, DEV_ORG_ID, async (client) => {
        const { rows } = await client.query<{ n: string }>(
          `SELECT COUNT(*)::text as n FROM user_invitations WHERE email = $1`,
          [email],
        );
        expect(Number(rows[0]!.n)).toBe(1);
      });
    });

    it("expiresInHours = 0 (below min) → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: {
          email: gate66Email("ttl0"),
          roleId: "SALES_REP",
          expiresInHours: 0,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("expiresInHours = 169 (above 7-day max) → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: {
          email: gate66Email("ttl169"),
          roleId: "SALES_REP",
          expiresInHours: 169,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("expiresInHours = -24 (negative) → 400", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post("/admin/users/invite", {
        token: tok,
        body: {
          email: gate66Email("ttlneg"),
          roleId: "SALES_REP",
          expiresInHours: -24,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 7. Concurrent requests
  // ══════════════════════════════════════════════════════════════════

  describe("7. concurrency", () => {
    it("5 parallel invites for same email → exactly one 201, rest 409", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const email = gate66Email("race");
      const calls = Array.from({ length: 5 }, () =>
        harness.post<{ code?: string }>("/admin/users/invite", {
          token: tok,
          body: { email, roleId: "SALES_REP" },
        }),
      );
      const results = await Promise.all(calls);
      const statusCounts = results.reduce<Record<number, number>>(
        (acc, r) => {
          acc[r.statusCode] = (acc[r.statusCode] ?? 0) + 1;
          return acc;
        },
        {},
      );
      // Exactly one winner; the other four get 409 conflict. The 409
      // can come from the service pre-check or the 23505 partial-unique
      // index; both land at conflict_error.
      expect(statusCounts[201]).toBe(1);
      expect(statusCounts[409]).toBe(4);

      // DB invariant: exactly one active invitation for this email.
      await withOrg(harness.pool, DEV_ORG_ID, async (client) => {
        const { rows } = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM user_invitations
            WHERE email = lower($1)
              AND accepted_at IS NULL
              AND expires_at > now()
              AND (metadata->>'revokedAt') IS NULL`,
          [email],
        );
        expect(rows[0]!.count).toBe("1");
      });
    });

    it("5 parallel invites for DISTINCT emails → all 5 succeed (201)", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const emails = Array.from({ length: 5 }, (_, i) =>
        gate66Email(`distinct-${i}`),
      );
      const results = await Promise.all(
        emails.map((email) =>
          harness.post("/admin/users/invite", {
            token: tok,
            body: { email, roleId: "SALES_REP" },
          }),
        ),
      );
      for (const r of results) expect(r.statusCode).toBe(201);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 8. Error response contract
  // ══════════════════════════════════════════════════════════════════

  describe("8. response contract", () => {
    it("401 unauth response is RFC 7807 Problem+JSON with code + status", async () => {
      const res = await harness.post<{
        type: string;
        title: string;
        status: number;
        code: string;
        detail: string;
      }>("/admin/users/invite", {
        body: { email: gate66Email("shape"), roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.body.status).toBe(401);
      expect(typeof res.body.code).toBe("string");
      expect(typeof res.body.title).toBe("string");
      expect(typeof res.body.type).toBe("string");
      expect(typeof res.body.detail).toBe("string");
    });

    it("400 validation response contains issue details", async () => {
      const tok = await harness.tokenForRole("MANAGEMENT");
      const res = await harness.post<{
        code: string;
        status: number;
        details?: { issues?: unknown[] };
      }>("/admin/users/invite", {
        token: tok,
        body: { email: "not-an-email", roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
      expect(Array.isArray(res.body.details?.issues)).toBe(true);
    });

    it("403 permission response has forbidden-shaped code", async () => {
      const tok = await harness.tokenForRole("SALES_REP");
      const res = await harness.post<{
        code: string;
        status: number;
      }>("/admin/users/invite", {
        token: tok,
        body: { email: gate66Email("forbidden"), roleId: "SALES_REP" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body.status).toBe(403);
      // The exact code string depends on the authGuard's ForbiddenError.
      // Just assert it's a string and 403-shaped.
      expect(typeof res.body.code).toBe("string");
    });
  });
});
