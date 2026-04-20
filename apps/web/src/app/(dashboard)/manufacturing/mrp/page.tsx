"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import {
  enhancedWorkOrders,
  boms,
  formatCurrency,
  formatDate,
  isWOOverdue,
  MRPLine,
  EnhancedWorkOrder,
} from "@/data/manufacturing-mock";
import { indents } from "@/data/procurement-mock";
import {
  Factory,
  CheckCircle2,
  AlertTriangle,
  FileText,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Users,
  Calendar,
  TrendingUp,
  Package,
} from "lucide-react";

// ── Static mock data for Capacity tab ────────────────────────────────────────
const capacityData = [
  { name: "Assembly Line A", utilization: 82, color: "bg-blue-500" },
  { name: "Assembly Line B", utilization: 65, color: "bg-emerald-500" },
  { name: "Mixing Station", utilization: 91, color: "bg-amber-500" },
  { name: "Packaging Unit", utilization: 45, color: "bg-violet-500" },
  { name: "QC Lab", utilization: 58, color: "bg-rose-500" },
];

// ── Static demand forecast data ───────────────────────────────────────────────
const pipelineDemand = [
  {
    product: "Hematology Analyzer HA-500",
    expectedQty: 5,
    dealStage: "Negotiation",
    expectedOrderDate: "2026-05-15",
    estimatedWODate: "2026-05-18",
    leadTimeRisk: "HIGH",
  },
  {
    product: "Biochemistry Analyzer BA-200",
    expectedQty: 2,
    dealStage: "Proposal",
    expectedOrderDate: "2026-06-01",
    estimatedWODate: "2026-06-05",
    leadTimeRisk: "MEDIUM",
  },
  {
    product: "CBL Glucometer Strip GS-300",
    expectedQty: 10,
    dealStage: "Qualified",
    expectedOrderDate: "2026-05-30",
    estimatedWODate: "2026-06-02",
    leadTimeRisk: "LOW",
  },
  {
    product: "CBC Reagent Lot 500T",
    expectedQty: 50,
    dealStage: "Discovery",
    expectedOrderDate: "2026-06-20",
    estimatedWODate: "2026-06-22",
    leadTimeRisk: "LOW",
  },
];

