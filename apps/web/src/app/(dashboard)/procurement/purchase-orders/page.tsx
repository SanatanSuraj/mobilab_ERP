"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Textarea } from "@/components/ui/textarea";
import {
  purchaseOrders as initialPOs,
  vendors,
  PurchaseOrder,
  POStatus,
  formatCurrency,
  formatDate,
} from "@/data/procurement-mock";
import {
  ShoppingBag,
  Clock,
  CheckCircle2,
  PackageOpen,
  PackageCheck,
  Plus,
  Eye,
} from "lucide-react";

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [poList, setPOList] = useState<PurchaseOrder[]>(initialPOs);
  const [newPOOpen, setNewPOOpen] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [vendorFilter, setVendorFilter] = useState("ALL");

  // New PO form state
  const [formVendorId, setFormVendorId] = useState("");
  const [formWarehouse, setFormWarehouse] = useState("wh1");
  const [formDeliveryDate, setFormDeliveryDate] = useState("");
  const [formCostCentre, setFormCostCentre] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const activeVendors = vendors.filter((v) => v.status === "ACTIVE");

  // KPIs
  const total = poList.length;
  const draftPending = poList.filter(
    (p) =>
      p.status === "DRAFT" ||
      p.status === "PENDING_FINANCE" ||
      p.status === "PENDING_MGMT"
  ).length;
  const approvedSent = poList.filter(
    (p) => p.status === "APPROVED" || p.status === "PO_SENT"
  ).length;
  const partiallyReceived = poList.filter(
    (p) => p.status === "PARTIALLY_RECEIVED"
  ).length;
  const fulfilled = poList.filter((p) => p.status === "FULFILLED").length;

  // Filtered
  const filtered = poList.filter((p) => {
    if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
    if (vendorFilter !== "ALL" && p.vendorId !== vendorFilter) return false;
    return true;
  });

  function handleCreateDraft() {
    const vendor = vendors.find((v) => v.id === formVendorId);
    if (!vendor) return;
    const newPO: PurchaseOrder = {
      id: `po-new-${Date.now()}`,
      poNumber: `MLB-PO-2026-${String(Math.floor(Math.random() * 900) + 100)}`,
      vendorId: formVendorId,
      vendorName: vendor.tradeName,
      vendorGstin: vendor.gstin,
      warehouseId: formWarehouse,
      warehouseName: formWarehouse === "wh1" ? "Guwahati HQ" : "Noida Secondary",
      requiredDeliveryDate: formDeliveryDate,
      status: "DRAFT" as POStatus,
      lines: [],
      subtotal: 0,
      gstAmount: 0,
      totalValue: 0,
      approvalLogs: [],
      proformaUploaded: false,
      createdBy: "Current User",
      createdAt: new Date().toISOString().split("T")[0],
      costCentre: formCostCentre,
      notes: formNotes || undefined,
    };
    setPOList([newPO, ...poList]);
    setNewPOOpen(false);
    setFormVendorId("");
    setFormWarehouse("wh1");
    setFormDeliveryDate("");
    setFormCostCentre("");
    setFormNotes("");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function isDeliveryOverdue(po: PurchaseOrder) {
    return (
      (po.status === "APPROVED" || po.status === "PO_SENT") &&
      new Date(po.requiredDeliveryDate) < today
    );
  }

  const columns: Column<PurchaseOrder>[] = [
    {
      key: "poNumber",
      header: "PO #",
      sortable: true,
      render: (po) => (
        <span className="font-mono font-bold text-sm">{po.poNumber}</span>
      ),
    },
    {
      key: "vendorName",
      header: "Vendor",
      render: (po) => (
        <div>
          <p className="font-semibold text-sm">{po.vendorName}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {po.vendorGstin}
          </p>
        </div>
      ),
    },
    {
      key: "warehouseName",
      header: "Warehouse",
      render: (po) => <span className="text-sm">{po.warehouseName}</span>,
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (po) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(po.createdAt)}
        </span>
      ),
    },
    {
      key: "requiredDeliveryDate",
      header: "Required Delivery",
      render: (po) => (
        <span
          className={
            isDeliveryOverdue(po)
              ? "text-red-600 font-medium text-sm"
              : "text-sm"
          }
        >
          {formatDate(po.requiredDeliveryDate)}
        </span>
      ),
    },
    {
      key: "lines",
      header: "Lines",
      render: (po) => (
        <span className="text-sm text-muted-foreground">
          {po.lines.length} item{po.lines.length !== 1 ? "s" : ""}
        </span>
      ),
    },
    {
      key: "totalValue",
      header: "Value",
      render: (po) => (
        <div className="text-right space-y-0.5">
          <p className="text-xs text-muted-foreground">
            {formatCurrency(po.subtotal)} + GST {formatCurrency(po.gstAmount)}
          </p>
          <p className="font-bold text-sm">{formatCurrency(po.totalValue)}</p>
        </div>
      ),
    },
    {
      key: "proformaUploaded",
      header: "Proforma",
      render: (po) =>
        po.proformaUploaded ? (
          <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
            PI Received
          </Badge>
        ) : (
          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
            Awaiting PI
          </Badge>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (po) => <StatusBadge status={po.status} />,
    },
    {
      key: "createdBy",
      header: "Created By",
      render: (po) => <span className="text-sm">{po.createdBy}</span>,
    },
    {
      key: "id",
      header: "Actions",
      render: (po) => (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/procurement/purchase-orders/${po.id}`);
          }}
        >
          <Eye className="h-3.5 w-3.5 mr-1" />
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Purchase Orders"
        description="Full PO lifecycle from draft to fulfilment"
        actions={
          <Button onClick={() => setNewPOOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New PO
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard
          title="Total POs"
          value={String(total)}
          icon={ShoppingBag}
          iconColor="text-primary"
        />
        <KPICard
          title="Draft / Pending"
          value={String(draftPending)}
          icon={Clock}
          iconColor="text-amber-500"
        />
        <KPICard
          title="Approved / Sent"
          value={String(approvedSent)}
          icon={CheckCircle2}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Partially Received"
          value={String(partiallyReceived)}
          icon={PackageOpen}
          iconColor="text-cyan-600"
        />
        <KPICard
          title="Fulfilled"
          value={String(fulfilled)}
          icon={PackageCheck}
          iconColor="text-green-700"
        />
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v ?? "ALL")}
              >
                <SelectTrigger className="w-48 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="PENDING_FINANCE">
                    Pending Finance
                  </SelectItem>
                  <SelectItem value="PENDING_MGMT">Pending Mgmt</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="PO_SENT">PO Sent</SelectItem>
                  <SelectItem value="PARTIALLY_RECEIVED">
                    Partially Received
                  </SelectItem>
                  <SelectItem value="FULFILLED">Fulfilled</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="AMENDED">Amended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Vendor</Label>
              <Select
                value={vendorFilter}
                onValueChange={(v) => setVendorFilter(v ?? "ALL")}
              >
                <SelectTrigger className="w-52 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Vendors</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.tradeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(statusFilter !== "ALL" || vendorFilter !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setStatusFilter("ALL");
                  setVendorFilter("ALL");
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <DataTable
        data={filtered}
        columns={columns}
        searchKey="poNumber"
        searchPlaceholder="Search by PO number..."
        pageSize={10}
        onRowClick={(po) =>
          router.push(`/procurement/purchase-orders/${po.id}`)
        }
      />

      {/* New PO Dialog */}
      <Dialog open={newPOOpen} onOpenChange={setNewPOOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Select
                value={formVendorId}
                onValueChange={(v) => setFormVendorId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select active vendor..." />
                </SelectTrigger>
                <SelectContent>
                  {activeVendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.tradeName} — {v.category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Delivery Warehouse</Label>
              <Select
                value={formWarehouse}
                onValueChange={(v) => setFormWarehouse(v ?? "wh1")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wh1">Guwahati HQ</SelectItem>
                  <SelectItem value="wh2">Noida Secondary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Required Delivery Date</Label>
              <Input
                type="date"
                value={formDeliveryDate}
                onChange={(e) => setFormDeliveryDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cost Centre</Label>
              <Input
                value={formCostCentre}
                onChange={(e) => setFormCostCentre(e.target.value)}
                placeholder="e.g. PROD-GUW, STORES-NOI"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Any additional notes..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPOOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateDraft}
              disabled={
                !formVendorId || !formDeliveryDate || !formCostCentre
              }
            >
              Create as Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
