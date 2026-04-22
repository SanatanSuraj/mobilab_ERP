"use client";

/**
 * BOM detail — reads /production/boms/:id (returns BomVersionWithLines)
 * via useApiBom.
 *
 * Capabilities:
 *   - Add / update / delete BOM lines (while BOM is in DRAFT); server
 *     recomputes `total_std_cost` after every line mutation.
 *   - Activate a DRAFT BOM atomically: supersedes any prior ACTIVE BOM for
 *     the same product, stamps approvedBy/approvedAt, and updates the
 *     product's denormalised active_bom_id.
 *   - Soft-delete DRAFT BOMs (server rejects deletion of ACTIVE BOMs — the
 *     rule is "supersede first" via activation of a newer version).
 *
 * Deltas vs manufacturing-mock prototype:
 *   - No ECN workflow panel — ECN is a Phase 3 concern.
 *   - No rev/dwg pointer — that lives on BOM metadata (ecnRef).
 *   - Component lookup uses useApiItems from the inventory module.
 */

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiActivateBom,
  useApiAddBomLine,
  useApiBom,
  useApiDeleteBom,
  useApiDeleteBomLine,
  useApiProduct,
} from "@/hooks/useProductionApi";
import { useApiItems } from "@/hooks/useInventoryApi";
import {
  BOM_LINE_TRACKING_TYPES,
  type BomLineTrackingType,
  type BomStatus,
} from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Plus,
  ShieldCheck,
  Trash2,
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

