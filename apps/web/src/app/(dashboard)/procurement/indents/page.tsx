"use client";

/**
 * Indents — reads /procurement/indents via useApiIndents.
 *
 * Contract deltas vs the older mock (Indent in src/data/procurement-mock.ts):
 *   - Header + lines: one indent can request many items. The mock modeled
 *     one-item-per-indent; we now list header-level records and show the
 *     line count inline. Full line editing is done from a detail page
 *     (Phase 3).
 *   - Statuses are DRAFT / SUBMITTED / APPROVED / REJECTED / CONVERTED
 *     (replaces mock's PO_RAISED / PARTIALLY_RECEIVED / FULFILLED /
 *     CANCELLED). The mock's downstream states are tracked on the PO +
 *     GRN side now — cleaner separation of concerns.
 *   - `priority` (LOW / NORMAL / HIGH / URGENT) replaces `urgency`.
 *   - `source` (MANUAL / MRP_AUTO / REORDER_AUTO) isn't in Phase 2 schema.
 *     All indents are effectively "manual"; MRP auto-creation is a Phase 3
 *     job that will stamp a `source` column.
 *   - "Create PO from Indent" inline flow dropped — use the dedicated PO
 *     page, which can link back to an indentId via UpdatePurchaseOrder.
 *
 * Create dialog posts header + 1 line via useApiCreateIndent.
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
  useApiCreateIndent,
  useApiIndents,
} from "@/hooks/useProcurementApi";
import { useApiItems } from "@/hooks/useInventoryApi";
import {
  INDENT_PRIORITIES,
  INDENT_STATUSES,
  type IndentPriority,
  type IndentStatus,
  type Indent,
} from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowRightCircle,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Plus,
  XCircle,
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

const STATUS_TONE: Record<IndentStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  SUBMITTED: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-green-50 text-green-700 border-green-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  CONVERTED: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

const PRIORITY_TONE: Record<IndentPriority, string> = {
  LOW: "bg-gray-50 text-gray-600 border-gray-200",
  NORMAL: "bg-blue-50 text-blue-600 border-blue-200",
  HIGH: "bg-amber-50 text-amber-700 border-amber-200",
  URGENT: "bg-red-50 text-red-700 border-red-200",
};

export default function IndentsPage() {
  const router = useRouter();

  // ─── Filters ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<IndentStatus | "all">("all");
  const [priority, setPriority] = useState<IndentPriority | "all">("all");

  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      status: status === "all" ? undefined : status,
      priority: priority === "all" ? undefined : priority,
    }),
    [search, status, priority]
  );

  const indentsQuery = useApiIndents(query);
  const createIndent = useApiCreateIndent();
  const itemsQuery = useApiItems({ limit: 200, isActive: true });

  // ─── Create dialog state ────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formDepartment, setFormDepartment] = useState("");
  const [formPurpose, setFormPurpose] = useState("");
  const [formPriority, setFormPriority] = useState<IndentPriority>("NORMAL");
  const [formRequiredBy, setFormRequiredBy] = useState("");
  const [formItemId, setFormItemId] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formUom, setFormUom] = useState("");
  const [formEstCost, setFormEstCost] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const items = itemsQuery.data?.data ?? [];
  const selectedItem = items.find((i) => i.id === formItemId);

  // Loading / error shells
  if (indentsQuery.isLoading) {
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

  if (indentsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load indents</p>
            <p className="text-red-700 mt-1">
              {indentsQuery.error instanceof Error
                ? indentsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const indents = indentsQuery.data?.data ?? [];
  const total = indentsQuery.data?.meta.total ?? indents.length;

  // KPIs
  const draftCount = indents.filter((i) => i.status === "DRAFT").length;
  const submittedCount = indents.filter((i) => i.status === "SUBMITTED").length;
  const approvedCount = indents.filter((i) => i.status === "APPROVED").length;
  const convertedCount = indents.filter(
    (i) => i.status === "CONVERTED"
  ).length;

  const columns: Column<Indent>[] = [
    {
      key: "indentNumber",
      header: "Indent #",
      render: (i) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {i.indentNumber}
        </span>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (i) => (
        <span className="text-sm">{i.department ?? "—"}</span>
      ),
    },
    {
      key: "purpose",
      header: "Purpose",
      render: (i) => (
        <span className="text-sm line-clamp-1 text-muted-foreground">
          {i.purpose ?? "—"}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (i) => (
        <Badge
          variant="outline"
          className={`text-xs ${PRIORITY_TONE[i.priority]}`}
        >
          {i.priority}
        </Badge>
      ),
    },
    {
      key: "requiredBy",
      header: "Required By",
      render: (i) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(i.requiredBy)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (i) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[i.status]}`}
        >
          {i.status}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (i) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(i.createdAt)}
        </span>
      ),
    },
  ];

  async function handleSave(): Promise<void> {
    setSaveError(null);
    if (!formItemId || !formQty || !formUom) {
      setSaveError("Pick an item and enter quantity + UoM.");
      return;
    }
    try {
      await createIndent.mutateAsync({
        department: formDepartment.trim() || undefined,
        purpose: formPurpose.trim() || undefined,
        priority: formPriority,
        requiredBy: formRequiredBy || undefined,
        notes: formNotes.trim() || undefined,
        lines: [
          {
            itemId: formItemId,
            quantity: formQty,
            uom: formUom,
            estimatedCost: formEstCost.trim() || "0",
          },
        ],
      });
      setDialogOpen(false);
      setFormDepartment("");
      setFormPurpose("");
      setFormPriority("NORMAL");
      setFormRequiredBy("");
      setFormItemId("");
      setFormQty("");
      setFormUom("");
      setFormEstCost("");
      setFormNotes("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Indents"
        description="Material requisitions — one header can request many items"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KPICard
          title="Total Indents"
          value={String(total)}
          icon={ClipboardList}
          iconColor="text-primary"
        />
        <KPICard
          title="Draft"
          value={String(draftCount)}
          icon={FileText}
          iconColor="text-gray-500"
        />
        <KPICard
          title="Submitted"
          value={String(submittedCount)}
          icon={Clock}
          iconColor="text-amber-500"
        />
        <KPICard
          title="Approved"
          value={String(approvedCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Converted"
          value={String(convertedCount)}
          icon={ArrowRightCircle}
          iconColor="text-indigo-600"
        />
      </div>

      <DataTable<Indent>
        data={indents}
        columns={columns}
        searchKey="indentNumber"
        searchPlaceholder="Search indent #..."
        onRowClick={(i) => router.push(`/procurement/indents/${i.id}`)}
        pageSize={10}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search number / department..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <Select
              value={status}
              onValueChange={(v) =>
                setStatus((v ?? "all") as IndentStatus | "all")
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {INDENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={priority}
              onValueChange={(v) =>
                setPriority((v ?? "all") as IndentPriority | "all")
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {INDENT_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Indent
            </Button>
          </div>
        }
      />

      {indents.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center flex flex-col items-center gap-2">
          <XCircle className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No indents match the current filter.
          </p>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Indent</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {saveError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Input
                  placeholder="e.g. Production"
                  value={formDepartment}
                  onChange={(e) => setFormDepartment(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select
                  value={formPriority}
                  onValueChange={(v) =>
                    setFormPriority((v ?? "NORMAL") as IndentPriority)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INDENT_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Purpose</Label>
              <Input
                placeholder="Reason for requisition"
                value={formPurpose}
                onChange={(e) => setFormPurpose(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Required By</Label>
              <Input
                type="date"
                value={formRequiredBy}
                onChange={(e) => setFormRequiredBy(e.target.value)}
              />
            </div>
            <div className="rounded-md border p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                First Line
              </p>
              <div className="space-y-1.5">
                <Label>Item</Label>
                <Select
                  value={formItemId}
                  onValueChange={(v) => {
                    setFormItemId(v ?? "");
                    const item = items.find((i) => i.id === v);
                    if (item) setFormUom(item.uom);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select item..." />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.sku} — {it.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Qty</Label>
                  <Input
                    type="number"
                    value={formQty}
                    onChange={(e) => setFormQty(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>UoM</Label>
                  <Input
                    value={formUom}
                    onChange={(e) => setFormUom(e.target.value)}
                    placeholder={selectedItem?.uom ?? "EA"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Est. Cost</Label>
                  <Input
                    type="number"
                    value={formEstCost}
                    onChange={(e) => setFormEstCost(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Additional lines can be added from the indent detail page
                after creation.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Optional notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createIndent.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                createIndent.isPending ||
                !formItemId ||
                !formQty ||
                !formUom
              }
            >
              {createIndent.isPending ? "Saving…" : "Create Indent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
