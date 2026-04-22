"use client";

/**
 * Warehouses — reads /inventory/warehouses + /inventory/stock/summary.
 *
 * Two sections:
 *   1. A card per warehouse with code/kind/city + per-warehouse stock totals
 *      derived from the summary projection.
 *   2. A combined stock table pivoted by warehouse — "what's on hand where".
 *
 * Zone configuration from the mock is NOT reflected — our Phase 2 schema
 * has no zone concept. When Phase 3 adds zones, the card grows a Zones
 * panel and this page becomes the surface for that.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useApiCreateWarehouse,
  useApiStockSummary,
  useApiWarehouses,
} from "@/hooks/useInventoryApi";
import {
  WAREHOUSE_KINDS,
  type StockSummaryRow,
  type Warehouse,
  type WarehouseKind,
} from "@instigenie/contracts";
import { AlertCircle, Building2, MapPin, Plus } from "lucide-react";

function parseQty(q: string | null | undefined): number {
  if (!q) return 0;
  const n = Number(q);
  return Number.isFinite(n) ? n : 0;
}

const KIND_TONES: Record<WarehouseKind, string> = {
  PRIMARY: "bg-blue-50 text-blue-700 border-blue-200",
  SECONDARY: "bg-slate-50 text-slate-700 border-slate-200",
  QUARANTINE: "bg-amber-50 text-amber-700 border-amber-200",
  SCRAP: "bg-red-50 text-red-700 border-red-200",
  VIRTUAL: "bg-purple-50 text-purple-700 border-purple-200",
};

function WarehouseCard({
  warehouse,
  summaries,
}: {
  warehouse: Warehouse;
  summaries: StockSummaryRow[];
}) {
  const own = summaries.filter((s) => s.warehouseId === warehouse.id);
  const totalSkus = own.length;
  const totalUnits = own.reduce((acc, s) => acc + parseQty(s.onHand), 0);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-muted/50">
              <Building2 className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">{warehouse.name}</CardTitle>
              <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {warehouse.city ?? "—"}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant="outline"
              className={`text-xs ${KIND_TONES[warehouse.kind]}`}
            >
              {warehouse.kind}
            </Badge>
            {warehouse.isDefault && (
              <Badge
                variant="outline"
                className="text-[10px] bg-blue-50 text-blue-700 border-blue-200"
              >
                Default
              </Badge>
            )}
          </div>
        </div>
        <div className="mt-2 space-y-0.5">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Code:</span>{" "}
            {warehouse.code}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Postal:</span>{" "}
            {warehouse.postalCode ?? "—"}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Stock Summary
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-bold">{totalSkus}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                SKUs Stocked
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-center">
              <p className="text-lg font-bold">
                {totalUnits.toLocaleString("en-IN")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Total Units
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WarehousesPage() {
  const warehousesQuery = useApiWarehouses({ limit: 100 });
  const summaryQuery = useApiStockSummary({ limit: 500 });
  const createWh = useApiCreateWarehouse();

  // Create dialog state.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WarehouseKind>("PRIMARY");
  const [city, setCity] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Build a pivot of (itemId → warehouseId → onHand) for the combined table.
  const pivot = useMemo(() => {
    const byItem = new Map<
      string,
      {
        sku: string;
        name: string;
        uom: string;
        per: Map<string, number>;
        total: number;
      }
    >();
    for (const s of summaryQuery.data?.data ?? []) {
      const existing = byItem.get(s.itemId) ?? {
        sku: s.itemSku,
        name: s.itemName,
        uom: s.itemUom,
        per: new Map<string, number>(),
        total: 0,
      };
      const onHand = parseQty(s.onHand);
      existing.per.set(s.warehouseId, onHand);
      existing.total += onHand;
      byItem.set(s.itemId, existing);
    }
    return [...byItem.entries()]
      .map(([itemId, v]) => ({ itemId, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [summaryQuery.data]);

  async function handleSave(): Promise<void> {
    setSaveError(null);
    try {
      await createWh.mutateAsync({
        code: code.trim(),
        name: name.trim(),
        kind,
        city: city.trim() || undefined,
        // Zod defaults these server-side; TS still wants them because
        // z.infer<> produces the post-parse OUTPUT type.
        country: "IN",
        isDefault: false,
        isActive: true,
      });
      setDialogOpen(false);
      setCode("");
      setName("");
      setKind("PRIMARY");
      setCity("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  if (warehousesQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (warehousesQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load warehouses</p>
            <p className="text-red-700 mt-1">
              {warehousesQuery.error instanceof Error
                ? warehousesQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const warehouses = warehousesQuery.data?.data ?? [];
  const summaries = summaryQuery.data?.data ?? [];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Warehouses"
        description="Manage physical storage locations across your organisation"
        actions={
          <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Warehouse
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {warehouses.map((wh) => (
          <WarehouseCard key={wh.id} warehouse={wh} summaries={summaries} />
        ))}
        {warehouses.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No warehouses yet. Create one to start posting stock.
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mb-3">
        <h2 className="text-base font-semibold">Combined Stock by Warehouse</h2>
        <p className="text-sm text-muted-foreground">
          On-hand quantities pivoted across every warehouse, sorted by total
          available.
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-36">SKU</TableHead>
              <TableHead className="min-w-[200px]">Item Name</TableHead>
              {warehouses.map((w) => (
                <TableHead key={w.id} className="text-right">
                  {w.code}
                </TableHead>
              ))}
              <TableHead className="text-right font-semibold">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pivot.map((row) => (
              <TableRow key={row.itemId} className="hover:bg-muted/30">
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.sku}
                  </span>
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium leading-tight">
                    {row.name}
                  </p>
                </TableCell>
                {warehouses.map((w) => {
                  const q = row.per.get(w.id) ?? 0;
                  return (
                    <TableCell key={w.id} className="text-right">
                      <span
                        className={`text-sm font-semibold ${
                          q === 0 ? "text-muted-foreground" : "text-foreground"
                        }`}
                      >
                        {q.toLocaleString("en-IN")}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        {row.uom}
                      </span>
                    </TableCell>
                  );
                })}
                <TableCell className="text-right">
                  <span
                    className={`text-sm font-bold ${
                      row.total === 0
                        ? "text-red-600"
                        : row.total < 10
                          ? "text-amber-600"
                          : "text-green-700"
                    }`}
                  >
                    {row.total.toLocaleString("en-IN")}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    {row.uom}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {pivot.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={3 + warehouses.length}
                  className="text-center py-8 text-muted-foreground"
                >
                  No stock data available.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Warehouse</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {saveError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Code</label>
                <Input
                  placeholder="WH-003"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Kind</label>
                <Select
                  value={kind}
                  onValueChange={(v) =>
                    setKind((v ?? "PRIMARY") as WarehouseKind)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WAREHOUSE_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="R&D Lab Store"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">City</label>
              <Input
                placeholder="Bengaluru"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createWh.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createWh.isPending || !code.trim() || !name.trim()}
            >
              {createWh.isPending ? "Saving…" : "Save Warehouse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
