"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { NewLeadSheet } from "@/components/crm/leads/NewLeadSheet";
import { CsvImportDialog } from "@/components/crm/leads/CsvImportDialog";
import { useLeads } from "@/hooks/useCrm";
import { formatCurrency, formatDate, getUserById } from "@/data/mock";
import type { EnhancedLead, EnhancedLeadStatus } from "@/data/crm-mock";
import {
  Users,
  UserPlus,
  Target,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Upload,
} from "lucide-react";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL",       label: "All Statuses" },
  { value: "new",       label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "converted", label: "Converted" },
  { value: "lost",      label: "Lost" },
];

export default function LeadsPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: allLeads = [], isLoading } = useLeads();

  const leads = useMemo(() => {
    if (statusFilter === "ALL") return allLeads;
    return allLeads.filter((l) => l.status === statusFilter);
  }, [allLeads, statusFilter]);

  // KPI counts from full dataset (not filtered)
  const kpi = useMemo(() => ({
    total:     allLeads.length,
    new:       allLeads.filter((l) => l.status === "new").length,
    qualified: allLeads.filter((l) => l.status === "qualified").length,
    converted: allLeads.filter((l) => l.status === "converted").length,
    lost:      allLeads.filter((l) => l.status === "lost").length,
  }), [allLeads]);

  const columns: Column<EnhancedLead>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (lead) => (
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{lead.name}</span>
          {lead.isDuplicate && (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="Possible duplicate" />
          )}
        </div>
      ),
    },
    {
      key: "company",
      header: "Company",
      sortable: true,
      render: (lead) => <span className="text-sm">{lead.company}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (lead) => <StatusBadge status={lead.status} />,
    },
    {
      key: "source",
      header: "Source",
      render: (lead) => (
        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {lead.source}
        </span>
      ),
    },
    {
      key: "estimatedValue",
      header: "Est. Value",
      sortable: true,
      className: "text-right",
      render: (lead) => (
        <span className="text-sm font-medium tabular-nums">
          {formatCurrency(lead.estimatedValue)}
        </span>
      ),
    },
    {
      key: "assignedTo",
      header: "Assigned To",
      render: (lead) => {
        const user = getUserById(lead.assignedTo);
        return <span className="text-sm">{user?.name ?? "Unassigned"}</span>;
      },
    },
    {
      key: "lastActivity",
      header: "Last Activity",
      sortable: true,
      render: (lead) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(lead.lastActivity)}
        </span>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Leads"
        description="Track and manage your sales leads"
      />

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <KPICard title="Total" value={String(kpi.total)} icon={Users} />
        <KPICard title="New" value={String(kpi.new)} icon={UserPlus} iconColor="text-blue-600" />
        <KPICard title="Qualified" value={String(kpi.qualified)} icon={Target} iconColor="text-purple-600" />
        <KPICard title="Converted" value={String(kpi.converted)} icon={CheckCircle} iconColor="text-green-600" />
        <KPICard title="Lost" value={String(kpi.lost)} icon={XCircle} iconColor="text-red-600" />
      </div>

      {/* Table toolbar */}
      <DataTable<EnhancedLead>
        data={leads}
        columns={columns}
        searchKey="company"
        searchPlaceholder="Search by name or company…"
        onRowClick={(lead) => router.push(`/crm/leads/${lead.id}`)}
        actions={
          <>
            {/* Status filter */}
            <Select
              value={statusFilter}
              onValueChange={(v) => v && setStatusFilter(v)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* CSV Import */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>

            {/* New Lead */}
            <Button size="sm" onClick={() => setNewLeadOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              New Lead
            </Button>
          </>
        }
      />

      {/* Sheets / Dialogs */}
      <NewLeadSheet open={newLeadOpen} onOpenChange={setNewLeadOpen} />
      <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
