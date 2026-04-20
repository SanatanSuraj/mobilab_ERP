"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { getUserById, formatCurrency, formatDate, type Deal } from "@/data/mock";
import { useDeals } from "@/hooks/useCrm";
import { Briefcase, DollarSign, TrendingUp, Target } from "lucide-react";

export default function DealsPage() {
  const router = useRouter();
  const { data: deals = [], isLoading } = useDeals();

  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);
  const wonValue = deals
    .filter((d) => d.stage === "closed_won")
    .reduce((sum, d) => sum + d.value, 0);
  const avgProbability = deals.length
    ? Math.round(deals.reduce((sum, d) => sum + d.probability, 0) / deals.length)
    : 0;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

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
        <span className="text-sm font-medium">{formatCurrency(deal.value)}</span>
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
      render: (deal) => {
        const user = getUserById(deal.assignedTo);
        return <span className="text-sm">{user?.name ?? "Unassigned"}</span>;
      },
    },
    {
      key: "expectedClose",
      header: "Expected Close",
      sortable: true,
      render: (deal) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(deal.expectedClose)}
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
          change="+8% this quarter"
          trend="up"
          icon={DollarSign}
        />
        <KPICard
          title="Won Revenue"
          value={formatCurrency(wonValue)}
          change="2 deals closed"
          trend="up"
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
