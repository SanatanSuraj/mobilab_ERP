/**
 * Stock reservations service. ARCHITECTURE.md §3.2.
 *
 * Wraps the three PL/pgSQL functions that own the concurrency logic
 * (reserve_stock_atomic, release_stock_reservation,
 * consume_stock_reservation) with:
 *
 *   1. Retry loop for lock contention (SQLSTATE 55P03) and deadlocks
 *      (40P01). Each attempt is a fresh transaction — withRequest →
 *      withOrg opens + commits or rolls back per call, so we re-enter
 *      the wrapper on retry. Jittered exponential backoff: 10, 20, 40,
 *      80, 160 ms ±25%, max 5 attempts.
 *
 *   2. Error translation: Postgres custom SQLSTATEs UR001/UR002 →
 *      ShortageError / StateTransitionError so the HTTP layer returns
 *      RFC 7807 Problem+JSON with the right status.
 *
 *   3. mrpReserveAll — canonical-ordering helper that sorts lines by
 *      (itemId, warehouseId) before calling reserveStockAtomic in
 *      sequence within one transaction. Two concurrent MRPs acquire
 *      the same lock order → deadlocks are mathematically impossible
 *      (not just "retried"). The retry loop still exists for 55P03
 *      timeouts from unrelated traffic.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  BulkReserveStockRequest,
  ConsumeReservationRequest,
  ReserveStockRequest,
  StockReservation,
  StockReservationListQuerySchema,
} from "@instigenie/contracts";
import { z } from "zod";
import { paginated } from "@instigenie/contracts";
import {
  NotFoundError,
  ShortageError,
  StateTransitionError,
  ValidationError,
} from "@instigenie/errors";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { reservationsRepo } from "./reservations.repository.js";
import { itemsRepo } from "./items.repository.js";
import { warehousesRepo } from "./warehouses.repository.js";
import { requireUser } from "../../context/request-context.js";

type ListQuery = z.infer<typeof StockReservationListQuerySchema>;

const LIST_SORTS: Record<string, string> = {
  reservedAt: "reserved_at",
  updatedAt: "updated_at",
  quantity: "quantity",
  status: "status",
};

// ── SQLSTATE handling ────────────────────────────────────────────────────────
//
// pg.DatabaseError is the concrete class but isn't exported from the
// type surface cleanly across versions. Ducktype on `code`.

function pgCodeOf(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

const LOCK_NOT_AVAILABLE = "55P03";
const DEADLOCK_DETECTED = "40P01";
const INSUFFICIENT_STOCK = "UR001";
const RESERVATION_NOT_ACTIVE = "UR002";
const NO_DATA_FOUND = "P0002";

const RETRY_CODES = new Set([LOCK_NOT_AVAILABLE, DEADLOCK_DETECTED]);

/** Max attempts (1 initial + up to 4 retries). */
const MAX_ATTEMPTS = 5;

/** Base delay in ms. Exponential: base * 2^(attempt-1) with ±25% jitter. */
const BASE_DELAY_MS = 10;

function jitteredBackoff(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(1, Math.floor(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Re-run `fn` up to MAX_ATTEMPTS times on transient concurrency errors.
 * `fn` is expected to open + commit its own transaction (via
 * withRequest), so each attempt is independent.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = pgCodeOf(err);
      if (!code || !RETRY_CODES.has(code)) throw err;
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(jitteredBackoff(attempt));
    }
  }
  throw lastErr;
}

/**
 * Translate raw Postgres errors thrown by the reservation functions
 * into the typed AppError hierarchy. Non-reservation errors pass
 * through unchanged.
 */
