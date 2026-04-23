/**
 * Stock service.
 *
 * Thin orchestrator. Three concerns:
 *   - Post / list ledger rows.
 *   - List summary rows (the projection).
 *   - Upsert / list / delete item-warehouse bindings (reorder thresholds).
 *
 * The DB trigger tg_stock_summary_from_ledger keeps stock_summary in sync
 * on every ledger insert, so this layer doesn't touch stock_summary on
 * writes — only reads from it.
 *
 * Business rule enforced here (rather than the repo) so Phase 3 can add
 * more:
 *   - Issue-style txn types (WO_ISSUE, TRANSFER_OUT, SCRAP, RTV_OUT,
 *     CUSTOMER_ISSUE) must have quantity < 0.
 *   - Receipt-style types must have quantity > 0.
 *   - ADJUSTMENT and REVERSAL allow any sign — adjustments can be ±.
 *   - The current on_hand must not go negative after the post unless
 *     txn_type is ADJUSTMENT (explicit shortage correction).
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  ItemWarehouseBinding,
  ItemWarehouseBindingListQuerySchema,
  PostStockLedgerEntry,
  StockLedgerEntry,
  StockLedgerListQuerySchema,
  StockSummary,
  StockSummaryListQuerySchema,
  StockSummaryRow,
  StockTxnType,
  UpsertItemWarehouseBinding,
} from "@instigenie/contracts";
import { z } from "zod";
import {
  NotFoundError,
  ShortageError,
  UnauthorizedError,
  ValidationError,
} from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { stockRepo } from "./stock.repository.js";
import { itemsRepo } from "./items.repository.js";
import { warehousesRepo } from "./warehouses.repository.js";
import { requireUser } from "../../context/request-context.js";
import type { EsignatureService } from "../esignature/service.js";

type LedgerListQuery = z.infer<typeof StockLedgerListQuerySchema>;
type SummaryListQuery = z.infer<typeof StockSummaryListQuerySchema>;
type BindingListQuery = z.infer<typeof ItemWarehouseBindingListQuerySchema>;

const LEDGER_SORTS: Record<string, string> = {
  postedAt: "posted_at",
  createdAt: "created_at",
  quantity: "quantity",
  txnType: "txn_type",
};

const SUMMARY_SORTS: Record<string, string> = {
  updatedAt: "ss.updated_at",
  lastMovementAt: "ss.last_movement_at",
  onHand: "ss.on_hand",
  available: "ss.available",
  sku: "it.sku",
  itemName: "it.name",
  warehouseCode: "wh.code",
};

const BINDING_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  reorderLevel: "reorder_level",
};

const RECEIPT_TYPES: readonly StockTxnType[] = [
  "OPENING_BALANCE",
  "GRN_RECEIPT",
  "WO_RETURN",
  "WO_OUTPUT",
  "TRANSFER_IN",
  "CUSTOMER_RETURN",
];
const ISSUE_TYPES: readonly StockTxnType[] = [
  "WO_ISSUE",
  "TRANSFER_OUT",
  "SCRAP",
  "RTV_OUT",
  "CUSTOMER_ISSUE",
];

/**
 * Phase 4 §9.5 — the subset of stock-ledger txn types that count as
 * "critical actions" and therefore require password re-entry.
 *
 *   SCRAP           — "stock write-off" per §9.5. Irreversible material
 *                     destruction.
 *   CUSTOMER_ISSUE  — "device release" per §9.5. In the current Phase 2
 *                     data model, devices leave the facility via a
 *                     CUSTOMER_ISSUE ledger row; the dedicated device_ids
 *                     table with 13-state lifecycle lands later.
 *
 * Non-critical issue types (WO_ISSUE, TRANSFER_OUT, RTV_OUT) still post
 * without e-sig — they're internal movements, not compliance-gated
 * events. If you need to widen this set, add a justification in the
 * ARCHITECTURE.md critical-action list and extend Gate 43.
 */
