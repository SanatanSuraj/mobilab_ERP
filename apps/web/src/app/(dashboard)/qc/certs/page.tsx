"use client";

/**
 * QC Certificates — reads /qc/certs via useApiQcCerts.
 *
 * Certs are append-only records issued when a FINAL_QC inspection passes.
 * The cert snapshots product_name / wo_pid / device_serials at issuance
 * time so it's stable against upstream edits.
 *
 * This page is read + recall-only. Issuance happens from the inspection
 * detail page.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQcCerts } from "@/hooks/useQcApi";
import type { QcCert } from "@instigenie/contracts";
import { AlertCircle, FileCheck2 } from "lucide-react";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function QcCertsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
    }),
    [search],
  );

  const certsQuery = useApiQcCerts(query);

  if (certsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (certsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load certificates
            </p>
            <p className="text-red-700 mt-1">
              {certsQuery.error instanceof Error
                ? certsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const certs = certsQuery.data?.data ?? [];
  const total = certsQuery.data?.meta.total ?? certs.length;

  // "This month" KPI — rough, based on issuedAt ISO strings.
  const thisMonth = certs.filter((c) => {
    const d = new Date(c.issuedAt);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth()
    );
  }).length;

  const columns: Column<QcCert>[] = [
    {
      key: "certNumber",
      header: "Cert #",
      render: (c) => (
        <span className="font-mono text-xs font-semibold text-green-700">
          {c.certNumber}
        </span>
      ),
    },
    {
      key: "productName",
      header: "Product",
      render: (c) => <span className="text-sm">{c.productName ?? "—"}</span>,
    },
    {
      key: "woPid",
      header: "Work Order",
      render: (c) => (
        <span className="font-mono text-xs text-muted-foreground">
          {c.woPid ?? "—"}
        </span>
      ),
    },
    {
      key: "deviceSerials",
      header: "Serials",
      render: (c) => (
        <div className="text-xs text-muted-foreground">
          {c.deviceSerials.length === 0 ? (
            "—"
          ) : c.deviceSerials.length <= 3 ? (
            c.deviceSerials.join(", ")
          ) : (
            <>
              {c.deviceSerials.slice(0, 2).join(", ")}
              <Badge variant="outline" className="ml-1 text-[10px]">
                +{c.deviceSerials.length - 2}
              </Badge>
            </>
          )}
        </div>
      ),
    },
    {
      key: "issuedAt",
      header: "Issued",
      render: (c) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(c.issuedAt)}
        </span>
      ),
    },
    {
      key: "signedByName",
      header: "Signed by",
      render: (c) => <span className="text-sm">{c.signedByName ?? "—"}</span>,
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="QC Certificates"
        description="Append-only certificates issued on passed Final QC inspections"
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KPICard
          title="Total Certificates"
          value={String(total)}
          icon={FileCheck2}
          iconColor="text-green-600"
          change="All time"
          trend="neutral"
        />
        <KPICard
          title="This Month"
          value={String(thisMonth)}
          icon={FileCheck2}
          iconColor="text-blue-600"
          change="Issued in current month"
          trend="up"
        />
        <KPICard
          title="Shown"
          value={String(certs.length)}
          icon={FileCheck2}
          iconColor="text-slate-600"
          change="On this page"
          trend="neutral"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <Label className="text-xs">Search</Label>
          <Input
            placeholder="Cert #, WO PID, product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <DataTable
        data={certs}
        columns={columns}
        pageSize={25}
        onRowClick={(c) =>
          router.push(`/qc/inspections/${c.inspectionId}`)
        }
      />
    </div>
  );
}
