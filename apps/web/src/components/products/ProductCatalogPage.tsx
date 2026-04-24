"use client";

/**
 * ProductCatalogPage — shared catalog manager mounted at:
 *   /admin/products         (SUPER_ADMIN / MANAGEMENT)
 *   /production/products    (PRODUCTION_MANAGER / RD / PRODUCTION / QC_MANAGER read)
 *
 * Same component in both spots so the list, filters, dialog state, and
 * toast flows stay perfectly consistent regardless of which sidebar
 * entry the user clicked. Role-appropriate buttons are gated via
 * `can()` — if the API would reject the action, the button doesn't render.
 *
 * Data flow:
 *   filters/page change ─┐
 *                        ├─► fetch() ─► setRows / setTotal
 *   dialog onSaved ──────┘            (fetch is the single refresh path)
 *
 * Deletes are soft on the server; the "Historical … will remain unaffected"
 * copy in the confirm dialog mirrors that guarantee so the admin knows
 * they are not about to vaporise referenced WOs / BOMs / QC records.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Edit2,
  Loader2,
  Plus,
  Search,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Check,
  X as XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

import { ProductFormDialog } from "./ProductFormDialog";
import {
  apiListProducts,
  apiDeleteProduct,
  type ProductListQuery,
} from "@/lib/api/production";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import { useAuthStore } from "@/store/auth.store";
import {
  PRODUCT_FAMILIES,
  type Product,
  type ProductFamily,
} from "@instigenie/contracts";

// ─── Labels & tokens ─────────────────────────────────────────────────────────

const FAMILY_LABELS: Record<ProductFamily, string> = {
  MODULE: "Module",
  DEVICE: "Device",
  REAGENT: "Reagent",
  CONSUMABLE: "Consumable",
};

/** Muted pastel palette so the badge never fights the row text. */
const FAMILY_BADGE_CLASS: Record<ProductFamily, string> = {
  MODULE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  DEVICE: "bg-cyan-50 text-cyan-700 border-cyan-200",
  REAGENT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CONSUMABLE: "bg-amber-50 text-amber-700 border-amber-200",
};

const PAGE_SIZE = 25;
/** Default family matches the user's core product line (devices). */
const DEFAULT_FAMILY: ProductFamily = "DEVICE";

// ─── Sentinel for the "all families" option ──────────────────────────────────
//
// Radix <Select> treats empty-string values as "cleared", so we need a
// non-empty sentinel. The cast to ProductFamily below is never exercised —
// we translate back to undefined at the API boundary.
const ALL_FAMILIES = "__ALL__" as const;
type FamilyFilter = ProductFamily | typeof ALL_FAMILIES;

const ACTIVE_FILTERS = ["active", "inactive", "all"] as const;
type ActiveFilter = (typeof ACTIVE_FILTERS)[number];

