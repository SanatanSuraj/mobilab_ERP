/**
 * Inventory Service — Data Access Layer
 *
 * org_id injected via apiFetch() on every real API call.
 * Import { apiFetch, getOrgId } from "@/lib/api-client" when swapping mock.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getOrgId } from "@/lib/api-client";
import {
  invItems,
  stockSummaries,
  invBatches,
  invSerials,
  grns,
  stockTransfers,
  stockAdjustments,
  reorderAlerts,
  warehouses,
  type InvItem,
  type StockSummary,
  type InvBatch,
  type InvSerial,
  type Grn,
  type StockTransfer,
  type StockAdjustment,
  type ReorderAlert,
  type Warehouse,
} from "@/data/inventory-mock";

export interface StockFilters {
  warehouseId?: string;
  search?: string;
  abcClass?: "A" | "B" | "C";
  trackingType?: "NONE" | "BATCH" | "SERIAL";
}

export interface SerialFilters {
  status?: string;
  warehouseId?: string;
  itemId?: string;
  search?: string;
}

export const inventoryService = {
  // ── Items ─────────────────────────────────────────────────────────────────

  async getItems(filters?: StockFilters): Promise<InvItem[]> {
    // API: return fetch(`/api/inventory/items?${qs}`).then(r => r.json())
    let result = [...invItems];
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.itemCode.toLowerCase().includes(q)
      );
    }
    if (filters?.abcClass) {
      result = result.filter((i) => i.abcClass === filters.abcClass);
    }
    if (filters?.trackingType) {
      result = result.filter((i) => i.trackingType === filters.trackingType);
    }
    return Promise.resolve(result);
  },

  async getItem(id: string): Promise<InvItem | null> {
    // API: return fetch(`/api/inventory/items/${id}`).then(r => r.json())
    return Promise.resolve(invItems.find((i) => i.id === id) ?? null);
  },

  // ── Stock ─────────────────────────────────────────────────────────────────

  async getStockSummaries(filters?: StockFilters): Promise<StockSummary[]> {
    // API: return fetch(`/api/inventory/stock?${qs}`).then(r => r.json())
    let result = [...stockSummaries];
    if (filters?.warehouseId) {
      result = result.filter((s) => s.warehouseId === filters.warehouseId);
    }
    return Promise.resolve(result);
  },

  async getWarehouses(): Promise<Warehouse[]> {
    // API: return fetch('/api/inventory/warehouses').then(r => r.json())
    return Promise.resolve(warehouses);
  },

  // ── Batches ───────────────────────────────────────────────────────────────

  async getBatches(itemId?: string): Promise<InvBatch[]> {
    // API: return fetch(`/api/inventory/batches?itemId=${itemId}`).then(r => r.json())
    let result = [...invBatches];
    if (itemId) result = result.filter((b) => b.itemId === itemId);
    return Promise.resolve(result);
  },

  async getExpiringBatches(days = 30): Promise<InvBatch[]> {
    // API: return fetch(`/api/inventory/batches/expiring?days=${days}`).then(r => r.json())
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const result = invBatches.filter(
      (b) => b.expiryDate && new Date(b.expiryDate) <= cutoff && b.status === "ACTIVE"
    );
    return Promise.resolve(result);
  },

  async getQuarantineCount(): Promise<number> {
    // API: return fetch('/api/inventory/batches?status=QUARANTINED').then(r => r.json()).then(r => r.total)
    return Promise.resolve(invBatches.filter((b) => b.status === "QUARANTINED").length);
  },

  // ── Serials ───────────────────────────────────────────────────────────────

  async getSerials(filters?: SerialFilters): Promise<InvSerial[]> {
    // API: return fetch(`/api/inventory/serials?${qs}`).then(r => r.json())
    let result = [...invSerials];
    if (filters?.status) result = result.filter((s) => s.status === filters.status);
    if (filters?.warehouseId) result = result.filter((s) => s.warehouseId === filters.warehouseId);
    if (filters?.itemId) result = result.filter((s) => s.itemId === filters.itemId);
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter((s) => s.serialNumber.toLowerCase().includes(q));
    }
    return Promise.resolve(result);
  },

  // ── GRNs ──────────────────────────────────────────────────────────────────

  async getGRNs(): Promise<Grn[]> {
    // API: return fetch('/api/inventory/grns').then(r => r.json())
    return Promise.resolve(grns);
  },

  async getPendingGRNs(): Promise<Grn[]> {
    // API: return fetch('/api/inventory/grns?status=DRAFT,PARTIALLY_QC').then(r => r.json())
    return Promise.resolve(
      grns.filter((g) => g.status === "DRAFT" || g.status === "PARTIALLY_QC")
    );
  },

  // ── Transfers ─────────────────────────────────────────────────────────────

  async getTransfers(): Promise<StockTransfer[]> {
    // API: return fetch('/api/inventory/transfers').then(r => r.json())
    return Promise.resolve(stockTransfers);
  },

  // ── Adjustments ───────────────────────────────────────────────────────────

  async getAdjustments(): Promise<StockAdjustment[]> {
    // API: return fetch('/api/inventory/adjustments').then(r => r.json())
    return Promise.resolve(stockAdjustments);
  },

  // ── Reorder Alerts ────────────────────────────────────────────────────────

  async getReorderAlerts(includeSuppressed = false): Promise<ReorderAlert[]> {
    // API: return fetch(`/api/inventory/reorder?includeSuppressed=${includeSuppressed}`).then(r => r.json())
    const result = includeSuppressed
      ? reorderAlerts
      : reorderAlerts.filter((r) => !r.isSuppressed);
    return Promise.resolve(result);
  },
};
