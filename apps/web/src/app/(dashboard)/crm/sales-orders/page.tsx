"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { useApiSalesOrders } from "@/hooks/useCrmApi";
import type { SalesOrder } from "@instigenie/contracts";
import {
  ShoppingCart,
  DollarSign,
  Truck,
  PackageCheck,
  AlertCircle,
} from "lucide-react";

/**
 * Sales orders list — /crm/sales-orders backed by useApiSalesOrders.
 *
 * This duplicates /crm/orders to preserve the old dashboard entry point
 * while the nav is still in flux. Both hit the same endpoint.
 */

function toNumber(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function SalesOrdersPage() {
  const router = useRouter();
  const ordersQuery = useApiSalesOrders({ limit: 50 });

  if (ordersQuery.isLoading) {
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

  if (ordersQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load sales orders
            </p>
            <p className="text-red-700 mt-1">
              {ordersQuery.error instanceof Error
                ? ordersQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const salesOrders = ordersQuery.data?.data ?? [];

  const totalRevenue = salesOrders.reduce(
    (sum, o) => sum + toNumber(o.grandTotal),
    0
  );
  const deliveredCount = salesOrders.filter(
    (o) => o.status === "DELIVERED"
  ).length;
  const processingCount = salesOrders.filter(
    (o) => o.status === "PROCESSING" || o.status === "CONFIRMED"
  ).length;

  const columns: Column<SalesOrder>[] = [
    {
      key: "orderNumber",
      header: "Order #",
      sortable: true,
      render: (o) => (
        <span className="text-sm font-medium font-mono">{o.orderNumber}</span>
      ),
    },
    {
      key: "company",
      header: "Customer",
      sortable: true,
      render: (o) => <span className="text-sm">{o.company}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (o) => <StatusBadge status={o.status} />,
    },
    {
      key: "items",
      header: "Items",
      render: (o) => (
        <span className="text-sm text-muted-foreground">
          {o.lineItems.length} item{o.lineItems.length !== 1 ? "s" : ""}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      sortable: true,
      className: "text-right",
      render: (o) => (
        <span className="text-sm font-medium">
          {formatCurrency(toNumber(o.grandTotal))}
        </span>
      ),
    },
    {
      key: "expectedDelivery",
      header: "Delivery Date",
      sortable: true,
      render: (o) => (
        <span className="text-sm text-muted-foreground">
          {o.expectedDelivery ? formatDate(o.expectedDelivery) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Sales Orders"
        description="Track and fulfill customer orders"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Orders"
          value={String(salesOrders.length)}
          icon={ShoppingCart}
        />
        <KPICard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          icon={DollarSign}
        />
        <KPICard
          title="Delivered"
          value={String(deliveredCount)}
          icon={PackageCheck}
          iconColor="text-green-600"
        />
        <KPICard
          title="In Progress"
          value={String(processingCount)}
          icon={Truck}
          iconColor="text-amber-600"
        />
      </div>

      <DataTable<SalesOrder>
        data={salesOrders}
        columns={columns}
        searchKey="orderNumber"
        searchPlaceholder="Search by order number..."
        onRowClick={(o) => router.push(`/crm/orders/${o.id}`)}
      />
    </div>
  );
}
