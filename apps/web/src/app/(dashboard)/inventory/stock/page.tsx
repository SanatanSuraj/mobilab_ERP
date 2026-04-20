"use client";

import React, { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  invItems,
  stockSummaries,
  reorderAlerts,
  warehouses,
  formatCurrency,
  StockSummary,
  ReorderAlert,
} from "@/data/inventory-mock";
import { Package, DollarSign, AlertTriangle, Bell } from "lucide-react";

type WarehouseFilter = "all" | "wh1" | "wh2";

// O(1) lookup maps built once at module level
const stockMap = new Map<string, StockSummary>(
  stockSummaries.map((s) => [`${s.itemId}:${s.warehouseId}`, s])
);

const alertsByItem = new Map<string, ReorderAlert[]>();
reorderAlerts.forEach((r) => {
  const existing = alertsByItem.get(r.itemId) ?? [];
  alertsByItem.set(r.itemId, [...existing, r]);
});

function getStockForWarehouse(itemId: string, warehouseId: string): StockSummary {
  return (
    stockMap.get(`${itemId}:${warehouseId}`) ?? {
      itemId,
      warehouseId,
      totalQty: 0,
      reservedQty: 0,
      availableQty: 0,
    }
  );
}

function getReorderStatus(
  itemId: string,
  warehouseId: string
): { label: string; color: string } {
  const alert = reorderAlerts.find(
    (r) => r.itemId === itemId && r.warehouseId === warehouseId
  );
  if (!alert) return { label: "OK", color: "text-green-600 bg-green-50 border-green-200" };
  if (alert.severity === "CRITICAL") return { label: "At Reorder", color: "text-red-700 bg-red-50 border-red-200" };
  return { label: "Near Reorder", color: "text-amber-700 bg-amber-50 border-amber-200" };
}

const ReorderDot = React.memo(function ReorderDot({ itemId, warehouseId }: { itemId: string; warehouseId: string }) {
  const status = getReorderStatus(itemId, warehouseId);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${status.color}`}>
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status.label === "At Reorder"
            ? "bg-red-600"
            : status.label === "Near Reorder"
            ? "bg-amber-500"
            : "bg-green-500"
        }`}
      />
      {status.label}
    </span>
  );
});

const StockCell = React.memo(function StockCell({ stock }: { stock: StockSummary }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-green-700 font-semibold">{stock.availableQty}</span>
      <span className="text-muted-foreground">/</span>
      <span className="text-amber-600">{stock.reservedQty}</span>
      <span className="text-muted-foreground">/</span>
      <span className="font-medium">{stock.totalQty}</span>
    </div>
  );
});

