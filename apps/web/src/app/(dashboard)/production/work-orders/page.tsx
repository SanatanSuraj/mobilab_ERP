"use client";

/**
 * Work Orders — reads /production/work-orders via useApiWorkOrders.
 *
 * Contract deltas vs the older manufacturing-mock prototype:
 *   - Status vocabulary: PLANNED / MATERIAL_CHECK / IN_PROGRESS / QC_HOLD /
 *     REWORK / COMPLETED / CANCELLED (matches DB CHECK constraint).
 *   - quantity is a decimal string ("5.000"). Priority is LOW/NORMAL/HIGH/
 *     CRITICAL.
 *   - Every WO is anchored to a product (productId) + BOM (bomId) — we
 *     resolve product details via useApiProducts for display.
 *   - PIDs are server-generated as PID-YYYY-NNNN when the `pid` field is
 *     omitted; the list dialog always omits it.
 *   - Device serials, lot number, deviceSerials[], currentStageIndex,
 *     reworkCount — all server-maintained. MRP lines, component
 *     assignments, stage notes were prototype-only and live in Phase 3.
 *
 * Clicking a row routes to /production/work-orders/:id (detail page with
 * WIP stage tracker + stage-advance actions).
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
  useApiCreateWorkOrder,
  useApiProducts,
  useApiWorkOrders,
} from "@/hooks/useProductionApi";
import {
  WO_PRIORITIES,
  WO_STATUSES,
  type WoPriority,
  type WoStatus,
  type WorkOrder,
} from "@instigenie/contracts";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Loader2,
  Plus,
} from "lucide-react";

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

const WO_STATUS_TONE: Record<WoStatus, string> = {
  PLANNED: "bg-gray-50 text-gray-700 border-gray-200",
  MATERIAL_CHECK: "bg-amber-50 text-amber-700 border-amber-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  QC_HOLD: "bg-orange-50 text-orange-700 border-orange-200",
  REWORK: "bg-red-50 text-red-700 border-red-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-slate-50 text-slate-700 border-slate-200",
};

const WO_PRIORITY_TONE: Record<WoPriority, string> = {
  LOW: "bg-slate-50 text-slate-600 border-slate-200",
  NORMAL: "bg-gray-50 text-gray-700 border-gray-200",
  HIGH: "bg-amber-50 text-amber-700 border-amber-200",
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
};

function isOverdue(wo: WorkOrder): boolean {
  if (!wo.targetDate) return false;
  if (wo.status === "COMPLETED" || wo.status === "CANCELLED") return false;
  const target = new Date(wo.targetDate).getTime();
  if (Number.isNaN(target)) return false;
  return target < Date.now();
}

export default function WorkOrdersPage() {
  const router = useRouter();

  // ─── Filters ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<WoStatus | "all">("all");
  const [priority, setPriority] = useState<WoPriority | "all">("all");
  const [productFilter, setProductFilter] = useState<string>("all");

  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      status: status === "all" ? undefined : status,
      priority: priority === "all" ? undefined : priority,
      productId: productFilter === "all" ? undefined : productFilter,
    }),
    [search, status, priority, productFilter]
  );

  const wosQuery = useApiWorkOrders(query);
  const productsQuery = useApiProducts({ limit: 200, isActive: true });
  const createWo = useApiCreateWorkOrder();

  // ─── Create dialog state ────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formProductId, setFormProductId] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formPriority, setFormPriority] = useState<WoPriority>("NORMAL");
  const [formTargetDate, setFormTargetDate] = useState("");
  const [formLotNumber, setFormLotNumber] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const products = productsQuery.data?.data ?? [];
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === formProductId),
    [products, formProductId]
  );

  // Loading / error shells
  if (wosQuery.isLoading) {
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

  if (wosQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load work orders
            </p>
            <p className="text-red-700 mt-1">
              {wosQuery.error instanceof Error
                ? wosQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const wos = wosQuery.data?.data ?? [];
  const total = wosQuery.data?.meta.total ?? wos.length;

  // KPIs — scoped to the current page window. Global totals would need
  // dedicated aggregate endpoints.
  const inProgress = wos.filter((w) => w.status === "IN_PROGRESS").length;
  const qcHoldRework = wos.filter(
    (w) => w.status === "QC_HOLD" || w.status === "REWORK"
  ).length;
  const completed = wos.filter((w) => w.status === "COMPLETED").length;
  const overdue = wos.filter(isOverdue).length;

  const columns: Column<WorkOrder>[] = [
    {
      key: "pid",
      header: "PID",
      render: (w) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {w.pid}
        </span>
      ),
    },
    {
      key: "productId",
      header: "Product",
      render: (w) => {
        const product = products.find((p) => p.id === w.productId);
        return (
          <div className="space-y-0.5">
            <div className="text-sm font-medium">
              {product?.name ?? (
                <span className="font-mono text-xs text-muted-foreground">
                  {w.productId.slice(0, 8)}…
                </span>
              )}
            </div>
            {product && (
              <Badge
                variant="outline"
                className="text-[10px] text-muted-foreground"
              >
                {product.family.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "bomVersionLabel",
      header: "BOM",
      render: (w) => (
        <Badge
          variant="outline"
          className="font-mono text-xs text-muted-foreground"
        >
          {w.bomVersionLabel}
        </Badge>
      ),
    },
    {
      key: "quantity",
      header: "Qty",
      className: "text-right",
      render: (w) => <span className="tabular-nums text-sm">{w.quantity}</span>,
    },
    {
      key: "priority",
      header: "Priority",
      render: (w) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${WO_PRIORITY_TONE[w.priority]}`}
        >
          {w.priority}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (w) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${WO_STATUS_TONE[w.status]}`}
        >
          {w.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "targetDate",
      header: "Target",
      render: (w) => (
        <span
          className={`text-xs ${
            isOverdue(w)
              ? "text-red-600 font-semibold"
              : "text-muted-foreground"
          }`}
        >
          {formatDate(w.targetDate)}
        </span>
      ),
    },
    {
      key: "reworkCount",
      header: "Rework",
      render: (w) =>
        w.reworkCount > 0 ? (
          <Badge
            variant="outline"
            className="bg-orange-50 text-orange-700 border-orange-200 text-xs"
          >
            ↺ {w.reworkCount}
          </Badge>
        ) : null,
    },
    {
      key: "currentStageIndex",
      header: "Stage",
      render: (w) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          #{w.currentStageIndex + 1}
        </span>
      ),
    },
  ];

  async function handleSave(): Promise<void> {
    setSaveError(null);
    if (!formProductId) {
      setSaveError("Pick a product.");
      return;
    }
    if (!formQty.trim() || !/^\d+(\.\d{1,3})?$/.test(formQty.trim())) {
      setSaveError("Quantity must be a non-negative decimal (e.g. 5 or 5.000).");
      return;
    }
    try {
      const created = await createWo.mutateAsync({
        productId: formProductId,
        quantity: formQty.trim(),
        priority: formPriority,
        targetDate: formTargetDate || undefined,
        lotNumber: formLotNumber.trim() || undefined,
        notes: formNotes.trim() || undefined,
      });
      setDialogOpen(false);
      setFormProductId("");
      setFormQty("");
      setFormPriority("NORMAL");
      setFormTargetDate("");
      setFormLotNumber("");
      setFormNotes("");
      router.push(`/production/work-orders/${created.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Work Orders (PID)"
        description="Production orders — PID-YYYY-NNNN auto-generated. Headers defer BOM, stages, and serials to the service."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KPICard
          title="Total"
          value={String(total)}
          icon={ClipboardList}
          iconColor="text-primary"
        />
        <KPICard
          title="In Progress"
          value={String(inProgress)}
          icon={Loader2}
          iconColor="text-blue-600"
        />
        <KPICard
          title="QC Hold / Rework"
          value={String(qcHoldRework)}
          icon={AlertTriangle}
          iconColor="text-orange-600"
        />
        <KPICard
          title="Completed"
          value={String(completed)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Overdue"
          value={String(overdue)}
          icon={Clock}
          iconColor="text-red-600"
        />
      </div>

      <DataTable<WorkOrder>
        data={wos}
        columns={columns}
        searchKey="pid"
        searchPlaceholder="Search by PID..."
        onRowClick={(w) => router.push(`/production/work-orders/${w.id}`)}
        pageSize={10}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search PID / notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <Select
              value={status}
              onValueChange={(v) =>
                setStatus((v ?? "all") as WoStatus | "all")
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {WO_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={priority}
              onValueChange={(v) =>
                setPriority((v ?? "all") as WoPriority | "all")
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                {WO_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={productFilter}
              onValueChange={(v) => setProductFilter(v ?? "all")}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Product" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.productCode} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New WO
            </Button>
          </div>
        }
      />

      {wos.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center flex flex-col items-center gap-2">
          <FileText className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No work orders match the current filter.
          </p>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Work Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {saveError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Product</Label>
              <Select
                value={formProductId}
                onValueChange={(v) => setFormProductId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select product..." />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.productCode} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProduct && !selectedProduct.activeBomId && (
                <p className="text-xs text-amber-700">
                  Warning: this product has no active BOM. The server will
                  reject the WO unless a BOM is activated first.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 5"
                  value={formQty}
                  onChange={(e) => setFormQty(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select
                  value={formPriority}
                  onValueChange={(v) =>
                    setFormPriority((v ?? "NORMAL") as WoPriority)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Normal" />
                  </SelectTrigger>
                  <SelectContent>
                    {WO_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Target Date</Label>
                <Input
                  type="date"
                  value={formTargetDate}
                  onChange={(e) => setFormTargetDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lot Number</Label>
                <Input
                  placeholder="Optional"
                  value={formLotNumber}
                  onChange={(e) => setFormLotNumber(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Optional WO notes..."
              />
            </div>
            <p className="text-xs text-muted-foreground">
              PID, BOM, and WIP stages are server-generated. Device serials
              are auto-assigned for serialized products.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createWo.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createWo.isPending || !formProductId || !formQty}
            >
              {createWo.isPending ? "Saving…" : "Create Work Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
