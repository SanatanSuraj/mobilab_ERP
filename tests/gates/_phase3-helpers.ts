/**
 * Shared helpers for Track 1 Phase 3 gate tests (automate.md).
 *
 * Each gate under gate-48 .. gate-59 exercises one of the ten outbox
 * emit sites landed in Phase 1, plus any handlers registered in
 * apps/worker/src/handlers/index.ts. The tests share a lot of
 * scaffolding — Fastify request stubs, dynamic service loading,
 * idempotency-key polling, handler dispatch — so it lives here instead
 * of being copy-pasted across 12 files.
 *
 * What *doesn't* live here:
 *   - Pool setup / teardown (each gate owns its own pool so vitest can
 *     parallelise without sharing state).
 *   - Fixture cleanup SQL (each gate's rows have unique tags so the
 *     surgical DELETEs stay in their respective test files).
 *   - Any assertion (these helpers return raw data; gates assert).
 */

import type pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { AUDIENCE, type Permission, type Role } from "@instigenie/contracts";
import {
  HANDLER_CATALOGUE,
  runHandlersForEvent,
  type HandlerContext,
  type RunHandlerResult,
} from "@instigenie/worker/handlers";

// Re-export these so gates don't have to dual-import.
export { HANDLER_CATALOGUE, runHandlersForEvent };

// Dev seed (ops/sql/seed/03-dev-org-users.sql). The dev SALES_MANAGER
// user covers every permission the CRM gate tests need
// (deals:transition, quotations:*, sales_orders:*, leads:convert).
// Ops-side gates that need procurement / finance / qc permissions use
// the SUPER_ADMIN user (b001) via `makeAdminRequest`.
export const DEV_USER_ID = "00000000-0000-0000-0000-00000000b004";
export const DEV_ADMIN_ID = "00000000-0000-0000-0000-00000000b001";

/**
 * Minimal FastifyRequest stub — mirrors gate-26 / gate-46. Only req.user
 * is read by withRequest + requireUser; headers / URL / req.id are never
 * touched by the services under test.
 */
export interface ServiceRequest {
  user: {
    id: string;
    orgId: string;
    email: string;
    roles: Role[];
    permissions: Set<Permission>;
    audience: (typeof AUDIENCE)[keyof typeof AUDIENCE];
  };
}

export function makeRequest(
  orgId: string,
  userId: string = DEV_USER_ID,
  roles: Role[] = ["SALES_MANAGER"],
  email = "salesmgr@instigenie.local",
): ServiceRequest {
  return {
    user: {
      id: userId,
      orgId,
      email,
      roles,
      permissions: new Set<Permission>(),
      audience: AUDIENCE.internal,
    },
  };
}

export function makeAdminRequest(orgId: string): ServiceRequest {
  return makeRequest(orgId, DEV_ADMIN_ID, ["SUPER_ADMIN"], "admin@instigenie.local");
}

/**
 * Dynamically load an API service module by its source path. Matches the
 * gate-46 trick: services that aren't listed in apps/api/package.json's
 * `exports` field can't be imported statically, but a runtime
 * `import(fileUrl)` bypasses the package boundary. vitest transforms the
 * .ts source via the standard vite plugin.
 */
export async function loadApiService<T>(
  relativePathFromRepoRoot: string,
): Promise<T> {
  const here = dirname(fileURLToPath(import.meta.url));
  const abs = resolve(here, "..", "..", relativePathFromRepoRoot);
  const url = `file://${abs}`;
  // Eager cast — callers pin the return shape.
  return (await import(url)) as T;
}

/**
 * Poll outbox.events for a row with the given idempotency_key. Returns
 * the row (id + payload) or throws after `timeoutMs`.
 *
 * Why polling vs. one-shot: the `enqueueOutbox` call lands in the same
 * txn as the domain write, so by the time the service method awaits a
 * successful return the row is committed. But CI occasionally surfaces
 * tiny replication-lag style delays when the test pool and the service
 * pool are different PIDs. A 5s budget keeps the test fast on the
 * happy path and tolerant on the slow path.
 *
 * Shape note: outbox.events has no `trace_id` column today — that
 * migration lives in Phase 4 §4.2 on audit.log only (see
 * ops/sql/init/19-phase4-audit-trace-id.sql). If/when a similar column
 * is added to outbox.events, widen the returned shape rather than
 * querying a non-existent column.
 */
