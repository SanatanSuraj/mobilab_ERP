"use client";

// TODO(phase-5): Inward entries (gate-in records that precede GRN) have no
// backend routes yet. Expected routes:
//   GET  /procurement/inward-entries
//   POST /procurement/inward-entries - record gate-in against a PO
//   POST /procurement/inward-entries/:id/convert-to-grn
// Mock imports left in place until the inward slice ships in
// apps/api/src/modules/procurement.

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  inwardEntries,
  purchaseOrders,
  InwardEntry,
  formatDate,
} from "@/data/procurement-mock";
import {
  Package,
  Truck,
  ClipboardCheck,
  CheckCircle2,
  FileCheck,
  Plus,
} from "lucide-react";

const approvedPOs = purchaseOrders.filter((po) =>
  ["APPROVED", "PO_SENT", "PARTIALLY_RECEIVED"].includes(po.status)
);

export default function InwardPage() {
  const [entries, setEntries] = useState<InwardEntry[]>(inwardEntries);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form state
  const [selectedPOId, setSelectedPOId] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [challanRef, setChallanRef] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [qtyReceived, setQtyReceived] = useState<number>(0);
  const [vendorBatchRef, setVendorBatchRef] = useState("");

  const selectedPO = approvedPOs.find((p) => p.id === selectedPOId);
  const firstLine = selectedPO?.lines[0];

  function resetForm() {
    setSelectedPOId("");
    setVehicleNumber("");
    setDriverName("");
    setChallanRef("");
    setReceivedAt("");
    setQtyReceived(0);
    setVendorBatchRef("");
    setSaved(false);
  }

  function handleSave() {
    if (!selectedPO || !firstLine) return;
    const newEntry: InwardEntry = {
      id: `inw${Date.now()}`,
      inwardNumber: `MLB-INW-2026-00${entries.length + 4}`,
      poId: selectedPO.id,
      poNumber: selectedPO.poNumber,
      vendorId: selectedPO.vendorId,
      vendorName: selectedPO.vendorName,
      warehouseId: selectedPO.warehouseId,
      warehouseName: selectedPO.warehouseName,
      vehicleNumber,
      driverName,
      challanRef,
      receivedAt: receivedAt || new Date().toISOString(),
      status: "RECEIVED",
      lines: [
        {
          id: `inl${Date.now()}`,
          itemId: firstLine.itemId,
          itemCode: firstLine.itemCode,
          itemName: firstLine.itemName,
          qtyOrdered: firstLine.qty,
          qtyReceived,
          unit: firstLine.unit,
          vendorBatchRef: vendorBatchRef || undefined,
          condition: "GOOD",
        },
      ],
      receivedBy: "Ranjit Bora",
      qcTaskId: `qc-inw-00${entries.length + 4}`,
    };
    setEntries((prev) => [newEntry, ...prev]);
    setSaved(true);
  }

  // KPIs
  const total = entries.length;
  const received = entries.filter((e) => e.status === "RECEIVED").length;
  const inQC = entries.filter((e) => e.status === "QC_IN_PROGRESS").length;
  const qcDone = entries.filter((e) => e.status === "QC_DONE").length;
  const grnCreated = entries.filter((e) => e.status === "GRN_CREATED").length;

  const columns: Column<InwardEntry>[] = [
    {
      key: "inwardNumber",
      header: "Inward #",
      render: (row) => (
        <span className="font-mono font-bold text-sm">{row.inwardNumber}</span>
      ),
    },
    {
      key: "poNumber",
      header: "PO Number",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.poNumber}
        </span>
      ),
    },
    { key: "vendorName", header: "Vendor" },
    { key: "warehouseName", header: "Warehouse" },
    {
      key: "receivedAt",
      header: "Received At",
      render: (row) => (
        <span className="text-sm">{formatDate(row.receivedAt)}</span>
      ),
    },
    {
      key: "vehicleNumber",
      header: "Vehicle",
      render: (row) => (
        <span className="font-mono text-xs">{row.vehicleNumber}</span>
      ),
    },
    {
      key: "challanRef",
      header: "Challan Ref",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.challanRef}
        </span>
      ),
    },
    {
      key: "lines",
      header: "Items",
      render: (row) => (
        <div className="space-y-0.5">
          {row.lines.map((line) => {
            const isShort = line.qtyReceived < line.qtyOrdered;
            const isFull = line.qtyReceived === line.qtyOrdered;
            return (
              <div key={line.id} className="text-xs">
                <span>{line.itemName}: </span>
                <span
                  className={
                    isShort
                      ? "text-red-600 font-medium"
                      : isFull
                      ? "text-green-600 font-medium"
                      : "text-amber-600 font-medium"
                  }
                >
                  {line.qtyOrdered} → {line.qtyReceived} {line.unit}
                </span>
              </div>
            );
          })}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "qcTaskId",
      header: "QC Task",
      render: (row) =>
        row.qcTaskId ? (
          <span className="font-mono text-xs text-blue-600 underline underline-offset-2 cursor-pointer">
            {row.qcTaskId}
          </span>
        ) : (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
          >
            Pending
          </Badge>
        ),
    },
    {
      key: "grnId",
      header: "GRN",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.grnId ?? "—"}
        </span>
      ),
    },
    { key: "receivedBy", header: "Received By" },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <Button variant="outline" size="sm" className="h-7 text-xs">
          View QC
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Inward / Gate Entry"
        description="Record all goods received at warehouse gate"
        actions={
          <Button onClick={() => { resetForm(); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            New Inward Entry
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard
          title="Total Inwards"
          value={String(total)}
          icon={Package}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Received (Pending QC)"
          value={String(received)}
          icon={Truck}
          iconColor="text-amber-600"
        />
        <KPICard
          title="In QC"
          value={String(inQC)}
          icon={ClipboardCheck}
          iconColor="text-orange-600"
        />
        <KPICard
          title="QC Done"
          value={String(qcDone)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="GRN Created"
          value={String(grnCreated)}
          icon={FileCheck}
          iconColor="text-indigo-600"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <DataTable
            data={entries}
            columns={columns}
            searchKey="vendorName"
            searchPlaceholder="Search by vendor..."
          />
        </CardContent>
      </Card>

      {/* New Inward Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Inward Entry</DialogTitle>
          </DialogHeader>

          {saved ? (
            <div className="rounded-md bg-green-50 border border-green-200 p-4 text-green-800 text-sm font-medium">
              ✓ QC Inspection task auto-created and assigned to QC Inspector
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label>PO Reference</Label>
                  <Select
                    value={selectedPOId}
                    onValueChange={(v) => setSelectedPOId(v ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select approved PO…" />
                    </SelectTrigger>
                    <SelectContent>
                      {approvedPOs.map((po) => (
                        <SelectItem key={po.id} value={po.id}>
                          {po.poNumber} — {po.vendorName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Vendor</Label>
                  <Input
                    value={selectedPO?.vendorName ?? ""}
                    readOnly
                    className="bg-muted/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Warehouse</Label>
                  <Input
                    value={selectedPO?.warehouseName ?? ""}
                    readOnly
                    className="bg-muted/40"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Vehicle Number</Label>
                  <Input
                    placeholder="e.g. AS-01-AB-1234"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Driver Name</Label>
                  <Input
                    placeholder="Driver's name"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Challan Reference</Label>
                  <Input
                    placeholder="e.g. BIO-CH-2026-0412"
                    value={challanRef}
                    onChange={(e) => setChallanRef(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Received At</Label>
                  <Input
                    type="datetime-local"
                    value={receivedAt}
                    onChange={(e) => setReceivedAt(e.target.value)}
                  />
                </div>
              </div>

              {/* Items */}
              <div className="pt-2">
                <h4 className="text-sm font-semibold mb-3">Items Received</h4>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Item Name</th>
                        <th className="text-right px-3 py-2 font-medium">Qty Ordered</th>
                        <th className="text-right px-3 py-2 font-medium">Qty Received</th>
                        <th className="text-left px-3 py-2 font-medium">Batch Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t">
                        <td className="px-3 py-2">
                          <Input
                            value={firstLine?.itemName ?? ""}
                            readOnly
                            className="bg-muted/40 h-8 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            value={firstLine?.qty ?? ""}
                            readOnly
                            className="bg-muted/40 h-8 text-xs text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            max={firstLine?.qty ?? 9999}
                            value={qtyReceived}
                            onChange={(e) => setQtyReceived(Number(e.target.value))}
                            className="h-8 text-xs text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            placeholder="Vendor batch ref"
                            value={vendorBatchRef}
                            onChange={(e) => setVendorBatchRef(e.target.value)}
                            className="h-8 text-xs"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            {!saved && (
              <Button onClick={handleSave} disabled={!selectedPOId}>
                Save Entry
              </Button>
            )}
            {saved && (
              <Button
                onClick={() => {
                  setOpen(false);
                  resetForm();
                }}
              >
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
