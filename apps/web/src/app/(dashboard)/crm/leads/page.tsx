"use client";

/**
 * /crm/leads — real-API-backed leads list.
 *
 * Migrated from the mock-store version that used @/hooks/useCrm and
 * @/data/crm-mock shapes. Differences you'll hit if you compare with git:
 *
 *   - Status values are UPPER_SNAKE on the wire (NEW, CONTACTED, …).
 *     The server-side filter query uses them as-is; UI labels are
 *     formatted by StatusBadge / formatStatusLabel.
 *
 *   - estimatedValue is a decimal STRING ("1000.50"), not a number.
 *     Rendered with formatCurrencyStr from lib/format.ts.
 *
 *   - Pagination, filtering and sorting are all server-side. The
 *     DataTable's built-in filtering is bypassed via `serverSide` prop.
 *
 *   - Assignee is a UUID-or-null. We don't yet have a users-in-org
 *     endpoint to resolve names, so for now we display a short fingerprint
 *     of the UUID or "Unassigned". When /org/users lands, hook it up here.
 *
 *   - CSV import is intentionally dropped — the real API has no bulk
 *     import endpoint yet. When one ships, wire a new dialog.
 *
 * Auth: relies on useTenantAuthGuard to bounce unauth'd users to /auth/login.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, AlertTriangle, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { NewApiLeadSheet } from "@/components/crm/leads/NewApiLeadSheet";
import { useApiLeads } from "@/hooks/useCrmApi";
import { useTenantAuthGuard } from "@/hooks/useTenantAuthGuard";
import { formatCurrencyStr, formatRelativeDate } from "@/lib/format";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import type { Lead, LeadStatus } from "@mobilab/contracts";
import type { LeadListQuery } from "@/lib/api/crm";

// ─── Filter options ────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: "ALL" | LeadStatus; label: string }[] = [
  { value: "ALL", label: "All Statuses" },
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "QUALIFIED", label: "Qualified" },
  { value: "CONVERTED", label: "Converted" },
  { value: "LOST", label: "Lost" },
];

const DEFAULT_LIMIT = 25;

// Normalize an UPPER_SNAKE enum back to something StatusBadge can key on
// (StatusBadge's color map for leads uses lowercase keys).
function statusBadgeKey(s: LeadStatus): string {
  return s.toLowerCase();
}

// Short fingerprint so the table cell has *something* to show for an
// assigned user. Replace once we have a users-in-org endpoint.
function shortId(id: string | null): string {
  if (!id) return "Unassigned";
  return id.slice(0, 8);
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const router = useRouter();
  const guard = useTenantAuthGuard();

  // Server-side query state. `page` is 1-indexed to match the API;
  // DataTable uses 0-indexed pages, so we convert at the boundary.
  const [query, setQuery] = useState<LeadListQuery>({
    page: 1,
    limit: DEFAULT_LIMIT,
    sortBy: "createdAt",
    sortDir: "desc",
  });

  // Debounced search — DataTable fires onSearchChange per keystroke; we
  // let the user pause 300ms before round-tripping to the API. Also reset
  // to page 1 so the new filter lands on the first page of results.
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery((q) => ({
        ...q,
        search: searchInput.trim() || undefined,
        page: 1,
      }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const [statusFilter, setStatusFilter] = useState<"ALL" | LeadStatus>("ALL");
  // Propagate status filter into query.
  useEffect(() => {
    setQuery((q) => ({
      ...q,
      status: statusFilter === "ALL" ? undefined : statusFilter,
      page: 1,
    }));
  }, [statusFilter]);

  const [newLeadOpen, setNewLeadOpen] = useState(false);

  // React Query is paused while the guard is checking/redirecting to
  // avoid a spurious 401 ping against the API before login.
  const leadsQuery = useApiLeads(guard === "authenticated" ? query : {});

  // ── Auth states ──────────────────────────────────────────────────────────
  if (guard !== "authenticated") {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-2 text-muted-foreground py-20 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">
            {guard === "redirecting" ? "Redirecting to login…" : "Checking session…"}
          </span>
        </div>
      </div>
    );
  }

  // ── 401 after guard (token expired + refresh failed) ─────────────────────
  if (leadsQuery.isError) {
    const err = leadsQuery.error;
    const is401 = err instanceof ApiProblem && err.problem.status === 401;
    if (is401) {
      return (
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <ShieldAlert className="h-8 w-8 text-amber-500" />
            <h2 className="text-lg font-semibold">Session expired</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Your login has expired. Please sign in again.
            </p>
            <Button onClick={() => router.replace("/auth/login?from=/crm/leads")}>
              Go to login
            </Button>
          </div>
        </div>
      );
    }
  }

  const data = leadsQuery.data;
  const leads: Lead[] = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  const columns: Column<Lead>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (lead) => (
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{lead.name}</span>
          {lead.isDuplicate && (
            <AlertTriangle
              className="h-3.5 w-3.5 text-amber-500 shrink-0"
              aria-label="Possible duplicate"
            />
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
      render: (lead) => <StatusBadge status={statusBadgeKey(lead.status)} />,
    },
    {
      key: "source",
      header: "Source",
      render: (lead) => (
        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {lead.source ?? "—"}
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
          {formatCurrencyStr(lead.estimatedValue)}
        </span>
      ),
    },
    {
      key: "assignedTo",
      header: "Assigned",
      render: (lead) => (
        <span className="text-xs font-mono text-muted-foreground">
          {shortId(lead.assignedTo)}
        </span>
      ),
    },
    {
      key: "lastActivityAt",
      header: "Last Activity",
      sortable: true,
      render: (lead) => (
        <span className="text-sm text-muted-foreground">
          {lead.lastActivityAt ? formatRelativeDate(lead.lastActivityAt) : "—"}
        </span>
      ),
    },
  ];

  const showInitialSkeleton = leadsQuery.isLoading && !data;

  // Memoized header summary so it only recomputes when meta moves.
  const summary = useMemo(() => {
    if (showInitialSkeleton) return null;
    if (total === 0) return "No leads yet";
    if (total === 1) return "1 lead";
    return `${total.toLocaleString("en-IN")} leads`;
  }, [total, showInitialSkeleton]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Leads"
        description={summary ?? "Track and manage your sales leads"}
      />

      {showInitialSkeleton ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <DataTable<Lead>
          serverSide
          data={leads}
          columns={columns}
          pageSize={query.limit ?? DEFAULT_LIMIT}
          totalCount={total}
          searchKey="name"
          searchPlaceholder="Search by name, email, phone…"
          onSearchChange={(s) => setSearchInput(s)}
          onPageChange={(page0) =>
            setQuery((q) => ({ ...q, page: page0 + 1 }))
          }
          onSortChange={(key, dir) =>
            setQuery((q) => ({ ...q, sortBy: key, sortDir: dir }))
          }
          onRowClick={(lead) => router.push(`/crm/leads/${lead.id}`)}
          actions={
            <>
              <Select
                value={statusFilter}
                onValueChange={(v) => v && setStatusFilter(v as "ALL" | LeadStatus)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button size="sm" onClick={() => setNewLeadOpen(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                New Lead
              </Button>
            </>
          }
        />
      )}

      <NewApiLeadSheet open={newLeadOpen} onOpenChange={setNewLeadOpen} />
    </div>
  );
}
