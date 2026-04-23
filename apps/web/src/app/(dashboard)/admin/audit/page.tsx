"use client";

/**
 * Admin audit dashboard — ARCHITECTURE.md §4.2.
 *
 * Tenant-facing read-only view of audit.log with filters for
 * table / action / actor / date-range / free-text. Each row links its
 * trace_id out to Loki (override with NEXT_PUBLIC_LOKI_BASE_URL) and
 * Tempo (NEXT_PUBLIC_TEMPO_BASE_URL) so compliance reviewers can pull
 * the full request waterfall without round-tripping through ops.
 *
 * RLS runs on the server — this page issues a single GET that comes
 * back already scoped to the caller's org. No client-side filtering
 * for security; the limit/offset parameters only shape pagination.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ExternalLink, RefreshCw, FileText } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { listAdminAuditEntries } from "@/lib/api/admin-audit";
import type {
  AdminAuditEntry,
  AdminAuditListQuery,
} from "@instigenie/contracts";

const LOKI_BASE =
  process.env.NEXT_PUBLIC_LOKI_BASE_URL ?? "http://localhost:3100/grafana";
const TEMPO_BASE =
  process.env.NEXT_PUBLIC_TEMPO_BASE_URL ?? "http://localhost:3200/grafana";

const PAGE_SIZE = 50;
const ACTION_BADGE: Record<AdminAuditEntry["action"], string> = {
  INSERT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-amber-50 text-amber-700 border-amber-200",
  DELETE: "bg-rose-50 text-rose-700 border-rose-200",
};

interface FilterState {
  tableName: string;
  action: "" | "INSERT" | "UPDATE" | "DELETE";
  userId: string;
  fromDate: string;
  toDate: string;
  q: string;
}

const EMPTY_FILTER: FilterState = {
  tableName: "",
  action: "",
  userId: "",
  fromDate: "",
  toDate: "",
  q: "",
};

function toQueryParams(
  f: FilterState,
  offset: number,
): Partial<AdminAuditListQuery> {
  const out: Partial<AdminAuditListQuery> = {
    limit: PAGE_SIZE,
    offset,
  };
  if (f.tableName.trim()) out.tableName = f.tableName.trim();
  if (f.action) out.action = f.action;
  if (f.userId.trim()) out.userId = f.userId.trim();
  if (f.fromDate) out.fromDate = new Date(f.fromDate).toISOString();
  if (f.toDate) out.toDate = new Date(f.toDate).toISOString();
  if (f.q.trim()) out.q = f.q.trim();
  return out;
}

function traceUrl(kind: "loki" | "tempo", traceId: string): string {
  if (kind === "tempo") {
    return `${TEMPO_BASE}/explore?left=${encodeURIComponent(
      JSON.stringify({
        datasource: "tempo",
        queries: [{ query: traceId }],
      }),
    )}`;
  }
  return `${LOKI_BASE}/explore?left=${encodeURIComponent(
    JSON.stringify({
      datasource: "loki",
      queries: [{ expr: `{trace_id="${traceId}"}` }],
    }),
  )}`;
}

export default function AdminAuditPage() {
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTER);
  const [offset, setOffset] = useState(0);
  const [detailRow, setDetailRow] = useState<AdminAuditEntry | null>(null);

  const queryParams = useMemo(
    () => toQueryParams(applied, offset),
    [applied, offset],
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-audit", queryParams],
    queryFn: () => listAdminAuditEntries(queryParams),
    // Audit rows don't mutate — a fresh fetch only matters when the
    // user asks for one. 30s staleTime dedupes the page-change pings
    // that happen while the user is still scrolling.
    staleTime: 30_000,
  });

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const applyFilters = (): void => {
    setOffset(0);
    setApplied(draft);
  };
  const clearFilters = (): void => {
    setDraft(EMPTY_FILTER);
    setApplied(EMPTY_FILTER);
    setOffset(0);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="21 CFR Part 11 append-only change history for this tenant. Every row links to its source trace in Loki and Tempo."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="filter-table">Table</Label>
              <Input
                id="filter-table"
                placeholder="e.g. public.sales_invoices"
                value={draft.tableName}
                onChange={(e) =>
                  setDraft({ ...draft, tableName: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="filter-action">Action</Label>
              <Select
                value={draft.action || "ALL"}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    action:
                      v === "ALL"
                        ? ""
                        : (v as "INSERT" | "UPDATE" | "DELETE"),
                  })
                }
              >
                <SelectTrigger id="filter-action">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Any</SelectItem>
                  <SelectItem value="INSERT">INSERT</SelectItem>
                  <SelectItem value="UPDATE">UPDATE</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-user">Actor user id</Label>
              <Input
                id="filter-user"
                placeholder="UUID"
                value={draft.userId}
                onChange={(e) =>
                  setDraft({ ...draft, userId: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="filter-from">From</Label>
              <Input
                id="filter-from"
                type="datetime-local"
                value={draft.fromDate}
                onChange={(e) =>
                  setDraft({ ...draft, fromDate: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="filter-to">To</Label>
              <Input
                id="filter-to"
                type="datetime-local"
                value={draft.toDate}
                onChange={(e) =>
                  setDraft({ ...draft, toDate: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="filter-q">Free text (before/after jsonb)</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="filter-q"
                  className="pl-9"
                  placeholder="e.g. POSTED, cancelled, 1234"
                  value={draft.q}
                  onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={applyFilters}>Apply</Button>
            <Button variant="outline" onClick={clearFilters}>
              Clear
            </Button>
            <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                />
                <span className="ml-1">Refresh</span>
              </Button>
              {total > 0 ? <span>{total.toLocaleString()} rows</span> : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Entries</CardTitle>
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </div>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="p-6 text-sm text-rose-600">
              Failed to load audit log:{" "}
              {error instanceof Error ? error.message : String(error)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">When</TableHead>
                  <TableHead className="w-[90px]">Action</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="w-[320px]">Trace</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No audit rows match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(row.changedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={ACTION_BADGE[row.action]}
                        >
                          {row.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.tableName}
                        {row.rowId ? (
                          <div className="text-[11px] text-muted-foreground">
                            id: {row.rowId.slice(0, 8)}…
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.actorName || row.actorEmail ? (
                          <div>
                            <div className="font-medium">
                              {row.actorName || row.actorEmail}
                            </div>
                            {row.actorName && row.actorEmail ? (
                              <div className="text-xs text-muted-foreground">
                                {row.actorEmail}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            system / migration
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.traceId ? (
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                              {row.traceId.length > 20
                                ? `${row.traceId.slice(0, 20)}…`
                                : row.traceId}
                            </code>
                            <a
                              className="text-xs underline decoration-dotted hover:text-primary"
                              href={traceUrl("loki", row.traceId)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Loki
                            </a>
                            <a
                              className="text-xs underline decoration-dotted hover:text-primary"
                              href={traceUrl("tempo", row.traceId)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Tempo
                            </a>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDetailRow(row)}
                        >
                          <FileText className="h-4 w-4" />
                          <span className="sr-only">Inspect</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}

          <div className="mt-4 flex items-center justify-between text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              ← Previous
            </Button>
            <div className="text-muted-foreground">
              Showing {Math.min(offset + 1, total)} –
              {" "}
              {Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next →
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={detailRow !== null}
        onOpenChange={(open) => (open ? undefined : setDetailRow(null))}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {detailRow?.action} · {detailRow?.tableName}
            </DialogTitle>
          </DialogHeader>
          {detailRow ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-muted-foreground">Row id</div>
                  <code className="font-mono">
                    {detailRow.rowId ?? "—"}
                  </code>
                </div>
                <div>
                  <div className="text-muted-foreground">When</div>
                  <div>{new Date(detailRow.changedAt).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Actor</div>
                  <div>
                    {detailRow.actorName || detailRow.actorEmail || "system"}
                    {detailRow.actorId ? (
                      <div className="font-mono text-[11px]">
                        {detailRow.actorId}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Trace</div>
                  <div className="flex items-center gap-2">
                    <code className="font-mono">
                      {detailRow.traceId ?? "—"}
                    </code>
                    {detailRow.traceId ? (
                      <>
                        <a
                          className="text-primary underline"
                          href={traceUrl("loki", detailRow.traceId)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="inline h-3 w-3" /> Loki
                        </a>
                        <a
                          className="text-primary underline"
                          href={traceUrl("tempo", detailRow.traceId)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="inline h-3 w-3" /> Tempo
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Before
                  </div>
                  <pre className="max-h-[50vh] overflow-auto rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(detailRow.before ?? null, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    After
                  </div>
                  <pre className="max-h-[50vh] overflow-auto rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(detailRow.after ?? null, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
