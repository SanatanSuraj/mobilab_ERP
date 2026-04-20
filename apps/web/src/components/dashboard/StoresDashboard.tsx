"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Boxes, AlertTriangle, Package, Clock } from "lucide-react";
import { reorderAlerts, grns, invBatches } from "@/data/inventory-mock";
import { formatDate } from "@/lib/format";

export function StoresDashboard() {
  const belowReorder = useMemo(
    () => reorderAlerts.filter((r) => !r.isSuppressed),
    []
  );

  // Derived from actual batch data — not a magic number constant
  const inQuarantine = useMemo(
    () => invBatches.filter((b) => b.status === "QUARANTINED").length,
    []
  );

  const pendingInward = useMemo(
    () =>
      grns.filter((g) => g.status === "DRAFT" || g.status === "PARTIALLY_QC")
        .length,
    []
  );

  // Derived from actual batch expiry data — not a magic number constant
  const expiring30d = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    return invBatches.filter(
      (b) =>
        b.expiryDate &&
        new Date(b.expiryDate) <= cutoff &&
        b.status === "ACTIVE"
    ).length;
  }, []);

  const recentGRNs = useMemo(
    () =>
      [...grns]
        .sort(
          (a, b) =>
            new Date(b.receivedDate).getTime() -
            new Date(a.receivedDate).getTime()
        )
        .slice(0, 3),
    []
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Below Reorder" value={String(belowReorder.length)} icon={Boxes} trend={belowReorder.length > 0 ? "down" : "up"} iconColor={belowReorder.length > 0 ? "text-red-600" : "text-green-600"} />
        <KPICard title="In Quarantine" value={String(inQuarantine)} icon={AlertTriangle} trend={inQuarantine > 0 ? "down" : "up"} iconColor={inQuarantine > 0 ? "text-amber-600" : "text-green-600"} />
        <KPICard title="Pending Inward" value={String(pendingInward)} icon={Package} trend="neutral" iconColor="text-blue-600" />
        <KPICard title="Expiring in 30d" value={String(expiring30d)} icon={Clock} trend={expiring30d > 0 ? "down" : "up"} iconColor={expiring30d > 0 ? "text-amber-600" : "text-green-600"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Below Reorder Level</CardTitle>
          </CardHeader>
          <CardContent>
            {belowReorder.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">All stock levels are healthy.</p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Item Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Reorder Pt</TableHead>
                      <TableHead>Severity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {belowReorder.map((alert) => (
                      <TableRow key={alert.id}>
                        <TableCell className="font-mono text-xs">{alert.itemCode}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                          {alert.itemName}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums text-red-600">
                          {alert.availableQty}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {alert.reorderPoint}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={alert.severity} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Recent GRNs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentGRNs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No recent GRNs.</p>
            ) : (
              recentGRNs.map((grn) => (
                <div key={grn.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="text-sm font-medium">{grn.grnNumber}</p>
                    <p className="text-xs text-muted-foreground">{grn.vendorName}</p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={grn.status} />
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(grn.receivedDate)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
