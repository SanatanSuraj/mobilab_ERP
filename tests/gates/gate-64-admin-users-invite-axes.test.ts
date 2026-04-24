/**
 * Gate 64 — POST /admin/users/invite: happy-path + sad-path axes.
 *
 * TESTING_PLAN.md §6 priority gap + user request:
 *   "For each endpoint, cover: happy path, invalid input, missing
 *    fields, wrong types, auth failures, boundary values (empty, huge,
 *    negative, unicode, SQL-like strings), and concurrent requests."
 *
 * Scope: the invite endpoint specifically. This is the surface the
 * admin dashboard's InviteUserDialog (apps/web/src/components/admin-users)
 * drives, and it's the most sensitive path in admin-users — it creates
 * a user_invitations row + raw token + outbox event for email
 * dispatch. A regression here lets strangers into the tenant, or
 * silently drops invites.
 *
 * Two surfaces covered:
 *
 *   A. CONTRACT LAYER — InviteUserRequestSchema (Zod, strict()). The
 *      route layer parses the body through this before calling the
 *      service, so every Zod rejection is a 400 to the client. We
 *      drive the schema directly rather than through HTTP because
 *      (1) it's faster and deterministic, (2) the route code is a
 *      trivial `.parse(req.body ?? {})` — testing the schema IS
 *      testing the route.
 *
 *   B. SERVICE LAYER — AdminUsersService.invite(req, body). Runs
 *      against the live dev Postgres so RLS, the partial unique
 *      index, and the outbox enqueue all participate. Covers the
 *      rules Zod CAN'T express:
 *        - CUSTOMER role is blocked at the service layer even
 *          though the schema accepts it.
 *        - Duplicate active invite for (org, email) → ConflictError.
 *        - Concurrent invites for the same (org, email) collapse to
 *          exactly one winner.
 *        - Missing auth context → requireUser throws.
 *
 * The accept-invite flow is covered by Gate 61 (concurrent accept
 * race) and Gate 28/etc.; this gate is the *invite-side* companion.
 *
 * Cleanup: deterministic email prefix `gate64+…@instigenie.local` so
 * a failed test can't leak invitations that trip the next run's
 * uniqueness guards. DELETE runs under withOrg() because
 * user_invitations is RLS-forced.
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
import type { FastifyRequest } from "fastify";
import { withOrg } from "@instigenie/db";
// apps/api/package.json does not export an "./admin-users" subpath (the
// service is only used internally by the route registration in
// apps/api/src/index.ts). Import directly from the source file like
// Gate 61 does for the repository — this keeps the gate self-contained
// without forcing a package.json surface expansion.
import { AdminUsersService } from "../../apps/api/src/modules/admin-users/service.js";
import { TokenFactory } from "@instigenie/api/auth/tokens";
import {
  AUDIENCE,
  InviteUserRequestSchema,
  type Permission,
} from "@instigenie/contracts";
import { ConflictError, ValidationError } from "@instigenie/errors";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

// ── Fixtures ─────────────────────────────────────────────────────────

const MANAGEMENT_USER_ID = "00000000-0000-0000-0000-00000000b002";
const MANAGEMENT_IDENTITY_ID = "00000000-0000-0000-0000-00000000c002"; // not used by invite; stubbed
const JWT_SECRET = "gate64-test-secret-at-least-thirty-two-chars-long";

/** Every invite in this file uses this email-prefix pattern so cleanup
 *  can find and purge them without touching any unrelated rows. */
function gate64Email(tag: string): string {
  return `gate64+${tag}@instigenie.local`;
}

function makeFakeReq(
  overrides: Partial<{
    hasUser: boolean;
    headers: Record<string, string>;
  }> = {},
): FastifyRequest {
  const { hasUser = true, headers = {} } = overrides;
  const perms = new Set<Permission>(["users:invite"]);
  const req = {
    headers,
    id: "gate-64-fake-req",
    ip: "127.0.0.1",
    user: hasUser
      ? {
          id: MANAGEMENT_USER_ID,
          orgId: DEV_ORG_ID,
          email: "management@instigenie.local",
          roles: ["MANAGEMENT"],
          permissions: perms,
          audience: AUDIENCE.internal,
          identityId: MANAGEMENT_IDENTITY_ID,
        }
      : undefined,
  };
  return req as unknown as FastifyRequest;
}

// ── Contract layer ────────────────────────────────────────────────────
// Pure Zod tests — no DB. Driven through InviteUserRequestSchema exactly
// as routes.ts does: `InviteUserRequestSchema.parse(req.body ?? {})`.

