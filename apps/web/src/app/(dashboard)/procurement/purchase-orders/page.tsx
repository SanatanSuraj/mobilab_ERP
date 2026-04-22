"use client";

/**
 * Purchase Orders — reads /procurement/purchase-orders via
 * useApiPurchaseOrders.
 *
 * Contract deltas vs the older mock (PurchaseOrder in procurement-mock.ts):
 *   - Status vocabulary is DRAFT / PENDING_APPROVAL / APPROVED / SENT /
 *     PARTIALLY_RECEIVED / RECEIVED / CANCELLED. Mock's PENDING_FINANCE /
 *     PENDING_MGMT double-approval model collapses to a single
 *     PENDING_APPROVAL step; workflow stages are a Phase 3 concern.
 *   - Header totals are decimal strings (subtotal, taxTotal, discountTotal,
 *     grandTotal), maintained server-side from the sum of po_lines.
 *   - "Cost centre", "proforma uploaded", "approval logs" — not in Phase 2.
 *   - PO creation requires `vendorId` + at least a list of items (via
 *     `lines[]`). The list page only creates an EMPTY DRAFT; line entry
 *     happens on the PO detail page.
 *
 * Clicking a row routes to /procurement/purchase-orders/:id (detail page).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiCreatePurchaseOrder,
  useApiPurchaseOrders,
  useApiVendors,
} from "@/hooks/useProcurementApi";
import { useApiWarehouses } from "@/hooks/useInventoryApi";
import {
  PO_STATUSES,
  type PoStatus,
  type PurchaseOrder,
} from "@instigenie/contracts";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  PackageCheck,
  PackageOpen,
  Plus,
  ShoppingBag,
} from "lucide-react";

function formatMoney(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw ?? "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const STATUS_TONE: Record<PoStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  SENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PARTIALLY_RECEIVED: "bg-purple-50 text-purple-700 border-purple-200",
  RECEIVED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default function PurchaseOrdersPage() {
  const router = useRouter();

  // ─── Filters ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PoStatus | "all">("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");

  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      status: status === "all" ? undefined : status,
      vendorId: vendorFilter === "all" ? undefined : vendorFilter,
    }),
    [search, status, vendorFilter]
  );

  const posQuery = useApiPurchaseOrders(query);
  const vendorsQuery = useApiVendors({ limit: 200, isActive: true });
  const warehousesQuery = useApiWarehouses({ limit: 100, isActive: true });
  const createPo = useApiCreatePurchaseOrder();

  // ─── Create dialog state ────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formVendorId, setFormVendorId] = useState("");
  const [formWarehouseId, setFormWarehouseId] = useState("");
  const [formExpectedDate, setFormExpectedDate] = useState("");
  const [formPaymentTermsDays, setFormPaymentTermsDays] = useState("30");
  const [formNotes, setFormNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const vendors = vendorsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];

  // Loading / error shells
  if (posQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (posQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load purchase orders
            </p>
            <p className="text-red-700 mt-1">
              {posQuery.error instanceof Error
                ? posQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const pos = posQuery.data?.data ?? [];
  const total = posQuery.data?.meta.total ?? pos.length;

  // KPIs — scoped to the current page window. Global totals would need
  // dedicated aggregate endpoints.
  const draftPending = pos.filter(
    (p) => p.status === "DRAFT" || p.status === "PENDING_APPROVAL"
  ).length;
  const approvedOrSent = pos.filter(
    (p) => p.status === "APPROVED" || p.status === "SENT"
  ).length;
  const partiallyReceived = pos.filter(
    (p) => p.status === "PARTIALLY_RECEIVED"
  ).length;
  const received = pos.filter((p) => p.status === "RECEIVED").length;

  const columns: Column<PurchaseOrder>[] = [
    {
      key: "poNumber",
      header: "PO #",
      render: (p) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {p.poNumber}
        </span>
      ),
    },
    {
      key: "vendorId",
      header: "Vendor",
      render: (p) => {
        const vendor = vendors.find((v) => v.id === p.vendorId);
        return (
          <span className="text-sm">
            {vendor?.name ?? (
              <span className="font-mono text-xs text-muted-foreground">
                {p.vendorId.slice(0, 8)}…
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "orderDate",
      header: "Order Date",
      render: (p) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(p.orderDate)}
        </span>
      ),
    },
    {
      key: "expectedDate",
      header: "Expected",
      render: (p) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(p.expectedDate)}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Value",
      className: "text-right",
      render: (p) => (
        <span className="text-sm font-medium text-right block">
          {formatMoney(p.grandTotal)}
        </span>
      ),
    },
    {
      key: "currency",
      header: "Currency",
      render: (p) => (
        <span className="text-xs text-muted-foreground">{p.currency}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[p.status]}`}
        >
          {p.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
  ];

  async function handleSave(): Promise<void> {
    setSaveError(null);
    if (!formVendorId) {
      setSaveError("Pick a vendor.");
      return;
    }
    const termsDays = Number.parseInt(formPaymentTermsDays, 10);
    if (!Number.isFinite(termsDays) || termsDays < 0) {
      setSaveError("Payment terms must be a non-negative number of days.");
      return;
    }
    try {
      const created = await createPo.mutateAsync({
        vendorId: formVendorId,
        deliveryWarehouseId: formWarehouseId || undefined,
        expectedDate: formExpectedDate || undefined,
        paymentTermsDays: termsDays,
        notes: formNotes.trim() || undefined,
        // Zod defaults these server-side; z.infer<> output still wants them.
        currency: "INR",
        lines: [],
      });
      setDialogOpen(false);
      setFormVendorId("");
      setFormWarehouseId("");
      setFormExpectedDate("");
      setFormPaymentTermsDays("30");
      setFormNotes("");
      router.push(`/procurement/purchase-orders/${created.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Purchase Orders"
        description="Purchase orders — one header, many item lines. Totals are server-computed."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
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
          value={String(approvedOrSent)}
          icon={CheckCircle2}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Partially Received"
          value={String(partiallyReceived)}
          icon={PackageOpen}
          iconColor="text-purple-600"
        />
        <KPICard
          title="Received"
          value={String(received)}
          icon={PackageCheck}
          iconColor="text-green-600"
        />
      </div>

      <DataTable<PurchaseOrder>
        data={pos}
        columns={columns}
        searchKey="poNumber"
        searchPlaceholder="Search PO number..."
        onRowClick={(p) => router.push(`/procurement/purchase-orders/${p.id}`)}
        pageSize={10}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search PO / notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <Select
              value={status}
              onValueChange={(v) => setStatus((v ?? "all") as PoStatus | "all")}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {PO_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={vendorFilter}
              onValueChange={(v) => setVendorFilter(v ?? "all")}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vendors</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.code} — {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New PO
            </Button>
          </div>
        }
      />

      {pos.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center flex flex-col items-center gap-2">
          <FileText className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No purchase orders match the current filter.
          </p>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {saveError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Select
                value={formVendorId}
                onValueChange={(v) => setFormVendorId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor..." />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.code} — {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Delivery Warehouse</Label>
              <Select
                value={formWarehouseId}
                onValueChange={(v) => setFormWarehouseId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional — select warehouse..." />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Expected Date</Label>
                <Input
                  type="date"
                  value={formExpectedDate}
                  onChange={(e) => setFormExpectedDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Terms (days)</Label>
                <Input
                  type="number"
                  value={formPaymentTermsDays}
                  onChange={(e) => setFormPaymentTermsDays(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Optional PO notes..."
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Add line items from the PO detail page after creating the
              header.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createPo.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createPo.isPending || !formVendorId}
            >
              {createPo.isPending ? "Saving…" : "Create Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