export default function BomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const bomQuery = useApiBom(id);
  const bom = bomQuery.data;
  const productQuery = useApiProduct(bom?.productId);

  const itemsQuery = useApiItems({ limit: 200, isActive: true });
  const items = itemsQuery.data?.data ?? [];

  const addLine = useApiAddBomLine(id);
  const deleteLine = useApiDeleteBomLine(id);
  const activateBom = useApiActivateBom(id);
  const deleteBom = useApiDeleteBom();

  // Dialog state
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Line form
  const [formItemId, setFormItemId] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formUom, setFormUom] = useState("");
  const [formUnitCost, setFormUnitCost] = useState("0");
  const [formRefDes, setFormRefDes] = useState("");
  const [formTracking, setFormTracking] =
    useState<BomLineTrackingType>("NONE");
  const [formIsCritical, setFormIsCritical] = useState(false);
  const [formLeadDays, setFormLeadDays] = useState("0");
  const [lineError, setLineError] = useState<string | null>(null);

  const [activateEffectiveFrom, setActivateEffectiveFrom] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === formItemId),
    [items, formItemId]
  );

  if (bomQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (bomQuery.isError || !bom) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              {bomQuery.isError ? "Failed to load BOM" : "BOM not found"}
            </p>
            {bomQuery.isError && (
              <p className="text-red-700 mt-1">
                {bomQuery.error instanceof Error
                  ? bomQuery.error.message
                  : "Unknown error"}
              </p>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={() => router.push("/production/bom")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to BOMs
        </Button>
      </div>
    );
  }

  const product = productQuery.data;
  const editable = bom.status === "DRAFT";
  const canActivate = bom.status === "DRAFT" && bom.lines.length > 0;
  const canDelete = bom.status === "DRAFT";

  async function handleAddLine(): Promise<void> {
    setLineError(null);
    if (!formItemId || !formQty.trim() || !formUom.trim()) {
      setLineError("Component, quantity, and UoM are required.");
      return;
    }
    if (!/^\d+(\.\d{1,3})?$/.test(formQty.trim())) {
      setLineError("Quantity must be a non-negative decimal (e.g. 2 or 2.500).");
      return;
    }
    if (!/^-?\d+(\.\d+)?$/.test(formUnitCost.trim())) {
      setLineError("Unit cost must be a decimal (e.g. 100.00).");
      return;
    }
    try {
      await addLine.mutateAsync({
        componentItemId: formItemId,
        qtyPerUnit: formQty.trim(),
        uom: formUom.trim(),
        stdUnitCost: formUnitCost.trim() || "0",
        referenceDesignator: formRefDes.trim() || undefined,
        trackingType: formTracking,
        isCritical: formIsCritical,
        leadTimeDays: Number.parseInt(formLeadDays, 10) || 0,
      });
      setLineDialogOpen(false);
      setFormItemId("");
      setFormQty("");
      setFormUom("");
      setFormUnitCost("0");
      setFormRefDes("");
      setFormTracking("NONE");
      setFormIsCritical(false);
      setFormLeadDays("0");
    } catch (err) {
      setLineError(err instanceof Error ? err.message : "Add line failed");
    }
  }

  async function handleDeleteLine(lineId: string): Promise<void> {
    setActionError(null);
    try {
      await deleteLine.mutateAsync(lineId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function handleActivate(): Promise<void> {
    if (!bom) return;
    setActionError(null);
    try {
      await activateBom.mutateAsync({
        expectedVersion: bom.version,
        effectiveFrom: activateEffectiveFrom || undefined,
      });
      setActivateDialogOpen(false);
      setActivateEffectiveFrom("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Activate failed");
    }
  }

  async function handleDeleteBom(): Promise<void> {
    if (!bom) return;
    setActionError(null);
    try {
      await deleteBom.mutateAsync(bom.id);
      router.push("/production/bom");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  // When the component is selected, default the UoM to the item's UoM.
  function handleItemChange(newItemId: string): void {
    setFormItemId(newItemId);
    const item = items.find((i) => i.id === newItemId);
    if (item) {
      setFormUom(item.uom);
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Back button */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/production/bom")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to BOMs
        </Button>
      </div>

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight font-mono">
              {bom.versionLabel}
            </h1>
            <Badge
              variant="outline"
              className={`text-xs whitespace-nowrap ${BOM_STATUS_TONE[bom.status]}`}
            >
              {bom.status}
            </Badge>
            {bom.ecnRef && (
              <Badge variant="outline" className="font-mono text-xs">
                ECN {bom.ecnRef}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {product
              ? `${product.name} (${product.productCode})`
              : "…"}{" "}
            · Std cost {formatMoney(bom.totalStdCost)}
            {bom.effectiveFrom &&
              ` · Effective from ${formatDate(bom.effectiveFrom)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canActivate && (
            <Button
              size="sm"
              onClick={() => setActivateDialogOpen(true)}
              disabled={activateBom.isPending}
              className="gap-1"
            >
              <ShieldCheck className="h-4 w-4" /> Activate
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-300 hover:bg-red-50 gap-1"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleteBom.isPending}
            >
              <Trash2 className="h-4 w-4" /> Delete Draft
            </Button>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: 2/3 */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">BOM Header</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Product
                </p>
                <p className="font-medium">{product?.name ?? "—"}</p>
                {product && (
                  <p className="text-xs text-muted-foreground font-mono">
                    {product.productCode}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Version
                </p>
                <p className="font-mono">{bom.versionLabel}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Effective From
                </p>
                <p>{formatDate(bom.effectiveFrom)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Effective To
                </p>
                <p>{formatDate(bom.effectiveTo)}</p>
              </div>
              {bom.approvedAt && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Approved
                  </p>
                  <p>{formatDate(bom.approvedAt)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Total Std Cost
                </p>
                <p className="font-medium">{formatMoney(bom.totalStdCost)}</p>
              </div>
              {bom.notes && (
                <div className="col-span-2 pt-2 border-t">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Notes
                  </p>
                  <p>{bom.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                BOM Lines
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  ({bom.lines.length})
                </span>
              </CardTitle>
              {editable && (
                <Button
                  size="sm"
                  onClick={() => setLineDialogOpen(true)}
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" /> Add Line
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {bom.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No lines yet. {editable && "Use 'Add Line' to get started."}
                </p>
              ) : (
                <div className="rounded-lg border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Component</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead>UoM</TableHead>
                        <TableHead>Ref Des</TableHead>
                        <TableHead>Tracking</TableHead>
                        <TableHead className="text-right">Unit Cost</TableHead>
                        <TableHead className="text-right">Line Cost</TableHead>
                        {editable && <TableHead className="w-12" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bom.lines.map((line) => {
                        const item = items.find(
                          (i) => i.id === line.componentItemId
                        );
                        const lineCost =
                          Number(line.qtyPerUnit) * Number(line.stdUnitCost);
                        return (
                          <TableRow key={line.id}>
                            <TableCell className="tabular-nums text-xs">
                              {line.lineNo}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-0.5">
                                <div className="text-sm">
                                  {item?.name ?? (
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {line.componentItemId.slice(0, 8)}…
                                    </span>
                                  )}
                                </div>
                                {item && (
                                  <div className="text-[10px] text-muted-foreground font-mono">
                                    {item.sku}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm">
                              {line.qtyPerUnit}
                            </TableCell>
                            <TableCell className="text-xs">
                              {line.uom}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">
                              {line.referenceDesignator ?? "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-muted-foreground"
                                >
                                  {line.trackingType}
                                </Badge>
                                {line.isCritical && (
                                  <Badge
                                    variant="outline"
                                    className="bg-red-50 text-red-700 border-red-200 text-[10px]"
                                  >
                                    Critical
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {formatMoney(line.stdUnitCost)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs font-medium">
                              {Number.isFinite(lineCost)
                                ? formatMoney(lineCost.toFixed(2))
                                : "—"}
                            </TableCell>
                            {editable && (
                              <TableCell>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-red-600 hover:bg-red-50"
                                  onClick={() => handleDeleteLine(line.id)}
                                  disabled={deleteLine.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: 1/3 — summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Line count</span>
                <span className="tabular-nums">{bom.lines.length}</span>
              </div>
              <div className="flex justify-between pt-2 border-t">
                <span className="font-medium">Total Std Cost</span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(bom.totalStdCost)}
                </span>
              </div>
            </CardContent>
          </Card>

          {bom.status === "ACTIVE" && (
            <div className="flex items-start gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                This is the active BOM for {product?.name ?? "this product"}.
                New work orders will default to this version.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Add line dialog */}
      <Dialog open={lineDialogOpen} onOpenChange={setLineDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add BOM Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {lineError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {lineError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Component (Item)</Label>
              <Select
                value={formItemId}
                onValueChange={(v) => handleItemChange(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select item..." />
                </SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.sku} — {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedItem && (
                <p className="text-[11px] text-muted-foreground">
                  UoM: {selectedItem.uom}
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Qty / Unit</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={formQty}
                  onChange={(e) => setFormQty(e.target.value)}
                  placeholder="e.g. 2"
                />
              </div>
              <div className="space-y-1.5">
                <Label>UoM</Label>
                <Input
                  value={formUom}
                  onChange={(e) => setFormUom(e.target.value)}
                  placeholder="PCS"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit Cost</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={formUnitCost}
                  onChange={(e) => setFormUnitCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tracking</Label>
                <Select
                  value={formTracking}
                  onValueChange={(v) =>
                    setFormTracking((v ?? "NONE") as BomLineTrackingType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BOM_LINE_TRACKING_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Lead Time (days)</Label>
                <Input
                  type="number"
                  value={formLeadDays}
                  onChange={(e) => setFormLeadDays(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reference Designator</Label>
              <Input
                value={formRefDes}
                onChange={(e) => setFormRefDes(e.target.value)}
                placeholder="e.g. U1, R5"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="bom-line-critical"
                checked={formIsCritical}
                onCheckedChange={(v) => setFormIsCritical(v === true)}
              />
              <Label htmlFor="bom-line-critical" className="text-sm">
                Mark as critical component
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLineDialogOpen(false)}
              disabled={addLine.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleAddLine} disabled={addLine.isPending}>
              {addLine.isPending ? "Adding…" : "Add Line"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate dialog */}
      <Dialog open={activateDialogOpen} onOpenChange={setActivateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Activate BOM</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Promoting this BOM to <span className="font-medium">ACTIVE</span>{" "}
              will atomically supersede any prior active BOM for{" "}
              <span className="font-medium">{product?.name ?? "this product"}</span>{" "}
              and update its active-BOM pointer. The action is irreversible —
              you can only move forward by creating a new DRAFT version and
              activating that.
            </p>
            <div className="space-y-1.5">
              <Label>Effective From (optional)</Label>
              <Input
                type="date"
                value={activateEffectiveFrom}
                onChange={(e) => setActivateEffectiveFrom(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActivateDialogOpen(false)}
              disabled={activateBom.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleActivate}
              disabled={activateBom.isPending}
              className="gap-1"
            >
              <ShieldCheck className="h-4 w-4" />
              {activateBom.isPending ? "Activating…" : "Activate BOM"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Draft BOM</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Delete this DRAFT BOM? Lines will be removed too. This cannot be
            undone. (Active BOMs cannot be deleted — supersede instead.)
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleteBom.isPending}
            >
              Keep
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteBom}
              disabled={deleteBom.isPending}
            >
              {deleteBom.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
