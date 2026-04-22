/**
 * Gate 29 — ARCHITECTURE.md Phase 3 §3.5 "Redis Caching".
 *
 * Enforces the four architectural rules for cache usage:
 *
 *   1. TTL buckets match spec — BOM (3600s), item master (7200s),
 *      permissions (300s), dashboard KPIs (60s), WIP dashboard (30s).
 *      Drift is a bug: change the constant in one place and we notice here.
 *
 *   2. Keys are NAMESPACED — `{prefix}:{orgId}:{resource}:{id}`. Tenancy
 *      lives in the key so SCAN can scope invalidation to one tenant.
 *
 *   3. Invalidation uses SCAN, never KEYS. `KEYS *` blocks the Redis event
 *      loop on a big keyspace; we scan production-safely. This gate scans
 *      app + package source for `.keys(` on Redis clients and fails if it
 *      finds any (allowlist for tests/mocks is explicit).
 *
 *   4. Read-through `getOrLoad` semantics — cache miss → loader runs →
 *      value persisted with the bucket's TTL → subsequent read is a hit.
 *      Invalidation (SCAN-based) blows away one tenant's slice without
 *      touching a sibling tenant's slice.
 *
 * Runs against the dev `mobilab-redis-cache` container on 6382.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Cache, RESOURCE_TTL } from "@instigenie/cache";
import { REDIS_CACHE_URL } from "./_helpers.js";

// Two fixture orgs so we can prove tenant-scoped invalidation doesn't
// leak. These don't need to exist in Postgres — Redis keys are string-keyed.
const ORG_A = "00000000-0000-0000-0000-0000cache29a1";
const ORG_B = "00000000-0000-0000-0000-0000cache29b1";
const GATE_PREFIX = "gate29cache";

const REPO_ROOT = resolve(__dirname, "..", "..");

// ── source-scan config ──────────────────────────────────────────────────────

/**
 * Directories we recursively scan for forbidden `.keys(` usage.
 * Only touches our own source — node_modules, dist, .turbo are skipped.
 */
const SOURCE_ROOTS = ["apps", "packages"].map((d) => join(REPO_ROOT, d));

/** Directory names we never descend into. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  ".next",
  "coverage",
]);

/** File extensions we examine. */
const SOURCE_EXTS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

/**
 * `.keys(` is legal in many non-Redis contexts — `Object.keys(`, `Map.keys(`,
 * `req.query.keys(`, etc. Our rule only bans it on the ioredis `Redis` client.
 * We err on the side of false-positive-safety by allowing *.keys(* to match
 * but filtering out these well-known safe forms.
 */
const SAFE_PREFIXES = [
  "Object.keys(",
  "Reflect.ownKeys(",
  "Array.from(",
  "Map.prototype.keys(",
  "Set.prototype.keys(",
  "Headers.prototype.keys(",
  "URLSearchParams.prototype.keys(",
];

/**
 * Explicit allowlist: files that legitimately mention `.keys(` in comments
 * or JSDoc warning about it (e.g. cache source itself documents why it's
 * banned). Paths are repo-relative.
 */
const ALLOWLIST_FILES = new Set<string>([
  // cache source explains the ban
  "packages/cache/src/index.ts",
  // gate-29 itself contains the string literal ".keys(" as test fixture
  "tests/gates/gate-29-phase3-caching.test.ts",
]);

interface Offender {
  file: string;
  line: number;
  snippet: string;
}

function* walk(root: string): IterableIterator<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (SOURCE_EXTS.some((ext) => name.endsWith(ext))) {
      yield full;
    }
  }
}

