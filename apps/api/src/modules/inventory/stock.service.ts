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
  ValidationError,
} from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { stockRepo } from "./stock.repository.js";
import { itemsRepo } from "./items.repository.js";
import { warehousesRepo } from "./warehouses.repository.js";
import { requireUser } from "../../context/request-context.js";

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

function parseQty(q: string): number {
  // Contract already validated the string; Number() is safe here but we
  // keep the decimal string for storage.
  return Number.parseFloat(q);
}

export class StockService {
  constructor(private readonly pool: pg.Pool) {}

  // ── Ledger ────────────────────────────────────────────────────────────────

  async postEntry(
    req: FastifyRequest,
    input: PostStockLedgerEntry
  ): Promise<StockLedgerEntry> {
    const user = requireUser(req);
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

      return stockRepo.postLedgerEntry(client, user.orgId, user.id, input);
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
