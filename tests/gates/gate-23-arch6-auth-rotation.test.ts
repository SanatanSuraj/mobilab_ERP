/**
 * Gate 23 — ARCHITECTURE.md Phase 1 Gate 6 "Auth flow".
 *
 * Spec:
 *   "Login → access+refresh → access expires → refresh rotates → old
 *    refresh rejected. JWT revocation sets Redis key and PG row; both
 *    checked on next request."
 *
 * What we actually cover here:
 *
 *   1. login() with the dev seed credentials returns an authenticated pair.
 *   2. refresh(rt1) rotates to a new pair (rt2); rt1 has revoked_at set.
 *   3. refresh(rt1) again is REJECTED ("refresh token revoked"). This is
 *      the whole point of rotation — reuse must not succeed.
 *   4. logout(rt2) flips revoked_at on rt2; a follow-up refresh(rt2) also
 *      rejects. Idempotent logout(rt2) after that is a no-op.
 *   5. The minted access token verifies under the expected audience and
 *      carries org/roles/identity claims matching the seed user.
 *
 * Notes:
 *   - We construct AuthService directly against the dev Postgres rather
 *     than hitting HTTP. That way CI doesn't need apps/api running, and
 *     any regression lands closer to the failure site.
 *   - TenantStatusService is stubbed to always-active. Its own semantics
 *     are covered by gate-15-tenant-status-guard.
 *   - JWT revocation-in-Redis is NOT covered here — that mechanism was
 *     descoped to a later sprint per the code in AuthService. When the
 *     Redis revocation path lands, extend this file rather than creating
 *     a parallel test.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { AuthService } from "@instigenie/api/auth/service";
import { TokenFactory } from "@instigenie/api/auth/tokens";
import { AUDIENCE } from "@instigenie/contracts";
import { makeTestPool, waitForPg } from "./_helpers.js";

const DEV_EMAIL = "sales@instigenie.local";
const DEV_PASSWORD = "instigenie_dev_2026";
const DEV_ORG_ID = "00000000-0000-0000-0000-00000000a001";
const DEV_USER_ID = "00000000-0000-0000-0000-00000000b003";

const JWT_SECRET = "dev-only-secret-do-not-use-in-production-xxxxxxxx";
const JWT_ISSUER = "instigenie-api";

describe("gate-23 (arch-6): auth flow — login → refresh rotates → old refresh rejected", () => {
  let pool: pg.Pool;
  let tokens: TokenFactory;
  let auth: AuthService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);

    tokens = new TokenFactory({
      secret: new TextEncoder().encode(JWT_SECRET),
      issuer: JWT_ISSUER,
      accessTokenTtlSec: 900,
    });

    // Stub tenant-status as always-active. Gate 15 covers its real
    // semantics; this gate cares only about rotation.
    const tenantStatus = {
      assertActive: async () => undefined,
    } as unknown as ConstructorParameters<typeof AuthService>[0]["tenantStatus"];

    // No-op lockout store — this gate doesn't exercise per-account
    // lockout, but AuthService now requires the dep so credential-
    // stuffing protection is impossible to forget at the call site.
    const lockoutStore = {
      incr: async () => 0,
      expire: async () => 1,
      del: async () => 0,
    };

    auth = new AuthService({
      pool,
      tokens,
      refreshTtlSec: 60 * 60 * 24 * 14,
      tenantStatus,
      lockoutStore,
    });
  });

  afterAll(async () => {
    // Clean up refresh tokens this test minted so we don't stockpile.
    await pool.query(
      `DELETE FROM refresh_tokens
        WHERE user_agent = 'gate-23' OR ip_address = 'gate-23'`
    );
    await pool.end();
  });

  beforeEach(async () => {
    // Revoke any prior gate-23 rows so each test starts clean.
    await pool.query(
      `UPDATE refresh_tokens
          SET revoked_at = now()
        WHERE (user_agent = 'gate-23' OR ip_address = 'gate-23')
          AND revoked_at IS NULL`
    );
  });

  it("login returns authenticated with a valid access token (roles, org, aud)", async () => {
    const result = await auth.login({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      surface: "internal",
      userAgent: "gate-23",
      ipAddress: "gate-23",
    });
    if (result.status !== "authenticated") {
      throw new Error(
        `expected authenticated, got ${result.status} (multi-tenant?)`
      );
    }
    expect(result.accessToken).toMatch(/^eyJ/);
    expect(result.refreshToken.length).toBeGreaterThan(20);
    expect(result.user.orgId).toBe(DEV_ORG_ID);
    expect(result.user.id).toBe(DEV_USER_ID);
    expect(result.user.roles).toContain("SALES_REP");

    const claims = await tokens.verifyAccess(
      result.accessToken,
      AUDIENCE.internal
    );
    expect(claims.org).toBe(DEV_ORG_ID);
    expect(claims.idn).toBeTruthy();
    expect(claims.roles).toContain("SALES_REP");
  });

  it("refresh rotates: new pair issued, original refresh row has revoked_at set", async () => {
    const login = await auth.login({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      surface: "internal",
      userAgent: "gate-23",
      ipAddress: "gate-23",
    });
    if (login.status !== "authenticated") throw new Error("multi-tenant");

    const rotated = await auth.refresh({
      refreshToken: login.refreshToken,
      userAgent: "gate-23",
      ipAddress: "gate-23",
    });
    expect(rotated.status).toBe("authenticated");
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    expect(rotated.accessToken).not.toBe(login.accessToken);
    expect(rotated.user.id).toBe(DEV_USER_ID);

    // DB side: the original refresh hash must now carry revoked_at.
    const origHash = tokens.hashRefresh(login.refreshToken);
    const { rows } = await pool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM public.auth_load_refresh_token($1)`,
      [origHash]
    );
    expect(rows[0]?.revoked_at).not.toBeNull();
  });

  it("reusing the original refresh token AFTER rotation is rejected", async () => {
    const login = await auth.login({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      surface: "internal",
      userAgent: "gate-23",
      ipAddress: "gate-23",
    });
    if (login.status !== "authenticated") throw new Error("multi-tenant");

    // First refresh — legitimate.
    await auth.refresh({
      refreshToken: login.refreshToken,
      userAgent: "gate-23",
      ipAddress: "gate-23",
    });

    // Second refresh with the SAME original token must fail. This is the
    // whole point of rotation: an exfiltrated old refresh token is worthless.
    await expect(
      auth.refresh({
        refreshToken: login.refreshToken,
        userAgent: "gate-23",
        ipAddress: "gate-23",
      })
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("logout revokes the refresh; subsequent refresh is rejected", async () => {
    const login = await auth.login({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      surface: "internal",
      userAgent: "gate-23",
      ipAddress: "gate-23",
    });
    if (login.status !== "authenticated") throw new Error("multi-tenant");

    await auth.logout(login.refreshToken);

    await expect(
      auth.refresh({
        refreshToken: login.refreshToken,
        userAgent: "gate-23",
        ipAddress: "gate-23",
      })
    ).rejects.toMatchObject({ code: "unauthorized" });

    // logout is idempotent — calling it a second time on the same token
    // must not throw.
    await expect(auth.logout(login.refreshToken)).resolves.toBeUndefined();
  });

  it("refresh with an unknown token is rejected as invalid", async () => {
    await expect(
      auth.refresh({
        refreshToken:
          "this-is-definitely-not-a-real-refresh-token-xxxxxxxxxxxxxxxxxx",
        userAgent: "gate-23",
        ipAddress: "gate-23",
      })
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});