export async function waitForOutboxRow(
  pool: pg.Pool,
  idempotencyKey: string,
  timeoutMs = 5_000,
): Promise<{ id: string; payload: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{
      id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, payload
         FROM outbox.events
        WHERE idempotency_key = $1
        LIMIT 1`,
      [idempotencyKey],
    );
    if (rows[0]) {
      return {
        id: rows[0].id,
        payload: rows[0].payload,
      };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `waitForOutboxRow: no outbox.events row for idempotency_key=${idempotencyKey} within ${timeoutMs}ms`,
  );
}

/**
 * Assert no outbox row was written for `idempotencyKey`. Useful when a
 * negative path (REJECTED, version conflict) is supposed to prevent the
 * emit entirely. Small settle budget to catch a late write.
 */
export async function assertNoOutboxRow(
  pool: pg.Pool,
  idempotencyKey: string,
  settleMs = 500,
): Promise<void> {
  await new Promise((r) => setTimeout(r, settleMs));
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM outbox.events WHERE idempotency_key = $1 LIMIT 1`,
    [idempotencyKey],
  );
  if (rows[0]) {
    throw new Error(
      `assertNoOutboxRow: expected no outbox row for idempotency_key=${idempotencyKey}, found ${rows[0].id}`,
    );
  }
}

/**
 * The handler runner swallows its own log output — but the test still
 * needs a logger shape. One of these per file, frozen so the compiler
 * can't widen it.
 */
export const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLog,
  level: "info",
} as unknown as HandlerContext["log"];

/**
 * Run every handler registered for `eventType` against `outboxId` and
 * return the per-handler results. Thin wrapper around
 * `runHandlersForEvent` that plumbs the standard context + payload
 * shape. Returns the results so the gate can assert on statuses.
 */
export async function runRegisteredHandlers(
  pool: pg.Pool,
  outboxId: string,
  eventType: string,
  payload: { orgId: string } & Record<string, unknown>,
  clients?: HandlerContext["clients"],
): Promise<RunHandlerResult[]> {
  return runHandlersForEvent({
    pool,
    entries: HANDLER_CATALOGUE,
    eventType,
    payload,
    ctx: {
      outboxId,
      log: silentLog,
      ...(clients ? { clients } : {}),
    },
  });
}

/**
 * List the handlerNames registered for `eventType`. Gates assert they
 * all completed.
 */
export function registeredHandlerNames(eventType: string): string[] {
  return HANDLER_CATALOGUE.filter((e) => e.eventType === eventType).map(
    (e) => e.handlerName,
  );
}

/**
 * Poll outbox.handler_runs until a row with the given (outboxId,
 * handlerName) exists with status='COMPLETED'. Mirrors the
 * `runner.ts:runHandler` contract. Useful when the test lets the
 * actual worker drain a row end-to-end rather than calling
 * `runHandlersForEvent` directly — not currently used by any of the
 * Phase 3 gates (they all drive the runner themselves) but surfaced
 * here for future E2E-smoke gates.
 */
export async function waitForHandlerRun(
  pool: pg.Pool,
  outboxId: string,
  handlerName: string,
  timeoutMs = 5_000,
): Promise<{ status: string; createdAt: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ status: string; created_at: string }>(
      `SELECT status, created_at::text AS created_at
         FROM outbox.handler_runs
        WHERE outbox_id = $1 AND handler_name = $2
        LIMIT 1`,
      [outboxId, handlerName],
    );
    if (rows[0]) {
      return { status: rows[0].status, createdAt: rows[0].created_at };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `waitForHandlerRun: no handler_runs row for (${outboxId}, ${handlerName}) within ${timeoutMs}ms`,
  );
}