const CRITICAL_TXN_TYPES: readonly StockTxnType[] = [
  "SCRAP",
  "CUSTOMER_ISSUE",
];

function isCriticalTxn(txnType: StockTxnType): boolean {
  return CRITICAL_TXN_TYPES.includes(txnType);
}

function parseQty(q: string): number {
  // Contract already validated the string; Number() is safe here but we
  // keep the decimal string for storage.
  return Number.parseFloat(q);
}

export interface StockServiceDeps {
  pool: pg.Pool;
  /**
   * Phase 4 §9.5 — HMAC-SHA256 seal for SCRAP and CUSTOMER_ISSUE
   * postings. When absent the service still works, but posts of
   * critical txn_types fail closed with ValidationError before
   * touching the DB — strictly safer than silently skipping the seal.
   */
  esignature?: EsignatureService;
}

function isStockServiceDeps(
  x: StockServiceDeps | pg.Pool,
): x is StockServiceDeps {
  return typeof x === "object" && x !== null && "pool" in x;
}

export class StockService {
  private readonly pool: pg.Pool;
  private readonly esignature: EsignatureService | null;

  // Two accepted shapes so Phase 2/3 tests that pre-date §4.2c and
  // construct `new StockService(pool)` still work.
  constructor(poolOrDeps: pg.Pool | StockServiceDeps) {
    if (isStockServiceDeps(poolOrDeps)) {
      this.pool = poolOrDeps.pool;
      this.esignature = poolOrDeps.esignature ?? null;
    } else {
      this.pool = poolOrDeps;
      this.esignature = null;
    }
  }

  // ── Ledger ────────────────────────────────────────────────────────────────

  async postEntry(
    req: FastifyRequest,
    input: PostStockLedgerEntry
  ): Promise<StockLedgerEntry> {
    const user = requireUser(req);

    // ─── Phase 4 §9.5 — critical-action gate ─────────────────────────────
    // SCRAP ("stock write-off") and CUSTOMER_ISSUE ("device release")
    // require password re-entry. We check BEFORE opening the tx so a
    // bad payload doesn't even reserve a row-lock on stock_summary.
    //
    // Rule layering:
    //   - critical txn + deps present + missing fields        → ValidationError
    //   - critical txn + deps present + missing identity      → UnauthorizedError
    //   - critical txn + deps MISSING (misconfigured server)  → ValidationError (fail closed)
    //   - non-critical txn                                    → skip; e-sig fields ignored
    const isCritical = isCriticalTxn(input.txnType);
    if (isCritical) {
      if (!this.esignature) {
        throw new ValidationError(
          `${input.txnType} is a critical action and server is not configured for electronic signatures`,
        );
      }
      if (!input.eSignaturePassword) {
        throw new ValidationError(
          `eSignaturePassword is required for ${input.txnType}`,
        );
      }
      if (!input.eSignatureReason) {
        throw new ValidationError(
          `eSignatureReason is required for ${input.txnType}`,
        );
      }
      if (!user.identityId) {
        throw new UnauthorizedError(
          "e-signature requires a tenant-user session",
        );
      }
    }

    return withRequest(req, this.pool, async (client) => {
      // Validate sign vs txn_type.
      const qty = parseQty(input.quantity);
      if (RECEIPT_TYPES.includes(input.txnType) && qty <= 0) {
        throw new ValidationError(
          `txn_type ${input.txnType} must have positive quantity`
        );
      }
      if (ISSUE_TYPES.includes(input.txnType) && qty >= 0) {
        throw new ValidationError(
          `txn_type ${input.txnType} must have negative quantity`
        );
      }

      // Ensure referenced item + warehouse exist (via RLS-scoped reads).
      const [item, wh] = await Promise.all([
        itemsRepo.getById(client, input.itemId),
        warehousesRepo.getById(client, input.warehouseId),
      ]);
      if (!item) throw new NotFoundError("item");
      if (!wh) throw new NotFoundError("warehouse");

      // UoM mismatch is a bug 99% of the time; we reject it.
      if (input.uom !== item.uom) {
        throw new ValidationError(
          `uom ${input.uom} does not match item uom ${item.uom}`
        );
      }

      // Shortage check: anything that would drive on_hand negative is
      // rejected unless the caller explicitly posts an ADJUSTMENT.
      if (qty < 0 && input.txnType !== "ADJUSTMENT") {
        const cur = await stockRepo.getSummaryForItemAtWarehouse(
          client,
          input.itemId,
          input.warehouseId
        );
        const onHand = cur ? parseQty(cur.onHand) : 0;
        if (onHand + qty < 0) {
          throw new ShortageError("insufficient stock for issue", {
            itemId: input.itemId,
            warehouseId: input.warehouseId,
            required: Math.abs(qty).toString(),
            available: onHand.toString(),
          });
        }
      }

      // Phase 4 §9.5 — compute the seal just before the INSERT so the
      // bound actedAt is the very same ISO string we hand to the repo.
      // Non-critical txn_types produce a NULL signature_hash.
      const postedAtIso = new Date().toISOString();
      let signatureHash: string | null = null;
      if (
        isCritical &&
        this.esignature &&
        input.eSignaturePassword &&
        input.eSignatureReason &&
        user.identityId
      ) {
        const { hash } = await this.esignature.verifyAndHash({
          userIdentityId: user.identityId,
          password: input.eSignaturePassword,
          reason: input.eSignatureReason,
          actedAt: postedAtIso,
        });
        signatureHash = hash;
      }

      return stockRepo.postLedgerEntry(client, user.orgId, user.id, input, {
        postedAt: postedAtIso,
        signatureHash,
      });
    });
  }

