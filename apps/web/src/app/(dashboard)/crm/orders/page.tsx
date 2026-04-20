"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { orders, getAccountById, type Order } from "@/data/crm-mock";
import { formatCurrency, formatDate } from "@/data/mock";
import {
  ShoppingCart,
  Clock,
  Truck,
  CheckCircle2,
  Check,
  X,
  MessageCircle,
  Mail,
} from "lucide-react";

export default function OrdersPage() {
  const router = useRouter();

  const totalOrders = orders.length;
  const processing = orders.filter((o) => o.status === "processing" || o.status === "confirmed").length;
  const dispatched = orders.filter((o) => o.status === "dispatched" || o.status === "in_transit").length;
  const delivered = orders.filter((o) => o.status === "delivered").length;

  const columns: Column<Order>[] = [
    {
      key: "orderNumber",
      header: "Order #",
      sortable: true,
      render: (order) => (
        <span className="font-medium text-sm">{order.orderNumber}</span>
      ),
    },
    {
      key: "accountId",
      header: "Account",
      render: (order) => {
        const account = getAccountById(order.accountId);
        return (
          <span className="text-sm">{account?.name ?? "N/A"}</span>
        );
      },
    },
    {
      key: "items",
      header: "Items",
      render: (order) => (
        <span className="text-sm text-muted-foreground">
          {order.items.length} item{order.items.length !== 1 ? "s" : ""}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      sortable: true,
      className: "text-right",
      render: (order) => (
        <span className="text-sm font-medium">{formatCurrency(order.grandTotal)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (order) => <StatusBadge status={order.status} />,
    },
    {
      key: "orderDate",
      header: "Order Date",
      sortable: true,
      render: (order) => (
        <span className="text-sm text-muted-foreground">{formatDate(order.orderDate)}</span>
      ),
    },
    {
      key: "expectedDelivery",
      header: "Expected Delivery",
      render: (order) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(order.expectedDelivery)}
        </span>
      ),
    },
    {
      key: "fgAvailable",
      header: "FG",
      render: (order) =>
        order.fgAvailable ? (
          <Check className="h-4 w-4 text-green-600" />
        ) : (
          <X className="h-4 w-4 text-red-500" />
        ),
    },
    {
      key: "notifications",
      header: "Notified",
      render: (order) => (
        <div className="flex items-center gap-1.5">
          {order.whatsappSent && (
            <MessageCircle className="h-3.5 w-3.5 text-green-600" />
          )}
          {order.emailSent && (
            <Mail className="h-3.5 w-3.5 text-blue-600" />
          )}
        </div>
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

      <DataTable
        data={orders}
        columns={columns}
        searchKey="orderNumber"
        searchPlaceholder="Search by order number..."
        onRowClick={(order) => router.push(`/crm/orders/${order.id}`)}
      />
    </div>
  );
}
