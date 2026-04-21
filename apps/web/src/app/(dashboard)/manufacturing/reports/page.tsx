"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  enhancedWorkOrders,
  EnhancedWorkOrder,
  formatDate,
  getWOProgress,
  isWOOverdue,
  getCompletedStages,
} from "@/data/manufacturing-mock";
import {
  BarChart2,
  CheckCircle2,
  Loader2,
  XCircle,
  AlertTriangle,
  Search,
  GitBranch,
  Package,
  Truck,
  Factory,
  ShieldCheck,
  Clock,
} from "lucide-react";

// ─── Computed Data ────────────────────────────────────────────────────────────

const FAMILIES = [
  {
    key: "MOBILAB_INSTRUMENT",
    label: "Mobilab Instruments",
    color: "bg-blue-500",
    cardBg: "bg-blue-50 border-blue-200",
    textColor: "text-blue-700",
    cycleDays: 8,
    onTimeRate: 82,
  },
  {
    key: "CBL_DEVICE",
    label: "CBL Devices",
    color: "bg-purple-500",
    cardBg: "bg-purple-50 border-purple-200",
    textColor: "text-purple-700",
    cycleDays: 6,
    onTimeRate: 90,
  },
  {
    key: "REAGENT",
    label: "Reagents",
    color: "bg-teal-500",
    cardBg: "bg-teal-50 border-teal-200",
    textColor: "text-teal-700",
    cycleDays: 4,
    onTimeRate: 95,
  },
] as const;

const MONTHLY_OUTPUT = [
  {
    month: "Feb 2026",
    planned: 18,
    completed: 15,
    onTimeRate: "83%",
    reworkRate: "11%",
  },
  {
    month: "Mar 2026",
    planned: 22,
    completed: 20,
    onTimeRate: "90%",
    reworkRate: "8%",
  },
  {
    month: "Apr 2026",
    planned: 20,
    completed: 8,
    onTimeRate: "75%",
    reworkRate: "13%",
  },
];

// Note: MBA-* serials are Module Serials (Analyser sub-assembly). MCC-* would be
// Device Serials (finished Mobicase). MLB-BAT-* are batch numbers.
const RECENT_TRACES = [
  {
    serial: "MBA-2026-0091",
    type: "Module Serial",
    queriedAt: "17 Apr 2026, 09:12",
    queriedBy: "Ranjit Bora",
    result: "Full chain resolved",
  },
  {
    serial: "MLB-BAT-2026-005",
    type: "Batch Number",
    queriedAt: "16 Apr 2026, 16:43",
    queriedBy: "Dr. Sunit Bhuyan",
    result: "3 WOs, 2 vendors",
  },
  {
    serial: "MBA-2026-0101",
    type: "Module Serial",
    queriedAt: "16 Apr 2026, 11:30",
    queriedBy: "Vikram Nair",
    result: "Full chain resolved",
  },
  {
    serial: "MLB-BAT-2026-SEN-RECALL",
    type: "Batch Number",
    queriedAt: "15 Apr 2026, 17:05",
    queriedBy: "Dr. Sunit Bhuyan",
    result: "Recall batch — 1 WO affected",
  },
  {
    serial: "MBA-2026-0201",
    type: "Module Serial",
    queriedAt: "14 Apr 2026, 10:22",
    queriedBy: "Priya Devi",
    result: "QC hold — rework ongoing",
  },
];

// Top products by qty
const TOP_PRODUCTS = enhancedWorkOrders
  .reduce(
    (acc, wo) => {
      const existing = acc.find((p) => p.productCode === wo.productCode);
      if (existing) {
        existing.qty += wo.quantity;
      } else {
        acc.push({
          productCode: wo.productCode,
          productName: wo.productName,
          qty: wo.quantity,
        });
      }
      return acc;
    },
    [] as { productCode: string; productName: string; qty: number }[]
  )
  .sort((a, b) => b.qty - a.qty);

const maxQty = Math.max(...TOP_PRODUCTS.map((p) => p.qty));

// ─── Production Summary Tab ───────────────────────────────────────────────────

