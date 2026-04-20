/**
 * Procurement Service — Data Access Layer
 *
 * org_id injected via apiFetch() on every real API call.
 * Import { apiFetch, getOrgId } from "@/lib/api-client" when swapping mock.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getOrgId } from "@/lib/api-client";

import {
  vendors,
  indents,
  purchaseOrders,
  inwardEntries,
  qcInspections,
  procurementGRNs,
  rtvList,
  getVendorById,
  type Vendor,
  type Indent,
  type PurchaseOrder,
  type InwardEntry,
  type QCInspection,
  type GRN,
  type ReturnToVendor,
} from "@/data/procurement-mock";

export interface ProcVendorFilters {
  status?: string;
  search?: string;
}

export interface ProcPOFilters {
  status?: string;
  vendorId?: string;
  search?: string;
}

export const procurementService = {
  // ── Vendors ───────────────────────────────────────────────────────────────

  async getVendors(filters?: ProcVendorFilters): Promise<Vendor[]> {
    // API: return fetch(`/api/procurement/vendors?${qs}`).then(r => r.json())
    let result = [...vendors];
    if (filters?.status && filters.status !== "ALL") {
      result = result.filter((v) => v.status === filters.status);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (v) =>
          v.legalName.toLowerCase().includes(q) ||
          v.tradeName.toLowerCase().includes(q) ||
          v.code.toLowerCase().includes(q)
      );
    }
    return Promise.resolve(result);
  },

  async getVendor(id: string): Promise<Vendor | null> {
    // API: return fetch(`/api/procurement/vendors/${id}`).then(r => r.json())
    return Promise.resolve(getVendorById(id) ?? null);
  },

  // ── Indents ───────────────────────────────────────────────────────────────

  async getIndents(): Promise<Indent[]> {
    // API: return fetch('/api/procurement/indents').then(r => r.json())
    return Promise.resolve(indents);
  },

  // ── Purchase Orders ───────────────────────────────────────────────────────

  async getPurchaseOrders(filters?: ProcPOFilters): Promise<PurchaseOrder[]> {
    // API: return fetch(`/api/procurement/purchase-orders?${qs}`).then(r => r.json())
    let result = [...purchaseOrders];
    if (filters?.status && filters.status !== "ALL") {
      result = result.filter((p) => p.status === filters.status);
    }
    if (filters?.vendorId) {
      result = result.filter((p) => p.vendorId === filters.vendorId);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter((p) => p.poNumber.toLowerCase().includes(q));
    }
    return Promise.resolve(result);
  },

  async getPO(id: string): Promise<PurchaseOrder | null> {
    // API: return fetch(`/api/procurement/purchase-orders/${id}`).then(r => r.json())
    return Promise.resolve(purchaseOrders.find((p) => p.id === id) ?? null);
  },

  // ── Inward ────────────────────────────────────────────────────────────────

  async getInwardEntries(): Promise<InwardEntry[]> {
    // API: return fetch('/api/procurement/inward').then(r => r.json())
    return Promise.resolve(inwardEntries);
  },

  // ── GRN QC ────────────────────────────────────────────────────────────────

  async getQCInspections(): Promise<QCInspection[]> {
    // API: return fetch('/api/procurement/grn-qc').then(r => r.json())
    return Promise.resolve(qcInspections);
  },

  async getGRNs(): Promise<GRN[]> {
    // API: return fetch('/api/procurement/grn').then(r => r.json())
    return Promise.resolve(procurementGRNs);
  },

  // ── Returns ───────────────────────────────────────────────────────────────

  async getReturns(): Promise<ReturnToVendor[]> {
    // API: return fetch('/api/procurement/returns').then(r => r.json())
    return Promise.resolve(rtvList);
  },
};
