"use client";

/**
 * BOMs — reads /production/boms via useApiBoms.
 *
 * Contract deltas vs the older manufacturing-mock prototype:
 *   - Status vocabulary: DRAFT / ACTIVE / SUPERSEDED / OBSOLETE.
 *     Only one BOM may be ACTIVE per product (DB partial unique index +
 *     service-layer check).
 *   - `totalStdCost` is server-computed from sum(qtyPerUnit × stdUnitCost)
 *     across bom_lines — it's a decimal string.
 *   - ECN references, rev, effective-from/to are flat string/date fields.
 *   - Clicking a BOM opens the detail page which supports line CRUD (on
 *     DRAFT BOMs) plus the atomic activate flow.
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
  useApiBoms,
  useApiCreateBom,
  useApiProducts,
} from "@/hooks/useProductionApi";
import {
  BOM_STATUSES,
  type BomStatus,
  type BomVersion,
} from "@mobilab/contracts";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  Plus,
  XCircle,
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

const BOM_STATUS_TONE: Record<BomStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  ACTIVE: "bg-green-50 text-green-700 border-green-200",
  SUPERSEDED: "bg-amber-50 text-amber-700 border-amber-200",
  OBSOLETE: "bg-slate-50 text-slate-700 border-slate-200",
};

export default function BomsPage() {
  const router = useRouter();

  // ─── Filters ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<BomStatus | "all">("all");
  const [productFilter, setProductFilter] = useState<string>("all");

  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      status: status === "all" ? undefined : status,
      productId: productFilter === "all" ? undefined : productFilter,
    }),
    [search, status, productFilter]
  );

  const bomsQuery = useApiBoms(query);
  const productsQuery = useApiProducts({ limit: 200, isActive: true });
  const createBom = useApiCreateBom();

  // ─── Create dialog state ────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formProductId, setFormProductId] = useState("");
  const [formVersionLabel, setFormVersionLabel] = useState("");
  const [formEffectiveFrom, setFormEffectiveFrom] = useState("");
  const [formEcnRef, setFormEcnRef] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const products = productsQuery.data?.data ?? [];

  // Loading / error shells
  if (bomsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (bomsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load BOMs</p>
            <p className="text-red-700 mt-1">
              {bomsQuery.error instanceof Error
                ? bomsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const boms = bomsQuery.data?.data ?? [];
  const total = bomsQuery.data?.meta.total ?? boms.length;

  // KPIs — scoped to the current page window.
  const draft = boms.filter((b) => b.status === "DRAFT").length;
  const active = boms.filter((b) => b.status === "ACTIVE").length;
  const superseded = boms.filter((b) => b.status === "SUPERSEDED").length;

  const columns: Column<BomVersion>[] = [
    {
      key: "versionLabel",
      header: "Version",
      render: (b) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {b.versionLabel}
        </span>
      ),
    },
    {
      key: "productId",
      header: "Product",
      render: (b) => {
        const product = products.find((p) => p.id === b.productId);
        return (
          <div className="space-y-0.5">
            <div className="text-sm font-medium">
              {product?.name ?? (
                <span className="font-mono text-xs text-muted-foreground">
                  {b.productId.slice(0, 8)}…
                </span>
              )}
            </div>
            {product && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {product.productCode}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (b) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${BOM_STATUS_TONE[b.status]}`}
        >
          {b.status}
        </Badge>
      ),
    },
    {
      key: "totalStdCost",
      header: "Std Cost",
      className: "text-right",
      render: (b) => (
        <span className="text-sm font-medium text-right block">
          {formatMoney(b.totalStdCost)}
        </span>
      ),
    },
    {
      key: "effectiveFrom",
      header: "Effective From",
      render: (b) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(b.effectiveFrom)}
        </span>
      ),
    },
    {
      key: "effectiveTo",
      header: "Effective To",
      render: (b) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(b.effectiveTo)}
        </span>
      ),
    },
    {
      key: "ecnRef",
      header: "ECN Ref",
      render: (b) =>
        b.ecnRef ? (
          <Badge variant="outline" className="font-mono text-xs">
            {b.ecnRef}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "approvedAt",
      header: "Approved",
      render: (b) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(b.approvedAt)}
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
    if (!formVersionLabel.trim()) {
      setSaveError("Version label is required (e.g. v1, v2.0).");
      return;
    }
    try {
      const created = await createBom.mutateAsync({
        productId: formProductId,
        versionLabel: formVersionLabel.trim(),
        effectiveFrom: formEffectiveFrom || undefined,
        ecnRef: formEcnRef.trim() || undefined,
        notes: formNotes.trim() || undefined,
        lines: [],
      });
      setDialogOpen(false);
      setFormProductId("");
      setFormVersionLabel("");
      setFormEffectiveFrom("");
      setFormEcnRef("");
      setFormNotes("");
      router.push(`/production/bom/${created.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Bills of Materials"
        description="BOM versions — only one ACTIVE BOM per product. Activation atomically supersedes the prior version."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total BOMs"
          value={String(total)}
          icon={FileText}
          iconColor="text-primary"
        />
        <KPICard
          title="Draft"
          value={String(draft)}
          icon={Clock}
          iconColor="text-amber-500"
        />
        <KPICard
          title="Active"
          value={String(active)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Superseded"
          value={String(superseded)}
          icon={XCircle}
          iconColor="text-slate-500"
        />
      </div>

      <DataTable<BomVersion>
        data={boms}
        columns={columns}
        searchKey="versionLabel"
        searchPlaceholder="Search version..."
        onRowClick={(b) => router.push(`/production/bom/${b.id}`)}
        pageSize={10}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search version / notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <Select
              value={status}
              onValueChange={(v) =>
                setStatus((v ?? "all") as BomStatus | "all")
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {BOM_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
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
              New BOM
            </Button>
          </div>
        }
      />

      {boms.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center flex flex-col items-center gap-2">
          <Circle className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No BOMs match the current filter.
          </p>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New BOM Version</DialogTitle>
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Version Label</Label>
                <Input
                  placeholder="e.g. v1"
                  value={formVersionLabel}
                  onChange={(e) => setFormVersionLabel(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Effective From</Label>
                <Input
                  type="date"
                  value={formEffectiveFrom}
                  onChange={(e) => setFormEffectiveFrom(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>ECN Reference</Label>
              <Input
                placeholder="Optional ECN number"
                value={formEcnRef}
                onChange={(e) => setFormEcnRef(e.target.value)}
              />
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
            <p className="text-xs text-muted-foreground">
              BOM is created as <span className="font-medium">DRAFT</span>.
              Add lines from the detail page, then activate to promote it as
              the product&apos;s active BOM.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createBom.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createBom.isPending || !formProductId}
            >
              {createBom.isPending ? "Saving…" : "Create Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
