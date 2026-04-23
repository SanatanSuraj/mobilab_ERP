"use client";

// TODO(phase-5): Reorder alerts module has no backend routes yet. Expected
// routes:
//   GET  /inventory/reorder-alerts - compute/return active reorder alerts
//   POST /inventory/reorder-alerts/:id/suppress
//   POST /inventory/reorder-alerts/:id/create-indent - fan-out to procurement
// Mock imports left in place until the reorder slice ships in
// apps/api/src/modules/inventory.

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  reorderAlerts,
  formatDate,
  ReorderAlert,
} from "@/data/inventory-mock";
import {
  AlertTriangle,
  AlertCircle,
  BellOff,
  Activity,
} from "lucide-react";

export default function ReorderPage() {
  const [alerts, setAlerts] = useState<ReorderAlert[]>([...reorderAlerts]);

  const active = alerts.filter((a) => !a.isSuppressed);
  const suppressed = alerts.filter((a) => a.isSuppressed);
  const critical = active.filter((a) => a.severity === "CRITICAL").length;
  const warning = active.filter((a) => a.severity === "WARNING").length;

  const lastChecked =
    alerts.length > 0
      ? formatDate(alerts[0].lastCheckedAt.split("T")[0])
      : "—";

  function handleCreateIndent(id: string) {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              indentCreated: true,
              indentNumber: `MLB-INDENT-2026-${String(Math.floor(Math.random() * 900) + 100)}`,
            }
          : a
      )
    );
  }

  function handleSuppress(id: string) {
    const until = new Date();
    until.setDate(until.getDate() + 14);
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              isSuppressed: true,
              suppressedUntil: until.toISOString().split("T")[0],
            }
          : a
      )
    );
  }

  function handleUnsuppress(id: string) {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, isSuppressed: false, suppressedUntil: undefined } : a
      )
    );
  }

  function getProgressValue(avail: number, reorderPoint: number): number {
    if (reorderPoint === 0) return 100;
    return Math.min(100, Math.round((avail / reorderPoint) * 100));
  }

  function getProgressColor(alert: ReorderAlert): string {
    if (alert.severity === "CRITICAL") return "bg-red-500";
    if (alert.availableQty <= alert.reorderPoint * 1.2) return "bg-amber-500";
    return "bg-green-500";
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Reorder Alerts"
        description="Real-time stock level monitoring — checked every 6 hours"
      />
      <p className="text-xs text-muted-foreground -mt-4 mb-6">
        Last checked: {lastChecked}
      </p>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Alerts"
          value={String(alerts.length)}
          icon={Activity}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Critical"
          value={String(critical)}
          icon={AlertCircle}
          iconColor="text-red-600"
        />
        <KPICard
          title="Warning"
          value={String(warning)}
          icon={AlertTriangle}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Suppressed"
          value={String(suppressed.length)}
          icon={BellOff}
          iconColor="text-gray-500"
        />
      </div>

      <Tabs defaultValue="active">
        <TabsList className="mb-4">
          <TabsTrigger value="active">
            Active Alerts ({active.length})
          </TabsTrigger>
          <TabsTrigger value="suppressed">
            Suppressed ({suppressed.length})
          </TabsTrigger>
        </TabsList>

        {/* Active Alerts */}
        <TabsContent value="active">
          <div className="space-y-3">
            {active.length === 0 && (
              <p className="text-muted-foreground text-sm py-8 text-center">
                No active alerts
              </p>
            )}
            {active.map((alert) => {
              const progressVal = getProgressValue(
                alert.availableQty,
                alert.reorderPoint
              );
              const progressColor = getProgressColor(alert);

              return (
                <Card key={alert.id} className="border-l-4 border-l-transparent" style={{
                  borderLeftColor: alert.severity === "CRITICAL" ? "#ef4444" : "#f59e0b",
                }}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      {/* Left section */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div
                          className={`mt-1 h-3 w-3 rounded-full flex-shrink-0 ${alert.severity === "CRITICAL" ? "bg-red-500" : "bg-amber-500"}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-semibold text-muted-foreground">
                              {alert.itemCode}
                            </span>
                            <span className="font-semibold text-sm">
                              {alert.itemName}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-xs bg-blue-50 text-blue-700 border-blue-200"
                            >
                              {alert.warehouseName}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-xs font-semibold ${alert.severity === "CRITICAL" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}
                            >
                              {alert.severity}
                            </Badge>
                          </div>

                          {/* Progress bar */}
                          <div className="mt-3 mb-2">
                            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                              <span>Stock Level</span>
                              <span>
                                {alert.availableQty} / {alert.reorderPoint} (reorder point)
                              </span>
                            </div>
                            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${progressColor}`}
                                style={{ width: `${progressVal}%` }}
                              />
                            </div>
                          </div>

                          {/* Stats */}
                          <div className="grid grid-cols-4 gap-4 mt-2">
                            <div>
                              <p className="text-xs text-muted-foreground">Available</p>
                              <p className="text-sm font-semibold">
                                {alert.availableQty}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Reorder Point</p>
                              <p className="text-sm font-semibold">
                                {alert.reorderPoint}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Safety Stock</p>
                              <p className="text-sm font-semibold">
                                {alert.safetyStock}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">To Order</p>
                              <p className="text-sm font-semibold text-blue-700">
                                {alert.reorderQty}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right section */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {alert.indentCreated ? (
                          <Badge
                            variant="outline"
                            className="bg-green-50 text-green-700 border-green-200 text-xs"
                          >
                            Indent: {alert.indentNumber}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-red-50 text-red-700 border-red-200 text-xs"
                          >
                            No Indent
                          </Badge>
                        )}
                        <div className="flex gap-2">
                          {!alert.indentCreated && (
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleCreateIndent(alert.id)}
                            >
                              Create Indent
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => handleSuppress(alert.id)}
                          >
                            Suppress
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Suppressed tab */}
        <TabsContent value="suppressed">
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Item</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">Available Qty</TableHead>
                  <TableHead>Suppressed Until</TableHead>
                  <TableHead>Indent Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppressed.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No suppressed alerts
                    </TableCell>
                  </TableRow>
                )}
                {suppressed.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{alert.itemName}</p>
                        <p className="text-xs font-mono text-muted-foreground">
                          {alert.itemCode}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-xs bg-blue-50 text-blue-700 border-blue-200"
                      >
                        {alert.warehouseName}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {alert.availableQty}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {alert.suppressedUntil
                        ? formatDate(alert.suppressedUntil)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {alert.indentCreated ? (
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-green-700 border-green-200 text-xs"
                        >
                          {alert.indentNumber ?? "Created"}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-red-50 text-red-700 border-red-200 text-xs"
                        >
                          No Indent
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => handleUnsuppress(alert.id)}
                      >
                        Unsuppress
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
