/**
 * Gate 10 — Pagination hard cap.
 *
 * ARCHITECTURE.md §12.2 Deliverables:
 *   "limit=9999 returns 100 rows, not 9999"
 *
 * The contract is enforced in two places:
 *   1. Zod schema on the wire (PaginationQuerySchema.max(100).catch(default))
 *   2. normalizePagination() runtime clamp (defense-in-depth)
 *
 * This gate proves:
 *   - schema caps at PAGE_LIMIT_MAX
 *   - schema uses catch() so abusive values fall back, not 400
 *   - normalizePagination enforces the clamp even if someone hands it an
 *     unchecked object
 *   - the `paginated()` envelope reports the clamped limit in meta
 */

import { describe, it, expect } from "vitest";
import {
  PaginationQuerySchema,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_DEFAULT,
  normalizePagination,
  paginated,
} from "@mobilab/contracts";

describe("gate-10: pagination limits", () => {
  it("schema rejects <1 by falling back to default (catch)", () => {
    const r = PaginationQuerySchema.parse({ page: "1", limit: "0" });
    expect(r.limit).toBe(PAGE_LIMIT_DEFAULT);
  });

  it("schema rejects >PAGE_LIMIT_MAX by falling back to default (catch)", () => {
    const r = PaginationQuerySchema.parse({ page: "1", limit: "9999" });
    expect(r.limit).toBe(PAGE_LIMIT_DEFAULT);
  });

  it("schema accepts a value right at PAGE_LIMIT_MAX", () => {
    const r = PaginationQuerySchema.parse({
      page: "1",
      limit: String(PAGE_LIMIT_MAX),
    });
    expect(r.limit).toBe(PAGE_LIMIT_MAX);
  });

  it("schema coerces strings (query-string arrival)", () => {
    const r = PaginationQuerySchema.parse({ page: "3", limit: "42" });
    expect(r.page).toBe(3);
    expect(r.limit).toBe(42);
  });

  it("normalizePagination clamps page<1 to 1", () => {
    const n = normalizePagination({
      page: 0,
      limit: 25,
      sortDir: "desc",
    });
    expect(n.page).toBe(1);
  });

  it("normalizePagination hard-caps limit at PAGE_LIMIT_MAX", () => {
    // Skip schema on purpose — simulate a caller with an unchecked object.
    const n = normalizePagination({
      page: 1,
      limit: 9999 as unknown as number,
      sortDir: "desc",
    });
    expect(n.limit).toBe(PAGE_LIMIT_MAX);
  });

  it("paginated() reports the clamped limit in meta", () => {
    const n = normalizePagination({
      page: 1,
      limit: 9999 as unknown as number,
      sortDir: "desc",
    });
    const env = paginated(
      new Array(PAGE_LIMIT_MAX).fill(0).map((_, i) => ({ i })),
      n,
      1000
    );
    expect(env.meta.limit).toBe(PAGE_LIMIT_MAX);
    expect(env.meta.total).toBe(1000);
    expect(env.meta.totalPages).toBe(Math.ceil(1000 / PAGE_LIMIT_MAX));
  });

  it("fuzz: random bad limits never produce a limit > PAGE_LIMIT_MAX", () => {
    const randInt = (lo: number, hi: number): number =>
      Math.floor(lo + Math.random() * (hi - lo + 1));
    for (let i = 0; i < 50; i++) {
      const raw = randInt(-100, 100_000);
      const parsed = PaginationQuerySchema.parse({
        page: "1",
        limit: String(raw),
      });
      expect(parsed.limit).toBeLessThanOrEqual(PAGE_LIMIT_MAX);
      expect(parsed.limit).toBeGreaterThanOrEqual(1);
    }
  });
});
