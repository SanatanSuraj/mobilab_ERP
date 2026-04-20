"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supportTickets, getAccountById, type SupportTicket } from "@/data/crm-mock";
import { getUserById, formatDate } from "@/data/mock";
import {
  Ticket,
  AlertCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  MessageCircle,
} from "lucide-react";

function getSlaDisplay(slaDeadline: string, status: string): { text: string; isBreached: boolean } {
  if (status === "resolved" || status === "closed") {
    return { text: "Resolved", isBreached: false };
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
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered =
    statusFilter === "all"
      ? supportTickets
      : supportTickets.filter((t) => t.status === statusFilter);

  const totalTickets = supportTickets.length;
  const openCount = supportTickets.filter((t) => t.status === "open").length;
  const inProgressCount = supportTickets.filter((t) => t.status === "in_progress").length;
  const resolvedCount = supportTickets.filter(
    (t) => t.status === "resolved" || t.status === "closed"
  ).length;
  const criticalCount = supportTickets.filter((t) => t.priority === "critical").length;

  const columns: Column<SupportTicket>[] = [
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
      render: (ticket) => {
        const account = getAccountById(ticket.accountId);
        return <span className="text-sm">{account?.name ?? "N/A"}</span>;
      },
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
      render: (ticket) => {
        const user = getUserById(ticket.assignedTo);
        return (
          <span className="text-sm text-muted-foreground">
            {user?.name ?? "N/A"}
          </span>
        );
      },
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
    {
      key: "whatsappNotified",
      header: "",
      render: (ticket) =>
        ticket.whatsappNotified ? (
          <MessageCircle className="h-3.5 w-3.5 text-green-600" />
        ) : null,
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
          icon={Ticket}
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

      <DataTable
        data={filtered}
        columns={columns}
        searchKey="ticketNumber"
        searchPlaceholder="Search by ticket number..."
        onRowClick={(ticket) => router.push(`/crm/tickets/${ticket.id}`)}
        actions={
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? "all")}
          >
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="waiting_customer">Waiting Customer</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