  async listLedger(
    req: FastifyRequest,
    query: LedgerListQuery
  ): Promise<ReturnType<typeof paginated<StockLedgerEntry>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, LEDGER_SORTS, "postedAt");
      const { data, total } = await stockRepo.listLedger(
        client,
        {
          itemId: query.itemId,
          warehouseId: query.warehouseId,
          txnType: query.txnType,
          refDocType: query.refDocType,
          refDocId: query.refDocId,
          from: query.from,
          to: query.to,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  async listSummary(
    req: FastifyRequest,
    query: SummaryListQuery
  ): Promise<ReturnType<typeof paginated<StockSummaryRow>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, SUMMARY_SORTS, "updatedAt");
      const { data, total } = await stockRepo.listSummary(
        client,
        {
          itemId: query.itemId,
          warehouseId: query.warehouseId,
          category: query.category,
          lowStockOnly: query.lowStockOnly,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getSummaryForItemAtWarehouse(
    req: FastifyRequest,
    itemId: string,
    warehouseId: string
  ): Promise<StockSummary> {
    return withRequest(req, this.pool, async (client) => {
      const row = await stockRepo.getSummaryForItemAtWarehouse(
        client,
        itemId,
        warehouseId
      );
      if (!row) throw new NotFoundError("stock position");
      return row;
    });
  }

  // ── Bindings ──────────────────────────────────────────────────────────────

  async listBindings(
    req: FastifyRequest,
    query: BindingListQuery
  ): Promise<ReturnType<typeof paginated<ItemWarehouseBinding>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, BINDING_SORTS, "updatedAt");
      const { data, total } = await stockRepo.listBindings(
        client,
        {
          itemId: query.itemId,
          warehouseId: query.warehouseId,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async upsertBinding(
    req: FastifyRequest,
    input: UpsertItemWarehouseBinding
  ): Promise<ItemWarehouseBinding> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const [item, wh] = await Promise.all([
        itemsRepo.getById(client, input.itemId),
        warehousesRepo.getById(client, input.warehouseId),
      ]);
      if (!item) throw new NotFoundError("item");
      if (!wh) throw new NotFoundError("warehouse");
      return stockRepo.upsertBinding(client, user.orgId, input);
    });
  }

  async deleteBinding(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await stockRepo.deleteBinding(client, id);
      if (!ok) throw new NotFoundError("binding");
    });
  }
}