describe("gate-64 [A] contract layer — InviteUserRequestSchema axes", () => {
  // ── Happy path ─────────────────────────────────────────────────────

  it("happy: minimal valid body parses to a typed object", () => {
    const parsed = InviteUserRequestSchema.parse({
      email: "person@acme.test",
      roleId: "MANAGEMENT",
    });
    expect(parsed.email).toBe("person@acme.test");
    expect(parsed.roleId).toBe("MANAGEMENT");
    expect(parsed.expiresInHours).toBeUndefined();
    expect(parsed.name).toBeUndefined();
  });

  it("happy: full body with optional fields parses", () => {
    const parsed = InviteUserRequestSchema.parse({
      email: "person@acme.test",
      roleId: "SALES_REP",
      name: "Ada Lovelace",
      expiresInHours: 24,
    });
    expect(parsed.name).toBe("Ada Lovelace");
    expect(parsed.expiresInHours).toBe(24);
  });

  // ── Missing fields ─────────────────────────────────────────────────

  it("sad: empty body fails (email + roleId required)", () => {
    const r = InviteUserRequestSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("email");
      expect(paths).toContain("roleId");
    }
  });

  it("sad: missing email", () => {
    const r = InviteUserRequestSchema.safeParse({ roleId: "MANAGEMENT" });
    expect(r.success).toBe(false);
  });

  it("sad: missing roleId", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: "person@acme.test",
    });
    expect(r.success).toBe(false);
  });

  // ── Invalid input — email shape ────────────────────────────────────

  it.each([
    ["empty string", ""],
    ["no at-sign", "notanemail"],
    ["no local part", "@example.com"],
    ["no domain", "person@"],
    ["inline space", "person name@example.com"],
    ["double-at", "person@@example.com"],
  ])("sad: invalid email — %s", (_label, bad) => {
    const r = InviteUserRequestSchema.safeParse({
      email: bad,
      roleId: "MANAGEMENT",
    });
    expect(r.success).toBe(false);
  });

  it("sad: email > 254 chars fails (RFC 5321 upper bound)", () => {
    // 250 local-part chars + "@a.bc" = 255; schema max is 254.
    const huge = "a".repeat(250) + "@a.bc";
    expect(huge.length).toBe(255);
    const r = InviteUserRequestSchema.safeParse({
      email: huge,
      roleId: "MANAGEMENT",
    });
    expect(r.success).toBe(false);
  });

  it("boundary: email at 254 chars is accepted", () => {
    // Zod's email() regex requires valid structure on top of length; use
    // a long but well-formed local-part.
    const ok = "a".repeat(249) + "@a.bc"; // 249 + 5 = 254
    expect(ok.length).toBe(254);
    const r = InviteUserRequestSchema.safeParse({
      email: ok,
      roleId: "MANAGEMENT",
    });
    expect(r.success).toBe(true);
  });

  // ── Invalid input — roleId ─────────────────────────────────────────

  it("sad: roleId not in enum", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "SUPREME_LEADER",
    });
    expect(r.success).toBe(false);
  });

  it("sad: roleId empty string", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "",
    });
    expect(r.success).toBe(false);
  });

  // ── Wrong types ────────────────────────────────────────────────────

  it("sad: email as number is rejected", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: 42,
      roleId: "MANAGEMENT",
    });
    expect(r.success).toBe(false);
  });

  it("sad: roleId as number is rejected", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: 7,
    });
    expect(r.success).toBe(false);
  });

  it("sad: name as number is rejected", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      name: 123,
    });
    expect(r.success).toBe(false);
  });

  it("quirk: expiresInHours as numeric string is coerced (z.coerce.number)", () => {
    // The schema uses `z.coerce.number()` to accept query-string-style
    // numbers. Document that contract so a refactor to a strict
    // z.number() would fail this test loudly.
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      expiresInHours: "48",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.expiresInHours).toBe(48);
  });

  it("sad: expiresInHours as non-numeric string is rejected", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      expiresInHours: "forever",
    });
    expect(r.success).toBe(false);
  });

  // ── Boundary values — expiresInHours ───────────────────────────────

  it.each([
    ["0 (below min)", 0, false],
    ["1 (min)", 1, true],
    ["168 (max, 7 days)", 168, true],
    ["169 (above max)", 169, false],
    ["-24 (negative)", -24, false],
    ["1.5 (non-integer)", 1.5, false],
  ])("expiresInHours %s", (_label, value, ok) => {
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      expiresInHours: value,
    });
    expect(r.success).toBe(ok);
  });

  // ── Boundary values — name ─────────────────────────────────────────

  it("sad: name of only whitespace trims to empty and fails min(1)", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      name: "   \t   ",
    });
    expect(r.success).toBe(false);
  });

  it("boundary: name at exactly 120 chars is accepted", () => {
    const name = "x".repeat(120);
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      name,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe(name);
  });

  it("sad: name at 121 chars is rejected", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      name: "y".repeat(121),
    });
    expect(r.success).toBe(false);
  });

  it("boundary: unicode name is preserved byte-for-byte", () => {
    const name = "日本語 テスト 😀";
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      name,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe(name);
  });

  it("boundary: SQL-injection-shaped name is treated as a literal string (schema doesn't escape)", () => {
    // The schema's job is to accept the value as text — downstream is
    // parameterised SQL via pg, so this string is safe. We assert the
    // schema passes it through unchanged; anything else would hint at
    // an unexpected sanitiser creeping into the validation layer.
    const name = "'); DROP TABLE users; --";
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      name,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe(name);
  });

  // ── Strict mode ────────────────────────────────────────────────────

  it("sad: strict() rejects unknown fields", () => {
    const r = InviteUserRequestSchema.safeParse({
      email: "p@acme.test",
      roleId: "MANAGEMENT",
      isAdmin: true, // not in schema
    });
    expect(r.success).toBe(false);
  });
});