const reorderCoverage = [
  { itemCode: "MLB-ITM-0005", itemName: "PCB Assembly - HA500 Main Board", currentStock: 25, monthlyConsumption: 12, coverageMonths: 2.1, reorderQty: 20, status: "AT_RISK" },
  { itemCode: "MLB-ITM-0006", itemName: "Flow Cell Sensor - Precision Grade", currentStock: 13, monthlyConsumption: 8, coverageMonths: 1.6, reorderQty: 15, status: "CRITICAL" },
  { itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame - BA200", currentStock: 5, monthlyConsumption: 4, coverageMonths: 1.25, reorderQty: 12, status: "CRITICAL" },
  { itemCode: "MLB-ITM-0003", itemName: "CBC Reagent Kit - 500 Tests", currentStock: 140, monthlyConsumption: 35, coverageMonths: 4.0, reorderQty: 0, status: "OK" },
];

// ── Collapsible WO MRP Card ───────────────────────────────────────────────────
function WOMRPCard({ wo }: { wo: EnhancedWorkOrder }) {
  const [expanded, setExpanded] = useState(false);
  const shortfalls = wo.mrpLines.filter((l) => l.qtyShortfall > 0);
  const overdue = isWOOverdue(wo);

  return (
    <Card className="overflow-hidden">
      <button
        className="w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-mono font-bold text-sm">{wo.pid}</span>
          <span className="text-sm font-medium flex-1 truncate">{wo.productName}</span>
          <StatusBadge status={wo.status} />
          <span className={`text-xs ${overdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
            {overdue && <AlertTriangle className="h-3 w-3 inline mr-0.5" />}
            {formatDate(wo.targetDate)}
          </span>
          {shortfalls.length > 0 ? (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {shortfalls.length} shortfall{shortfalls.length > 1 ? "s" : ""}
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              All OK
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead>Item Code</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead className="text-right">Required</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Shortfall</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reserved Batch</TableHead>
                  <TableHead>Indent #</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wo.mrpLines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-4 text-muted-foreground text-sm">
                      No MRP lines
                    </TableCell>
                  </TableRow>
                ) : (
                  wo.mrpLines.map((line) => (
                    <TableRow key={line.itemId} className={line.qtyShortfall > 0 ? "bg-red-50/40" : ""}>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{line.itemCode}</span>
                      </TableCell>
                      <TableCell className="text-sm">{line.itemName}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{line.qtyRequired}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{line.qtyAvailable}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {line.qtyShortfall > 0 ? (
                          <span className="text-red-600 font-semibold">{line.qtyShortfall}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell><StatusBadge status={line.status} /></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {line.reservedBatch ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {line.indentNumber ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground">
            {shortfalls.length === 0 ? (
              <span className="text-green-700 font-medium">
                <CheckCircle2 className="h-3 w-3 inline mr-1" />
                MRP Status: All materials OK
              </span>
            ) : (
              <span className="text-red-600 font-medium">
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                MRP Status: {shortfalls.length} shortfall{shortfalls.length > 1 ? "s" : ""} — indents auto-created
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MRPPage() {
  const [tab, setTab] = useState("mrp");
  const [lastRunTime, setLastRunTime] = useState<string | null>(null);

  const openWOs = useMemo(
    () => enhancedWorkOrders.filter((wo) => wo.status !== "COMPLETED" && wo.status !== "CANCELLED"),
    []
  );

  const totalOpenWOs = openWOs.length;

  // Aggregate shortfalls
  const aggregateShortfalls = useMemo(() => {
    const map = new Map<string, { itemCode: string; itemName: string; totalShortfall: number; woPids: string[] }>();
    for (const wo of openWOs) {
      for (const line of wo.mrpLines) {
        if (line.qtyShortfall > 0) {
          const existing = map.get(line.itemId) ?? { itemCode: line.itemCode, itemName: line.itemName, totalShortfall: 0, woPids: [] };
          existing.totalShortfall += line.qtyShortfall;
          existing.woPids.push(wo.pid);
          map.set(line.itemId, existing);
        }
      }
    }
    return Array.from(map.values());
  }, [openWOs]);

  const materialsFullyCovered = openWOs.filter((wo) =>
    wo.mrpLines.every((l) => l.qtyShortfall === 0)
  ).length;

  const shortfallsDetected = openWOs.filter((wo) =>
    wo.mrpLines.some((l) => l.qtyShortfall > 0)
  ).length;

  const pendingIndents = indents.filter(
    (i) => i.status === "SUBMITTED" || i.status === "APPROVED"
  ).length;

  // Capacity tab helpers
  const avgCapacity = Math.round(capacityData.reduce((s, c) => s + c.utilization, 0) / capacityData.length);

  // Workload by stage
  const stageWOCounts = useMemo(() => {
    const stageMap = new Map<string, number>();
    for (const wo of openWOs) {
      const currentStage = wo.wipStages[wo.currentStageIndex];
      if (currentStage) {
        stageMap.set(currentStage.stageName, (stageMap.get(currentStage.stageName) ?? 0) + 1);
      }
    }
    return Array.from(stageMap.entries()).map(([name, count]) => ({ name, count }));
  }, [openWOs]);

  // Workload by person
  const workloadByPerson = useMemo(() => {
    const personMap = new Map<string, { activePIDs: string[]; totalUnits: number; earliestOverdue: string | null }>();
    for (const wo of openWOs) {
      const entry = personMap.get(wo.assignedTo) ?? { activePIDs: [], totalUnits: 0, earliestOverdue: null };
      entry.activePIDs.push(wo.pid);
      entry.totalUnits += wo.quantity;
      if (isWOOverdue(wo)) {
        if (!entry.earliestOverdue || wo.targetDate < entry.earliestOverdue) {
          entry.earliestOverdue = wo.targetDate;
        }
      }
      personMap.set(wo.assignedTo, entry);
    }
    return Array.from(personMap.entries()).map(([name, data]) => ({ name, ...data }));
  }, [openWOs]);

  // Upcoming completions in next 14 days
  const today = new Date();
  const in14Days = new Date(today);
  in14Days.setDate(today.getDate() + 14);

  const upcomingCompletions = openWOs
    .filter((wo) => {
      const target = new Date(wo.targetDate);
      return target >= today && target <= in14Days;
    })
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));

  // Draft BOMs for "Upcoming BOM Changes"
  const draftBOMs = boms.filter((b) => b.status === "DRAFT");

  function handleRunMRP() {
    setLastRunTime(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="MRP & Production Planning"
        description="Material requirements planning and capacity overview"
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v ?? "mrp")}>
        <TabsList>
          <TabsTrigger value="mrp">MRP Summary</TabsTrigger>
          <TabsTrigger value="capacity">Capacity & Workload</TabsTrigger>
          <TabsTrigger value="forecast">Demand Forecast</TabsTrigger>
        </TabsList>

        {/* ── MRP Summary Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="mrp" className="space-y-6 mt-4">
          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              title="Total Open WOs"
              value={String(totalOpenWOs)}
              icon={Factory}
              iconColor="text-blue-600"
              change="Not completed/cancelled"
              trend="neutral"
            />
            <KPICard
              title="Materials Fully Covered"
              value={String(materialsFullyCovered)}
              icon={CheckCircle2}
              iconColor="text-green-600"
              change="No shortfalls"
              trend="up"
            />
            <KPICard
              title="Shortfalls Detected"
              value={String(shortfallsDetected)}
              icon={AlertTriangle}
              iconColor="text-red-600"
              change={shortfallsDetected > 0 ? "Action required" : "All clear"}
              trend={shortfallsDetected > 0 ? "down" : "up"}
            />
            <KPICard
              title="Pending Indents"
              value={String(pendingIndents)}
              icon={FileText}
              iconColor="text-amber-600"
              change="Submitted / Approved"
              trend="neutral"
            />
          </div>

          {/* Run MRP Button */}
          <div className="flex items-center gap-4">
            <Button onClick={handleRunMRP} className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Run MRP
            </Button>
            {lastRunTime && (
              <span className="text-sm text-muted-foreground">
                MRP recalculated at <span className="font-mono font-medium">{lastRunTime}</span>
              </span>
            )}
          </div>

          {/* Aggregate Shortfall Summary */}
          {aggregateShortfalls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  Aggregate Shortfalls
                </CardTitle>
                <CardDescription>All unique items with shortfall across open work orders</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-red-50/60 hover:bg-red-50/60">
                      <TableHead>Item Code</TableHead>
                      <TableHead>Item Name</TableHead>
                      <TableHead className="text-right">Total Shortfall</TableHead>
                      <TableHead>Affected PIDs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aggregateShortfalls.map((row) => (
                      <TableRow key={row.itemCode} className="bg-red-50/20">
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">{row.itemCode}</span>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{row.itemName}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-600 font-bold">
                          {row.totalShortfall}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {row.woPids.map((pid) => (
                              <Badge key={pid} variant="outline" className="font-mono text-xs">
                                {pid}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Per-WO MRP Cards */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Open Work Orders — MRP Detail
            </h2>
            {openWOs.map((wo) => (
              <WOMRPCard key={wo.id} wo={wo} />
            ))}
            {openWOs.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No open work orders
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Capacity & Workload Tab ──────────────────────────────────────────── */}
        <TabsContent value="capacity" className="space-y-6 mt-4">
          {/* Capacity Bars */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Capacity Utilization</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {capacityData.map((line) => (
                  <div key={line.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground font-medium">{line.name}</span>
                      <span className={`tabular-nums font-semibold ${line.utilization >= 85 ? "text-red-600" : line.utilization >= 70 ? "text-amber-600" : "text-green-600"}`}>
                        {line.utilization}%
                      </span>
                    </div>
                    <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${line.color}`}
                        style={{ width: `${line.utilization}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Separator className="my-4" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Average Utilization</span>
                <span className="font-semibold">{avgCapacity}%</span>
              </div>
            </CardContent>
          </Card>

          {/* Work Orders by Stage — horizontal bar chart */}
          {stageWOCounts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Work Orders by Current Stage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stageWOCounts.map((row) => (
                    <div key={row.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{row.name}</span>
                        <span className="font-semibold tabular-nums">{row.count} WO{row.count !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${(row.count / openWOs.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Workload by Person */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Workload by Person
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Assignee</TableHead>
                    <TableHead className="text-right">Active WOs</TableHead>
                    <TableHead className="text-right">Total Units</TableHead>
                    <TableHead>Earliest Overdue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workloadByPerson.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                            {row.name.charAt(0)}
                          </div>
                          <span className="font-medium text-sm">{row.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.activePIDs.length}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.totalUnits}</TableCell>
                      <TableCell>
                        {row.earliestOverdue ? (
                          <span className="text-red-600 text-sm font-medium flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {formatDate(row.earliestOverdue)}
                          </span>
                        ) : (
                          <span className="text-green-600 text-sm">On track</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {workloadByPerson.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                        No active work orders
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Upcoming Completions (next 14 days) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Upcoming Completions — Next 14 Days
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>PID</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Target Date</TableHead>
                    <TableHead>Assigned To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingCompletions.map((wo) => (
                    <TableRow key={wo.id}>
                      <TableCell>
                        <span className="font-mono font-bold text-sm">{wo.pid}</span>
                      </TableCell>
                      <TableCell className="text-sm">{wo.productName}</TableCell>
                      <TableCell><StatusBadge status={wo.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{wo.quantity}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(wo.targetDate)}</TableCell>
                      <TableCell className="text-sm">{wo.assignedTo}</TableCell>
                    </TableRow>
                  ))}
                  {upcomingCompletions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                        No completions expected in the next 14 days
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Demand Forecast Tab ──────────────────────────────────────────────── */}
        <TabsContent value="forecast" className="space-y-6 mt-4">
          {/* Pipeline Demand */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Pipeline Demand
              </CardTitle>
              <CardDescription>
                Expected work orders from CRM pipeline deals
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Expected Qty</TableHead>
                    <TableHead>Deal Stage</TableHead>
                    <TableHead>Expected Order Date</TableHead>
                    <TableHead>Est. WO Date</TableHead>
                    <TableHead>Lead Time Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pipelineDemand.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium text-sm">{row.product}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{row.expectedQty}</TableCell>
                      <TableCell><StatusBadge status={row.dealStage.toLowerCase()} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(row.expectedOrderDate)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(row.estimatedWODate)}</TableCell>
                      <TableCell>
                        {row.leadTimeRisk === "HIGH" ? (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs font-semibold">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            HIGH RISK
                          </Badge>
                        ) : row.leadTimeRisk === "MEDIUM" ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                            MEDIUM
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                            LOW
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Reorder Coverage */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Reorder Coverage
              </CardTitle>
              <CardDescription>
                Items where current stock is below 3 months projected consumption
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Item Code</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Monthly Usage</TableHead>
                    <TableHead>Coverage</TableHead>
                    <TableHead className="text-right">Reorder Qty</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reorderCoverage.map((row) => {
                    const pct = Math.min((row.coverageMonths / 3) * 100, 100);
                    return (
                      <TableRow key={row.itemCode} className={row.status === "CRITICAL" ? "bg-red-50/30" : row.status === "AT_RISK" ? "bg-amber-50/30" : ""}>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">{row.itemCode}</span>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{row.itemName}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.currentStock}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.monthlyConsumption}/mo</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 w-40">
                            <Progress
                              value={pct}
                              className={`h-2 flex-1 ${row.status === "CRITICAL" ? "[&>div]:bg-red-500" : row.status === "AT_RISK" ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500"}`}
                            />
                            <span className="text-xs tabular-nums text-muted-foreground w-12 text-right">
                              {row.coverageMonths.toFixed(1)} mo
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {row.reorderQty > 0 ? <span className="font-semibold text-red-600">{row.reorderQty}</span> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {row.status === "CRITICAL" ? (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">Critical</Badge>
                          ) : row.status === "AT_RISK" ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">At Risk</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Upcoming BOM Changes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Upcoming BOM Changes
              </CardTitle>
              <CardDescription>
                BOMs in DRAFT status that may affect future production
              </CardDescription>
            </CardHeader>
            <CardContent>
              {draftBOMs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No draft BOMs pending. All BOMs are active or superseded.
                </p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead>Product</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created By</TableHead>
                        <TableHead>Approved By</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {draftBOMs.map((bom) => (
                        <TableRow key={bom.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{bom.productName}</p>
                              <p className="font-mono text-xs text-muted-foreground">{bom.productCode}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono font-bold">{bom.version}</Badge>
                          </TableCell>
                          <TableCell><StatusBadge status={bom.status} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{bom.createdBy}</TableCell>
                          <TableCell>
                            {bom.approvedBy ? (
                              <span className="text-sm">{bom.approvedBy}</span>
                            ) : (
                              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                                Pending
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                            {bom.notes ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
