"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/data/mock";
import { useApiSalesOrders } from "@/hooks/useCrmApi";
import type { SalesOrder } from "@mobilab/contracts";
import {
  ShoppingCart,
  Clock,
  Truck,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

/**
 * Orders list — /crm/orders backed by useApiSalesOrders.
 *
 * Contract deltas from mock (src/data/crm-mock.ts → Order):
 *   - Status is UPPER_CASE (DRAFT, CONFIRMED, PROCESSING, DISPATCHED,
 *     IN_TRANSIT, DELIVERED, CANCELLED).
 *   - Totals are decimal *strings*; toNumber() only for display.
 *   - Line items count from sub-array length (never includes deleted items).
 *   - No more whatsappSent/emailSent/fgAvailable prototype columns — those
 *     live on notifications/inventory modules, not on the SO itself.
 */

function toNumber(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function OrdersPage() {
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
            <p className="font-medium text-red-900">Failed to load orders</p>
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

  const orders = ordersQuery.data?.data ?? [];

  const totalOrders = orders.length;
  const processing = orders.filter(
    (o) => o.status === "PROCESSING" || o.status === "CONFIRMED"
  ).length;
  const dispatched = orders.filter(
    (o) => o.status === "DISPATCHED" || o.status === "IN_TRANSIT"
  ).length;
  const delivered = orders.filter((o) => o.status === "DELIVERED").length;

  const columns: Column<SalesOrder>[] = [
    {
      key: "orderNumber",
      header: "Order #",
      sortable: true,
      render: (order) => (
        <span className="font-medium text-sm font-mono">
          {order.orderNumber}
        </span>
      ),
    },
    {
      key: "company",
      header: "Company",
      render: (order) => <span className="text-sm">{order.company}</span>,
    },
    {
      key: "contactName",
      header: "Contact",
      render: (order) => (
        <span className="text-sm text-muted-foreground">
          {order.contactName}
        </span>
      ),
    },
    {
      key: "items",
      header: "Items",
      render: (order) => (
        <span className="text-sm text-muted-foreground">
          {order.lineItems.length} item
          {order.lineItems.length !== 1 ? "s" : ""}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      sortable: true,
      className: "text-right",
      render: (order) => (
        <span className="text-sm font-medium">
          {formatCurrency(toNumber(order.grandTotal))}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (order) => <StatusBadge status={order.status} />,
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (order) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(order.createdAt.slice(0, 10))}
        </span>
      ),
    },
    {
      key: "expectedDelivery",
      header: "Expected Delivery",
      render: (order) => (
        <span className="text-sm text-muted-foreground">
          {order.expectedDelivery ? formatDate(order.expectedDelivery) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Orders"
        description="Manage sales orders, dispatch, and delivery tracking"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Total Orders"
          value={String(totalOrders)}
          icon={ShoppingCart}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Processing"
          value={String(processing)}
          icon={Clock}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Dispatched"
          value={String(dispatched)}
          icon={Truck}
          iconColor="text-indigo-600"
        />
        <KPICard
          title="Delivered"
          value={String(delivered)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
      </div>

      <DataTable<SalesOrder>
        data={orders}
        columns={columns}
        searchKey="orderNumber"
        searchPlaceholder="Search by order number..."
        onRowClick={(order) => router.push(`/crm/orders/${order.id}`)}
      />
    </div>
  );
}
