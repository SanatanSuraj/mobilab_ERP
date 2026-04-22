/**
 * Gate 20 — ARCHITECTURE.md Phase 1 Gate 5 "Listener bypasses PgBouncer".
 *
 * Spec: "Integration test fails if DATABASE_DIRECT_URL points through
 *        PgBouncer (connection string check)."
 *
 * We enforce this at boot time in apps/listen-notify via
 * `assertDirectPgUrl(url)` from @instigenie/db. This test covers the
 * helper directly and via the apps/listen-notify env loader to prove:
 *
 *   - A PgBouncer-port URL throws PgBouncerUrlError.
 *   - A URL whose hostname contains "pgbouncer" throws.
 *   - A direct PG URL (5432, or dev-remapped 5434) passes.
 *   - The live dev DATABASE_DIRECT_URL (or DATABASE_URL fallback) passes
 *     the check — without which listen-notify wouldn't start.
 */

import { describe, it, expect } from "vitest";
import { assertDirectPgUrl, PgBouncerUrlError } from "@instigenie/db";
import { DATABASE_URL } from "./_helpers.js";

describe("gate-20 (arch-5): listener bypasses PgBouncer", () => {
  it("throws on the conventional PgBouncer port (6432)", () => {
    expect(() =>
      assertDirectPgUrl(
        "postgres://instigenie_app:pw@localhost:6432/instigenie"
      )
    ).toThrow(PgBouncerUrlError);
  });

  it("throws when the hostname contains 'pgbouncer'", () => {
    expect(() =>
      assertDirectPgUrl("postgres://instigenie_app:pw@pgbouncer:5432/instigenie")
    ).toThrow(/pgbouncer/i);
  });

  it("allows the dev direct-PG URL (port 5434 in docker-compose)", () => {
    expect(() =>
      assertDirectPgUrl(
        "postgres://instigenie_app:pw@localhost:5434/instigenie"
      )
    ).not.toThrow();
  });

  it("allows a prod-style :5432 direct URL", () => {
    expect(() =>
      assertDirectPgUrl(
        "postgres://erp:pw@postgres-primary:5432/erp"
      )
    ).not.toThrow();
  });

  it("honors PGBOUNCER_PORT override (rejects remapped pooler port)", () => {
    expect(() =>
      assertDirectPgUrl(
        "postgres://instigenie_app:pw@localhost:7777/instigenie",
        { pgBouncerPort: 7777 }
      )
    ).toThrow(PgBouncerUrlError);
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertDirectPgUrl("not a url")).toThrow(
      PgBouncerUrlError
    );
  });

  it("redacts credentials in its error message", () => {
    try {
      assertDirectPgUrl(
        "postgres://user:supersecret@pgbouncer:5432/instigenie"
      );
    } catch (err) {
      expect(String(err)).not.toContain("supersecret");
      return;
    }
    throw new Error("expected throw");
  });

  it("the dev DATABASE_URL itself is a valid direct PG URL", () => {
    // If this fails, the listen-notify process won't start in dev either —
    // which is the whole point of Gate 5.
    expect(() => assertDirectPgUrl(DATABASE_URL)).not.toThrow();
  });
});
