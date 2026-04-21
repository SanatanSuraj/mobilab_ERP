"use client";

/**
 * GRNs & QC — reads /procurement/grns via useApiGrns.
 *
 * Contract deltas vs the older mock (QCInspection / GRN in
 * procurement-mock.ts):
 *   - QC in Phase 2 is a `qcStatus` enum on each grn_line (PENDING /
 *     ACCEPTED / REJECTED / PARTIAL) — there's no separate QCInspection
 *     aggregate, no checklist, no defect-code catalogue. The rich mock UI
 *     belongs to a dedicated QC module (Phase 2 §12.1 #5), which will add
 *     qc_inspections + qc_checks tables and route /qc/* wrapping these
 *     fields.
 *   - GRN statuses simplify to DRAFT / POSTED (mock had a PENDING_QC /
 *     QC_COMPLETED chain). Posting a GRN is an atomic write:
 *       1. stock_ledger += accepted_qty   (per grn_line)
 *       2. po_lines.received_qty += accepted_qty
 *       3. PO status re-projected (PARTIALLY_RECEIVED / RECEIVED)
 *       4. GRN status → POSTED
 *     All in one transaction; a DRAFT is the only editable state.
 *
 * List view only: creating a new GRN requires a parent PO + lines, which
 * is a multi-step flow best handled from the PO detail page (Phase 3).
 * Here we surface the real GRN pipeline and let a user POST DRAFT rows.
 */

import { useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApiGrn,
  useApiGrns,
  useApiPostGrn,
  useApiVendors,
} from "@/hooks/useProcurementApi";
import { useApiWarehouses } from "@/hooks/useInventoryApi";
import {
  GRN_STATUSES,
  type Grn,
  type GrnStatus,
} from "@mobilab/contracts";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileText,
  PackageCheck,
  PackageSearch,
  PlayCircle,
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

const STATUS_TONE: Record<GrnStatus, string> = {
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200",
  POSTED: "bg-green-50 text-green-700 border-green-200",
};

