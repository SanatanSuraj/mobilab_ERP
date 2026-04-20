"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  warehouses,
  stockSummaries,
  formatCurrency,
  Warehouse,
  StockSummary,
} from "@/data/inventory-mock";
import { MapPin, Building2 } from "lucide-react";

function getWarehouseStockStats(warehouseId: string): {
  totalSkus: number;
  totalStockValue: number;
  totalItems: number;
} {
  const summaries = stockSummaries.filter((s) => s.warehouseId === warehouseId);
  const totalSkus = summaries.length;
  const totalItems = summaries.reduce((acc, s) => acc + s.totalQty, 0);
  const totalStockValue = summaries.reduce((acc, s) => {
    const item = invItems.find((i) => i.id === s.itemId);
    return acc + (item ? item.standardCost * s.totalQty : 0);
  }, 0);
  return { totalSkus, totalItems, totalStockValue };
}

function getStockForWarehouse(itemId: string, warehouseId: string): StockSummary {
  return (
    stockSummaries.find((s) => s.itemId === itemId && s.warehouseId === warehouseId) ?? {
      itemId,
      warehouseId,
      totalQty: 0,
      reservedQty: 0,
      availableQty: 0,
    }
  );
}

function WarehouseCard({ warehouse }: { warehouse: Warehouse }) {
  const stats = useMemo(() => getWarehouseStockStats(warehouse.id), [warehouse.id]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-muted/50">
              <Building2 className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">{warehouse.name}</CardTitle>
              <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {warehouse.city}
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className={
              warehouse.isPrimary
                ? "bg-blue-50 text-blue-700 border-blue-200 text-xs"
                : "bg-gray-50 text-gray-600 border-gray-200 text-xs"
            }
          >
            {warehouse.isPrimary ? "Primary" : "Secondary"}
          </Badge>
        </div>
        <div className="mt-2 space-y-0.5">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Code:</span> {warehouse.code}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">GSTIN:</span>{" "}
            <span className="font-mono">{warehouse.gstin}</span>
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Zones */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Zones
          </h4>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs py-2">Zone Name</TableHead>
                  <TableHead className="text-xs py-2">Code</TableHead>
                  <TableHead className="text-xs py-2">Allowed Transactions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {warehouse.zones.map((zone) => (
                  <TableRow key={zone.id} className="hover:bg-muted/20">
                    <TableCell className="py-1.5 text-xs font-medium">{zone.name}</TableCell>
                    <TableCell className="py-1.5">
                      <span className="font-mono text-xs text-muted-foreground">{zone.code}</span>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {zone.allowedTxnTypes.map((txn) => (
                          <span
                            key={txn}
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 border border-gray-200 font-mono"
                          >
                            {txn}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Stock Summary Stats */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Stock Summary
          </h4>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-bold">{stats.totalSkus}</p>
              <p className="text-xs text-muted-foreground mt-0.5">SKUs Stocked</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-bold">{stats.totalItems.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total Units</p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-base font-bold leading-tight">
                {formatCurrency(stats.totalStockValue)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Stock Value</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WarehousesPage() {
  const wh1 = warehouses.find((w) => w.id === "wh1")!;
  const wh2 = warehouses.find((w) => w.id === "wh2")!;

  // Combined stock table — sorted by total available desc
  const combinedRows = useMemo(() => {
    return invItems
      .map((item) => {
        const wh1Stock = getStockForWarehouse(item.id, "wh1");
        const wh2Stock = getStockForWarehouse(item.id, "wh2");
        const totalAvailable = wh1Stock.availableQty + wh2Stock.availableQty;
        return { item, wh1Stock, wh2Stock, totalAvailable };
      })
      .sort((a, b) => b.totalAvailable - a.totalAvailable);
  }, []);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Warehouses & Zones"
        description="Manage warehouse locations and zone configuration"
      />

      {/* Two Warehouse Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <WarehouseCard warehouse={wh1} />
        <WarehouseCard warehouse={wh2} />
      </div>

      {/* Combined Stock by Warehouse Table */}
      <div className="mb-3">
        <h2 className="text-base font-semibold">Combined Stock by Warehouse</h2>
        <p className="text-sm text-muted-foreground">
          Available quantities per item across both warehouses, sorted by total available stock.
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-36">Item Code</TableHead>
              <TableHead className="min-w-[200px]">Item Name</TableHead>
              <TableHead>Tracking</TableHead>
              <TableHead className="text-right">{wh1.name} Available</TableHead>
              <TableHead className="text-right">{wh2.name} Available</TableHead>
              <TableHead className="text-right font-semibold">Total Available</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {combinedRows.map(({ item, wh1Stock, wh2Stock, totalAvailable }) => (
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
                <TableCell className="text-right">
                  <span
                    className={`text-sm font-semibold ${
                      wh1Stock.availableQty === 0 ? "text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {wh1Stock.availableQty.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">{item.unit}</span>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={`text-sm font-semibold ${
                      wh2Stock.availableQty === 0 ? "text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {wh2Stock.availableQty.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">{item.unit}</span>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={`text-sm font-bold ${
                      totalAvailable === 0
                        ? "text-red-600"
                        : totalAvailable < 10
                        ? "text-amber-600"
                        : "text-green-700"
                    }`}
                  >
                    {totalAvailable.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">{item.unit}</span>
                </TableCell>
              </TableRow>
            ))}
            {combinedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No stock data available.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
