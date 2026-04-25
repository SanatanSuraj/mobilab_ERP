"use client";

/**
 * Finance reports.
 *
 * Server returns a single rollup keyed on a date window (defaults to last
 * 90d when from/to omitted). All math is server-side; the page is a KPI +
 * AR/AP ageing + top-customers layout with date pickers.
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
import { useApiFinanceReports } from "@/hooks/useFinanceApi";
import type { FinanceReports } from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  Clock,
  IndianRupee,
  Loader2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

type CustomerRow = FinanceReports["topCustomers"][number];

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

export default function FinanceReportsPage() {
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

  const query = useApiFinanceReports(committed);
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

  const customerColumns: Column<CustomerRow>[] = useMemo(
    () => [
      {
        key: "customerName",
        header: "Customer",
        render: (r) => (
          <span className="text-sm font-medium">{r.customerName}</span>
        ),
      },
      {
        key: "invoiceCount",
        header: "Invoices",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm">{r.invoiceCount}</span>
        ),
      },
      {
        key: "invoicedTotal",
        header: "Invoiced",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm font-semibold">
            {fmtMoney(r.invoicedTotal)}
          </span>
        ),
      },
      {
        key: "paidTotal",
        header: "Paid",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm text-muted-foreground">
            {fmtMoney(r.paidTotal)}
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
          title="Financial Reports"
          description="P&L summary, AR/AP ageing, and top customers"
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
          title="Financial Reports"
          description="P&L summary, AR/AP ageing, and top customers"
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-red-600">
            Failed to load finance reports.{" "}
            {query.error ? String(query.error) : ""}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Financial Reports"
        description="P&L summary, AR/AP ageing, and top customers"
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

      {/* P&L KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Revenue"
          value={fmtMoney(data.pnl.revenue)}
          icon={IndianRupee}
          iconColor="text-green-600"
        />
        <KPICard
          title="Expenses"
          value={fmtMoney(data.pnl.expenses)}
          icon={TrendingDown}
          iconColor="text-red-600"
        />
        <KPICard
          title="Gross Profit"
          value={fmtMoney(data.pnl.grossProfit)}
          icon={TrendingUp}
          iconColor="text-blue-600"
          change={fmtPct(data.pnl.grossMarginPct)}
          trend={data.pnl.grossMarginPct >= 0 ? "up" : "down"}
        />
        <KPICard
          title="Net Cash Flow"
          value={fmtMoney(data.pnl.cashFlow)}
          icon={Wallet}
          iconColor={
            Number(data.pnl.cashFlow) >= 0 ? "text-green-600" : "text-red-600"
          }
        />
      </div>

      {/* Cash flow detail */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Cash Movement (window)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <ArrowDownCircle className="h-3 w-3 text-green-600" />
              Payments In
            </div>
            <div className="text-2xl font-bold tabular-nums text-green-600">
              {fmtMoney(data.pnl.paymentsIn)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <ArrowUpCircle className="h-3 w-3 text-red-600" />
              Payments Out
            </div>
            <div className="text-2xl font-bold tabular-nums text-red-600">
              {fmtMoney(data.pnl.paymentsOut)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Net Cash Flow
            </div>
            <div
              className={`text-2xl font-bold tabular-nums ${
                Number(data.pnl.cashFlow) >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {fmtMoney(data.pnl.cashFlow)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AR Ageing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Receivables Ageing (current outstanding)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-6 gap-4 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Current
            </div>
            <div className="text-lg font-bold tabular-nums">
              {fmtMoney(data.arAgeing.current)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              1–30 days
            </div>
            <div className="text-lg font-bold tabular-nums">
              {fmtMoney(data.arAgeing.days1to30)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              31–60 days
            </div>
            <div className="text-lg font-bold tabular-nums text-amber-600">
              {fmtMoney(data.arAgeing.days31to60)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              61–90 days
            </div>
            <div className="text-lg font-bold tabular-nums text-orange-600">
              {fmtMoney(data.arAgeing.days61to90)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-red-600" />
              90+ days
            </div>
            <div className="text-lg font-bold tabular-nums text-red-600">
              {fmtMoney(data.arAgeing.days90Plus)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Total AR
            </div>
            <div className="text-lg font-bold tabular-nums text-blue-600">
              {fmtMoney(data.arAgeing.total)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AP Ageing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Payables Ageing (current outstanding)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-6 gap-4 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Current
            </div>
            <div className="text-lg font-bold tabular-nums">
              {fmtMoney(data.apAgeing.current)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              1–30 days
            </div>
            <div className="text-lg font-bold tabular-nums">
              {fmtMoney(data.apAgeing.days1to30)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              31–60 days
            </div>
            <div className="text-lg font-bold tabular-nums text-amber-600">
              {fmtMoney(data.apAgeing.days31to60)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              61–90 days
            </div>
            <div className="text-lg font-bold tabular-nums text-orange-600">
              {fmtMoney(data.apAgeing.days61to90)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-red-600" />
              90+ days
            </div>
            <div className="text-lg font-bold tabular-nums text-red-600">
              {fmtMoney(data.apAgeing.days90Plus)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Total AP
            </div>
            <div className="text-lg font-bold tabular-nums text-blue-600">
              {fmtMoney(data.apAgeing.total)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top customers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Top Customers by Invoiced Amount
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<CustomerRow>
            data={data.topCustomers}
            columns={customerColumns}
            pageSize={10}
          />
        </CardContent>
      </Card>
    </div>
  );
}