export default function StockPage() {
  const [warehouseFilter, setWarehouseFilter] = useState<WarehouseFilter>("all");

  const totalStockValue = useMemo(() => {
    return invItems.reduce((sum, item) => {
      const total = stockSummaries
        .filter((s) => s.itemId === item.id)
        .reduce((s, ss) => s + ss.totalQty, 0);
      return sum + item.standardCost * total;
    }, 0);
  }, []);

  const lowStockCount = useMemo(() => {
    return invItems.filter((item) =>
      item.reorderPoints.some((rp) => {
        const stock = getStockForWarehouse(item.id, rp.warehouseId);
        return stock.availableQty <= rp.reorderPoint;
      })
    ).length;
  }, []);

  const activeAlerts = useMemo(
    () => reorderAlerts.filter((r) => !r.isSuppressed).length,
    []
  );

  const filteredItems = useMemo(() => {
    if (warehouseFilter === "all") return invItems;
    return invItems.filter((item) =>
      stockSummaries.some(
        (s) => s.itemId === item.id && s.warehouseId === warehouseFilter && s.totalQty > 0
      )
    );
  }, [warehouseFilter]);

  const wh1 = warehouses.find((w) => w.id === "wh1")!;
  const wh2 = warehouses.find((w) => w.id === "wh2")!;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Stock Overview"
        description="Monitor inventory levels across all warehouses"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total SKUs"
          value={String(invItems.length)}
          icon={Package}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Total Stock Value"
          value={formatCurrency(totalStockValue)}
          change="Across all warehouses"
          trend="neutral"
          icon={DollarSign}
          iconColor="text-emerald-600"
        />
        <KPICard
          title="Low Stock Items"
          value={String(lowStockCount)}
          change="Below reorder point"
          trend="down"
          icon={AlertTriangle}
          iconColor="text-red-600"
        />
        <KPICard
          title="Reorder Alerts"
          value={String(activeAlerts)}
          change="Active alerts"
          trend={activeAlerts > 0 ? "down" : "neutral"}
          icon={Bell}
          iconColor="text-orange-600"
        />
      </div>

      {/* Warehouse Filter */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">Combined Stock View</h2>
        <Select
          value={warehouseFilter}
          onValueChange={(v) => setWarehouseFilter((v ?? "all") as WarehouseFilter)}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Filter by Warehouse" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Warehouses</SelectItem>
            <SelectItem value="wh1">Guwahati HQ</SelectItem>
            <SelectItem value="wh2">Noida Secondary</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Combined Stock Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-32">Item Code</TableHead>
              <TableHead className="min-w-[180px]">Item / Category</TableHead>
              <TableHead>Tracking</TableHead>
              <TableHead>ABC</TableHead>
              {(warehouseFilter === "all" || warehouseFilter === "wh1") && (
                <TableHead className="text-center min-w-[130px]">
                  <span className="block text-xs font-semibold">{wh1.name}</span>
                  <span className="block text-[10px] text-muted-foreground font-normal">Avail / Rsv / Total</span>
                </TableHead>
              )}
              {(warehouseFilter === "all" || warehouseFilter === "wh2") && (
                <TableHead className="text-center min-w-[130px]">
                  <span className="block text-xs font-semibold">{wh2.name}</span>
                  <span className="block text-[10px] text-muted-foreground font-normal">Avail / Rsv / Total</span>
                </TableHead>
              )}
              <TableHead>Reorder Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map((item) => {
              const wh1Stock = getStockForWarehouse(item.id, "wh1");
              const wh2Stock = getStockForWarehouse(item.id, "wh2");

              // Determine combined reorder status (worst severity wins)
              const alerts = (alertsByItem.get(item.id) ?? []).filter((r) => !r.isSuppressed);
              const hasCritical = alerts.some((a) => a.severity === "CRITICAL");
              const hasWarning = alerts.some((a) => a.severity === "WARNING");
              const overallStatus = hasCritical
                ? { label: "At Reorder", color: "text-red-700 bg-red-50 border-red-200", dot: "bg-red-600" }
                : hasWarning
                ? { label: "Near Reorder", color: "text-amber-700 bg-amber-50 border-amber-200", dot: "bg-amber-500" }
                : { label: "OK", color: "text-green-700 bg-green-50 border-green-200", dot: "bg-green-500" };

              return (
                <TableRow key={item.id} className="hover:bg-muted/30">
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.itemCode}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium leading-tight">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.category}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.trackingType} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.abcClass} />
                  </TableCell>
                  {(warehouseFilter === "all" || warehouseFilter === "wh1") && (
                    <TableCell className="text-center">
                      <StockCell stock={wh1Stock} />
                    </TableCell>
                  )}
                  {(warehouseFilter === "all" || warehouseFilter === "wh2") && (
                    <TableCell className="text-center">
                      <StockCell stock={wh2Stock} />
                    </TableCell>
                  )}
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${overallStatus.color}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${overallStatus.dot}`} />
                      {overallStatus.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
            {filteredItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No items found for the selected warehouse.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
        <span className="font-medium">Stock columns:</span>
        <span className="text-green-700 font-medium">Avail</span>
        <span>/</span>
        <span className="text-amber-600">Reserved</span>
        <span>/</span>
        <span>Total</span>
      </div>
    </div>
  );
}
