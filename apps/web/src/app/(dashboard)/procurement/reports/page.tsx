"use client";

/**
 * Procurement reports.
 *
 * Server returns a single rollup keyed on a date window (defaults to last
 * 90d when from/to omitted). All math is server-side; the page is a KPI +
 * delivery + top-vendors layout with date pickers.
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
import { useApiProcurementReports } from "@/hooks/useProcurementApi";
import type { ProcurementReports } from "@instigenie/contracts";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  IndianRupee,
  Loader2,
  Package,
  ShoppingCart,
  Truck,
} from "lucide-react";

type VendorRow = ProcurementReports["topVendors"][number];

function fmtMoney(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtDays(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(1)} d`;
}

export default function ProcurementReportsPage() {
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

  const query = useApiProcurementReports(committed);
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

  const vendorColumns: Column<VendorRow>[] = useMemo(
    () => [
      {
        key: "vendorCode",
        header: "Code",
        render: (r) => (
          <span className="font-mono text-xs font-bold text-blue-600">
            {r.vendorCode}
          </span>
        ),
      },
      {
        key: "vendorName",
        header: "Vendor",
        render: (r) => <span className="text-sm">{r.vendorName}</span>,
      },
      {
        key: "poCount",
        header: "POs",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm">{r.poCount}</span>
        ),
      },
      {
        key: "totalSpend",
        header: "Total Spend",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm font-semibold">
            {fmtMoney(r.totalSpend)}
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
          title="Procurement Reports"
          description="PO throughput, delivery performance, and top vendors"
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
          title="Procurement Reports"
          description="PO throughput, delivery performance, and top vendors"
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-red-600">
            Failed to load procurement reports.{" "}
            {query.error ? String(query.error) : ""}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Procurement Reports"
        description="PO throughput, delivery performance, and top vendors"
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
          title="Total POs"
          value={data.poThroughput.total.toLocaleString("en-IN")}
          icon={ShoppingCart}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Received"
          value={data.poThroughput.received.toLocaleString("en-IN")}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Total Spend"
          value={fmtMoney(data.poThroughput.totalSpend)}
          icon={IndianRupee}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Received Spend"
          value={fmtMoney(data.poThroughput.receivedSpend)}
          icon={Package}
          iconColor="text-purple-600"
        />
      </div>

      {/* PO Status breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            PO Status Breakdown (window)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-7 gap-4 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Draft
            </div>
            <div className="text-lg font-bold tabular-nums">
              {data.poThroughput.draft.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Pending
            </div>
            <div className="text-lg font-bold tabular-nums text-amber-600">
              {data.poThroughput.pendingApproval.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Approved
            </div>
            <div className="text-lg font-bold tabular-nums text-blue-600">
              {data.poThroughput.approved.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Sent
            </div>
            <div className="text-lg font-bold tabular-nums text-cyan-600">
              {data.poThroughput.sent.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Partial
            </div>
            <div className="text-lg font-bold tabular-nums text-orange-600">
              {data.poThroughput.partiallyReceived.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Received
            </div>
            <div className="text-lg font-bold tabular-nums text-green-600">
              {data.poThroughput.received.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Cancelled
            </div>
            <div className="text-lg font-bold tabular-nums text-red-600">
              {data.poThroughput.cancelled.toLocaleString("en-IN")}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delivery */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Delivery Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-6 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              GRNs Posted
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {data.delivery.grnsPosted.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              On-Time %
            </div>
            <div className="text-2xl font-bold tabular-nums text-green-600">
              {fmtPct(data.delivery.onTimePct)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Avg Lead Time
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtDays(data.delivery.avgLeadDays)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-orange-600" />
              Late GRNs
            </div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                data.delivery.lateGrns > 0 ? "text-orange-600" : "text-gray-500"
              }`}
            >
              {data.delivery.lateGrns.toLocaleString("en-IN")}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top vendors */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="h-4 w-4" />
            Top Vendors by Spend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<VendorRow>
            data={data.topVendors}
            columns={vendorColumns}
            pageSize={10}
          />
        </CardContent>
      </Card>
    </div>
  );
}
