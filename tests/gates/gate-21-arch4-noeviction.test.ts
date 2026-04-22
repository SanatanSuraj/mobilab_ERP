/**
 * Gate 21 — ARCHITECTURE.md Phase 1 Gate 4 "BullMQ noeviction enforced".
 *
 * Spec: "Integration test flips redis-bull to `allkeys-lru`, starts worker,
 *        asserts it refuses to start."
 *
 * We prove this with `assertBullRedisNoeviction(redis)` from @instigenie/queue,
 * which is the same helper wired into apps/worker and apps/listen-notify
 * boot paths. The test connects to the live dev redis-bull (port 6381,
 * see ops/compose/docker-compose.dev.yml), flips the policy, asserts the
 * assertion throws, then restores the policy and asserts it passes.
 *
 * Restoration is in afterAll() so a crash mid-test doesn't leave the dev
 * stack in a dangerous eviction mode.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Redis } from "ioredis";
import {
  assertBullRedisNoeviction,
  BullEvictionPolicyError,
  createBullConnection,
} from "@instigenie/queue";
import { REDIS_BULL_URL } from "./_helpers.js";

describe("gate-21 (arch-4): BullMQ refuses non-noeviction redis", () => {
  let admin: Redis;
  let originalPolicy = "noeviction";

  beforeAll(async () => {
    // A plain ioredis (not the BullMQ one) for admin writes.
    const u = new URL(REDIS_BULL_URL);
    admin = new Redis({
      host: u.hostname,
      port: Number(u.port || 6379),
      lazyConnect: false,
    });
    // Wait for connection.
    await admin.ping();

    const rows = await admin.config("GET", "maxmemory-policy");
    originalPolicy = Array.isArray(rows) ? String(rows[1] ?? "") : "noeviction";
  });

  afterAll(async () => {
    // Always restore, even on test failure.
    try {
      await admin.config("SET", "maxmemory-policy", originalPolicy || "noeviction");
    } catch {
      /* best effort */
    }
    await admin.quit().catch(() => undefined);
  });

  it("throws BullEvictionPolicyError when policy is allkeys-lru", async () => {
    await admin.config("SET", "maxmemory-policy", "allkeys-lru");

    const probe = createBullConnection(REDIS_BULL_URL);
    try {
      await expect(assertBullRedisNoeviction(probe)).rejects.toThrow(
        BullEvictionPolicyError
      );
      await expect(assertBullRedisNoeviction(probe)).rejects.toThrow(
        /allkeys-lru/
      );
    } finally {
      await probe.quit().catch(() => undefined);
    }
  });

  it("throws when policy is volatile-ttl", async () => {
    await admin.config("SET", "maxmemory-policy", "volatile-ttl");

    const probe = createBullConnection(REDIS_BULL_URL);
    try {
      await expect(assertBullRedisNoeviction(probe)).rejects.toThrow(
        BullEvictionPolicyError
      );
    } finally {
      await probe.quit().catch(() => undefined);
    }
  });

  it("passes when policy is noeviction", async () => {
    await admin.config("SET", "maxmemory-policy", "noeviction");

    const probe = createBullConnection(REDIS_BULL_URL);
    try {
      await expect(assertBullRedisNoeviction(probe)).resolves.toBeUndefined();
    } finally {
      await probe.quit().catch(() => undefined);
    }
  });

  it("BullEvictionPolicyError carries the offending policy name", async () => {
    await admin.config("SET", "maxmemory-policy", "allkeys-random");
    const probe = createBullConnection(REDIS_BULL_URL);
    try {
      await assertBullRedisNoeviction(probe);
    } catch (err) {
      expect(err).toBeInstanceOf(BullEvictionPolicyError);
      expect((err as BullEvictionPolicyError).actualPolicy).toBe(
        "allkeys-random"
      );
      expect((err as BullEvictionPolicyError).code).toBe(
        "bull_redis_not_noeviction"
      );
      return;
    } finally {
      await probe.quit().catch(() => undefined);
    }
    throw new Error("expected throw");
  });
});
