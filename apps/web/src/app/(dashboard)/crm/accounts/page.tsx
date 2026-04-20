"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import {
  accounts,
  getHealthScoreColor,
  getHealthScoreLabel,
  type Account,
} from "@/data/crm-mock";
import { getUserById, formatCurrency } from "@/data/mock";
import { Building2, Star, DollarSign, Activity } from "lucide-react";

export default function AccountsPage() {
  const router = useRouter();

  const keyAccountCount = accounts.filter((a) => a.isKeyAccount).length;
  const totalRevenue = accounts.reduce((sum, a) => sum + a.annualRevenue, 0);
  const avgHealth = Math.round(
    accounts.reduce((sum, a) => sum + a.healthScore, 0) / accounts.length
  );

  const columns: Column<Account>[] = [
    {
      key: "name",
      header: "Account Name",
      sortable: true,
      render: (a) => (
        <span className="text-sm font-medium">{a.name}</span>
      ),
    },
    {
      key: "industry",
      header: "Industry",
      sortable: true,
      render: (a) => (
        <span className="text-sm text-muted-foreground">{a.industry}</span>
      ),
    },
    {
      key: "city",
      header: "Location",
      render: (a) => (
        <span className="text-sm text-muted-foreground">
          {a.city}, {a.state}
        </span>
      ),
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
          <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs" variant="outline">
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
        <span className="text-sm font-medium">{formatCurrency(a.annualRevenue)}</span>
      ),
    },
    {
      key: "ownerId",
      header: "Owner",
      render: (a) => {
        const user = getUserById(a.ownerId);
        return <span className="text-sm">{user?.name ?? "Unassigned"}</span>;
      },
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