function scanForKeysCalls(): Offender[] {
  const offenders: Offender[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of walk(root)) {
      const rel = relative(REPO_ROOT, file);
      if (ALLOWLIST_FILES.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // strip single-line // comments to avoid false positives
        const noComment = line.replace(/\/\/.*$/, "");
        if (!/\.keys\s*\(/.test(noComment)) continue;
        if (SAFE_PREFIXES.some((p) => noComment.includes(p))) continue;
        // Also accept patterns that are clearly not Redis (TypeScript
        // types like `keyof`, template literal generics, etc.) —
        // `.keys(` is precise enough that we flag what remains.
        offenders.push({
          file: rel,
          line: i + 1,
          snippet: line.trim(),
        });
      }
    }
  }
  return offenders;
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("gate-29 (arch phase 3.5): redis caching", () => {
  let cache: Cache;

  beforeAll(async () => {
    cache = new Cache({
      url: REDIS_CACHE_URL,
      prefix: GATE_PREFIX,
      defaultTtlSec: 60,
    });
    await cache.connect();
  });

  afterAll(async () => {
    // Clean up everything we wrote so we don't pollute later gate runs.
    await cache.invalidateOrg(ORG_A);
    await cache.invalidateOrg(ORG_B);
    await cache.quit();
  });

  beforeEach(async () => {
    // Per-test isolation.
    await cache.invalidateOrg(ORG_A);
    await cache.invalidateOrg(ORG_B);
  });

  // ── 1. TTL constants match ARCHITECTURE.md §3.5 ───────────────────────────

  describe("1. TTL buckets match the §3.5 spec", () => {
    it("BOM is 1h (3600s)", () => {
      expect(RESOURCE_TTL.bom.ttlSec).toBe(3600);
    });
    it("item master is 2h (7200s)", () => {
      expect(RESOURCE_TTL.item.ttlSec).toBe(7200);
    });
    it("permissions is 5min (300s)", () => {
      expect(RESOURCE_TTL.permissions.ttlSec).toBe(300);
    });
    it("dashboard KPIs is 60s", () => {
      expect(RESOURCE_TTL.kpi.ttlSec).toBe(60);
    });
    it("WIP dashboard is 30s", () => {
      expect(RESOURCE_TTL.wip.ttlSec).toBe(30);
    });

    it("scope accessors carry the right resource name + ttl", () => {
      const b = cache.bom(ORG_A);
      expect(b.resource).toBe("bom");
      expect(b.ttlSec).toBe(3600);
      const i = cache.item(ORG_A);
      expect(i.resource).toBe("item");
      expect(i.ttlSec).toBe(7200);
      const p = cache.permissions(ORG_A);
      expect(p.resource).toBe("permissions");
      expect(p.ttlSec).toBe(300);
      const k = cache.kpi(ORG_A);
      expect(k.resource).toBe("dashboard_kpi");
      expect(k.ttlSec).toBe(60);
      const w = cache.wip(ORG_A);
      expect(w.resource).toBe("dashboard_wip");
      expect(w.ttlSec).toBe(30);
    });
  });

  // ── 2. Keys are tenant-namespaced ─────────────────────────────────────────

  describe("2. keys are tenant-namespaced", () => {
    it("writes a key shaped {prefix}:{orgId}:{resource}:{id}", async () => {
      await cache.bom(ORG_A).set("sku-42", { bom: "ok" });
      const raw = await cache.client.get(
        `${GATE_PREFIX}:${ORG_A}:bom:sku-42`,
      );
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual({ bom: "ok" });
    });

    it("sets a real Redis TTL matching the bucket spec", async () => {
      await cache.bom(ORG_A).set("sku-42", { bom: "ok" });
      const ttl = await cache.client.ttl(
        `${GATE_PREFIX}:${ORG_A}:bom:sku-42`,
      );
      // ttl is an int in whole seconds; allow -1..+1s slop.
      expect(ttl).toBeGreaterThan(3599 - 2);
      expect(ttl).toBeLessThanOrEqual(3600);
    });

    it("permissions bucket has a 5-minute TTL", async () => {
      await cache
        .permissions(ORG_A)
        .set("user-123", { perms: ["approvals:read"] });
      const ttl = await cache.client.ttl(
        `${GATE_PREFIX}:${ORG_A}:permissions:user-123`,
      );
      expect(ttl).toBeGreaterThan(300 - 2);
      expect(ttl).toBeLessThanOrEqual(300);
    });

    it("WIP dashboard has a 30s TTL", async () => {
      await cache.wip(ORG_A).set("line-3", { pending: 12 });
      const ttl = await cache.client.ttl(
        `${GATE_PREFIX}:${ORG_A}:dashboard_wip:line-3`,
      );
      expect(ttl).toBeGreaterThan(30 - 2);
      expect(ttl).toBeLessThanOrEqual(30);
    });
  });

  // ── 3. Read-through getOrLoad ─────────────────────────────────────────────

  describe("3. getOrLoad read-through", () => {
    it("first call invokes loader; second call returns cached value", async () => {
      let calls = 0;
      const loader = async () => {
        calls++;
        return { computed: calls };
      };
      const bom = cache.bom(ORG_A);
      const first = await bom.getOrLoad("sku-77", loader);
      const second = await bom.getOrLoad("sku-77", loader);
      expect(first).toEqual({ computed: 1 });
      expect(second).toEqual({ computed: 1 });
      expect(calls).toBe(1);
    });

    it("loader returning null is NOT cached — next call runs loader again", async () => {
      let calls = 0;
      const loader = async () => {
        calls++;
        return null;
      };
      const item = cache.item(ORG_A);
      expect(await item.getOrLoad("missing", loader)).toBeNull();
      expect(await item.getOrLoad("missing", loader)).toBeNull();
      expect(calls).toBe(2);
    });
  });

  // ── 4. SCAN-based invalidation is scoped & non-blocking ───────────────────

  describe("4. invalidation uses SCAN and respects tenant scope", () => {
    it("invalidateResource blows away only that (org, resource) slice", async () => {
      // Seed two resources for two orgs.
      await Promise.all([
        cache.bom(ORG_A).set("sku-1", { v: 1 }),
        cache.bom(ORG_A).set("sku-2", { v: 2 }),
        cache.item(ORG_A).set("item-1", { v: "item-a" }),
        cache.bom(ORG_B).set("sku-1", { v: "b1" }),
      ]);

      const removed = await cache.invalidateResource(ORG_A, "bom");
      expect(removed).toBe(2);

      // ORG_A/bom is gone.
      expect(await cache.bom(ORG_A).get("sku-1")).toBeNull();
      expect(await cache.bom(ORG_A).get("sku-2")).toBeNull();
      // ORG_A/item survives.
      expect(await cache.item(ORG_A).get("item-1")).toEqual({ v: "item-a" });
      // ORG_B/bom survives (different tenant, same resource).
      expect(await cache.bom(ORG_B).get("sku-1")).toEqual({ v: "b1" });
    });

    it("scope.invalidate() removes via SCAN for a large keyspace", async () => {
      // 250 keys — above our SCAN COUNT 100 so we prove we page, not
      // KEYS-in-one-shot. (KEYS would also work here; the assertion that
      // we use SCAN lives in the source-scan test below.)
      const writes: Promise<void>[] = [];
      for (let i = 0; i < 250; i++) {
        writes.push(cache.kpi(ORG_A).set(`kpi-${i}`, { i }));
      }
      await Promise.all(writes);

      const removed = await cache.kpi(ORG_A).invalidate();
      expect(removed).toBe(250);
      expect(await cache.kpi(ORG_A).get("kpi-7")).toBeNull();
    });

    it("invalidateOrg removes every resource for one tenant, leaves others", async () => {
      await Promise.all([
        cache.bom(ORG_A).set("b1", { v: 1 }),
        cache.item(ORG_A).set("i1", { v: 2 }),
        cache.permissions(ORG_A).set("u1", { v: 3 }),
        cache.kpi(ORG_B).set("k1", { v: 4 }),
      ]);
      const removed = await cache.invalidateOrg(ORG_A);
      expect(removed).toBe(3);
      expect(await cache.kpi(ORG_B).get("k1")).toEqual({ v: 4 });
    });
  });

  // ── 5. Source scan: no `.keys(` on Redis clients ──────────────────────────

  describe("5. KEYS is banned in app + package source", () => {
    it("no .keys( call survives in apps/** or packages/**", () => {
      const offenders = scanForKeysCalls();
      if (offenders.length > 0) {
        const msg = offenders
          .map((o) => `  ${o.file}:${o.line}  →  ${o.snippet}`)
          .join("\n");
        throw new Error(
          `Found ${offenders.length} forbidden .keys( call(s). Use SCAN ` +
            `(cache.invalidateResource / cache.invalidateOrg) instead:\n${msg}`,
        );
      }
      expect(offenders).toHaveLength(0);
    });

    it("Cache.deleteByPattern uses SCAN under the hood", () => {
      const src = readFileSync(
        resolve(REPO_ROOT, "packages/cache/src/index.ts"),
        "utf8",
      );
      // Must call .scan(
      expect(src).toMatch(/this\.client\.scan\(/);
      // Must NOT call .keys( on the client (the source also documents why,
      // which is why it's in ALLOWLIST_FILES above).
      expect(src).not.toMatch(/this\.client\.keys\(/);
    });
  });
});
