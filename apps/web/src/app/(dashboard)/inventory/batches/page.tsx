"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  invBatches,
  invItems,
  warehouses,
  getInvItemById,
  getWarehouseById,
  formatDate,
  getDaysToExpiry,
  getExpiryUrgency,
  getExpiringBatches,
  InvBatch,
} from "@/data/inventory-mock";
import { Layers, CheckCircle, ShieldAlert, Clock, AlertTriangle } from "lucide-react";

const BATCH_STATUSES = [
  "All",
  "ACTIVE",
  "PARTIALLY_CONSUMED",
  "QUARANTINED",
  "EXPIRED",
] as const;

function ExpiryCell({ expiryDate }: { expiryDate: string }) {
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

function QtyProgressCell({
  received,
  current,
  consumed,
}: {
  received: number;
  current: number;
  consumed: number;
}) {
  const pct = received > 0 ? Math.round((current / received) * 100) : 0;
  return (
    <div className="min-w-[120px]">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>
          {current}/{received}
        </span>
        <span className="text-red-500">-{consumed}</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

export default function BatchesPage() {
  const [warehouseFilter, setWarehouseFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [itemFilter, setItemFilter] = useState("All");
  const [detailBatch, setDetailBatch] = useState<InvBatch | null>(null);

  const expiring30 = getExpiringBatches(30);
  const expiring90 = getExpiringBatches(90);

  const totalBatches = invBatches.length;
  const activeBatches = invBatches.filter((b) => b.status === "ACTIVE").length;
  const quarantinedBatches = invBatches.filter(
    (b) => b.status === "QUARANTINED"
  ).length;
  const expiring90Count = expiring90.length;

  const filteredBatches = useMemo(() => {
    return invBatches.filter((b) => {
      if (warehouseFilter !== "All" && b.warehouseId !== warehouseFilter)
        return false;
      if (statusFilter !== "All" && b.status !== statusFilter) return false;
      if (itemFilter !== "All" && b.itemId !== itemFilter) return false;
      return true;
    });
  }, [warehouseFilter, statusFilter, itemFilter]);

  const columns: Column<InvBatch>[] = [
    {
      key: "batchNumber",
      header: "Batch Number",
      sortable: true,
      render: (b) => (
        <span className="font-mono text-xs font-bold">{b.batchNumber}</span>
      ),
    },
    {
      key: "itemId",
      header: "Item",
      render: (b) => {
        const item = getInvItemById(b.itemId);
        return (
          <div>
            <p className="text-sm font-medium">{item?.name ?? b.itemId}</p>
            <p className="text-xs font-mono text-muted-foreground">
              {item?.itemCode}
            </p>
          </div>
        );
      },
    },
    {
      key: "vendorLotNumber",
      header: "Vendor Lot #",
      render: (b) => (
        <span className="font-mono text-xs text-muted-foreground">
          {b.vendorLotNumber}
        </span>
      ),
    },
    {
      key: "vendorName",
      header: "Vendor",
      render: (b) => <span className="text-sm">{b.vendorName}</span>,
    },
    {
      key: "grnId",
      header: "GRN",
      render: (b) => (
        <span className="font-mono text-xs text-muted-foreground">
          {b.grnId}
        </span>
      ),
    },
    {
      key: "mfgDate",
      header: "Mfg Date",
      render: (b) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(b.mfgDate)}
        </span>
      ),
    },
    {
      key: "expiryDate",
      header: "Expiry Date",
      sortable: true,
      render: (b) => <ExpiryCell expiryDate={b.expiryDate} />,
    },
    {
      key: "currentQty",
      header: "Qty (Rcvd/Curr/Cnsmd)",
      render: (b) => (
        <QtyProgressCell
          received={b.receivedQty}
          current={b.currentQty}
          consumed={b.consumedQty}
        />
      ),
    },
    {
      key: "qcStatus",
      header: "QC",
      render: (b) => <StatusBadge status={b.qcStatus} />,
    },
    {
      key: "status",
      header: "Status",
      render: (b) => <StatusBadge status={b.status} />,
    },
    {
      key: "storageTemp",
      header: "Storage Temp",
      render: (b) => (
        <span className="text-sm text-muted-foreground">
          {b.storageTemp ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Batch Register"
        description="Track reagent and component batches with FEFO and expiry monitoring"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <KPICard
          title="Total Batches"
          value={String(totalBatches)}
          icon={Layers}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Active"
          value={String(activeBatches)}
          icon={CheckCircle}
          iconColor="text-green-600"
        />
        <KPICard
          title="Quarantined"
          value={String(quarantinedBatches)}
          icon={ShieldAlert}
          iconColor="text-orange-600"
        />
        <KPICard
          title="Expiring in 90 Days"
          value={String(expiring90Count)}
          icon={Clock}
          iconColor="text-amber-600"
        />
      </div>

      {/* Expiry Alert Banner */}
      {expiring30.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <p className="text-sm font-medium">
            {expiring30.length} batch{expiring30.length !== 1 ? "es" : ""}{" "}
            expiring within 30 days — review immediately
          </p>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Select
          value={warehouseFilter}
          onValueChange={(v) => setWarehouseFilter(v ?? "All")}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Warehouse" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Warehouses</SelectItem>
            {warehouses.map((wh) => (
              <SelectItem key={wh.id} value={wh.id}>
                {wh.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v ?? "All")}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {BATCH_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "All"
                  ? "All Statuses"
                  : s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={itemFilter}
          onValueChange={(v) => setItemFilter(v ?? "All")}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Item" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Items</SelectItem>
            {invItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable<InvBatch>
        data={filteredBatches}
        columns={columns}
        searchKey="batchNumber"
        searchPlaceholder="Search by batch number..."
        onRowClick={(b) => setDetailBatch(b)}
      />

      {/* Detail Dialog */}
      <Dialog
        open={!!detailBatch}
        onOpenChange={(open) => !open && setDetailBatch(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono">
              {detailBatch?.batchNumber}
            </DialogTitle>
          </DialogHeader>
          {detailBatch && (
            <div className="space-y-4">
              {/* Item */}
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                  Item
                </p>
                <p className="font-semibold">
                  {getInvItemById(detailBatch.itemId)?.name}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  {getInvItemById(detailBatch.itemId)?.itemCode}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Warehouse:</span>{" "}
                  <span className="font-medium">
                    {getWarehouseById(detailBatch.warehouseId)?.name}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Vendor:</span>{" "}
                  <span className="font-medium">{detailBatch.vendorName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Vendor Lot #:</span>{" "}
                  <span className="font-mono text-xs">
                    {detailBatch.vendorLotNumber}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">GRN:</span>{" "}
                  <span className="font-mono text-xs">{detailBatch.grnId}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Mfg Date:</span>{" "}
                  <span className="font-medium">
                    {formatDate(detailBatch.mfgDate)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Expiry Date:</span>{" "}
                  <ExpiryCell expiryDate={detailBatch.expiryDate} />
                </div>
                <div>
                  <span className="text-muted-foreground">QC Status:</span>{" "}
                  <StatusBadge status={detailBatch.qcStatus} />
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <StatusBadge status={detailBatch.status} />
                </div>
                {detailBatch.catalogueNumber && (
                  <div>
                    <span className="text-muted-foreground">
                      Catalogue #:
                    </span>{" "}
                    <span className="font-mono text-xs">
                      {detailBatch.catalogueNumber}
                    </span>
                  </div>
                )}
                {detailBatch.storageTemp && (
                  <div>
                    <span className="text-muted-foreground">
                      Storage Temp:
                    </span>{" "}
                    <span className="font-medium">
                      {detailBatch.storageTemp}
                    </span>
                  </div>
                )}
              </div>

              {/* Consumption Progress */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Consumption</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>
                        Received:{" "}
                        <strong>{detailBatch.receivedQty}</strong>
                      </span>
                      <span>
                        Current: <strong>{detailBatch.currentQty}</strong>
                      </span>
                      <span className="text-red-600">
                        Consumed: <strong>{detailBatch.consumedQty}</strong>
                      </span>
                    </div>
                    <Progress
                      value={
                        detailBatch.receivedQty > 0
                          ? Math.round(
                              (detailBatch.currentQty /
                                detailBatch.receivedQty) *
                                100
                            )
                          : 0
                      }
                      className="h-3"
                    />
                    <p className="text-xs text-muted-foreground text-right">
                      {detailBatch.receivedQty > 0
                        ? Math.round(
                            (detailBatch.currentQty /
                              detailBatch.receivedQty) *
                              100
                          )
                        : 0}
                      % remaining
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailBatch(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
