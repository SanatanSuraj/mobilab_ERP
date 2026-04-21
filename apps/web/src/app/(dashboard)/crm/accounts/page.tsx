"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getHealthScoreColor, getHealthScoreLabel } from "@/data/crm-mock";
import { formatCurrency } from "@/data/mock";
import { useApiAccounts } from "@/hooks/useCrmApi";
import type { Account } from "@mobilab/contracts";
import { Building2, Star, DollarSign, Activity, AlertCircle } from "lucide-react";

/**
 * Accounts list — reads /crm/accounts via useApiAccounts.
 *
 * Contract ↔ prototype shape deltas handled here:
 *   - `annualRevenue` is a decimal *string* (NUMERIC(18,2)) now, not a
 *     number. We parse with Number() for aggregates + display only; writes
 *     would need to round-trip through the original string.
 *   - `industry`, `city`, `state`, `annualRevenue`, `ownerId` are all
 *     nullable — every render path falls back to an em-dash.
 *   - Owner *name* requires a users API we don't expose yet, so the column
 *     shows the raw uuid prefix or "—" when absent. Upgrade-path: wire a
 *     `useApiUsers` hook and lookup similar to account-name-by-id in
 *     contacts.
 */

function toNumber(v: string | null): number {
  if (v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function AccountsPage() {
  const router = useRouter();
  const accountsQuery = useApiAccounts({ limit: 100 });

  if (accountsQuery.isLoading) {
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

  if (accountsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load accounts</p>
            <p className="text-red-700 mt-1">
              {accountsQuery.error instanceof Error
                ? accountsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const accounts = accountsQuery.data?.data ?? [];

  const keyAccountCount = accounts.filter((a) => a.isKeyAccount).length;
  const totalRevenue = accounts.reduce(
    (sum, a) => sum + toNumber(a.annualRevenue),
    0
  );
  const avgHealth = accounts.length
    ? Math.round(
        accounts.reduce((sum, a) => sum + a.healthScore, 0) / accounts.length
      )
    : 0;

  const columns: Column<Account>[] = [
    {
      key: "name",
      header: "Account Name",
      sortable: true,
      render: (a) => <span className="text-sm font-medium">{a.name}</span>,
    },
    {
      key: "industry",
      header: "Industry",
      sortable: true,
      render: (a) => (
        <span className="text-sm text-muted-foreground">
          {a.industry ?? "—"}
        </span>
      ),
    },
    {
      key: "city",
      header: "Location",
      render: (a) => {
        const parts = [a.city, a.state].filter(Boolean);
        return (
          <span className="text-sm text-muted-foreground">
            {parts.length ? parts.join(", ") : "—"}
          </span>
        );
      },
    },
    {
      key: "healthScore",
      header: "Health",
      sortable: true,
      render: (a) => (
        <Badge
          variant="outline"
          className={`text-xs font-medium ${getHealthScoreColor(a.healthScore)}`}
        >
          {a.healthScore} &middot; {getHealthScoreLabel(a.healthScore)}
        </Badge>
      ),
    },
    {
      key: "isKeyAccount",
      header: "Key Account",
      render: (a) =>
        a.isKeyAccount ? (
          <Badge
            className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
            variant="outline"
          >
            Key
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">&mdash;</span>
        ),
    },
    {
      key: "annualRevenue",
      header: "Annual Revenue",
      sortable: true,
      className: "text-right",
      render: (a) => (
        <span className="text-sm font-medium">
          {a.annualRevenue === null
            ? "—"
            : formatCurrency(toNumber(a.annualRevenue))}
        </span>
      ),
    },
    {
      key: "ownerId",
      header: "Owner",
      render: (a) => (
        <span className="text-sm text-muted-foreground">
          {a.ownerId ? a.ownerId.slice(0, 8) : "Unassigned"}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Accounts"
        description="Manage customer accounts and relationships"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Accounts"
          value={String(accounts.length)}
          icon={Building2}
        />
        <KPICard
          title="Key Accounts"
          value={String(keyAccountCount)}
          icon={Star}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          icon={DollarSign}
          iconColor="text-green-600"
        />
        <KPICard
          title="Avg Health Score"
          value={String(avgHealth)}
          icon={Activity}
          iconColor="text-blue-600"
        />
      </div>

      <DataTable<Account>
        data={accounts}
        columns={columns}
        searchKey="name"
        searchPlaceholder="Search by account name..."
        onRowClick={(account) => router.push(`/crm/accounts/${account.id}`)}
      />
    </div>
  );
}