function ProductionSummaryTab() {
  const total = enhancedWorkOrders.length;
  const completed = enhancedWorkOrders.filter(
    (w) => w.status === "COMPLETED"
  ).length;
  const inProgress = enhancedWorkOrders.filter(
    (w) =>
      w.status === "IN_PROGRESS" ||
      w.status === "QC_HOLD" ||
      w.status === "REWORK" ||
      w.status === "MATERIAL_CHECK"
  ).length;
  const cancelled = enhancedWorkOrders.filter(
    (w) => w.status === "CANCELLED"
  ).length;

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard
          title="Total Work Orders"
          value={String(total)}
          icon={BarChart2}
          iconColor="text-primary"
        />
        <KPICard
          title="Completed"
          value={String(completed)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="In Progress"
          value={String(inProgress)}
          icon={Loader2}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Cancelled"
          value={String(cancelled)}
          icon={XCircle}
          iconColor="text-gray-500"
        />
      </div>

      {/* Production by Family */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-foreground">
          Production by Product Family
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FAMILIES.map((fam) => {
            const famWOs = enhancedWorkOrders.filter(
              (w) => w.productFamily === fam.key
            );
            const famCompleted = famWOs.filter(
              (w) => w.status === "COMPLETED"
            ).length;
            const totalUnits = famWOs.reduce((s, w) => s + w.quantity, 0);
            const completedUnits = famWOs
              .filter((w) => w.status === "COMPLETED")
              .reduce((s, w) => s + w.quantity, 0);

            return (
              <Card
                key={fam.key}
                className={`border ${fam.cardBg}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className={`text-sm font-semibold ${fam.textColor}`}>
                    {fam.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span className="text-muted-foreground">Work Orders</span>
                    <span className="font-semibold tabular-nums">
                      {famWOs.length}
                    </span>
                    <span className="text-muted-foreground">Total Units</span>
                    <span className="font-semibold tabular-nums">
                      {totalUnits}
                    </span>
                    <span className="text-muted-foreground">Completed Units</span>
                    <span className="font-semibold tabular-nums">
                      {completedUnits}
                    </span>
                    <span className="text-muted-foreground">Avg Cycle Days</span>
                    <span className="font-semibold tabular-nums">
                      {fam.cycleDays}d
                    </span>
                    <span className="text-muted-foreground">On-Time Rate</span>
                    <span className={`font-semibold tabular-nums ${fam.textColor}`}>
                      {fam.onTimeRate}%
                    </span>
                  </div>
                  <Progress
                    value={
                      famWOs.length > 0
                        ? Math.round((famCompleted / famWOs.length) * 100)
                        : 0
                    }
                    className="h-1.5 mt-2"
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Monthly Output */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Monthly Output</CardTitle>
          <CardDescription>Last 3 months production summary</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Units Planned</TableHead>
                <TableHead className="text-right">Units Completed</TableHead>
                <TableHead className="text-right">On-Time Rate</TableHead>
                <TableHead className="text-right">Rework Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MONTHLY_OUTPUT.map((row) => (
                <TableRow key={row.month}>
                  <TableCell className="font-medium">{row.month}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.planned}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.completed}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-green-700 font-medium">
                    {row.onTimeRate}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700 font-medium">
                    {row.reworkRate}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Top Products by Volume */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            Top Products by Volume
          </CardTitle>
          <CardDescription>
            Total units across all work orders
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TOP_PRODUCTS.map((p) => (
            <div key={p.productCode} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{p.productName}</span>
                <span className="tabular-nums text-muted-foreground font-semibold">
                  {p.qty} units
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className="bg-primary h-2.5 rounded-full transition-all"
                  style={{ width: `${Math.round((p.qty / maxQty) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Work Order Analysis Tab ──────────────────────────────────────────────────

function WorkOrderAnalysisTab() {
  const completed = enhancedWorkOrders.filter(
    (w) => w.status === "COMPLETED"
  );
  const onTimeCompleted = completed.filter(
    (w) =>
      w.completedAt &&
      new Date(w.completedAt) <= new Date(w.targetDate)
  ).length;
  const onTimeRate =
    completed.length > 0
      ? Math.round((onTimeCompleted / completed.length) * 100)
      : 0;
  const overdueCount = enhancedWorkOrders.filter(isWOOverdue).length;

  const columns: Column<EnhancedWorkOrder>[] = [
    {
      key: "pid",
      header: "PID",
      sortable: true,
      render: (w) => (
        <span className="font-mono font-bold text-sm">{w.pid}</span>
      ),
    },
    {
      key: "productName",
      header: "Product",
      render: (w) => (
        <div>
          <p className="font-medium text-sm leading-tight">{w.productName}</p>
          <p className="text-xs text-muted-foreground">{w.productCode}</p>
        </div>
      ),
    },
    {
      key: "productFamily",
      header: "Family",
      render: (w) => <StatusBadge status={w.productFamily} />,
    },
    {
      key: "quantity",
      header: "Qty",
      sortable: true,
      className: "text-right",
      render: (w) => (
        <span className="tabular-nums font-semibold">{w.quantity}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (w) => <StatusBadge status={w.status} />,
    },
    {
      key: "priority",
      header: "Priority",
      render: (w) => <StatusBadge status={w.priority} />,
    },
    {
      key: "targetDate",
      header: "Target Date",
      sortable: true,
      render: (w) => (
        <span
          className={`text-sm tabular-nums ${
            isWOOverdue(w) ? "text-red-600 font-semibold" : ""
          }`}
        >
          {formatDate(w.targetDate)}
          {isWOOverdue(w) && (
            <span className="ml-1 text-[10px] bg-red-50 text-red-600 border border-red-200 rounded px-1">
              OVERDUE
            </span>
          )}
        </span>
      ),
    },
    {
      key: "completedAt",
      header: "Completed",
      render: (w) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {w.completedAt ? formatDate(w.completedAt) : "—"}
        </span>
      ),
    },
    {
      key: "currentStageIndex",
      header: "Progress",
      render: (w) => {
        const pct = getWOProgress(w);
        return (
          <div className="space-y-1 min-w-[80px]">
            <span className="text-xs text-muted-foreground">{pct}%</span>
            <Progress value={pct} className="h-1.5" />
          </div>
        );
      },
    },
    {
      key: "reworkCount",
      header: "Rework",
      render: (w) => (
        <span
          className={`text-sm tabular-nums font-semibold ${
            w.reworkCount > 0 ? "text-orange-600" : "text-muted-foreground"
          }`}
        >
          {w.reworkCount}
        </span>
      ),
    },
    {
      key: "assignedTo",
      header: "Assigned To",
      render: (w) => (
        <span className="text-sm text-muted-foreground">{w.assignedTo}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <KPICard
          title="Avg Completion Time"
          value="21 days"
          icon={Clock}
          iconColor="text-blue-600"
        />
        <KPICard
          title="On-Time Completion Rate"
          value={`${onTimeRate}%`}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Overdue WOs"
          value={String(overdueCount)}
          icon={AlertTriangle}
          iconColor="text-red-600"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            All Work Orders ({enhancedWorkOrders.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            data={enhancedWorkOrders}
            columns={columns}
            searchKey="pid"
            searchPlaceholder="Search by PID..."
            pageSize={10}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Quality & Rework Tab ─────────────────────────────────────────────────────

function QualityReworkTab() {
  // Aggregate rework
  const totalReworkEvents = enhancedWorkOrders.reduce(
    (s, w) => s + w.reworkCount,
    0
  );
  const wosWithRework = enhancedWorkOrders.filter(
    (w) => w.reworkCount > 0
  ).length;
  const avgReworkPerWO =
    enhancedWorkOrders.length > 0
      ? (totalReworkEvents / enhancedWorkOrders.length).toFixed(2)
      : "0";

  // QC stage pass rate
  const allQCStages = enhancedWorkOrders.flatMap((w) =>
    w.wipStages.filter((s) => s.requiresQCSignOff && s.qcResult)
  );
  const qcPass = allQCStages.filter((s) => s.qcResult === "PASS").length;
  const qcPassRate =
    allQCStages.length > 0
      ? Math.round((qcPass / allQCStages.length) * 100)
      : 0;

  // Rework by family
  const reworkByFamily = FAMILIES.map((fam) => {
    const famWOs = enhancedWorkOrders.filter(
      (w) => w.productFamily === fam.key
    );
    const reworkCount = famWOs.reduce((s, w) => s + w.reworkCount, 0);
    const rate =
      famWOs.length > 0
        ? ((reworkCount / famWOs.length) * 100).toFixed(0)
        : "0";
    return { ...fam, reworkCount, rate, woCount: famWOs.length };
  });

  // QC gate performance
  const qcGates = enhancedWorkOrders
    .flatMap((w) => w.wipStages.filter((s) => s.requiresQCSignOff))
    .reduce(
      (acc, stage) => {
        const existing = acc.find((g) => g.stageName === stage.stageName);
        if (existing) {
          existing.timesUsed++;
          if (stage.qcResult === "PASS") existing.pass++;
          if (stage.qcResult === "FAIL") existing.fail++;
        } else {
          acc.push({
            stageName: stage.stageName,
            timesUsed: 1,
            pass: stage.qcResult === "PASS" ? 1 : 0,
            fail: stage.qcResult === "FAIL" ? 1 : 0,
          });
        }
        return acc;
      },
      [] as {
        stageName: string;
        timesUsed: number;
        pass: number;
        fail: number;
      }[]
    )
    .map((g) => ({
      ...g,
      passRate:
        g.pass + g.fail > 0
          ? Math.round((g.pass / (g.pass + g.fail)) * 100)
          : null,
    }))
    .sort((a, b) => {
      if (a.passRate === null) return 1;
      if (b.passRate === null) return -1;
      return a.passRate - b.passRate;
    });

  // WOs with rework
  const reworkWOs = enhancedWorkOrders.filter((w) => w.reworkCount > 0);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard
          title="Total Rework Events"
          value={String(totalReworkEvents)}
          icon={AlertTriangle}
          iconColor="text-orange-600"
        />
        <KPICard
          title="WOs with Rework"
          value={String(wosWithRework)}
          icon={Factory}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Avg Rework / WO"
          value={avgReworkPerWO}
          icon={BarChart2}
          iconColor="text-blue-600"
        />
        <KPICard
          title="QC Pass Rate"
          value={`${qcPassRate}%`}
          icon={ShieldCheck}
          iconColor="text-green-600"
        />
      </div>

      {/* Rework by Family */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            Rework by Product Family
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Family</TableHead>
                <TableHead className="text-right">Work Orders</TableHead>
                <TableHead className="text-right">Rework Events</TableHead>
                <TableHead className="text-right">Rework Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reworkByFamily.map((fam) => (
                <TableRow key={fam.key}>
                  <TableCell className="font-medium">{fam.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fam.woCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {fam.reworkCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span
                      className={`font-semibold ${
                        Number(fam.rate) > 10
                          ? "text-red-600"
                          : Number(fam.rate) > 5
                          ? "text-amber-600"
                          : "text-green-600"
                      }`}
                    >
                      {fam.rate}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* QC Gate Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            QC Gate Performance
          </CardTitle>
          <CardDescription>
            Sorted by pass rate (lowest first)
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage Name</TableHead>
                <TableHead className="text-right">Times Used</TableHead>
                <TableHead className="text-right">Pass</TableHead>
                <TableHead className="text-right">Fail</TableHead>
                <TableHead className="text-right">Pass Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {qcGates.map((gate) => (
                <TableRow key={gate.stageName}>
                  <TableCell className="font-medium">{gate.stageName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {gate.timesUsed}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-green-700 font-medium">
                    {gate.pass}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-red-600 font-medium">
                    {gate.fail}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {gate.passRate !== null ? (
                      <span
                        className={`font-semibold ${
                          gate.passRate < 80
                            ? "text-red-600"
                            : gate.passRate < 95
                            ? "text-amber-600"
                            : "text-green-600"
                        }`}
                      >
                        {gate.passRate}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        No QC data
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* WOs with Rework */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            Work Orders with Rework
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PID</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Rework Stage</TableHead>
                <TableHead className="text-right">Rework Count</TableHead>
                <TableHead>Delay Impact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reworkWOs.map((wo) => {
                const reworkStage = wo.wipStages.find(
                  (s) => s.reworkCount > 0 || s.qcResult === "FAIL"
                );
                return (
                  <TableRow key={wo.id}>
                    <TableCell className="font-mono font-bold text-sm">
                      {wo.pid}
                    </TableCell>
                    <TableCell className="font-medium">
                      {wo.productName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {reworkStage?.stageName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-orange-600">
                      {wo.reworkCount}
                    </TableCell>
                    <TableCell className="text-sm text-amber-700">
                      Est. +2 days
                    </TableCell>
                  </TableRow>
                );
              })}
              {reworkWOs.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-6"
                  >
                    No rework events recorded.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Component Traceability Tab ───────────────────────────────────────────────

function TraceabilityTab() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchedSerial, setSearchedSerial] = useState("");

  // Static mock result for "MBA-2026-0101"
  const MOCK_SERIAL = "MBA-2026-0101";

  function handleSearch() {
    if (query.trim()) {
      setSearchedSerial(query.trim());
      setSearched(true);
    }
  }

  const showResult =
    searched && searchedSerial.toUpperCase() === MOCK_SERIAL.toUpperCase();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            Traceability Query
          </CardTitle>
          <CardDescription>
            Query the complete forward/backward traceability chain for any
            device serial (MCC), module serial (MBA/MBM/MBC/CFG), or component
            batch number. Full traceability completes in &lt; 5 seconds per PRD
            spec.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Enter Device Serial (MCC-*), Module Serial (MBA/MBM/MBC/CFG-*), or Component Batch Number to trace..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
              />
            </div>
            <Button onClick={handleSearch}>
              <Search className="h-4 w-4 mr-1.5" />
              Trace
            </Button>
          </div>

          {searched && !showResult && (
            <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground text-center">
              No traceability data found for{" "}
              <code className="font-mono">{searchedSerial}</code>. Try{" "}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => {
                  setQuery(MOCK_SERIAL);
                  setSearchedSerial(MOCK_SERIAL);
                  setSearched(true);
                }}
              >
                MBA-2026-0101
              </button>
              .
            </div>
          )}

          {showResult && (
            <div className="mt-5 space-y-5">
              {/* Forward Trace */}
              <div>
                <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                  <GitBranch className="h-4 w-4 text-primary" />
                  Forward Trace — Module Lifecycle
                </p>
                <div className="space-y-1 text-sm">
                  <TraceNode
                    icon={<Factory className="h-4 w-4 text-blue-600" />}
                    label="Module Serial (MBA · Analyser)"
                    id={MOCK_SERIAL}
                    depth={0}
                    color="text-blue-700"
                  />
                  <TraceNode
                    icon={<BarChart2 className="h-4 w-4 text-amber-600" />}
                    label="Work Order"
                    id="PID-2026-041"
                    depth={1}
                    color="text-amber-700"
                  />
                  <TraceNode
                    icon={<Package className="h-4 w-4 text-green-600" />}
                    label="Product"
                    id="Hematology Analyzer HA-500 (MBA-HA500)"
                    depth={2}
                    color="text-green-700"
                  />
                  <TraceNode
                    icon={<Truck className="h-4 w-4 text-indigo-600" />}
                    label="Dispatch Status"
                    id="Not yet dispatched — WO In Progress"
                    depth={3}
                    color="text-indigo-700"
                  />
                </div>
              </div>

              {/* Backward Trace */}
              <div>
                <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                  <GitBranch className="h-4 w-4 rotate-180 text-purple-600" />
                  Backward Trace — Component Lineage
                </p>
                <div className="space-y-1 text-sm">
                  <TraceNode
                    icon={<Factory className="h-4 w-4 text-blue-600" />}
                    label="Module Serial (MBA · Analyser)"
                    id={MOCK_SERIAL}
                    depth={0}
                    color="text-blue-700"
                  />
                  <TraceNode
                    icon={<Package className="h-4 w-4 text-gray-600" />}
                    label="Component — PCB Assembly"
                    id="MLB-ITM-0005"
                    depth={1}
                    color="text-gray-700"
                  />
                  <TraceNode
                    icon={<Package className="h-4 w-4 text-gray-600" />}
                    label="Batch / GRN Ref"
                    id="MLB-BAT-2026-005 · GRN-2026-031"
                    depth={2}
                    color="text-gray-600"
                  />
                  <TraceNode
                    icon={<Truck className="h-4 w-4 text-amber-600" />}
                    label="Vendor"
                    id="PCBTech India Pvt. Ltd."
                    depth={3}
                    color="text-amber-700"
                  />
                  <TraceNode
                    icon={<Package className="h-4 w-4 text-indigo-600" />}
                    label="Purchase Order"
                    id="PO-2026-019"
                    depth={3}
                    color="text-indigo-700"
                  />
                  <TraceNode
                    icon={<Package className="h-4 w-4 text-gray-600" />}
                    label="Component — Flow Cell Sensor"
                    id="MLB-ITM-0006"
                    depth={1}
                    color="text-gray-700"
                  />
                  <TraceNode
                    icon={<Package className="h-4 w-4 text-gray-600" />}
                    label="Serial"
                    id="MLB-SEN-FC-0050"
                    depth={2}
                    color="text-gray-600"
                  />
                  <TraceNode
                    icon={<Truck className="h-4 w-4 text-amber-600" />}
                    label="Vendor"
                    id="SensorTech Asia (Precision Grade)"
                    depth={3}
                    color="text-amber-700"
                  />
                  <TraceNode
                    icon={<Package className="h-4 w-4 text-indigo-600" />}
                    label="Purchase Order"
                    id="PO-2026-021"
                    depth={3}
                    color="text-indigo-700"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Traces */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Recent Traces</CardTitle>
          <CardDescription>Last 5 traceability queries</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serial / Batch</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Queried At</TableHead>
                <TableHead>Queried By</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RECENT_TRACES.map((t) => (
                <TableRow key={t.serial}>
                  <TableCell className="font-mono text-sm font-semibold">
                    {t.serial}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {t.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.queriedAt}
                  </TableCell>
                  <TableCell className="text-sm">{t.queriedBy}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.result}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Traceability Tree Node ───────────────────────────────────────────────────

interface TraceNodeProps {
  icon: React.ReactNode;
  label: string;
  id: string;
  depth: number;
  color: string;
}

function TraceNode({ icon, label, id, depth, color }: TraceNodeProps) {
  return (
    <div
      className="flex items-start gap-2"
      style={{ marginLeft: `${depth * 20}px` }}
    >
      {depth > 0 && (
        <div className="flex flex-col items-center shrink-0">
          <div className="w-px h-3 bg-border" />
          <div className="w-3 h-px bg-border" />
        </div>
      )}
      <div className="flex items-center gap-2 bg-muted/50 border rounded-md px-3 py-1.5 flex-1 min-w-0">
        {icon}
        <span className="text-xs text-muted-foreground shrink-0">{label}:</span>
        <code className={`text-xs font-mono font-semibold truncate ${color}`}>
          {id}
        </code>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductionReportsPage() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Production Reports"
        description="KPIs, efficiency metrics, and traceability analytics"
      />

      <Tabs defaultValue="production-summary">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="production-summary">
            Production Summary
          </TabsTrigger>
          <TabsTrigger value="wo-analysis">Work Order Analysis</TabsTrigger>
          <TabsTrigger value="quality-rework">Quality &amp; Rework</TabsTrigger>
          <TabsTrigger value="traceability">
            Component Traceability
          </TabsTrigger>
        </TabsList>

        <TabsContent value="production-summary" className="mt-6">
          <ProductionSummaryTab />
        </TabsContent>

        <TabsContent value="wo-analysis" className="mt-6">
          <WorkOrderAnalysisTab />
        </TabsContent>

        <TabsContent value="quality-rework" className="mt-6">
          <QualityReworkTab />
        </TabsContent>

        <TabsContent value="traceability" className="mt-6">
          <TraceabilityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
