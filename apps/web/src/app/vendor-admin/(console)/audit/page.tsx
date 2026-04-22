"use client";

/**
 * /vendor-admin/audit — the forensic view.
 *
 * Every row in vendor.action_log is renderable here. Filters:
 *   - org (uuid, exact — typically arrived at via "See full audit log →"
 *     link on a tenant detail page, which preseeds ?orgId=…)
 *   - action type (suspend / reinstate / change_plan / view / list …)
 *   - pagination (50 / page, same as the tenants list)
 *
 * The backend records THIS page load as a tenant.view_audit entry so the
 * log itself is self-auditing.
 *
 * Because the API uses `.default(50)` for limit and `.default(0)` for offset,
 * every query goes through the same listAudit pipeline server-side — we
 * just feed it the filters the user selected.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";

import type { VendorActionLogEntry } from "@instigenie/contracts/vendor-admin";
import { VENDOR_ACTION_TYPES } from "@instigenie/contracts/vendor-admin";

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
  apiVendorListAudit,
  ApiProblem,
} from "@/lib/api/vendor-admin";

const PAGE_SIZE = 50;

export default function AuditPage() {
  return (
    <Suspense fallback={<AuditFallback />}>
      <AuditLog />
    </Suspense>
  );
}

function AuditFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  );
}

function AuditLog() {
  const router = useRouter();
  const params = useSearchParams();

  const initialOrgId = params.get("orgId") ?? "";
  const initialAction = params.get("action") ?? "ALL";
  const [orgIdInput, setOrgIdInput] = useState<string>(initialOrgId);
  const [orgIdFilter, setOrgIdFilter] = useState<string>(initialOrgId);
  const [action, setAction] = useState<string>(initialAction);
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<VendorActionLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the org-id text field so we don't query on every keystroke.
  // The field only accepts a UUID — anything shorter we ignore.
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = orgIdInput.trim();
      setOrgIdFilter(isUuid(trimmed) || trimmed === "" ? trimmed : "");
      setOffset(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [orgIdInput]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiVendorListAudit({
          orgId: orgIdFilter || undefined,
          action: action === "ALL" ? undefined : action,
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
            : "Could not load audit log."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [orgIdFilter, action, offset]);

  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + rows.length, total);

  function clearOrgFilter() {
    setOrgIdInput("");
    setOrgIdFilter("");
    setOffset(0);
    // Keep query string in sync so the back-button story is coherent.
    const qs = new URLSearchParams(params?.toString() ?? "");
    qs.delete("orgId");
    router.replace(`/vendor-admin/audit?${qs.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
          <p className="text-sm text-slate-500">
            Every action taken through the vendor console. Append-only.
          </p>
        </div>
        <div className="text-sm text-slate-500">
          {total.toLocaleString()} total
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[280px] space-y-1.5">
              <Label
                htmlFor="audit-org"
                className="text-xs text-slate-500 flex items-center gap-1.5"
              >
                <Search className="h-3.5 w-3.5" />
                Org ID (UUID)
              </Label>
              <div className="relative">
                <Input
                  id="audit-org"
                  placeholder="paste an org id…"
                  value={orgIdInput}
                  onChange={(e) => setOrgIdInput(e.target.value)}
                  className="font-mono text-xs pr-8"
                />
                {orgIdInput && (
                  <button
                    type="button"
                    onClick={clearOrgFilter}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label="Clear org filter"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {orgIdInput && !isUuid(orgIdInput.trim()) && (
                <p className="text-[11px] text-slate-400">
                  Waiting for a complete UUID…
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Action</Label>
              <Select
                value={action}
                onValueChange={(v) => {
                  // base-ui Select emits string | null; ignore "deselect".
                  if (v === null) return;
                  setAction(v);
                  setOffset(0);
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All actions</SelectItem>
                  {VENDOR_ACTION_TYPES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(orgIdFilter || action !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOrgIdInput("");
                  setOrgIdFilter("");
                  setAction("ALL");
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
                  <TableHead className="w-[160px]">Action</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="w-[180px]">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400 inline-block" />
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-rose-600"
                    >
                      {error}
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-slate-500"
                    >
                      No audit entries match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-[11px] font-normal"
                        >
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.vendorAdminEmail ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {entry.orgId ? (
                          <button
                            type="button"
                            onClick={() =>
                              router.push(
                                `/vendor-admin/tenants/${entry.orgId}`
                              )
                            }
                            className="font-mono text-xs text-slate-600 hover:text-slate-900 hover:underline"
                          >
                            {entry.orgId.slice(0, 8)}…
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <DetailsCell details={entry.details} />
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatDateTime(entry.createdAt)}
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

function DetailsCell({
  details,
}: {
  details: Record<string, unknown> | null;
}) {
  if (!details) return <span className="text-slate-400">—</span>;
  const keys = Object.keys(details);
  if (keys.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="space-y-0.5 text-xs">
      {keys.slice(0, 3).map((k) => (
        <div key={k}>
          <span className="text-slate-400">{k}:</span>{" "}
          <span className="font-mono text-slate-700">
            {formatValue(details[k])}
          </span>
        </div>
      ))}
      {keys.length > 3 && (
        <div className="text-slate-400">+{keys.length - 3} more…</div>
      )}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function isUuid(s: string): boolean {
  // Plain UUID v1–v8 shape check (not strict enough for security but plenty
  // good for "is this long enough to send as a filter").
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}
