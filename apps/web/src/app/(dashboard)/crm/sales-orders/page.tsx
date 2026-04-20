"use client";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Button } from "@/components/ui/button";
import { salesOrders, formatCurrency, formatDate, SalesOrder } from "@/data/mock";
import { toast } from "sonner";
import { ShoppingCart, DollarSign, Truck, PackageCheck, Wrench } from "lucide-react";

export default function SalesOrdersPage() {
  const totalRevenue = salesOrders.reduce((sum, o) => sum + o.total, 0);
  const deliveredCount = salesOrders.filter((o) => o.status === "delivered").length;
  const processingCount = salesOrders.filter(
    (o) => o.status === "processing" || o.status === "confirmed"
  ).length;

  function handleCreateWorkOrder(order: SalesOrder) {
    toast.success(`Work order created for ${order.orderNumber}`, {
      description: `Customer: ${order.customer}`,
    });
  }

  const columns: Column<SalesOrder>[] = [
    {
      key: "orderNumber",
      header: "Order #",
      sortable: true,
      render: (o) => <span className="text-sm font-medium">{o.orderNumber}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      sortable: true,
      render: (o) => <span className="text-sm">{o.customer}</span>,
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
          {o.items.length} item{o.items.length !== 1 ? "s" : ""}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      sortable: true,
      className: "text-right",
      render: (o) => (
        <span className="text-sm font-medium">{formatCurrency(o.total)}</span>
      ),
    },
    {
      key: "deliveryDate",
      header: "Delivery Date",
      sortable: true,
      render: (o) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(o.deliveryDate)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-[160px]",
      render: (o) => (
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            handleCreateWorkOrder(o);
          }}
        >
          <Wrench className="h-3.5 w-3.5 mr-1.5" />
          Create Work Order
        </Button>
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
          change="+15% this quarter"
          trend="up"
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
        searchKey="customer"
        searchPlaceholder="Search by customer..."
      />
    </div>
  );
}
