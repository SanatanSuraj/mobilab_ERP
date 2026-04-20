"use client";

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
import { Textarea } from "@/components/ui/textarea";
import {
  indents as initialIndents,
  vendors,
  Indent,
  IndentStatus,
  IndentUrgency,
  IndentSource,
  formatDate,
} from "@/data/procurement-mock";
import {
  ClipboardList,
  Clock,
  CheckCircle2,
  ShoppingCart,
  PackageCheck,
  Plus,
} from "lucide-react";

export default function IndentsPage() {
  const [indentList, setIndentList] = useState<Indent[]>(initialIndents);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPOOpen, setCreatePOOpen] = useState(false);
  const [selectedIndent, setSelectedIndent] = useState<Indent | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");

  // Create Indent form state
  const [formItemName, setFormItemName] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formUom, setFormUom] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formUrgency, setFormUrgency] = useState<IndentUrgency>("NORMAL");
  const [formWarehouse, setFormWarehouse] = useState("wh1");
  const [formSource, setFormSource] = useState<IndentSource>("MANUAL");
  const [formWorkOrderId, setFormWorkOrderId] = useState("");

  // Create PO form state
  const [poVendorId, setPOVendorId] = useState("");
  const [poUnitPrice, setPOUnitPrice] = useState("");
  const [poDeliveryDate, setPODeliveryDate] = useState("");
  const [poNotes, setPONotes] = useState("");

  // KPIs
  const total = indentList.length;
  const draftSubmitted = indentList.filter(
    (i) => i.status === "DRAFT" || i.status === "SUBMITTED"
  ).length;
  const approved = indentList.filter((i) => i.status === "APPROVED").length;
  const poRaised = indentList.filter((i) => i.status === "PO_RAISED").length;
  const fulfilled = indentList.filter((i) => i.status === "FULFILLED").length;

  // Active vendors only
  const activeVendors = vendors.filter((v) => v.status === "ACTIVE");

  // Filtered data
  const filtered = indentList.filter((i) => {
    if (statusFilter !== "ALL" && i.status !== statusFilter) return false;
    if (urgencyFilter !== "ALL" && i.urgency !== urgencyFilter) return false;
    if (sourceFilter !== "ALL" && i.source !== sourceFilter) return false;
    return true;
  });

  function handleCreateIndent() {
    const newIndent: Indent = {
      id: `ind-new-${Date.now()}`,
      indentNumber: `MLB-IND-2026-${String(indentList.length + 1).padStart(3, "0")}`,
      itemId: `itm-new-${Date.now()}`,
      itemCode: `MLB-ITM-NEW`,
      itemName: formItemName,
      qtyRequired: Number(formQty),
      uom: formUom,
      requiredByDate: formDate,
      reason: formReason,
      urgency: formUrgency,
      source: formSource,
      status: "DRAFT",
      workOrderId: formWorkOrderId || undefined,
      warehouseId: formWarehouse,
      warehouseName: formWarehouse === "wh1" ? "Guwahati HQ" : "Noida Secondary",
      requestedBy: "Current User",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setIndentList([newIndent, ...indentList]);
    setCreateOpen(false);
    setFormItemName("");
    setFormQty("");
    setFormUom("");
    setFormDate("");
    setFormReason("");
    setFormUrgency("NORMAL");
    setFormWarehouse("wh1");
    setFormSource("MANUAL");
    setFormWorkOrderId("");
  }

  function handleCreatePO() {
    if (!selectedIndent) return;
    const poNum = `MLB-PO-2026-${String(Math.floor(Math.random() * 900) + 100)}`;
    setIndentList(
      indentList.map((i) =>
        i.id === selectedIndent.id
          ? { ...i, status: "PO_RAISED" as IndentStatus, poNumber: poNum }
          : i
      )
    );
    setCreatePOOpen(false);
    setSelectedIndent(null);
    setPOVendorId("");
    setPOUnitPrice("");
    setPODeliveryDate("");
    setPONotes("");
  }

  function openCreatePO(indent: Indent) {
    setSelectedIndent(indent);
    setCreatePOOpen(true);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function isOverdue(dateStr: string) {
    return new Date(dateStr) < today;
  }

  const columns: Column<Indent>[] = [
    {
      key: "indentNumber",
      header: "Indent #",
      render: (i) => (
        <span className="font-mono font-bold text-sm">{i.indentNumber}</span>
      ),
    },
    {
      key: "itemCode",
      header: "Item",
      render: (i) => (
        <div>
          <p className="text-xs font-mono text-muted-foreground">{i.itemCode}</p>
          <p className="font-semibold text-sm">{i.itemName}</p>
        </div>
      ),
    },
    {
      key: "qtyRequired",
      header: "Qty",
      render: (i) => (
        <span className="text-sm">
          {i.qtyRequired} {i.uom}
        </span>
      ),
    },
    {
      key: "requiredByDate",
      header: "Required By",
      render: (i) => (
        <span
          className={
            isOverdue(i.requiredByDate) &&
            i.status !== "FULFILLED" &&
            i.status !== "CANCELLED"
              ? "text-red-600 font-medium text-sm"
              : "text-sm"
          }
        >
          {formatDate(i.requiredByDate)}
        </span>
      ),
    },
    {
      key: "urgency",
      header: "Urgency",
      render: (i) =>
        i.urgency === "URGENT" ? (
          <Badge className="bg-red-100 text-red-700 border-red-200 text-xs font-semibold">
            URGENT
          </Badge>
        ) : (
          <Badge variant="outline" className="text-gray-500 text-xs">
            NORMAL
          </Badge>
        ),
    },
    {
      key: "source",
      header: "Source",
      render: (i) => {
        if (i.source === "MRP_AUTO")
          return (
            <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 text-xs">
              MRP Auto
            </Badge>
          );
        if (i.source === "REORDER_AUTO")
          return (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
              Reorder Auto
            </Badge>
          );
        return (
          <Badge variant="outline" className="text-gray-500 text-xs">
            Manual
          </Badge>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (i) => <StatusBadge status={i.status} />,
    },
    {
      key: "warehouseName",
      header: "Warehouse",
      render: (i) => <span className="text-sm">{i.warehouseName}</span>,
    },
    {
      key: "requestedBy",
      header: "Requested By",
      render: (i) => <span className="text-sm">{i.requestedBy}</span>,
    },
    {
      key: "poNumber",
      header: "PO #",
      render: (i) =>
        i.poNumber ? (
          <span className="font-mono text-xs text-muted-foreground">
            {i.poNumber}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "workOrderId",
      header: "Work Order",
      render: (i) =>
        i.workOrderId ? (
          <span className="font-mono text-xs text-indigo-600 font-medium">
            {i.workOrderId}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "id",
      header: "Actions",
      render: (i) =>
        i.status === "APPROVED" ? (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7"
            onClick={(e) => {
              e.stopPropagation();
              openCreatePO(i);
            }}
          >
            Create PO
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Indents"
        description="Material requisitions — manual, MRP auto, and reorder auto"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Indent
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard
          title="Total Indents"
          value={String(total)}
          icon={ClipboardList}
          iconColor="text-primary"
        />
        <KPICard
          title="Draft / Submitted"
          value={String(draftSubmitted)}
          icon={Clock}
          iconColor="text-amber-500"
        />
        <KPICard
          title="Approved"
          value={String(approved)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="PO Raised"
          value={String(poRaised)}
          icon={ShoppingCart}
          iconColor="text-indigo-600"
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
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="SUBMITTED">Submitted</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="PO_RAISED">PO Raised</SelectItem>
                  <SelectItem value="PARTIALLY_RECEIVED">
                    Partially Received
                  </SelectItem>
                  <SelectItem value="FULFILLED">Fulfilled</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Urgency</Label>
              <Select
                value={urgencyFilter}
                onValueChange={(v) => setUrgencyFilter(v ?? "ALL")}
              >
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source</Label>
              <Select
                value={sourceFilter}
                onValueChange={(v) => setSourceFilter(v ?? "ALL")}
              >
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Sources</SelectItem>
                  <SelectItem value="MANUAL">Manual</SelectItem>
                  <SelectItem value="MRP_AUTO">MRP Auto</SelectItem>
                  <SelectItem value="REORDER_AUTO">Reorder Auto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(statusFilter !== "ALL" ||
              urgencyFilter !== "ALL" ||
              sourceFilter !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setStatusFilter("ALL");
                  setUrgencyFilter("ALL");
                  setSourceFilter("ALL");
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
        searchKey="itemName"
        searchPlaceholder="Search by item name..."
        pageSize={10}
      />

      {/* Create Indent Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Indent</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Item Name</Label>
              <Input
                value={formItemName}
                onChange={(e) => setFormItemName(e.target.value)}
                placeholder="e.g. CBC Reagent Kit"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Qty Required</Label>
                <Input
                  type="number"
                  value={formQty}
                  onChange={(e) => setFormQty(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit of Measure</Label>
                <Input
                  value={formUom}
                  onChange={(e) => setFormUom(e.target.value)}
                  placeholder="PCS / KIT / BTL"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Required By Date</Label>
              <Input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                placeholder="Reason for requisition..."
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Urgency</Label>
                <Select
                  value={formUrgency}
                  onValueChange={(v) =>
                    setFormUrgency((v ?? "NORMAL") as IndentUrgency)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Select
                  value={formSource}
                  onValueChange={(v) =>
                    setFormSource((v ?? "MANUAL") as IndentSource)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL">Manual</SelectItem>
                    <SelectItem value="MRP_AUTO">MRP Auto</SelectItem>
                    <SelectItem value="REORDER_AUTO">Reorder Auto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Warehouse</Label>
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
              <Label>Work Order ID (optional)</Label>
              <Input
                value={formWorkOrderId}
                onChange={(e) => setFormWorkOrderId(e.target.value)}
                placeholder="e.g. WO-2026-005"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateIndent}
              disabled={!formItemName || !formQty || !formUom || !formDate}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create PO from Indent Dialog */}
      <Dialog open={createPOOpen} onOpenChange={setCreatePOOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create PO from Indent</DialogTitle>
          </DialogHeader>
          {selectedIndent && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Item:</span>{" "}
                  <span className="font-medium">{selectedIndent.itemName}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Qty:</span>{" "}
                  <span className="font-medium">
                    {selectedIndent.qtyRequired} {selectedIndent.uom}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Warehouse:</span>{" "}
                  <span className="font-medium">
                    {selectedIndent.warehouseName}
                  </span>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Vendor</Label>
                <Select
                  value={poVendorId}
                  onValueChange={(v) => setPOVendorId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select active vendor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeVendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.tradeName} ({v.category})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Unit Price (₹)</Label>
                <Input
                  type="number"
                  value={poUnitPrice}
                  onChange={(e) => setPOUnitPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Required Delivery Date</Label>
                <Input
                  type="date"
                  value={poDeliveryDate}
                  onChange={(e) => setPODeliveryDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  value={poNotes}
                  onChange={(e) => setPONotes(e.target.value)}
                  placeholder="Any special instructions..."
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatePOOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreatePO}
              disabled={!poVendorId || !poUnitPrice || !poDeliveryDate}
            >
              Save &amp; Raise PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
