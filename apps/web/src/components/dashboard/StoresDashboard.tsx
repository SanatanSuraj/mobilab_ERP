"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Boxes, AlertTriangle, Package, FileText } from "lucide-react";
import { useApiStockSummary } from "@/hooks/useInventoryApi";
import { useApiGrns, useApiVendors } from "@/hooks/useProcurementApi";
import { formatDate } from "@/lib/format";
import type { StockSummaryRow } from "@instigenie/contracts";

/**
 * Stores/inventory dashboard — live data from /inventory/stock-summary and
 * /procurement/grns.
 *
 * Mock → real deltas:
 *   - No `reorderAlerts` endpoint. We derive "below reorder" from
 *     StockSummaryRow where `available < reorderLevel` (both decimal strings).
 *   - No batches endpoint → quarantine + expiry KPIs removed.
 *   - GRN status is DRAFT / POSTED only (no PARTIALLY_QC). "Pending inward"
 *     is now the count of DRAFT GRNs.
 */

function toNumber(v: string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isBelowReorder(row: StockSummaryRow): boolean {
  if (row.reorderLevel == null) return false;
  return toNumber(row.available) < toNumber(row.reorderLevel);
}

export function StoresDashboard() {
  const stockQuery = useApiStockSummary({ limit: 200 });
  const grnsQuery = useApiGrns({ limit: 50 });
  const vendorsQuery = useApiVendors({ limit: 100 });

  const stock = useMemo(
    () => stockQuery.data?.data ?? [],
    [stockQuery.data?.data]
  );
  const grns = useMemo(
    () => grnsQuery.data?.data ?? [],
    [grnsQuery.data?.data]
  );

  const vendorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vendorsQuery.data?.data ?? []) map.set(v.id, v.name);
    return map;
  }, [vendorsQuery.data?.data]);

  const belowReorder = useMemo(() => stock.filter(isBelowReorder), [stock]);

  const pendingInward = useMemo(
    () => grns.filter((g) => g.status === "DRAFT").length,
    [grns]
  );

  const postedCount = useMemo(
    () => grns.filter((g) => g.status === "POSTED").length,
    [grns]
  );

  const skuCount = useMemo(() => new Set(stock.map((s) => s.itemId)).size, [
    stock,
  ]);

  const recentGRNs = useMemo(
    () =>
      [...grns]
        .sort(
          (a, b) =>
            new Date(b.receivedDate).getTime() -
            new Date(a.receivedDate).getTime()
        )
        .slice(0, 5),
    [grns]
  );

  const isLoading =
    stockQuery.isLoading || grnsQuery.isLoading || vendorsQuery.isLoading;
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Below Reorder"
          value={String(belowReorder.length)}
          icon={Boxes}
          trend={belowReorder.length > 0 ? "down" : "up"}
          iconColor={
            belowReorder.length > 0 ? "text-red-600" : "text-green-600"
          }
        />
        <KPICard
          title="Pending Inward"
          value={String(pendingInward)}
          icon={Package}
          trend="neutral"
          iconColor="text-blue-600"
        />
        <KPICard
          title="GRNs Posted"
          value={String(postedCount)}
          icon={FileText}
          trend="up"
          iconColor="text-green-600"
        />
        <KPICard
          title="Stocked SKUs"
          value={String(skuCount)}
          icon={AlertTriangle}
          trend="neutral"
          iconColor="text-amber-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Below Reorder Level
            </CardTitle>
          </CardHeader>
          <CardContent>
            {belowReorder.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                All stock levels are healthy.
              </p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>SKU</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Warehouse</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Reorder</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {belowReorder.slice(0, 10).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">
                          {row.itemSku}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                          {row.itemName}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.warehouseCode}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums text-red-600">
                          {toNumber(row.available)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {toNumber(row.reorderLevel)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Recent GRNs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentGRNs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No recent GRNs.
              </p>
            ) : (
              recentGRNs.map((grn) => (
                <div
                  key={grn.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div>
                    <p className="text-sm font-medium font-mono">
                      {grn.grnNumber}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {vendorById.get(grn.vendorId) ?? grn.vendorId.slice(0, 8)}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={grn.status} />
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(grn.receivedDate)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
