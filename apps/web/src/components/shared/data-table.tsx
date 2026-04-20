"use client";

/**
 * DataTable<T> — generic sortable, searchable, paginated table.
 *
 * Supports two pagination modes:
 *
 * ── Client-side (default) ──────────────────────────────────────────────────
 * Pass all data via `data` prop. The table handles filter / sort / page
 * entirely in the browser. Fine for < ~1 000 rows.
 *
 * ── Server-side ────────────────────────────────────────────────────────────
 * Set `serverSide={true}` and provide:
 *   • totalCount   — full record count from the backend
 *   • onPageChange — called when the user flips pages
 *   • onSearchChange — called when the search input changes
 *   • onSortChange   — called when a column header is clicked
 *
 * In server-side mode `data` holds ONLY the current page (already fetched).
 * The parent component owns the React Query state:
 *
 *   const [page, setPage] = useState(0);
 *   const [search, setSearch] = useState("");
 *   const { data } = useDeals({ page, pageSize: 25, search });
 *
 *   <DataTable
 *     serverSide
 *     data={data?.items ?? []}
 *     totalCount={data?.total ?? 0}
 *     onPageChange={(p) => setPage(p)}
 *     onSearchChange={(s) => { setSearch(s); setPage(0); }}
 *     columns={columns}
 *     pageSize={25}
 *   />
 *
 * Swapping client-side → server-side for an existing table:
 *   1. Move filter/sort/page state up to the parent hook call.
 *   2. Add serverSide + callback props.
 *   3. Done — no column or render changes needed.
 */

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Search, ChevronsLeft, ChevronsRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  // ── Required ────────────────────────────────────────────────────────────
  data: T[];
  columns: Column<T>[];

  // ── Client-side options ─────────────────────────────────────────────────
  searchKey?: string;
  searchPlaceholder?: string;
  onRowClick?: (item: T) => void;
  pageSize?: number;
  actions?: React.ReactNode;

  // ── Server-side pagination ───────────────────────────────────────────────
  /**
   * Enable server-side mode. When true, `data` must contain only the current
   * page and the parent must handle all state via the callbacks below.
   */
  serverSide?: boolean;

  /**
   * Total number of records across ALL pages in the backend dataset.
   * Required when serverSide=true.
   */
  totalCount?: number;

  /**
   * Called when the user changes page.
   * `page` is 0-indexed. `pageSize` matches the `pageSize` prop.
   */
  onPageChange?: (page: number, pageSize: number) => void;

  /**
   * Called when the user types in the search box.
   * Debouncing is the caller's responsibility.
   */
  onSearchChange?: (search: string) => void;

  /**
   * Called when a sortable column header is clicked.
   */
  onSortChange?: (key: string, dir: "asc" | "desc") => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T = any>({
  data,
  columns,
  searchKey,
  searchPlaceholder = "Search...",
  onRowClick,
  pageSize = 10,
  actions,
  // Server-side
  serverSide = false,
  totalCount,
  onPageChange,
  onSearchChange,
  onSortChange,
}: DataTableProps<T>) {
  // ── Local state (used in client-side mode; also tracks UI in server-side) ──
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getField = (item: T, key: string) => (item as any)[key];

  // ── Data pipeline (client-side only) ─────────────────────────────────────
  const filtered = serverSide
    ? data // already filtered by the server
    : data.filter((item) => {
        if (!search || !searchKey) return true;
        const val = String(getField(item, searchKey) ?? "").toLowerCase();
        return val.includes(search.toLowerCase());
      });

  const sorted = serverSide || !sortKey
    ? filtered
    : [...filtered].sort((a, b) => {
        const aVal = String(getField(a, sortKey) ?? "");
        const bVal = String(getField(b, sortKey) ?? "");
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });

  const effectiveTotal = serverSide ? (totalCount ?? data.length) : sorted.length;
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / pageSize));
  const paged = serverSide ? data : sorted.slice(page * pageSize, (page + 1) * pageSize);

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleSearch(value: string) {
    setSearch(value);
    setPage(0);
    if (serverSide) {
      onSearchChange?.(value);
      onPageChange?.(0, pageSize);
    }
  }

  function handleSort(key: string) {
    const newDir = sortKey === key && sortDir === "asc" ? "desc" : "asc";
    setSortKey(key);
    setSortDir(newDir);
    if (serverSide) {
      onSortChange?.(key, newDir);
    }
  }

  function goToPage(newPage: number) {
    setPage(newPage);
    if (serverSide) {
      onPageChange?.(newPage, pageSize);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const showingFrom = page * pageSize + 1;
  const showingTo = Math.min((page + 1) * pageSize, effectiveTotal);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        {searchKey && (
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        )}
        {actions && <div className="flex items-center gap-2 ml-auto">{actions}</div>}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={col.className}
                  onClick={() => col.sortable && handleSort(col.key)}
                  style={col.sortable ? { cursor: "pointer", userSelect: "none" } : undefined}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && sortKey === col.key && (
                      <span className="text-xs opacity-70">
                        {sortDir === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((item, idx) => (
              <TableRow
                key={idx}
                className={onRowClick ? "cursor-pointer hover:bg-muted/50" : ""}
                onClick={() => onRowClick?.(item)}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className}>
                    {col.render
                      ? col.render(item)
                      : String(getField(item, col.key) ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {paged.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-center py-10 text-muted-foreground"
                >
                  No data found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {effectiveTotal === 0
              ? "No results"
              : `Showing ${showingFrom}–${showingTo} of ${effectiveTotal.toLocaleString()}`}
            {serverSide && (
              <span className="ml-1 text-xs opacity-50">(server)</span>
            )}
          </span>

          <div className="flex items-center gap-1">
            {/* First page */}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page === 0}
              onClick={() => goToPage(0)}
              title="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            {/* Previous */}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page === 0}
              onClick={() => goToPage(page - 1)}
              title="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            {/* Page indicator */}
            <span className="px-2 text-xs tabular-nums">
              {page + 1} / {totalPages}
            </span>

            {/* Next */}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= totalPages - 1}
              onClick={() => goToPage(page + 1)}
              title="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            {/* Last page */}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= totalPages - 1}
              onClick={() => goToPage(totalPages - 1)}
              title="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