function translateReservationError(err: unknown, contextId?: string): never {
  const code = pgCodeOf(err);
  const msg = err instanceof Error ? err.message : String(err);
  if (code === INSUFFICIENT_STOCK) {
    throw new ShortageError(msg, { contextId });
  }
  if (code === RESERVATION_NOT_ACTIVE) {
    throw new StateTransitionError(msg, { contextId });
  }
  if (code === NO_DATA_FOUND) {
    throw new NotFoundError(msg);
  }
  throw err;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class ReservationsService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Single-line reservation. Validates item/warehouse/uom match, then
   * invokes the atomic SQL function under retry.
   *
   * Returns the fully-hydrated reservation row so the client has the
   * id for later release/consume.
   */
  async reserve(
    req: FastifyRequest,
    input: ReserveStockRequest
  ): Promise<StockReservation> {
    const user = requireUser(req);

    return withRetry(async () =>
      withRequest(req, this.pool, async (client) => {
        const [item, wh] = await Promise.all([
          itemsRepo.getById(client, input.itemId),
          warehousesRepo.getById(client, input.warehouseId),
        ]);
        if (!item) throw new NotFoundError("item");
        if (!wh) throw new NotFoundError("warehouse");
        if (input.uom !== item.uom) {
          throw new ValidationError(
            `uom ${input.uom} does not match item uom ${item.uom}`
          );
        }

        let resId: string;
        try {
          resId = await reservationsRepo.reserveAtomic(client, {
            orgId: user.orgId,
            itemId: input.itemId,
            warehouseId: input.warehouseId,
            quantity: input.quantity,
            uom: input.uom,
            refDocType: input.refDocType,
            refDocId: input.refDocId,
            refLineId: input.refLineId ?? null,
            reservedBy: user.id,
          });
        } catch (err) {
          translateReservationError(err);
        }

        const row = await reservationsRepo.getById(client, resId);
        if (!row) throw new NotFoundError("reservation");
        return row;
      })
    );
  }

  /**
   * MRP bulk-reserve. All-or-nothing: lines are sorted by
   * (itemId, warehouseId) so that concurrent MRP runs on overlapping
   * parts acquire locks in the same order and cannot deadlock each
   * other. If any line errors (shortage or repeated 55P03), the whole
   * transaction rolls back — no partial holds.
   */
  async mrpReserveAll(
    req: FastifyRequest,
    input: BulkReserveStockRequest
  ): Promise<StockReservation[]> {
    const user = requireUser(req);

    // Canonical ordering — defence against deadlocks. Stable sort on
    // itemId then warehouseId ensures any two callers agree on the
    // lock acquisition order for the parts they have in common.
    const orderedLines = [...input.lines].sort((a, b) => {
      if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
      if (a.warehouseId !== b.warehouseId)
        return a.warehouseId < b.warehouseId ? -1 : 1;
      return 0;
    });

    return withRetry(async () =>
      withRequest(req, this.pool, async (client) => {
        // Pre-flight: validate every line refers to a real item/wh and
        // the uom matches. Fail fast before acquiring any locks so we
        // don't sit holding a FOR UPDATE and block others while we
        // discover input bugs.
        const uniqueItemIds = [...new Set(orderedLines.map((l) => l.itemId))];
        const uniqueWhIds = [...new Set(orderedLines.map((l) => l.warehouseId))];
        const [items, whs] = await Promise.all([
          Promise.all(uniqueItemIds.map((id) => itemsRepo.getById(client, id))),
          Promise.all(
            uniqueWhIds.map((id) => warehousesRepo.getById(client, id))
          ),
        ]);
        const itemById = new Map(items.filter((x) => x != null).map((x) => [x!.id, x!]));
        for (const id of uniqueItemIds) {
          if (!itemById.has(id)) throw new NotFoundError(`item ${id}`);
        }
        const whById = new Map(whs.filter((x) => x != null).map((x) => [x!.id, x!]));
        for (const id of uniqueWhIds) {
          if (!whById.has(id)) throw new NotFoundError(`warehouse ${id}`);
        }
        for (const line of orderedLines) {
          const item = itemById.get(line.itemId)!;
          if (line.uom !== item.uom) {
            throw new ValidationError(
              `line uom ${line.uom} does not match item ${item.sku} uom ${item.uom}`
            );
          }
        }

        const created: StockReservation[] = [];
        for (const line of orderedLines) {
          let resId: string;
          try {
            resId = await reservationsRepo.reserveAtomic(client, {
              orgId: user.orgId,
              itemId: line.itemId,
              warehouseId: line.warehouseId,
              quantity: line.quantity,
              uom: line.uom,
              refDocType: input.refDocType,
              refDocId: input.refDocId,
              refLineId: line.refLineId ?? null,
              reservedBy: user.id,
            });
          } catch (err) {
            // All-or-nothing: the outer withRequest will roll back
            // everything we've reserved so far in this attempt. If the
            // error is a 55P03/40P01 the outer withRetry restarts the
            // whole batch — every line re-reserves from scratch.
            translateReservationError(err, line.itemId);
          }
          const row = await reservationsRepo.getById(client, resId);
          if (!row) throw new NotFoundError("reservation");
          created.push(row);
        }
        return created;
      })
    );
  }

  async release(req: FastifyRequest, reservationId: string): Promise<void> {
    const user = requireUser(req);
    return withRetry(async () =>
      withRequest(req, this.pool, async (client) => {
        try {
          await reservationsRepo.release(client, reservationId, user.id);
        } catch (err) {
          translateReservationError(err);
        }
      })
    );
  }

  /**
   * Bulk-release every ACTIVE reservation on a given ref doc.
   * Returns the count released (0 is fine — idempotent).
   */
  async releaseByRef(
    req: FastifyRequest,
    refDocType: string,
    refDocId: string
  ): Promise<number> {
    const user = requireUser(req);
    return withRetry(async () =>
      withRequest(req, this.pool, async (client) => {
        try {
          return await reservationsRepo.releaseByRef(
            client,
            user.orgId,
            refDocType,
            refDocId,
            user.id
          );
        } catch (err) {
          translateReservationError(err);
        }
      })
    );
  }

  async consume(
    req: FastifyRequest,
    reservationId: string,
    input: ConsumeReservationRequest
  ): Promise<{ reservation: StockReservation; ledgerId: string }> {
    const user = requireUser(req);
    return withRetry(async () =>
      withRequest(req, this.pool, async (client) => {
        let ledgerId: string;
        try {
          ledgerId = await reservationsRepo.consume(
            client,
            reservationId,
            user.id,
            {
              batchNo: input.batchNo,
              serialNo: input.serialNo,
              unitCost: input.unitCost,
            }
          );
        } catch (err) {
          translateReservationError(err);
        }
        const row = await reservationsRepo.getById(client, reservationId);
        if (!row) throw new NotFoundError("reservation");
        return { reservation: row, ledgerId };
      })
    );
  }

  async getById(
    req: FastifyRequest,
    id: string
  ): Promise<StockReservation> {
    return withRequest(req, this.pool, async (client) => {
      const row = await reservationsRepo.getById(client, id);
      if (!row) throw new NotFoundError("reservation");
      return row;
    });
  }

  async list(
    req: FastifyRequest,
    query: ListQuery
  ): Promise<ReturnType<typeof paginated<StockReservation>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, LIST_SORTS, "reservedAt");
      const { data, total } = await reservationsRepo.list(
        client,
        {
          itemId: query.itemId,
          warehouseId: query.warehouseId,
          status: query.status,
          refDocType: query.refDocType,
          refDocId: query.refDocId,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }
}
