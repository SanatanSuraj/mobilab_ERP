"use client";

/**
 * /vendor-admin/tenants — the primary vendor workbench.
 *
 * Lists every tenant (BYPASSRLS server-side, so no cross-tenant filtering
 * concerns) with:
 *   - status + plan + name filters
 *   - offset/limit pagination (page size 50 is hard-coded for now; the API
 *     caps at 200)
 *   - click-through to the detail page for suspend / reinstate / change-plan
 *
 * We intentionally do NOT try to do live filtering on the client — we
 * re-query the API on every filter change. The backend does the heavy
 * lifting (ILIKE, LEFT LATERAL join) and the filter state lives in local
 * component state, not the URL, to keep the code simple for now. If we
 * want shareable filter URLs later, this is the place to add it.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import type { PlanCode, TenantStatus } from "@instigenie/contracts/billing";
import type { VendorTenantRow } from "@instigenie/contracts/vendor-admin";
import { PLAN_CODES, TENANT_STATUSES } from "@instigenie/contracts/billing";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  apiVendorListTenants,
  ApiProblem,
} from "@/lib/api/vendor-admin";

const PAGE_SIZE = 50;

type Filters = {
  status: TenantStatus | "ALL";
  plan: PlanCode | "ALL";
  q: string;
};

const DEFAULT_FILTERS: Filters = { status: "ALL", plan: "ALL", q: "" };

export default function TenantsListPage() {
  const router = useRouter();

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [draftQuery, setDraftQuery] = useState("");
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<VendorTenantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search input so we don't fire a request on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((f) => ({ ...f, q: draftQuery.trim() }));
      setOffset(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [draftQuery]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiVendorListTenants({
          status:
            filters.status === "ALL" ? undefined : (filters.status as TenantStatus),
          plan: filters.plan === "ALL" ? undefined : (filters.plan as PlanCode),
          q: filters.q || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        if (cancelled) return;
        setRows(res.items);
        setTotal(res.total);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiProblem
            ? err.problem.detail ?? err.problem.title
            : "Could not load tenants."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [filters, offset]);

  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + rows.length, total);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tenants</h1>
          <p className="text-sm text-slate-500">
            Every customer org, across every plan and status.
          </p>
        </div>
        <div className="text-sm text-slate-500">
          {total.toLocaleString()} total
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px] space-y-1.5">
              <Label
                htmlFor="search"
                className="text-xs text-slate-500 flex items-center gap-1.5"
              >
                <Search className="h-3.5 w-3.5" />
                Search
              </Label>
              <Input
                id="search"
                placeholder="Filter by name…"
                value={draftQuery}
                onChange={(e) => setDraftQuery(e.target.value)}
              />
            </div>
            <FilterSelect
              label="Status"
              value={filters.status}
              onChange={(v) => {
                setFilters((f) => ({ ...f, status: v as Filters["status"] }));
                setOffset(0);
              }}
              options={[
                { value: "ALL", label: "All statuses" },
                ...TENANT_STATUSES.map((s) => ({ value: s, label: s })),
              ]}
            />
            <FilterSelect
              label="Plan"
              value={filters.plan}
              onChange={(v) => {
                setFilters((f) => ({ ...f, plan: v as Filters["plan"] }));
                setOffset(0);
              }}
              options={[
                { value: "ALL", label: "All plans" },
                ...PLAN_CODES.map((p) => ({ value: p, label: p })),
              ]}
            />
            {(filters.status !== "ALL" ||
              filters.plan !== "ALL" ||
              filters.q) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  setDraftQuery("");
                  setOffset(0);
                }}
              >
                <SlidersHorizontal className="h-4 w-4 mr-1.5" />
                Reset
              </Button>
            )}
          </div>

          <div className="border border-slate-200 rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400 inline-block" />
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-rose-600"
                    >
                      {error}
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-slate-500"
                    >
                      No tenants match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={() =>
                        router.push(`/vendor-admin/tenants/${row.id}`)
                      }
                      className="cursor-pointer"
                    >
                      <TableCell>
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-slate-400 font-mono">
                          {row.id.slice(0, 8)}…
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>
                        {row.plan ? (
                          <Badge variant="outline">{row.plan.code}</Badge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <BillingCell row={row} />
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDate(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <ArrowRight className="h-4 w-4 text-slate-300" />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            <div>
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </span>
              ) : (
                <span>
                  Showing {showingFrom.toLocaleString()}–
                  {showingTo.toLocaleString()} of {total.toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + rows.length >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Small cell components ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: TenantStatus }) {
  const variant = useMemo((): {
    bg: string;
    text: string;
    dot: string;
  } => {
    switch (status) {
      case "TRIAL":
        return { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-500" };
      case "ACTIVE":
        return {
          bg: "bg-emerald-50",
          text: "text-emerald-700",
          dot: "bg-emerald-500",
        };
      case "SUSPENDED":
        return {
          bg: "bg-amber-50",
          text: "text-amber-800",
          dot: "bg-amber-500",
        };
      case "DELETED":
        return { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" };
      default:
        return {
          bg: "bg-slate-50",
          text: "text-slate-700",
          dot: "bg-slate-400",
        };
    }
  }, [status]);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${variant.bg} ${variant.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${variant.dot}`} />
      {status}
    </span>
  );
}

function BillingCell({ row }: { row: VendorTenantRow }) {
  if (!row.subscription) {
    return <span className="text-xs text-slate-400">No subscription</span>;
  }
  return (
    <div className="text-xs leading-tight">
      <div className="font-medium text-slate-700">
        {row.subscription.status}
      </div>
      <div className="text-slate-400">
        renews {formatDate(row.subscription.currentPeriodEnd)}
        {row.subscription.cancelAtPeriodEnd && " · cancels at period end"}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500">{label}</Label>
      <Select
        value={value}
        // base-ui's Select hands us string | null (a "deselect" signal).
        // Our filters don't support deselection — the "ALL" sentinel
        // covers that — so coerce null back to the current value.
        onValueChange={(v) => onChange(v ?? value)}
      >
        <SelectTrigger className="w-[170px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}