// ── Service layer ────────────────────────────────────────────────────
// Live DB: drive AdminUsersService.invite() end-to-end against the dev
// Postgres. Asserts the rules Zod can't express.

describe("gate-64 [B] service layer — AdminUsersService.invite behavioural axes", () => {
  let pool: pg.Pool;
  let service: AdminUsersService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);

    const tokens = new TokenFactory({
      secret: new TextEncoder().encode(JWT_SECRET),
      issuer: "instigenie-api",
      accessTokenTtlSec: 900,
    });

    // tenantStatus is only consumed by the accept-invite path; invite()
    // never touches it. Stub with a shape-matching no-op so construction
    // succeeds without pulling the full TenantStatusService deps graph
    // into this test.
    const tenantStatus = {
      assertActive: async () => undefined,
    } as unknown as ConstructorParameters<
      typeof AdminUsersService
    >[0]["tenantStatus"];

    service = new AdminUsersService({
      pool,
      tokens,
      refreshTtlSec: 60 * 60 * 24 * 14,
      tenantStatus,
      webOrigin: "http://localhost:3000",
      includeDevAcceptUrl: true,
    });
  });

  afterAll(async () => {
    // Belt-and-braces final sweep.
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `SELECT set_config('app.current_user', $1, true)`,
        [MANAGEMENT_USER_ID],
      );
      await client.query(
        `DELETE FROM user_invitations WHERE email LIKE 'gate64+%@instigenie.local'`,
      );
    });
    await pool.end();
  });

  beforeEach(async () => {
    // Purge anything the previous subtest left behind — otherwise the
    // "active invitation already exists" guard from a stale row will
    // corrupt the next test. Also clear gate-64 outbox fanout so the
    // worker (if running) doesn't replay.
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `SELECT set_config('app.current_user', $1, true)`,
        [MANAGEMENT_USER_ID],
      );
      await client.query(
        `DELETE FROM user_invitations WHERE email LIKE 'gate64+%@instigenie.local'`,
      );
    });
    await pool.query(
      `DELETE FROM outbox.events
        WHERE event_type = 'user.invite.created'
          AND payload->>'recipient' LIKE 'gate64+%@instigenie.local'`,
    );
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it("happy: invite creates a PENDING row + raw-token-backed devAcceptUrl + outbox event", async () => {
    const email = gate64Email("happy");
    const res = await service.invite(makeFakeReq(), {
      email,
      roleId: "SALES_REP",
      name: "Ada Lovelace",
      expiresInHours: 48,
    });
    expect(res.invitation.email).toBe(email);
    expect(res.invitation.roleId).toBe("SALES_REP");
    expect(res.invitation.status).toBe("PENDING");
    expect(res.invitation.acceptedAt).toBeNull();
    // devAcceptUrl should carry a 64-hex raw token.
    expect(res.devAcceptUrl).toBeDefined();
    const url = new URL(res.devAcceptUrl!);
    const tok = url.searchParams.get("token");
    expect(tok).toMatch(/^[0-9a-f]{64}$/);

    // Outbox fanout row is written with the expected event type and
    // contains the right recipient — the worker handler gate (gate-38)
    // covers the consumer side; here we just prove the producer fired.
    const { rows: outboxRows } = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM outbox.events
        WHERE event_type = 'user.invite.created'
          AND payload->>'recipient' = $1`,
      [email],
    );
    expect(outboxRows).toHaveLength(1);
  });

  // ── Service-layer rules Zod can't express ──────────────────────────

  it("sad: roleId = CUSTOMER is rejected by the service even though the enum allows it", async () => {
    await expect(
      service.invite(makeFakeReq(), {
        email: gate64Email("customer"),
        roleId: "CUSTOMER",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("sad: second active invite for the same (org, email) collides with ConflictError", async () => {
    const email = gate64Email("dup");
    await service.invite(makeFakeReq(), {
      email,
      roleId: "MANAGEMENT",
    });
    await expect(
      service.invite(makeFakeReq(), {
        email,
        roleId: "MANAGEMENT",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("sad: email is lowercased before the uniqueness check — upper/lower are same identity", async () => {
    // Guards against a regression where the app code lowercases for
    // INSERT but not for the pre-check.
    const base = gate64Email("case");
    await service.invite(makeFakeReq(), {
      email: base,
      roleId: "MANAGEMENT",
    });
    await expect(
      service.invite(makeFakeReq(), {
        email: base.toUpperCase(),
        roleId: "MANAGEMENT",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // ── Auth failure ───────────────────────────────────────────────────

  it("sad: request without an authenticated user throws (requireUser)", async () => {
    await expect(
      service.invite(makeFakeReq({ hasUser: false }), {
        email: gate64Email("noauth"),
        roleId: "MANAGEMENT",
      }),
    ).rejects.toThrow(/no authenticated user/);
  });

  // ── Concurrent requests ────────────────────────────────────────────

  it(
    "concurrent: two simultaneous invites for the same (org, email) collapse to exactly one winner",
    async () => {
      const email = gate64Email("race");
      // Fire both in parallel from the same authenticated context.
      const results = await Promise.allSettled([
        service.invite(makeFakeReq(), {
          email,
          roleId: "MANAGEMENT",
        }),
        service.invite(makeFakeReq(), {
          email,
          roleId: "MANAGEMENT",
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // Loser should see ConflictError (either from the pre-check or
      // the partial-unique-index 23505 — both are translated by the
      // service to ConflictError so the client gets a predictable 409).
      const reason = (rejected[0] as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(ConflictError);

      // DB invariant: exactly one ACTIVE (non-accepted, non-revoked,
      // non-expired) invitation row for this email.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
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
    },
  );

  // ── Boundary — long email round-trips through DB ───────────────────

  it("boundary: near-max email round-trips through the DB without truncation", async () => {
    // Stay under the 254 cap and — critically — keep the
    // "@instigenie.local" suffix so the gate-wide cleanup LIKE clause
    // catches it. A divergent domain (e.g. `@a.bc`) would survive
    // beforeEach and poison the next run with a ConflictError.
    const suffix = "@instigenie.local";
    const localPart = "gate64+bigaddr+" + "a".repeat(254 - suffix.length - "gate64+bigaddr+".length);
    const finalEmail = (localPart + suffix).toLowerCase();
    expect(finalEmail.length).toBe(254);
    expect(finalEmail.startsWith("gate64+")).toBe(true);
    expect(finalEmail.endsWith("@instigenie.local")).toBe(true);
    const res = await service.invite(makeFakeReq(), {
      email: finalEmail,
      roleId: "MANAGEMENT",
    });
    expect(res.invitation.email).toBe(finalEmail);
  });

  // ── Boundary — unicode / "dangerous" name ──────────────────────────

  it("boundary: unicode + SQL-shaped name persist verbatim (parameterised SQL is safe)", async () => {
    const email = gate64Email("unicode");
    const name = "李白 '); DROP TABLE users; -- 😀";
    const res = await service.invite(makeFakeReq(), {
      email,
      roleId: "MANAGEMENT",
      name,
    });
    // users table still exists (trivially — or every subsequent test
    // would have failed) and the invite landed as normal. The name
    // hint survives in metadata.
    expect(res.invitation.email).toBe(email);
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const { rows } = await client.query<{ metadata: { name?: string } }>(
        `SELECT metadata FROM user_invitations WHERE id = $1`,
        [res.invitation.id],
      );
      expect(rows[0]!.metadata.name).toBe(name);
    });
  });
});
