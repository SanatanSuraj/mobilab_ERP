/**
 * Inventory React Query hooks.
 */

import { useQuery } from "@tanstack/react-query";
import { inventoryService, type StockFilters, type SerialFilters } from "@/services/inventory.service";

export const inventoryKeys = {
  items: (f?: StockFilters) => ["inventory", "items", f] as const,
  item: (id: string) => ["inventory", "items", id] as const,
  stock: (f?: StockFilters) => ["inventory", "stock", f] as const,
  warehouses: () => ["inventory", "warehouses"] as const,
  batches: (itemId?: string) => ["inventory", "batches", itemId] as const,
  expiringBatches: (days?: number) => ["inventory", "batches", "expiring", days] as const,
  serials: (f?: SerialFilters) => ["inventory", "serials", f] as const,
  grns: () => ["inventory", "grns"] as const,
  pendingGRNs: () => ["inventory", "grns", "pending"] as const,
  transfers: () => ["inventory", "transfers"] as const,
  adjustments: () => ["inventory", "adjustments"] as const,
  reorderAlerts: (includeSuppressed?: boolean) => ["inventory", "reorder-alerts", includeSuppressed] as const,
  quarantineCount: () => ["inventory", "quarantine-count"] as const,
};

export function useInventoryItems(filters?: StockFilters) {
  return useQuery({
    queryKey: inventoryKeys.items(filters),
    queryFn: () => inventoryService.getItems(filters),
    staleTime: 60_000,
  });
}

export function useStockSummaries(filters?: StockFilters) {
  return useQuery({
    queryKey: inventoryKeys.stock(filters),
    queryFn: () => inventoryService.getStockSummaries(filters),
    staleTime: 30_000,
  });
}

export function useWarehouses() {
  return useQuery({
    queryKey: inventoryKeys.warehouses(),
    queryFn: () => inventoryService.getWarehouses(),
    staleTime: 10 * 60_000,
  });
}

export function useBatches(itemId?: string) {
  return useQuery({
    queryKey: inventoryKeys.batches(itemId),
    queryFn: () => inventoryService.getBatches(itemId),
    staleTime: 30_000,
  });
}

export function useExpiringBatches(days = 30) {
  return useQuery({
    queryKey: inventoryKeys.expiringBatches(days),
    queryFn: () => inventoryService.getExpiringBatches(days),
    staleTime: 5 * 60_000,
  });
}

export function useSerials(filters?: SerialFilters) {
  return useQuery({
    queryKey: inventoryKeys.serials(filters),
    queryFn: () => inventoryService.getSerials(filters),
    staleTime: 30_000,
  });
}

export function useReorderAlerts(includeSuppressed = false) {
  return useQuery({
    queryKey: inventoryKeys.reorderAlerts(includeSuppressed),
    queryFn: () => inventoryService.getReorderAlerts(includeSuppressed),
    staleTime: 15_000,
  });
}

export function useQuarantineCount() {
  return useQuery({
    queryKey: inventoryKeys.quarantineCount(),
    queryFn: () => inventoryService.getQuarantineCount(),
    staleTime: 30_000,
  });
}

export function usePendingGRNs() {
  return useQuery({
    queryKey: inventoryKeys.pendingGRNs(),
    queryFn: () => inventoryService.getPendingGRNs(),
    staleTime: 15_000,
  });
}
