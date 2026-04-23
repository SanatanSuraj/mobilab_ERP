"use client";

// TODO(phase-5): Serial number tracking has no backend routes yet. Expected
// routes:
//   GET  /inventory/serials - list serials with item/warehouse/status filters
//   GET  /inventory/serials/:id - serial detail + movement history
//   POST /inventory/serials/:id/status - transition serial state
// Mock imports left in place until the serials slice ships in
// apps/api/src/modules/inventory.

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
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
import {
  invSerials,
  invItems,
  warehouses,
  formatDate,
  InvSerial,
} from "@/data/inventory-mock";
import {
  Factory,
  Package,
  Truck,
  RotateCcw,
} from "lucide-react";

// Module-level lookup maps — built once, never recreated
const itemMap = new Map(invItems.map((i) => [i.id, i]));
const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

const SERIAL_STATUSES = [
  "All",
  "CREATED",
  "IN_PRODUCTION",
  "QC_HOLD",
  "FINISHED",
  "RESERVED",
  "DISPATCHED",
  "RETURNED",
  "SCRAPPED",
] as const;

export default function SerialsPage() {
  const [itemFilter, setItemFilter] = useState("All");
  const [warehouseFilter, setWarehouseFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [detailSerial, setDetailSerial] = useState<InvSerial | null>(null);

  // KPI counts — single memoised pass, stable across re-renders
  const kpiCounts = useMemo(
    () => ({
      inProduction: invSerials.filter((s) => s.status === "IN_PRODUCTION")
        .length,
      finished: invSerials.filter((s) => s.status === "FINISHED").length,
      dispatched: invSerials.filter((s) => s.status === "DISPATCHED").length,
      returnedScrap: invSerials.filter(
        (s) => s.status === "RETURNED" || s.status === "SCRAPPED"
      ).length,
    }),
    []
  );

  const filteredSerials = useMemo(() => {
    return invSerials.filter((s) => {
      if (itemFilter !== "All" && s.itemId !== itemFilter) return false;
      if (warehouseFilter !== "All" && s.warehouseId !== warehouseFilter)
        return false;
      if (statusFilter !== "All" && s.status !== statusFilter) return false;
      return true;
    });
  }, [itemFilter, warehouseFilter, statusFilter]);

  const columns: Column<InvSerial>[] = useMemo(
    () => [
    {
      key: "serialNumber",
      header: "Serial Number",
      sortable: true,
      render: (s) => (
        <span className="font-mono text-xs font-bold">{s.serialNumber}</span>
      ),
    },
    {
      key: "itemId",
      header: "Item",
      render: (s) => {
        const item = itemMap.get(s.itemId);
        return (
          <div>
            <p className="text-sm font-medium">{item?.name ?? s.itemId}</p>
            <p className="text-xs font-mono text-muted-foreground">
              {item?.itemCode}
            </p>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (s) => <StatusBadge status={s.status} />,
    },
    {
      key: "warehouseId",
      header: "Warehouse",
      render: (s) => (
        <span className="text-sm">
          {warehouseMap.get(s.warehouseId)?.name ?? s.warehouseId}
        </span>
      ),
    },
    {
      key: "workOrderId",
      header: "Work Order",
      render: (s) => (
        <span className="font-mono text-xs text-muted-foreground">
          {s.workOrderId ?? "—"}
        </span>
      ),
    },
    {
      key: "components",
      header: "Component Links",
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          {s.pcbId && (
            <span className="font-mono text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
              PCB: {s.pcbId}
            </span>
          )}
          {s.mechId && (
            <span className="font-mono text-[10px] bg-purple-50 text-purple-700 border border-purple-200 rounded px-1.5 py-0.5">
              M: {s.mechId}
            </span>
          )}
          {s.sensorId && (
            <span className="font-mono text-[10px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">
              S: {s.sensorId}
            </span>
          )}
          {!s.pcbId && !s.mechId && !s.sensorId && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      key: "accountName",
      header: "Account",
      render: (s) => (
        <span className="text-sm text-muted-foreground">
          {s.accountName ?? "—"}
        </span>
      ),
    },
    {
      key: "manufacturedDate",
      header: "Manufactured",
      render: (s) => (
        <span className="text-sm text-muted-foreground">
          {s.manufacturedDate ? formatDate(s.manufacturedDate) : "—"}
        </span>
      ),
    },
    {
      key: "dispatchedDate",
      header: "Dispatched",
      render: (s) => (
        <span className="text-sm text-muted-foreground">
          {s.dispatchedDate ? formatDate(s.dispatchedDate) : "—"}
        </span>
      ),
    },
    {
      key: "qcCertUrl",
      header: "QC Cert",
      render: (s) =>
        s.qcCertUrl ? (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200 text-xs cursor-pointer"
          >
            View Cert
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ],
    []
  );

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Serial Number Register"
        description="Track individual instrument serials through their complete lifecycle"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="In Production"
          value={String(kpiCounts.inProduction)}
          icon={Factory}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Finished (In Stock)"
          value={String(kpiCounts.finished)}
          icon={Package}
          iconColor="text-green-600"
        />
        <KPICard
          title="Dispatched"
          value={String(kpiCounts.dispatched)}
          icon={Truck}
          iconColor="text-indigo-600"
        />
        <KPICard
          title="Returned / Scrapped"
          value={String(kpiCounts.returnedScrap)}
          icon={RotateCcw}
          iconColor="text-orange-600"
        />
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Select
          value={itemFilter}
          onValueChange={(v) => setItemFilter(v ?? "All")}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Item" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Items</SelectItem>
            {invItems
              .filter((i) => i.trackingType === "SERIAL")
              .map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

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
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {SERIAL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "All"
                  ? "All Statuses"
                  : s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable<InvSerial>
        data={filteredSerials}
        columns={columns}
        searchKey="serialNumber"
        searchPlaceholder="Search by serial number..."
        onRowClick={(s) => setDetailSerial(s)}
      />

      {/* Detail Dialog */}
      <Dialog
        open={!!detailSerial}
        onOpenChange={(open) => !open && setDetailSerial(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono">
              {detailSerial?.serialNumber}
            </DialogTitle>
          </DialogHeader>
          {detailSerial && (
            <div className="space-y-4">
              {/* Item info */}
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                  Item
                </p>
                <p className="font-semibold">
                  {itemMap.get(detailSerial.itemId)?.name}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  {itemMap.get(detailSerial.itemId)?.itemCode}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <StatusBadge status={detailSerial.status} />
                </div>
                <div>
                  <span className="text-muted-foreground">Warehouse:</span>{" "}
                  <span className="font-medium">
                    {warehouseMap.get(detailSerial.warehouseId)?.name}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Work Order:</span>{" "}
                  <span className="font-mono text-xs">
                    {detailSerial.workOrderId ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Account:</span>{" "}
                  <span className="font-medium">
                    {detailSerial.accountName ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Manufactured:</span>{" "}
                  <span className="font-medium">
                    {detailSerial.manufacturedDate
                      ? formatDate(detailSerial.manufacturedDate)
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Dispatched:</span>{" "}
                  <span className="font-medium">
                    {detailSerial.dispatchedDate
                      ? formatDate(detailSerial.dispatchedDate)
                      : "—"}
                  </span>
                </div>
                {detailSerial.deliveryChallanId && (
                  <div>
                    <span className="text-muted-foreground">
                      Delivery Challan:
                    </span>{" "}
                    <span className="font-mono text-xs">
                      {detailSerial.deliveryChallanId}
                    </span>
                  </div>
                )}
                {detailSerial.qcCertUrl && (
                  <div>
                    <span className="text-muted-foreground">QC Cert:</span>{" "}
                    <Badge
                      variant="outline"
                      className="bg-blue-50 text-blue-700 border-blue-200 text-xs ml-1"
                    >
                      {detailSerial.qcCertUrl}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Component Traceability */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Component Traceability
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 rounded-lg bg-blue-50 border border-blue-100">
                      <p className="text-xs text-blue-600 font-medium mb-1">
                        PCB ID
                      </p>
                      <p className="text-xs font-mono font-bold text-blue-800">
                        {detailSerial.pcbId ?? "—"}
                      </p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-purple-50 border border-purple-100">
                      <p className="text-xs text-purple-600 font-medium mb-1">
                        Mech ID
                      </p>
                      <p className="text-xs font-mono font-bold text-purple-800">
                        {detailSerial.mechId ?? "—"}
                      </p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-green-50 border border-green-100">
                      <p className="text-xs text-green-600 font-medium mb-1">
                        Sensor ID
                      </p>
                      <p className="text-xs font-mono font-bold text-green-800">
                        {detailSerial.sensorId ?? "—"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailSerial(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
