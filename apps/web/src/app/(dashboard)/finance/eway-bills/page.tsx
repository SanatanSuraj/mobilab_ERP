"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle, AlertTriangle, Truck, Loader2 } from "lucide-react";
import { ewayBills, getFinCustomerById } from "@/data/finance-mock";
import { formatCurrency } from "@/data/mock";
import { toast } from "sonner";

import type { EWayBill } from "@/data/finance-mock";

export default function EwayBillsPage() {
  const [generating, setGenerating] = useState(false);

  const totalEwbs = ewayBills.length;
  const activeEwbs = ewayBills.filter((e) => e.status === "active").length;
  const expiredEwbs = ewayBills.filter((e) => e.status === "expired").length;

  function handleGenerateEwb() {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      const fakeEwb = `2714 ${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(1000 + Math.random() * 9000)}`;
      toast.success(`E-Way Bill generated successfully: ${fakeEwb}`);
    }, 2000);
  }

  const columns: Column<EWayBill>[] = [
    {
      key: "ewbNumber",
      header: "EWB Number",
      sortable: true,
      render: (ewb) => <span className="text-sm font-mono">{ewb.ewbNumber}</span>,
    },
    {
      key: "invoiceRef",
      header: "Invoice Ref",
      sortable: true,
      render: (ewb) => <span className="text-sm font-mono">{ewb.invoiceRef}</span>,
    },
    {
      key: "customerId",
      header: "Customer",
      render: (ewb) => {
        const customer = getFinCustomerById(ewb.customerId);
        return <span className="text-sm">{customer?.name ?? "Unknown"}</span>;
      },
    },
    {
      key: "fromState",
      header: "Route",
      render: (ewb) => (
        <span className="text-sm text-muted-foreground">
          {ewb.fromState} &rarr; {ewb.toState}
        </span>
      ),
    },
    {
      key: "transporterName",
      header: "Transporter",
      render: (ewb) => <span className="text-sm">{ewb.transporterName}</span>,
    },
    {
      key: "vehicleNumber",
      header: "Vehicle",
      render: (ewb) => <span className="text-sm font-mono">{ewb.vehicleNumber}</span>,
    },
    {
      key: "value",
      header: "Value",
      sortable: true,
      className: "text-right",
      render: (ewb) => (
        <span className="text-sm font-medium">{formatCurrency(ewb.value)}</span>
      ),
    },
    {
      key: "generatedDate",
      header: "Generated",
      sortable: true,
      render: (ewb) => <span className="text-sm text-muted-foreground">{ewb.generatedDate}</span>,
    },
    {
      key: "validUntil",
      header: "Valid Until",
      sortable: true,
      render: (ewb) => <span className="text-sm text-muted-foreground">{ewb.validUntil}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (ewb) => <StatusBadge status={ewb.status} />,
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="E-Way Bill Management"
        description="Generate and track e-way bills for goods movement"
        actions={
          <Button onClick={handleGenerateEwb} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Truck className="h-4 w-4 mr-2" />
                Generate EWB
              </>
            )}
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title="Total E-Way Bills" value={String(totalEwbs)} icon={FileText} />
        <KPICard
          title="Active"
          value={String(activeEwbs)}
          icon={CheckCircle}
          iconColor="text-green-600"
        />
        <KPICard
          title="Expired"
          value={String(expiredEwbs)}
          icon={AlertTriangle}
          iconColor="text-amber-600"
        />
      </div>

      <DataTable<EWayBill>
        data={ewayBills}
        columns={columns}
        searchKey="ewbNumber"
        searchPlaceholder="Search by EWB number..."
        pageSize={10}
      />
    </div>
  );
}