const ACTIVE_LABELS: Record<ActiveFilter, string> = {
  active: "Active",
  inactive: "Inactive",
  all: "All",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function ProductCatalogPage(): React.JSX.Element {
  const can = useAuthStore((s) => s.can);

  // Filters
  const [family, setFamily] = useState<FamilyFilter>(DEFAULT_FAMILY);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Pagination
  const [page, setPage] = useState(1);

  // Data
  const [rows, setRows] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Dialog state — one discriminated union instead of two booleans so we
  // can't wind up in "open but mode unclear" states when the user clicks
  // Edit then Cancel then New Product rapidly.
  type DialogState =
    | { kind: "closed" }
    | { kind: "create" }
    | { kind: "edit"; product: Product };
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const [isDeletePending, startDeleteTransition] = useTransition();

  // Debounce the search box (350 ms) so we aren't firing a request per
  // keystroke. Resets to page 1 whenever the debounced term changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to page 1 when family or active filter changes (otherwise you
  // could be on page 4 of a filter result that now has 1 page).
  useEffect(() => {
    setPage(1);
  }, [family, activeFilter]);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const query = useMemo<ProductListQuery>(() => {
    const q: ProductListQuery = {
      page,
      limit: PAGE_SIZE,
      sortBy: "updatedAt",
      sortDir: "desc",
    };
    if (family !== ALL_FAMILIES) q.family = family;
    if (activeFilter === "active") q.isActive = true;
    if (activeFilter === "inactive") q.isActive = false;
    if (debouncedSearch) q.search = debouncedSearch;
    return q;
  }, [family, activeFilter, debouncedSearch, page]);

  // A running request counter guards against out-of-order responses when
  // the user toggles filters quickly — only the latest fetch writes state.
  const requestIdRef = useRef(0);

  const fetchProducts = useCallback(async () => {
    const id = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiListProducts(query);
      if (id !== requestIdRef.current) return;
      setRows(res.data);
      setTotal(res.meta.total);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      if (id !== requestIdRef.current) return;
      const msg =
        err instanceof ApiProblem
          ? (err.problem.detail ?? err.problem.title)
          : "Could not reach the API.";
      setLoadError(msg);
      setRows([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  // ── Permission flags — compute once per render ────────────────────────────

  const canCreate = can("products:create");
  const canUpdate = can("products:update");
  const canDelete = can("products:delete");
  const canAnyRowAction = canUpdate || canDelete;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSaved(): void {
    // ProductFormDialog already toasted the success; we just re-fetch so
    // the list shows the new/updated row. Bouncing back to page 1 on
    // *create* avoids the surprise where the new row is on page N and
    // invisible.
    if (dialog.kind === "create") setPage(1);
    void fetchProducts();
  }

  function handleConfirmDelete(): void {
    if (!pendingDelete) return;
    const target = pendingDelete;
    startDeleteTransition(async () => {
      try {
        await apiDeleteProduct(target.id);
        toast.success(`Product ${target.productCode} deleted.`);
        setPendingDelete(null);
        // If we just nuked the last row on this page, step back one so
        // the user doesn't land on an empty page.
        if (rows.length === 1 && page > 1) {
          setPage(page - 1);
        } else {
          void fetchProducts();
        }
      } catch (err) {
        const msg =
          err instanceof ApiProblem
            ? (err.problem.detail ?? err.problem.title)
            : "Could not reach the API.";
        toast.error("Delete failed", { description: msg });
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-[1240px] mx-auto space-y-5">
      {/* Form dialog (create + edit share one instance via a key) */}
      {dialog.kind === "create" && (
        <ProductFormDialog
          mode="create"
          open={true}
          onOpenChange={(next) => {
            if (!next) setDialog({ kind: "closed" });
          }}
          onSaved={handleSaved}
        />
      )}
      {dialog.kind === "edit" && (
        <ProductFormDialog
          key={dialog.product.id}
          mode="edit"
          initial={dialog.product}
          open={true}
          onOpenChange={(next) => {
            if (!next) setDialog({ kind: "closed" });
          }}
          onSaved={handleSaved}
        />
      )}

      {/* Delete confirm */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next && !isDeletePending) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Delete product?
            </DialogTitle>
            <DialogDescription>
              {pendingDelete ? (
                <>
                  You&apos;re about to delete{" "}
                  <span className="font-medium text-foreground">
                    {pendingDelete.productCode}
                  </span>{" "}
                  — <span className="text-foreground">{pendingDelete.name}</span>.
                  It will no longer appear in pickers or work-order creation.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-muted/60 border px-3 py-2 text-xs text-muted-foreground">
            Historical work orders, BOMs, and QC records will remain unaffected.
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={isDeletePending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeletePending}
            >
              {isDeletePending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete product
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Product Catalog</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage the devices, instruments, reagents, and consumables your team
            manufactures or sells. Changes apply across work orders, BOMs, and QC.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus className="h-4 w-4 mr-2" />
            New product
          </Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="rounded-lg border bg-card p-3">
        <div className="grid grid-cols-1 md:grid-cols-[200px_160px_1fr_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Family</Label>
            <Select
              value={family}
              onValueChange={(v) => setFamily(v as FamilyFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FAMILIES}>All families</SelectItem>
                {PRODUCT_FAMILIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FAMILY_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select
              value={activeFilter}
              onValueChange={(v) => setActiveFilter(v as ActiveFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVE_FILTERS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACTIVE_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pc-search" className="text-xs text-muted-foreground">
              Search
            </Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="pc-search"
                placeholder="Name or product code…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void fetchProducts()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2 hidden md:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-[140px]">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-[120px]">Family</TableHead>
              <TableHead className="w-[70px]">UOM</TableHead>
              <TableHead className="w-[90px] text-right">Cycle (d)</TableHead>
              <TableHead className="w-[110px]">Serial</TableHead>
              <TableHead className="w-[90px]">Active</TableHead>
              <TableHead className="w-[160px]">Updated</TableHead>
              {canAnyRowAction && (
                <TableHead className="w-[96px] text-right">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadError ? (
              <TableRow>
                <TableCell
                  colSpan={canAnyRowAction ? 9 : 8}
                  className="py-10 text-center text-sm text-destructive"
                >
                  {loadError}
                </TableCell>
              </TableRow>
            ) : loading && rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canAnyRowAction ? 9 : 8}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading products…
                  </span>
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canAnyRowAction ? 9 : 8}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No products match these filters.
                  {canCreate && (
                    <>
                      {" "}
                      <button
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => setDialog({ kind: "create" })}
                      >
                        Create one
                      </button>
                      .
                    </>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => (
                <TableRow key={p.id} className="hover:bg-muted/20">
                  <TableCell className="font-mono text-xs">
                    {p.productCode}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium leading-tight">
                      {p.name}
                    </div>
                    {p.description && (
                      <div className="text-xs text-muted-foreground leading-tight line-clamp-1 mt-0.5">
                        {p.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={FAMILY_BADGE_CLASS[p.family]}
                    >
                      {FAMILY_LABELS[p.family]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.uom}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {p.standardCycleDays}
                  </TableCell>
                  <TableCell>
                    <BoolCell value={p.hasSerialTracking} />
                  </TableCell>
                  <TableCell>
                    <BoolCell value={p.isActive} tone="success" />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(p.updatedAt)}
                  </TableCell>
                  {canAnyRowAction && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canUpdate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Edit"
                            onClick={() =>
                              setDialog({ kind: "edit", product: p })
                            }
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            title="Delete"
                            onClick={() => setPendingDelete(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer — count + pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total === 0
            ? "0 products"
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(
                page * PAGE_SIZE,
                total,
              )} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="px-1">
            Page {page} / {Math.max(1, totalPages)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Presentational helpers ──────────────────────────────────────────────────

function BoolCell({
  value,
  tone = "neutral",
}: {
  value: boolean;
  tone?: "neutral" | "success";
}): React.JSX.Element {
  if (value) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium ${
          tone === "success" ? "text-emerald-700" : "text-foreground"
        }`}
      >
        <Check className="h-3.5 w-3.5" />
        Yes
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <XIcon className="h-3.5 w-3.5" />
      No
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
