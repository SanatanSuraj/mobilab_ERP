"use client";

/**
 * QC reports.
 *
 * Server returns a single rollup keyed on a date window (defaults to last
 * 90d when from/to omitted). All math is server-side; the page is a KPI +
 * pass-rate-by-kind + cycle-time + top-products-certified layout with date
 * pickers.
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
import { useApiQcReports } from "@/hooks/useQcApi";
import type { QcReports } from "@instigenie/contracts";
import {
  Activity,
  Award,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Gauge,
  Loader2,
  Package,
  XCircle,
} from "lucide-react";

type CertProductRow = QcReports["certs"]["topProducts"][number];

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtHours(n: number | null): string {
  if (n === null) return "—";
  if (n < 24) return `${n.toFixed(1)} h`;
  return `${(n / 24).toFixed(1)} d`;
}

export default function QcReportsPage() {
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

  const query = useApiQcReports(committed);
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

  const certColumns: Column<CertProductRow>[] = useMemo(
    () => [
      {
        key: "productName",
        header: "Product",
        render: (r) => (
          <span className="text-sm font-medium">{r.productName}</span>
        ),
      },
      {
        key: "certCount",
        header: "Certs Issued",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm font-semibold text-blue-600">
            {r.certCount}
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
          title="QC Reports"
          description="Inspection pass rates, cycle time, and cert issuance"
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
          title="QC Reports"
          description="Inspection pass rates, cycle time, and cert issuance"
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-red-600">
            Failed to load QC reports.{" "}
            {query.error ? String(query.error) : ""}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="QC Reports"
        description="Inspection pass rates, cycle time, and cert issuance"
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

      {/* Inspection KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Inspections"
          value={data.inspections.total.toLocaleString("en-IN")}
          icon={ClipboardCheck}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Passed"
          value={data.inspections.passed.toLocaleString("en-IN")}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change={fmtPct(data.inspections.passRatePct)}
          trend="up"
        />
        <KPICard
          title="Failed"
          value={data.inspections.failed.toLocaleString("en-IN")}
          icon={XCircle}
          iconColor="text-red-600"
        />
        <KPICard
          title="Certs Issued"
          value={data.certs.issued.toLocaleString("en-IN")}
          icon={Award}
          iconColor="text-amber-600"
        />
      </div>

      {/* Inspection status breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Inspection Status (window)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-6 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Draft
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {data.inspections.draft.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              In Progress
            </div>
            <div className="text-2xl font-bold tabular-nums text-amber-600">
              {data.inspections.inProgress.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Passed
            </div>
            <div className="text-2xl font-bold tabular-nums text-green-600">
              {data.inspections.passed.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Failed
            </div>
            <div className="text-2xl font-bold tabular-nums text-red-600">
              {data.inspections.failed.toLocaleString("en-IN")}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pass rate by kind */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Pass Rate by Inspection Kind
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-6 pt-0">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              IQC (Incoming)
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtPct(data.byKind.iqc.passRatePct)}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.byKind.iqc.passed} passed · {data.byKind.iqc.failed} failed
              · {data.byKind.iqc.total} total
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Sub-QC (WIP)
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtPct(data.byKind.subQc.passRatePct)}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.byKind.subQc.passed} passed · {data.byKind.subQc.failed}{" "}
              failed · {data.byKind.subQc.total} total
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Final QC
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtPct(data.byKind.finalQc.passRatePct)}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.byKind.finalQc.passed} passed ·{" "}
              {data.byKind.finalQc.failed} failed · {data.byKind.finalQc.total}{" "}
              total
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cycle time */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Cycle Time (completed inspections)
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

      {/* Top certified products */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="h-4 w-4" />
            Top Products by Cert Issuance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<CertProductRow>
            data={data.certs.topProducts}
            columns={certColumns}
            pageSize={10}
          />
        </CardContent>
      </Card>
    </div>
  );
}
