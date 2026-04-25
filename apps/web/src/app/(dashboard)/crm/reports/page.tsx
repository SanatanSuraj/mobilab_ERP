"use client";

/**
 * CRM reports.
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
import { Badge } from "@/components/ui/badge";
import { useApiCrmReports } from "@/hooks/useCrmApi";
import type { CrmReports } from "@instigenie/contracts";
import {
  BarChart3,
  CheckCircle2,
  DollarSign,
  Funnel,
  Loader2,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

type TopDealRow = CrmReports["topDeals"][number];

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtMoney(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

const stageBadgeColor: Record<string, string> = {
  DISCOVERY: "bg-cyan-100 text-cyan-800",
  PROPOSAL: "bg-orange-100 text-orange-800",
  NEGOTIATION: "bg-amber-100 text-amber-800",
  CLOSED_WON: "bg-green-100 text-green-800",
  CLOSED_LOST: "bg-red-100 text-red-800",
};

export default function CrmReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [fromInput, setFromInput] = useState(ninetyAgo);
  const [toInput, setToInput] = useState(today);
  const [committed, setCommitted] = useState<{ from: string; to: string }>({
    from: ninetyAgo,
    to: today,
  });

  const query = useApiCrmReports(committed);
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

  const topDealColumns: Column<TopDealRow>[] = useMemo(
    () => [
      {
        key: "dealNumber",
        header: "Deal",
        render: (r) => (
          <span className="font-mono text-xs font-bold text-blue-600">
            {r.dealNumber}
          </span>
        ),
      },
      {
        key: "title",
        header: "Title",
        render: (r) => <span className="text-sm">{r.title}</span>,
      },
      {
        key: "company",
        header: "Company",
        render: (r) => (
          <span className="text-sm text-muted-foreground">{r.company}</span>
        ),
      },
      {
        key: "stage",
        header: "Stage",
        render: (r) => (
          <Badge
            className={
              stageBadgeColor[r.stage] ?? "bg-gray-100 text-gray-800"
            }
            variant="secondary"
          >
            {r.stage.replace("_", " ")}
          </Badge>
        ),
      },
      {
        key: "probability",
        header: "Prob.",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-xs text-muted-foreground">
            {r.probability}%
          </span>
        ),
      },
      {
        key: "value",
        header: "Value",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm font-semibold">
            {fmtMoney(r.value)}
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
          title="CRM Reports"
          description="Pipeline, win-loss, and lead funnel rollups"
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
          title="CRM Reports"
          description="Pipeline, win-loss, and lead funnel rollups"
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-red-600">
            Failed to load CRM reports.{" "}
            {query.error ? String(query.error) : ""}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="CRM Reports"
        description="Pipeline, win-loss, and lead funnel rollups"
      />

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

      {/* Pipeline KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Pipeline Value"
          value={fmtMoney(data.pipeline.totalValue)}
          icon={DollarSign}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Weighted Value"
          value={fmtMoney(data.pipeline.weightedValue)}
          icon={Target}
          iconColor="text-purple-600"
        />
        <KPICard
          title="Win Rate"
          value={fmtPct(data.winLoss.winRatePct)}
          icon={TrendingUp}
          iconColor="text-green-600"
        />
        <KPICard
          title="Avg Deal Size (Won)"
          value={fmtMoney(data.winLoss.avgDealSizeWon)}
          icon={CheckCircle2}
          iconColor="text-emerald-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline funnel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Funnel className="h-4 w-4" />
              Pipeline Funnel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-6 pt-0">
            {[
              { label: "Discovery", v: data.pipeline.discovery, color: "bg-cyan-500" },
              { label: "Proposal", v: data.pipeline.proposal, color: "bg-orange-500" },
              { label: "Negotiation", v: data.pipeline.negotiation, color: "bg-amber-500" },
              { label: "Closed Won", v: data.pipeline.closedWon, color: "bg-green-500" },
              { label: "Closed Lost", v: data.pipeline.closedLost, color: "bg-red-500" },
            ].map((row) => {
              const max = Math.max(
                data.pipeline.discovery,
                data.pipeline.proposal,
                data.pipeline.negotiation,
                data.pipeline.closedWon,
                data.pipeline.closedLost,
                1,
              );
              const pct = (row.v / max) * 100;
              return (
                <div key={row.label} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>{row.label}</span>
                    <span className="font-semibold tabular-nums">{row.v}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${row.color} rounded-full`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Win/Loss */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Win / Loss (closed in window)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-6 p-6 pt-0">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600" />
                Won
              </div>
              <div className="text-2xl font-bold tabular-nums text-green-600">
                {data.winLoss.won}
              </div>
              <div className="text-xs text-muted-foreground">
                {fmtMoney(data.winLoss.wonValue)}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-red-600" />
                Lost
              </div>
              <div className="text-2xl font-bold tabular-nums text-red-600">
                {data.winLoss.lost}
              </div>
              <div className="text-xs text-muted-foreground">
                {fmtMoney(data.winLoss.lostValue)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Leads */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" />
            Lead Funnel
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-6 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Total
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {data.leads.total}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              New
            </div>
            <div className="text-2xl font-bold tabular-nums text-blue-600">
              {data.leads.new}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Contacted
            </div>
            <div className="text-2xl font-bold tabular-nums text-cyan-600">
              {data.leads.contacted}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Qualified
            </div>
            <div className="text-2xl font-bold tabular-nums text-amber-600">
              {data.leads.qualified}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Converted
            </div>
            <div className="text-2xl font-bold tabular-nums text-green-600">
              {data.leads.converted}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Lost
            </div>
            <div className="text-2xl font-bold tabular-nums text-red-600">
              {data.leads.lost}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Conv. Rate
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtPct(data.leads.conversionRatePct)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top deals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Top Deals by Value
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<TopDealRow>
            data={data.topDeals}
            columns={topDealColumns}
            pageSize={10}
          />
        </CardContent>
      </Card>
    </div>
  );
}
