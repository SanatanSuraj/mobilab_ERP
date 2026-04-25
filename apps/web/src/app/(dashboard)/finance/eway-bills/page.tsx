"use client";

/**
 * GST E-way bill register.
 *
 * One row per generated EWB (above the value threshold for inter/intra-state
 * shipments). Read-only Phase-5 surface — writes happen via SQL seed for
 * now; real GSTN-portal integration is a Phase-6 task.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiEwayBills } from "@/hooks/useFinanceApi";
import type {
  EwayBill,
  EwbStatus,
  EwbTransportMode,
} from "@instigenie/contracts";
import {
  Truck,
  CheckCircle2,
  Ban,
  Hourglass,
} from "lucide-react";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatINR(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

type StatusFilter = EwbStatus | "all";
type ModeFilter = EwbTransportMode | "all";

export default function EwayBillsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [mode, setMode] = useState<ModeFilter>("all");

  const query = useApiEwayBills(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "generatedAt" as const,
        sortDir: "desc" as const,
        status: status === "all" ? undefined : status,
        transportMode: mode === "all" ? undefined : mode,
      }),
      [status, mode],
    ),
  );

  if (query.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="E-Way Bill Management"
          description="Generated e-way bills for goods movement above the GST threshold"
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

  const rows = query.data?.data ?? [];

  const total = rows.length;
  const active = rows.filter((r) => r.status === "ACTIVE").length;
  const cancelled = rows.filter((r) => r.status === "CANCELLED").length;
  const expired = rows.filter((r) => r.status === "EXPIRED").length;
  const totalValue = rows.reduce((sum, r) => {
    const n = Number(r.invoiceValue);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

  const columns: Column<EwayBill>[] = [
    {
      key: "ewbNumber",
      header: "EWB #",
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.ewbNumber}</span>
      ),
    },
    {
      key: "invoiceNumber",
      header: "Invoice #",
      render: (r) => (
        <div className="space-y-0.5">
          <div className="font-mono text-xs">{r.invoiceNumber}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatDate(r.invoiceDate)}
          </div>
        </div>
      ),
    },
    {
      key: "consignee",
      header: "Consignee",
      render: (r) => (
        <div className="space-y-0.5">
          <div className="text-sm">{r.consigneeName ?? "—"}</div>
          {r.consigneeGstin && (
            <div className="text-[11px] font-mono text-muted-foreground">
              {r.consigneeGstin}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "route",
      header: "Route",
      render: (r) => (
        <div className="text-xs space-y-0.5">
          <div>
            <span className="font-mono text-muted-foreground">
              {r.fromStateCode}
            </span>
            {" → "}
            <span className="font-mono text-muted-foreground">
              {r.toStateCode}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground line-clamp-1">
            {r.fromPlace} → {r.toPlace}
          </div>
        </div>
      ),
    },
    {
      key: "distanceKm",
      header: "Distance",
      render: (r) => (
        <span className="text-xs font-mono text-muted-foreground">
          {r.distanceKm} km
        </span>
      ),
    },
    {
      key: "transportMode",
      header: "Mode",
      render: (r) => <StatusBadge status={r.transportMode} />,
    },
    {
      key: "vehicleNumber",
      header: "Vehicle",
      render: (r) => (
        <span className="font-mono text-xs">{r.vehicleNumber ?? "—"}</span>
      ),
    },
    {
      key: "invoiceValue",
      header: "Value",
      render: (r) => (
        <span className="font-mono text-xs font-semibold">
          {formatINR(r.invoiceValue)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "generatedAt",
      header: "Generated",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.generatedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="E-Way Bill Management"
        description="Generated e-way bills for goods movement above the GST threshold"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total EWBs"
          value={String(total)}
          icon={Truck}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Active"
          value={String(active)}
          icon={CheckCircle2}
          iconColor="text-green-700"
        />
        <KPICard
          title="Cancelled / Expired"
          value={String(cancelled + expired)}
          icon={Ban}
          iconColor="text-red-600"
        />
        <KPICard
          title="Total Value"
          value={
            new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
              maximumFractionDigits: 0,
            }).format(totalValue)
          }
          icon={Hourglass}
          iconColor="text-amber-600"
        />
      </div>

      <DataTable<EwayBill>
        data={rows}
        columns={columns}
        searchKey="ewbNumber"
        searchPlaceholder="Search EWB / invoice / consignee..."
        pageSize={15}
        actions={
          <div className="flex gap-2">
            <Select
              value={status}
              onValueChange={(v) => setStatus((v ?? "all") as StatusFilter)}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={mode}
              onValueChange={(v) => setMode((v ?? "all") as ModeFilter)}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modes</SelectItem>
                <SelectItem value="ROAD">Road</SelectItem>
                <SelectItem value="RAIL">Rail</SelectItem>
                <SelectItem value="AIR">Air</SelectItem>
                <SelectItem value="SHIP">Ship</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />
    </div>
  );
}
