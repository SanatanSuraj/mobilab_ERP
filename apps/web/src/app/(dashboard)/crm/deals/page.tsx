"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatDate } from "@/data/mock";
import { useApiDeals } from "@/hooks/useCrmApi";
import type { Deal } from "@instigenie/contracts";
import { Briefcase, DollarSign, TrendingUp, Target, AlertCircle } from "lucide-react";

/**
 * Deals list — /crm/deals via useApiDeals.
 *
 * Contract ↔ prototype shape deltas handled here:
 *   - `value` is a decimal *string* (NUMERIC(18,2)). Aggregates parse with
 *     Number(); display does too. This path never writes, so rounding via
 *     Intl.NumberFormat is fine for currency display.
 *   - `stage` is UPPER_CASE (`CLOSED_WON` vs the old `closed_won`) — every
 *     mock-case comparison below has been updated. StatusBadge has the
 *     UPPER_CASE styling keys added (see status-badge.tsx).
 *   - `assignedTo` + `expectedClose` are nullable. Owner name needs a users
 *     API we don't expose yet, so the cell shows the uuid prefix or
 *     "Unassigned".
 */

function toNumber(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function DealsPage() {
  const router = useRouter();
  const dealsQuery = useApiDeals({ limit: 50 });

  if (dealsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (dealsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load deals</p>
            <p className="text-red-700 mt-1">
              {dealsQuery.error instanceof Error
                ? dealsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const deals = dealsQuery.data?.data ?? [];

  const totalValue = deals.reduce((sum, d) => sum + toNumber(d.value), 0);
  const wonValue = deals
    .filter((d) => d.stage === "CLOSED_WON")
    .reduce((sum, d) => sum + toNumber(d.value), 0);
  const avgProbability = deals.length
    ? Math.round(
        deals.reduce((sum, d) => sum + d.probability, 0) / deals.length
      )
    : 0;
  const wonCount = deals.filter((d) => d.stage === "CLOSED_WON").length;

  const columns: Column<Deal>[] = [
    {
      key: "title",
      header: "Deal",
      sortable: true,
      render: (deal) => (
        <div>
          <p className="font-medium text-sm">{deal.title}</p>
          <p className="text-xs text-muted-foreground">{deal.company}</p>
        </div>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      render: (deal) => <StatusBadge status={deal.stage} />,
    },
    {
      key: "value",
      header: "Value",
      sortable: true,
      className: "text-right",
      render: (deal) => (
        <span className="text-sm font-medium">
          {formatCurrency(toNumber(deal.value))}
        </span>
      ),
    },
    {
      key: "probability",
      header: "Probability",
      className: "w-[140px]",
      render: (deal) => (
        <div className="flex items-center gap-2">
          <Progress value={deal.probability} className="h-2 flex-1" />
          <span className="text-xs text-muted-foreground w-8 text-right">
            {deal.probability}%
          </span>
        </div>
      ),
    },
    {
      key: "assignedTo",
      header: "Assigned To",
      render: (deal) => (
        <span className="text-sm text-muted-foreground">
          {deal.assignedTo ? deal.assignedTo.slice(0, 8) : "Unassigned"}
        </span>
      ),
    },
    {
      key: "expectedClose",
      header: "Expected Close",
      sortable: true,
      render: (deal) => (
        <span className="text-sm text-muted-foreground">
          {deal.expectedClose ? formatDate(deal.expectedClose) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Deals"
        description="Manage your active deals and opportunities"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Deals"
          value={String(deals.length)}
          icon={Briefcase}
        />
        <KPICard
          title="Pipeline Value"
          value={formatCurrency(totalValue)}
          icon={DollarSign}
        />
        <KPICard
          title="Won Revenue"
          value={formatCurrency(wonValue)}
          change={`${wonCount} deal${wonCount === 1 ? "" : "s"} closed`}
          trend={wonCount > 0 ? "up" : undefined}
          icon={TrendingUp}
        />
        <KPICard
          title="Avg. Probability"
          value={`${avgProbability}%`}
          icon={Target}
        />
      </div>

      <DataTable<Deal>
        data={deals}
        columns={columns}
        searchKey="title"
        searchPlaceholder="Search deals..."
        onRowClick={(deal) => router.push(`/crm/deals/${deal.id}`)}
      />
    </div>
  );
}
