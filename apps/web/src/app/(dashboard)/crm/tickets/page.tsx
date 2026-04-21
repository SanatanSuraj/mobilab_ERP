"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiTickets, useApiAccounts } from "@/hooks/useCrmApi";
import type { Ticket, TicketStatus } from "@mobilab/contracts";
import {
  Ticket as TicketIcon,
  AlertCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

/**
 * Support Tickets list — /crm/tickets via useApiTickets.
 *
 * Contract ↔ prototype shape deltas handled here:
 *   - Statuses / priorities / categories are UPPER_CASE now. Filter values,
 *     KPI comparisons, and the SLA helper all switched over.
 *   - `whatsappNotified` isn't in the wire contract (it was UI-only mock
 *     metadata) — the column is dropped rather than faked.
 *   - `accountId` + `slaDeadline` + `assignedTo` are nullable. Every render
 *     path falls back to "—"/"N/A" rather than exploding.
 *   - Account-name lookup is a side-fetch of /crm/accounts (same pattern as
 *     the contacts page). Followup: denormalise on the backend or fetch
 *     on demand per visible row.
 */

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: "all" | TicketStatus;
  label: string;
}> = [
  { value: "all", label: "All Statuses" },
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "WAITING_CUSTOMER", label: "Waiting Customer" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

/**
 * SLA countdown text + breached-flag. Returns "Resolved" for terminal
 * statuses and "—" when the backend hasn't assigned an SLA deadline yet
 * (accepted here rather than hiding the column — an SLA-less ticket is
 * itself a signal).
 */
function getSlaDisplay(
  slaDeadline: string | null,
  status: TicketStatus
): { text: string; isBreached: boolean } {
  if (status === "RESOLVED" || status === "CLOSED") {
    return { text: "Resolved", isBreached: false };
  }
  if (!slaDeadline) {
    return { text: "—", isBreached: false };
  }
  const now = new Date();
  const deadline = new Date(slaDeadline);
  const diff = deadline.getTime() - now.getTime();
  if (diff <= 0) {
    return { text: "Breached", isBreached: true };
  }
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return { text: `${days}d ${hours % 24}h left`, isBreached: false };
  }
  return { text: `${hours}h ${mins}m left`, isBreached: false };
}

export default function TicketsPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>(
    "all"
  );

  const ticketsQuery = useApiTickets({
    limit: 100,
    // Only scope server-side when a specific status is picked; "all" asks
    // for everything (server-side pagination still applies).
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
  });
  const accountsQuery = useApiAccounts({ limit: 100 });

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accountsQuery.data?.data ?? []) {
      map.set(a.id, a.name);
    }
    return map;
  }, [accountsQuery.data]);

  if (ticketsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (ticketsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load tickets</p>
            <p className="text-red-700 mt-1">
              {ticketsQuery.error instanceof Error
                ? ticketsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const tickets = ticketsQuery.data?.data ?? [];

  // KPIs are computed on the *unfiltered* totals when "all" is selected; a
  // status-filtered fetch can only report its own counts, so the KPI tiles
  // mirror the current view instead of a separate aggregate endpoint.
  const totalTickets = tickets.length;
  const openCount = tickets.filter((t) => t.status === "OPEN").length;
  const inProgressCount = tickets.filter(
    (t) => t.status === "IN_PROGRESS"
  ).length;
  const resolvedCount = tickets.filter(
    (t) => t.status === "RESOLVED" || t.status === "CLOSED"
  ).length;
  const criticalCount = tickets.filter(
    (t) => t.priority === "CRITICAL"
  ).length;

  const columns: Column<Ticket>[] = [
    {
      key: "ticketNumber",
      header: "Ticket #",
      sortable: true,
      render: (ticket) => (
        <span className="font-medium text-sm">{ticket.ticketNumber}</span>
      ),
    },
    {
      key: "subject",
      header: "Subject",
      render: (ticket) => (
        <span className="text-sm max-w-[200px] truncate block">
          {ticket.subject}
        </span>
      ),
    },
    {
      key: "accountId",
      header: "Account",
      render: (ticket) => (
        <span className="text-sm">
          {ticket.accountId
            ? accountNameById.get(ticket.accountId) ?? "Unknown"
            : "N/A"}
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (ticket) => <StatusBadge status={ticket.category} />,
    },
    {
      key: "priority",
      header: "Priority",
      render: (ticket) => <StatusBadge status={ticket.priority} />,
    },
    {
      key: "status",
      header: "Status",
      render: (ticket) => <StatusBadge status={ticket.status} />,
    },
    {
      key: "assignedTo",
      header: "Assigned To",
      render: (ticket) => (
        <span className="text-sm text-muted-foreground">
          {ticket.assignedTo ? ticket.assignedTo.slice(0, 8) : "N/A"}
        </span>
      ),
    },
    {
      key: "slaDeadline",
      header: "SLA",
      render: (ticket) => {
        const sla = getSlaDisplay(ticket.slaDeadline, ticket.status);
        return (
          <span
            className={`text-xs font-medium ${
              sla.isBreached ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {sla.text}
          </span>
        );
      },
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Support Tickets"
        description="Track and resolve customer support requests"
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard
          title="Total Tickets"
          value={String(totalTickets)}
          icon={TicketIcon}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Open"
          value={String(openCount)}
          icon={AlertCircle}
          iconColor="text-amber-600"
        />
        <KPICard
          title="In Progress"
          value={String(inProgressCount)}
          icon={Clock}
          iconColor="text-indigo-600"
        />
        <KPICard
          title="Resolved"
          value={String(resolvedCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Critical"
          value={String(criticalCount)}
          icon={AlertTriangle}
          iconColor="text-red-600"
        />
      </div>

      <DataTable<Ticket>
        data={tickets}
        columns={columns}
        searchKey="ticketNumber"
        searchPlaceholder="Search by ticket number..."
        onRowClick={(ticket) => router.push(`/crm/tickets/${ticket.id}`)}
        actions={
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter((v as "all" | TicketStatus) ?? "all")
            }
          >
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
