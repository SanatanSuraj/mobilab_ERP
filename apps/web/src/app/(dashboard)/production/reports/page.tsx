"use client";

/**
 * Production reports.
 *
 * Server returns a single rollup keyed on a date window (defaults to last
 * 90d when from/to omitted). All math is server-side; the page is just a
 * KPI + table layout with date pickers.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { DataTable, Column } from "@/components/shared/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiProductionReports } from "@/hooks/useProductionApi";
import type { ProductionReports } from "@instigenie/contracts";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Gauge,
  Loader2,
  TrendingUp,
} from "lucide-react";

type TopProductRow = ProductionReports["topProducts"][number];

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtHours(n: number | null): string {
  if (n === null) return "—";
  if (n < 24) return `${n.toFixed(1)} h`;
  return `${(n / 24).toFixed(1)} d`;
}

function fmtQty(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function ReportsPage() {
  // Local form state — committed to the query only on Apply, so editing
  // dates doesn't refetch on every keystroke.
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [fromInput, setFromInput] = useState(ninetyAgo);
  const [toInput, setToInput] = useState(today);
  const [committed, setCommitted] = useState<{
    from: string;
    to: string;
  }>({ from: ninetyAgo, to: today });

  const query = useApiProductionReports(committed);
  const data = query.data;

  const dirty = fromInput !== committed.from || toInput !== committed.to;

  function apply() {
    setCommitted({ from: fromInput, to: toInput });
  }

  function reset() {
    setFromInput(ninetyAgo);
    setToInput(today);
    setCommitted({ from: ninetyAgo, to: today });
  }

  const topProductColumns: Column<TopProductRow>[] = useMemo(
    () => [
      {
        key: "productCode",
        header: "Code",
        render: (r) => (
          <span className="font-mono text-xs font-bold text-blue-600">
            {r.productCode}
          </span>
        ),
      },
      {
        key: "name",
        header: "Product",
        render: (r) => <span className="text-sm">{r.name}</span>,
      },
      {
        key: "completed",
        header: "Completed WOs",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm font-semibold">
            {r.completed}
          </span>
        ),
      },
      {
        key: "totalQty",
        header: "Total Qty",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm text-muted-foreground">
            {fmtQty(r.totalQty)}
          </span>
        ),
      },
    ],
    [],
  );

  if (query.isLoading && !data) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Production Reports"
          description="Throughput, cycle time, and yield rollups"
        />
        <Skeleton className="h-20" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (query.isError || !data) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Production Reports"
          description="Throughput, cycle time, and yield rollups"
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-red-600">
            Failed to load production reports.{" "}
            {query.error ? String(query.error) : ""}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Production Reports"
        description="Throughput, cycle time, and yield rollups"
      />

      {/* Date range */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                className="w-44"
                max={toInput}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                className="w-44"
                min={fromInput}
                max={today}
              />
            </div>
            <Button onClick={apply} disabled={!dirty}>
              {query.isFetching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Apply
            </Button>
            <Button variant="ghost" onClick={reset} className="text-xs">
              Last 90 days
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              Window:{" "}
              <span className="font-mono">
                {data.from} → {data.to}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Throughput KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total WOs"
          value={data.throughput.total.toLocaleString("en-IN")}
          icon={ClipboardList}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Completed"
          value={data.throughput.completed.toLocaleString("en-IN")}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change={fmtPct(data.throughput.completionRatePct)}
          trend="up"
        />
        <KPICard
          title="In Progress"
          value={data.throughput.inProgress.toLocaleString("en-IN")}
          icon={Activity}
          iconColor="text-amber-600"
        />
        <KPICard
          title="QC Hold / Rework"
          value={(
            data.throughput.qcHold + data.throughput.rework
          ).toLocaleString("en-IN")}
          icon={AlertTriangle}
          iconColor={
            data.throughput.qcHold + data.throughput.rework > 0
              ? "text-orange-600"
              : "text-gray-500"
          }
        />
      </div>

      {/* Cycle time */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Cycle Time (completed WOs)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Average
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtHours(data.cycleTime.avgHours)}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.cycleTime.completedCount} completions
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Median (P50)
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtHours(data.cycleTime.p50Hours)}
            </div>
            <div className="text-xs text-muted-foreground">
              50% finish faster than this
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Tail (P90)
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtHours(data.cycleTime.p90Hours)}
            </div>
            <div className="text-xs text-muted-foreground">
              90% finish faster than this
            </div>
          </div>
        </CardContent>
      </Card>

      {/* QC */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Stage QC Rollup
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-6 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              QC Stages
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {data.qc.totalQcStages.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Passed
            </div>
            <div className="text-2xl font-bold tabular-nums text-green-600">
              {data.qc.passed.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Failed
            </div>
            <div className="text-2xl font-bold tabular-nums text-red-600">
              {data.qc.failed.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Pass Rate
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtPct(data.qc.passRatePct)}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.qc.reworkLoops.toLocaleString("en-IN")} rework loops
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top products */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Top Products by Completed WOs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<TopProductRow>
            data={data.topProducts}
            columns={topProductColumns}
            pageSize={10}
          />
        </CardContent>
      </Card>
    </div>
  );
}
