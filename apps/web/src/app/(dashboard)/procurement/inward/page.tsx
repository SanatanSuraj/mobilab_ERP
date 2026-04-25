"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Truck, ClipboardCheck, FileCheck } from "lucide-react";
import { useApiGrns, useApiVendors } from "@/hooks/useProcurementApi";
import type { Grn } from "@instigenie/contracts";
import { formatDate } from "@/lib/format";

/**
 * Inward register — in the real contracts, GRN is the canonical receipt
 * document. The old mock had a pre-GRN "inward entry" concept that hasn't
 * shipped server-side; this page now lists GRNs directly.
 */

export default function InwardPage() {
  const grnsQuery = useApiGrns({ limit: 200 });
  const vendorsQuery = useApiVendors({ limit: 200 });

  const grns = useMemo(
    () => grnsQuery.data?.data ?? [],
    [grnsQuery.data?.data]
  );
  const vendorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vendorsQuery.data?.data ?? []) map.set(v.id, v.name);
    return map;
  }, [vendorsQuery.data?.data]);

  const counts = useMemo(
    () => ({
      draft: grns.filter((g) => g.status === "DRAFT").length,
      posted: grns.filter((g) => g.status === "POSTED").length,
      total: grns.length,
      withInvoice: grns.filter((g) => g.invoiceNumber).length,
    }),
    [grns]
  );

  const columns: Column<Grn>[] = [
    {
      key: "grnNumber",
      header: "GRN#",
      sortable: true,
      render: (g) => (
        <span className="font-mono text-xs font-bold">{g.grnNumber}</span>
      ),
    },
    {
      key: "vendorId",
      header: "Vendor",
      render: (g) => (
        <span className="text-sm">
          {vendorById.get(g.vendorId) ?? g.vendorId.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "receivedDate",
      header: "Received",
      render: (g) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(g.receivedDate)}
        </span>
      ),
    },
    {
      key: "vehicleNumber",
      header: "Vehicle",
      render: (g) => (
        <span className="text-xs font-mono">{g.vehicleNumber ?? "—"}</span>
      ),
    },
    {
      key: "invoiceNumber",
      header: "Invoice",
      render: (g) => (
        <span className="text-xs">
          {g.invoiceNumber ?? (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (g) => <StatusBadge status={g.status} />,
    },
  ];

  const isLoading = grnsQuery.isLoading || vendorsQuery.isLoading;
  if (isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Inward Register"
          description="Goods received against purchase orders"
        />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Inward Register"
        description="Goods received against purchase orders"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Draft"
          value={String(counts.draft)}
          icon={Truck}
          trend="neutral"
          iconColor="text-amber-600"
        />
        <KPICard
          title="Posted"
          value={String(counts.posted)}
          icon={ClipboardCheck}
          trend="up"
          iconColor="text-green-600"
        />
        <KPICard
          title="With Invoice"
          value={String(counts.withInvoice)}
          icon={FileCheck}
          trend="neutral"
          iconColor="text-blue-600"
        />
        <KPICard
          title="Total"
          value={String(counts.total)}
          icon={Package}
          trend="neutral"
          iconColor="text-indigo-600"
        />
      </div>

      <DataTable<Grn>
        data={grns}
        columns={columns}
        searchKey="grnNumber"
        searchPlaceholder="Search by GRN number..."
      />
    </div>
  );
}
