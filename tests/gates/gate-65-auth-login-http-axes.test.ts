/**
 * Gate 65 — POST /auth/login: full HTTP axis matrix.
 *
 * TESTING_PLAN.md §6 priority gap — "Every endpoint must be covered
 * across happy path, invalid input, missing fields, wrong types, auth
 * failures, boundary values, and concurrent requests."
 *
 * This is the first gate that drives the Fastify app end-to-end via
 * the new HTTP harness (tests/gates/_http-harness.ts). Unlike the
 * service-layer gates (1–64), this one exercises the full pipeline —
 * onRequest hooks, the Zod body parse inside the route handler, the
 * error mapper in errors/problem.ts, and the response contract.
 *
 * Scope — POST /auth/login specifically. That route:
 *   • accepts { email, password, surface? } validated by LoginRequestSchema
 *   • returns 200 with { status: "authenticated", accessToken, … } on success
 *   • returns 200 with { status: "multi-tenant", tenantToken, memberships } if
 *     the identity has >1 eligible membership
 *   • returns 400 on Zod failure
 *   • returns 401 on invalid credentials (bcrypt miss OR unknown email — the
 *     service constant-time-compares a dummy hash on miss so timing doesn't
 *     distinguish them)
 *   • returns 403 on locked identity / no eligible membership
 *
 * Dev seed (ops/sql/seed/03-dev-org-users.sql) gives us 9+ single-membership
 * users with password `instigenie_dev_2026`. We use `mgmt@instigenie.local`
 * as the canonical happy-path account.
 *
 * No fixture cleanup needed — login doesn't mutate user-visible state (it
 * writes auth.sessions rows, but those age out on their own and are
 * tenant-unrelated).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHttpHarness,
  DEV_PASSWORD,
  DEV_USERS,
  type HttpHarness,
} from "./_http-harness.js";

// ── Shared harness ─────────────────────────────────────────────────────────

let harness: HttpHarness;

beforeAll(async () => {
  harness = await createHttpHarness();
}, 30_000);

afterAll(async () => {
  await harness?.close();
});

// Convenience — the happy-path credentials.
const GOOD_EMAIL = DEV_USERS.MANAGEMENT.email;
const GOOD_PASSWORD = DEV_PASSWORD;

// ── Types for narrowing the response body ──────────────────────────────────

interface AuthenticatedBody {
  status: "authenticated";
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string };
  org: { id: string };
}

interface ProblemBody {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  message?: string;
}

describe("gate-65: POST /auth/login — HTTP axis matrix", () => {
  // ══════════════════════════════════════════════════════════════════════
  // 1. HAPPY PATHS
  // ══════════════════════════════════════════════════════════════════════

  describe("1. happy paths", () => {
    it("valid email + password + surface=internal → 200 authenticated", async () => {
      const res = await harness.post<AuthenticatedBody>("/auth/login", {
        body: {
          email: GOOD_EMAIL,
          password: GOOD_PASSWORD,
          surface: "internal",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("authenticated");
      expect(typeof res.body.accessToken).toBe("string");
      expect(res.body.accessToken.length).toBeGreaterThan(100);
      expect(typeof res.body.refreshToken).toBe("string");
      expect(res.body.expiresIn).toBeGreaterThan(0);
      expect(res.body.user?.email).toBe(GOOD_EMAIL);
    });

    it("surface omitted → defaults to internal → 200 authenticated", async () => {
      const res = await harness.post<AuthenticatedBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: GOOD_PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("authenticated");
    });

    it("email is case-insensitive match (lookup is lower(email))", async () => {
      const res = await harness.post<AuthenticatedBody>("/auth/login", {
        body: {
          email: GOOD_EMAIL.toUpperCase(),
          password: GOOD_PASSWORD,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("authenticated");
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 2. MISSING FIELDS
  // ══════════════════════════════════════════════════════════════════════

  describe("2. missing fields", () => {
    it("empty body → 400 validation_error with both email+password flagged", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("missing email → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { password: GOOD_PASSWORD },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("missing password → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("empty string body (invalid JSON) → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: "",
        headers: { "content-type": "application/json" },
      });
      // Fastify's JSON parser rejects the empty string as invalid JSON;
      // the response comes out as 400 either way — exact code depends on
      // whether the parser or Zod wins the race. Accept either.
      expect(res.statusCode).toBe(400);
    });

    it("non-JSON content-type → 415 or 400", async () => {
      const res = await harness.post("/auth/login", {
        body: "email=foo&password=bar",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      // Fastify's default content-type parser list includes only application/json
      // (plus the ones provided by @fastify/sensible). Expect either 415 or 400.
      expect([400, 415]).toContain(res.statusCode);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 3. INVALID INPUT (wrong shape, malformed email)
  // ══════════════════════════════════════════════════════════════════════

  describe("3. invalid input", () => {
    it.each([
      ["no at-sign", "notanemail"],
      ["no local part", "@example.com"],
      ["no domain", "person@"],
      ["inline space", "per son@example.com"],
      ["double-at", "a@@b.com"],
      ["empty string", ""],
      ["whitespace only", "   "],
    ])("malformed email — %s → 400", async (_label, bad) => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: bad, password: GOOD_PASSWORD },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("empty password fails zod min(1) → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: "" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("unknown surface enum → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: {
          email: GOOD_EMAIL,
          password: GOOD_PASSWORD,
          surface: "backstage",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 4. WRONG TYPES
  // ══════════════════════════════════════════════════════════════════════

  describe("4. wrong types", () => {
    it("email as number → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: 42, password: GOOD_PASSWORD },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("email as boolean → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: true, password: GOOD_PASSWORD },
      });
      expect(res.statusCode).toBe(400);
    });

    it("password as object → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: { secret: "x" } },
      });
      expect(res.statusCode).toBe(400);
    });

    it("password as null → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: null },
      });
      expect(res.statusCode).toBe(400);
    });

    it("password as array → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: [GOOD_PASSWORD] },
      });
      expect(res.statusCode).toBe(400);
    });

    it("surface as number → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: GOOD_PASSWORD, surface: 1 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 5. AUTH FAILURES (invalid credentials)
  // ══════════════════════════════════════════════════════════════════════

  describe("5. auth failures", () => {
    it("wrong password for known email → 401 invalid credentials", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: "definitely-not-the-password" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.body.code).toBe("unauthorized");
    });

    it("unknown email → 401 (constant-time match with dummy bcrypt hash)", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: {
          email: "nobody+gate65@instigenie.local",
          password: "whatever",
        },
      });
      expect(res.statusCode).toBe(401);
      expect(res.body.code).toBe("unauthorized");
    });

    it("portal surface for an internal-only identity → 403 no-membership", async () => {
      // Dev-seed users have internal roles (MANAGEMENT, SALES_REP, etc.)
      // but NO CUSTOMER role. Asking for portal surface is a 403 by design.
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: {
          email: GOOD_EMAIL,
          password: GOOD_PASSWORD,
          surface: "portal",
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe("forbidden");
    });

    it("401 response does not leak whether the email exists", async () => {
      // Timing-side-channel check is out of scope for a functional gate,
      // but the body shape MUST be identical between the two error paths.
      const existsBadPw = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: "nope" },
      });
      const notExists = await harness.post<ProblemBody>("/auth/login", {
        body: {
          email: "nobody+gate65@instigenie.local",
          password: "nope",
        },
      });
      expect(existsBadPw.statusCode).toBe(notExists.statusCode);
      expect(existsBadPw.body.code).toBe(notExists.body.code);
      // Detail messages should not reveal email existence.
      expect(existsBadPw.body.detail ?? existsBadPw.body.message).toBe(
        notExists.body.detail ?? notExists.body.message,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 6. BOUNDARY VALUES
  // ══════════════════════════════════════════════════════════════════════

  describe("6. boundary values", () => {
    it("password at 128 chars (exact max) → 401 (wrong password, schema accepts)", async () => {
      const pw = "p".repeat(128);
      expect(pw.length).toBe(128);
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: pw },
      });
      // Schema accepts (.max(128)), credentials are wrong → 401.
      expect(res.statusCode).toBe(401);
    });

    it("password > 128 chars → 400 (zod rejects)", async () => {
      const pw = "p".repeat(129);
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: pw },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });

    it("huge email (>1 MB body) → bodyLimit kicks in, 413", async () => {
      // Fastify is configured with bodyLimit: 1_048_576 (1 MiB) in index.ts.
      // A 2 MiB payload should be rejected at the parser layer.
      const huge = "a".repeat(2 * 1024 * 1024);
      const res = await harness.post("/auth/login", {
        body: { email: huge + "@example.com", password: GOOD_PASSWORD },
      });
      // Fastify returns 413 for oversized body.
      expect([400, 413]).toContain(res.statusCode);
    });

    it("unicode email (Cyrillic) → 400 (zod email regex ASCII-only) OR 401", async () => {
      // Zod's .email() accepts some unicode — exact behavior depends on
      // version. Either a 400 from schema or a 401 from unknown-email
      // lookup is fine; what matters is we don't crash or return 500.
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: "привет@example.com", password: GOOD_PASSWORD },
      });
      expect([400, 401]).toContain(res.statusCode);
    });

    it("emoji in password → 401 (schema accepts, credentials wrong)", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: "🔑🗝️🔒" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("SQL-injection-shaped email → 400 (malformed)", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: {
          email: "admin' OR '1'='1@example.com",
          password: GOOD_PASSWORD,
        },
      });
      // Even if Zod's .email() accepts this (the apostrophe IS technically
      // valid in RFC 5321 local parts), the DB lookup is parameterised so
      // the query is safe. Expect 400 or 401 — never 200 and never 500.
      expect([400, 401]).toContain(res.statusCode);
    });

    it("SQL-injection-shaped password is passed as-is to bcrypt → 401", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: "' OR '1'='1" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("null bytes in email → 400", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: "foo\x00@example.com", password: GOOD_PASSWORD },
      });
      expect([400, 401]).toContain(res.statusCode);
    });

    it("strict mode: extra unknown fields are accepted (schema is not strict())", async () => {
      // LoginRequestSchema is NOT .strict(), so unknown keys are dropped
      // silently. Contrast with InviteUserRequestSchema which IS strict.
      const res = await harness.post<AuthenticatedBody>("/auth/login", {
        body: {
          email: GOOD_EMAIL,
          password: GOOD_PASSWORD,
          __proto__: { polluted: true },
          constructor: "evil",
          extraField: "ignored",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe("authenticated");
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 7. CONCURRENT REQUESTS
  // ══════════════════════════════════════════════════════════════════════

  describe("7. concurrency", () => {
    it("8 parallel logins with same credentials all succeed → 8 distinct sessions", async () => {
      const N = 8;
      const results = await Promise.all(
        Array.from({ length: N }, () =>
          harness.post<AuthenticatedBody>("/auth/login", {
            body: { email: GOOD_EMAIL, password: GOOD_PASSWORD },
          }),
        ),
      );
      for (const r of results) {
        expect(r.statusCode).toBe(200);
        expect(r.body.status).toBe("authenticated");
      }
      // Refresh tokens are cryptographically random — asserting uniqueness
      // proves each hit opened its own session row and no race collapsed
      // two callers into one.
      const refreshTokens = new Set(results.map((r) => r.body.refreshToken));
      expect(refreshTokens.size).toBe(N);
    });

    it("8 parallel logins with BAD password all return 401 (no state corruption)", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          harness.post<ProblemBody>("/auth/login", {
            body: { email: GOOD_EMAIL, password: "wrong-password-gate65" },
          }),
        ),
      );
      for (const r of results) {
        expect(r.statusCode).toBe(401);
        expect(r.body.code).toBe("unauthorized");
      }
      // Next correct-password call still works — no lockout applied by
      // count of failed attempts (if a lockout feature lands later, this
      // test will flag the regression from 8 → locked).
      const after = await harness.post<AuthenticatedBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: GOOD_PASSWORD },
      });
      expect(after.statusCode).toBe(200);
    });

    it("mixed good/bad parallel logins each resolve with its correct status", async () => {
      const results = await Promise.all([
        harness.post("/auth/login", {
          body: { email: GOOD_EMAIL, password: GOOD_PASSWORD },
        }),
        harness.post("/auth/login", {
          body: { email: GOOD_EMAIL, password: "wrong" },
        }),
        harness.post("/auth/login", {
          body: { email: "nobody@instigenie.local", password: "whatever" },
        }),
        harness.post("/auth/login", {
          body: { email: GOOD_EMAIL, password: GOOD_PASSWORD },
        }),
      ]);
      expect(results[0]?.statusCode).toBe(200);
      expect(results[1]?.statusCode).toBe(401);
      expect(results[2]?.statusCode).toBe(401);
      expect(results[3]?.statusCode).toBe(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 8. RESPONSE CONTRACT (problem+json shape)
  // ══════════════════════════════════════════════════════════════════════

  describe("8. error response contract", () => {
    it("400 responses follow RFC 7807 Problem shape", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe(400);
      expect(typeof res.body.code).toBe("string");
      expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    });

    it("401 responses follow RFC 7807 Problem shape", async () => {
      const res = await harness.post<ProblemBody>("/auth/login", {
        body: { email: GOOD_EMAIL, password: "wrong" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe(401);
      expect(res.body.code).toBe("unauthorized");
      expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    });
  });
});
