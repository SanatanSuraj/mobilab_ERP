"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  invBatches,
  invItems,
  stockSummaries,
  getInvItemById,
  getWarehouseById,
  formatDate,
  formatCurrency,
  getDaysToExpiry,
  getExpiryUrgency,
  InvBatch,
  InvItem,
} from "@/data/inventory-mock";
import {
  DollarSign,
  Package,
  Layers,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getItemTotalQty(itemId: string): number {
  return stockSummaries
    .filter((s) => s.itemId === itemId)
    .reduce((sum, s) => sum + s.totalQty, 0);
}

function getItemStockValue(item: InvItem): number {
  return getItemTotalQty(item.id) * item.standardCost;
}

function ExpiryDateCell({ expiryDate }: { expiryDate: string }) {
  const urgency = getExpiryUrgency(expiryDate);
  const days = getDaysToExpiry(expiryDate);
  const colorClass =
    urgency === "expired" || urgency === "urgent"
      ? "text-red-600"
      : urgency === "warning"
        ? "text-amber-600"
        : "text-green-600";
  return (
    <div>
      <p className={`text-sm font-medium ${colorClass}`}>
        {formatDate(expiryDate)}
      </p>
      <p className="text-xs text-muted-foreground">
        {days <= 0 ? "Expired" : `${days}d remaining`}
      </p>
    </div>
  );
}

function BatchMiniCard({ batch }: { batch: InvBatch }) {
  const item = getInvItemById(batch.itemId);
  const wh = getWarehouseById(batch.warehouseId);
  return (
    <div className="rounded-lg border p-3 space-y-1 text-sm">
      <p className="font-mono text-xs font-bold">{batch.batchNumber}</p>
      <p className="font-medium">{item?.name ?? batch.itemId}</p>
      <ExpiryDateCell expiryDate={batch.expiryDate} />
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          Qty: {batch.currentQty}
        </span>
        <Badge
          variant="outline"
          className="text-xs bg-blue-50 text-blue-700 border-blue-200"
        >
          {wh?.name ?? batch.warehouseId}
        </Badge>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  // ── Expiry segments ──────────────────────────────────────────────────────
  const expiredBatches = useMemo(
    () =>
      invBatches.filter(
        (b) =>
          getDaysToExpiry(b.expiryDate) <= 0 &&
          b.status !== "FULLY_CONSUMED" &&
          b.status !== "RETURNED_TO_VENDOR"
      ),
    []
  );
  const expiring30Batches = useMemo(
    () =>
      invBatches.filter((b) => {
        const d = getDaysToExpiry(b.expiryDate);
        return (
          d > 0 &&
          d <= 30 &&
          b.status !== "FULLY_CONSUMED" &&
          b.status !== "RETURNED_TO_VENDOR"
        );
      }),
    []
  );
  const expiring90Batches = useMemo(
    () =>
      invBatches.filter((b) => {
        const d = getDaysToExpiry(b.expiryDate);
        return (
          d > 30 &&
          d <= 90 &&
          b.status !== "FULLY_CONSUMED" &&
          b.status !== "RETURNED_TO_VENDOR"
        );
      }),
    []
  );

  // ── ABC Analysis ─────────────────────────────────────────────────────────
  const aItems = invItems.filter((i) => i.abcClass === "A");
  const bItems = invItems.filter((i) => i.abcClass === "B");
  const cItems = invItems.filter((i) => i.abcClass === "C");

  const totalItems = invItems.length;

  const aValue = aItems.reduce((s, i) => s + getItemStockValue(i), 0);
  const bValue = bItems.reduce((s, i) => s + getItemStockValue(i), 0);
  const cValue = cItems.reduce((s, i) => s + getItemStockValue(i), 0);
  const totalValue = aValue + bValue + cValue;

  // ── Stock Valuation ───────────────────────────────────────────────────────
  const valuedItems = useMemo(() => {
    return [...invItems]
      .map((item) => {
        const qty = getItemTotalQty(item.id);
        const value = qty * item.standardCost;
        return { ...item, totalQty: qty, totalValue: value };
      })
      .sort((a, b) => b.totalValue - a.totalValue);
  }, []);

  const totalInventoryValue = valuedItems.reduce(
    (s, i) => s + i.totalValue,
    0
  );
  const finishedGoodsValue = valuedItems
    .filter((i) => i.trackingType === "SERIAL")
    .reduce((s, i) => s + i.totalValue, 0);
  const rawMaterialsValue = valuedItems
    .filter(
      (i) => i.category === "Reagents" || i.category === "Components"
    )
    .reduce((s, i) => s + i.totalValue, 0);
  const wipEstimate = Math.round(totalInventoryValue * 0.08);

  // ── Slow Moving ───────────────────────────────────────────────────────────
  const slowMovingItems = invItems.filter(
    (i) => i.isSlowMoving || i.isDeadStock
  );
  const deadStockWriteoff = invItems
    .filter((i) => i.isDeadStock)
    .reduce((s, i) => s + getItemStockValue(i), 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Inventory Reports"
        description="Analytics, ABC analysis, expiry tracking, and valuation"
      />

      <Tabs defaultValue="expiry">
        <TabsList className="mb-6">
          <TabsTrigger value="expiry">Expiry Tracking</TabsTrigger>
          <TabsTrigger value="abc">ABC Analysis</TabsTrigger>
          <TabsTrigger value="valuation">Stock Valuation</TabsTrigger>
          <TabsTrigger value="slowmoving">Slow Moving</TabsTrigger>
        </TabsList>

        {/* ── Expiry Tracking ─────────────────────────────────────────────── */}
        <TabsContent value="expiry">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Expired */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <h3 className="text-sm font-semibold">
                  Expired ({expiredBatches.length})
                </h3>
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {expiredBatches.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No expired batches
                  </p>
                )}
                {expiredBatches.map((b) => (
                  <BatchMiniCard key={b.id} batch={b} />
                ))}
              </div>
            </div>

            {/* Expiring in 30 days */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <h3 className="text-sm font-semibold">
                  Expiring in 30 Days ({expiring30Batches.length})
                </h3>
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {expiring30Batches.length === 0 && (
                  <p className="text-xs text-muted-foreground">None</p>
                )}
                {expiring30Batches.map((b) => (
                  <BatchMiniCard key={b.id} batch={b} />
                ))}
              </div>
            </div>

            {/* Expiring in 90 days */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-3 w-3 rounded-full bg-amber-400" />
                <h3 className="text-sm font-semibold">
                  Expiring in 90 Days ({expiring90Batches.length})
                </h3>
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {expiring90Batches.length === 0 && (
                  <p className="text-xs text-muted-foreground">None</p>
                )}
                {expiring90Batches.map((b) => (
                  <BatchMiniCard key={b.id} batch={b} />
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── ABC Analysis ────────────────────────────────────────────────── */}
        <TabsContent value="abc">
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p className="text-sm">
              ABC classification is based on consumption value — A items
              represent ~80% of total value
            </p>
          </div>

          {/* Summary table */}
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">ABC Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Item Count</TableHead>
                    <TableHead className="text-right">% of Items</TableHead>
                    <TableHead className="text-right">Stock Value</TableHead>
                    <TableHead className="text-right">% of Value</TableHead>
                    <TableHead>Cycle Count Frequency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    {
                      cls: "A",
                      items: aItems,
                      value: aValue,
                      freq: "Monthly",
                    },
                    {
                      cls: "B",
                      items: bItems,
                      value: bValue,
                      freq: "Quarterly",
                    },
                    {
                      cls: "C",
                      items: cItems,
                      value: cValue,
                      freq: "Semi-Annually",
                    },
                  ].map((row) => (
                    <TableRow key={row.cls}>
                      <TableCell>
                        <StatusBadge status={row.cls} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {row.items.length}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {totalItems > 0
                          ? ((row.items.length / totalItems) * 100).toFixed(0)
                          : 0}
                        %
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(row.value)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {totalValue > 0
                          ? ((row.value / totalValue) * 100).toFixed(0)
                          : 0}
                        %
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-xs bg-purple-50 text-purple-700 border-purple-200"
                        >
                          {row.freq}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* All items with ABC class */}
          <h3 className="text-sm font-semibold mb-3">Item Detail</h3>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Item Code</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead>ABC</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead className="text-right">Std Cost</TableHead>
                  <TableHead className="text-right">Stock Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...invItems]
                  .sort((a, b) => a.abcClass.localeCompare(b.abcClass))
                  .map((item) => {
                    const qty = getItemTotalQty(item.id);
                    const val = qty * item.standardCost;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">
                          {item.itemCode}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {item.name}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={item.abcClass} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={item.trackingType} />
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {qty}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatCurrency(item.standardCost)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">
                          {formatCurrency(val)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Stock Valuation ──────────────────────────────────────────────── */}
        <TabsContent value="valuation">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KPICard
              title="Total Inventory Value"
              value={formatCurrency(totalInventoryValue)}
              icon={DollarSign}
              iconColor="text-blue-600"
            />
            <KPICard
              title="Finished Goods"
              value={formatCurrency(finishedGoodsValue)}
              icon={Package}
              iconColor="text-green-600"
            />
            <KPICard
              title="Raw Materials"
              value={formatCurrency(rawMaterialsValue)}
              icon={Layers}
              iconColor="text-indigo-600"
            />
            <KPICard
              title="WIP Estimate"
              value={formatCurrency(wipEstimate)}
              icon={TrendingDown}
              iconColor="text-amber-600"
            />
          </div>

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Item Code</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead>ABC</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead className="text-right">Total Qty</TableHead>
                  <TableHead className="text-right">Std Cost</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                  <TableHead className="text-right">% Portfolio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {valuedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      {item.itemCode}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {item.name}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.abcClass} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.trackingType} />
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {item.totalQty}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatCurrency(item.standardCost)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold">
                      {formatCurrency(item.totalValue)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {totalInventoryValue > 0
                        ? ((item.totalValue / totalInventoryValue) * 100).toFixed(
                            1
                          )
                        : 0}
                      %
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Slow Moving ──────────────────────────────────────────────────── */}
        <TabsContent value="slowmoving">
          {deadStockWriteoff > 0 && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex items-center gap-2 text-red-800">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">
                  Potential write-off value for dead stock items:
                </span>
              </div>
              <span className="text-sm font-bold text-red-700">
                {formatCurrency(deadStockWriteoff)}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {slowMovingItems.length === 0 && (
              <p className="text-muted-foreground text-sm py-8 col-span-2 text-center">
                No slow moving or dead stock items
              </p>
            )}
            {slowMovingItems.map((item) => {
              const qty = getItemTotalQty(item.id);
              const val = qty * item.standardCost;
              const isDeadStock = item.isDeadStock;
              const flag = isDeadStock ? "Dead Stock" : "Slow Moving";
              const action = isDeadStock
                ? "Consider write-off or disposal — no consumption activity detected"
                : "Review replenishment settings — reduce reorder quantity or frequency";

              return (
                <Card
                  key={item.id}
                  className={`border-l-4 ${isDeadStock ? "border-l-red-500" : "border-l-amber-500"}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-xs text-muted-foreground">
                            {item.itemCode}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${isDeadStock ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}
                          >
                            {flag}
                          </Badge>
                        </div>
                        <p className="font-semibold text-sm mb-1">
                          {item.name}
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">
                          {item.category} · {item.subCategory}
                        </p>
                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div>
                            <p className="text-muted-foreground">Total Qty</p>
                            <p className="font-semibold">{qty}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Std Cost</p>
                            <p className="font-semibold">
                              {formatCurrency(item.standardCost)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">
                              {isDeadStock ? "Write-off Value" : "Stock Value"}
                            </p>
                            <p
                              className={`font-semibold ${isDeadStock ? "text-red-600" : ""}`}
                            >
                              {formatCurrency(val)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Recommended:{" "}
                        </span>
                        {action}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