export default function GrnQcPage() {
  // ─── Filters ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<GrnStatus | "all">("all");

  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      status: status === "all" ? undefined : status,
    }),
    [search, status]
  );

  const grnsQuery = useApiGrns(query);
  const vendorsQuery = useApiVendors({ limit: 200 });
  const warehousesQuery = useApiWarehouses({ limit: 100 });

  const [postTargetId, setPostTargetId] = useState<string | null>(null);

  // Loading / error shells
  if (grnsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (grnsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load GRNs</p>
            <p className="text-red-700 mt-1">
              {grnsQuery.error instanceof Error
                ? grnsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const grns = grnsQuery.data?.data ?? [];
  const total = grnsQuery.data?.meta.total ?? grns.length;
  const vendors = vendorsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];

  // KPIs
  const draftCount = grns.filter((g) => g.status === "DRAFT").length;
  const postedCount = grns.filter((g) => g.status === "POSTED").length;

  const columns: Column<Grn>[] = [
    {
      key: "grnNumber",
      header: "GRN #",
      render: (g) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {g.grnNumber}
        </span>
      ),
    },
    {
      key: "vendorId",
      header: "Vendor",
      render: (g) => {
        const vendor = vendors.find((v) => v.id === g.vendorId);
        return (
          <span className="text-sm">
            {vendor?.name ?? (
              <span className="font-mono text-xs text-muted-foreground">
                {g.vendorId.slice(0, 8)}…
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "warehouseId",
      header: "Warehouse",
      render: (g) => {
        const wh = warehouses.find((w) => w.id === g.warehouseId);
        return (
          <span className="text-sm">
            {wh?.name ?? (
              <span className="font-mono text-xs text-muted-foreground">
                {g.warehouseId.slice(0, 8)}…
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "receivedDate",
      header: "Received",
      render: (g) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(g.receivedDate)}
        </span>
      ),
    },
    {
      key: "invoiceNumber",
      header: "Invoice",
      render: (g) => (
        <span className="text-sm">
          {g.invoiceNumber ? (
            <>
              <span className="font-mono">{g.invoiceNumber}</span>
              {g.invoiceDate && (
                <span className="text-xs text-muted-foreground ml-1">
                  · {formatDate(g.invoiceDate)}
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (g) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[g.status]}`}
        >
          {g.status}
        </Badge>
      ),
    },
    {
      key: "postedAt",
      header: "Posted",
      render: (g) => (
        <span className="text-xs text-muted-foreground">
          {g.postedAt ? formatDate(g.postedAt) : "—"}
        </span>
      ),
    },
    {
      key: "id",
      header: "Actions",
      render: (g) =>
        g.status === "DRAFT" ? (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 gap-1"
            onClick={(e) => {
              e.stopPropagation();
              setPostTargetId(g.id);
            }}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            Post
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Goods Receipt Notes"
        description="Received against purchase orders. Posting writes to the stock ledger and closes the PO line."
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <KPICard
          title="Total GRNs"
          value={String(total)}
          icon={PackageCheck}
          iconColor="text-primary"
        />
        <KPICard
          title="Drafts Awaiting Post"
          value={String(draftCount)}
          icon={FileText}
          iconColor="text-amber-500"
        />
        <KPICard
          title="Posted"
          value={String(postedCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
      </div>

      <DataTable<Grn>
        data={grns}
        columns={columns}
        searchKey="grnNumber"
        searchPlaceholder="Search GRN #..."
        pageSize={10}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search GRN / invoice..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <Select
              value={status}
              onValueChange={(v) =>
                setStatus((v ?? "all") as GrnStatus | "all")
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {GRN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {grns.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center flex flex-col items-center gap-2">
          <PackageSearch className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No GRNs match the current filter.
          </p>
          <p className="text-xs text-muted-foreground">
            GRNs are created from the PO detail page when goods arrive.
          </p>
        </div>
      )}

      {postTargetId && (
        <PostGrnDialog
          grnId={postTargetId}
          onClose={() => setPostTargetId(null)}
        />
      )}
    </div>
  );
}

// ─── Post-GRN dialog ────────────────────────────────────────────────────────

function PostGrnDialog({
  grnId,
  onClose,
}: {
  grnId: string;
  onClose: () => void;
}) {
  const grnQuery = useApiGrn(grnId);
  const postGrn = useApiPostGrn(grnId);
  const [error, setError] = useState<string | null>(null);

  const grn = grnQuery.data;
  const lines = grn?.lines ?? [];

  async function handlePost(): Promise<void> {
    if (!grn) return;
    setError(null);
    try {
      await postGrn.mutateAsync({ expectedVersion: grn.version });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Posting failed");
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Post GRN {grn ? grn.grnNumber : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {grnQuery.isLoading && <Skeleton className="h-32 w-full" />}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
              {error}
            </div>
          )}
          {grn && (
            <>
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Received on</span>
                  <span className="font-medium">
                    {formatDate(grn.receivedDate)}
                  </span>
                </div>
                {grn.invoiceNumber && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Invoice #</span>
                    <span className="font-mono">{grn.invoiceNumber}</span>
                  </div>
                )}
                {grn.vehicleNumber && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Vehicle</span>
                    <span>{grn.vehicleNumber}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t mt-1">
                  <span className="text-muted-foreground">Lines</span>
                  <span className="font-medium">{lines.length}</span>
                </div>
              </div>
              <div className="rounded-md border text-sm">
                <div className="grid grid-cols-[1fr_80px_80px] gap-2 p-2 bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Line</span>
                  <span className="text-right">Received</span>
                  <span className="text-right">Rejected</span>
                </div>
                {lines.map((line) => {
                  const rec = Number.parseFloat(line.quantity) || 0;
                  const rej = Number.parseFloat(line.qcRejectedQty) || 0;
                  const accepted = (rec - rej).toFixed(3);
                  return (
                    <div
                      key={line.id}
                      className="grid grid-cols-[1fr_80px_80px] gap-2 p-2 border-t text-xs items-center"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-muted-foreground">
                          L{line.lineNo}
                        </span>
                        {line.batchNo && (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-blue-50 text-blue-700 border-blue-200"
                          >
                            {line.batchNo}
                          </Badge>
                        )}
                        <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                        <span className="text-muted-foreground">
                          Accepted {accepted} {line.uom}
                        </span>
                      </span>
                      <span className="text-right font-medium">
                        {line.quantity}
                      </span>
                      <span className="text-right text-red-600">
                        {line.qcRejectedQty}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Posting is atomic: stock ledger entries are written, the
                parent PO's line received quantities are bumped, and the PO
                header status is recomputed. This cannot be undone.
              </p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={postGrn.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handlePost}
            disabled={
              postGrn.isPending || !grn || lines.length === 0
            }
          >
            {postGrn.isPending ? "Posting…" : "Confirm & Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
