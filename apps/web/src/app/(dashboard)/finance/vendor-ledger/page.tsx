"use client";

/**
 * Vendor Ledger — reads /finance/vendor-ledger via useApiVendorLedger.
 *
 * Mirror of customer-ledger for the AP side. Append-only feed of vendor
 * money events (BILL / PAYMENT / ADJUSTMENT / OPENING_BALANCE). Same
 * two-mode pattern — global feed with no filter, per-vendor feed + balance
 * when a vendor ID is selected.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useApiFinanceOverview,
  useApiPurchaseInvoices,
  useApiVendorBalance,
  useApiVendorLedger,
} from "@/hooks/useFinanceApi";
import {
  VENDOR_LEDGER_ENTRY_TYPES,
  type VendorLedgerEntryType,
} from "@mobilab/contracts";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  Receipt,
  ShoppingCart,
} from "lucide-react";

// ─── Display helpers ─────────────────────────────────────────────────────────

function formatMoney(value: string, currency = "INR"): string {
  const n = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const ENTRY_TONE: Record<VendorLedgerEntryType, string> = {
  BILL: "bg-orange-50 text-orange-700 border-orange-200",
  PAYMENT: "bg-green-50 text-green-700 border-green-200",
  DEBIT_NOTE: "bg-purple-50 text-purple-700 border-purple-200",
  ADJUSTMENT: "bg-amber-50 text-amber-700 border-amber-200",
  OPENING_BALANCE: "bg-gray-50 text-gray-600 border-gray-200",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function VendorLedgerPage() {
  const [vendorId, setVendorId] = useState<string>("");
  const [entryType, setEntryType] = useState<VendorLedgerEntryType | "all">(
    "all",
  );

  // Vendor dropdown options from recent purchase invoices
  const invoicesQuery = useApiPurchaseInvoices({ limit: 100 });
  const vendorOptions = useMemo(() => {
    const entries = invoicesQuery.data?.data ?? [];
    const map = new Map<string, string>();
    for (const inv of entries) {
      if (!inv.vendorId) continue;
      if (!map.has(inv.vendorId)) {
        map.set(inv.vendorId, inv.vendorName ?? inv.vendorId.slice(0, 8));
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [invoicesQuery.data]);

  const query = useMemo(
    () => ({
      limit: 200,
      vendorId: vendorId.trim() || undefined,
      entryType: entryType === "all" ? undefined : entryType,
    }),
    [vendorId, entryType],
  );

  const ledgerQuery = useApiVendorLedger(query);
  const balanceQuery = useApiVendorBalance(vendorId.trim() || undefined);
  const overviewQuery = useApiFinanceOverview();

  const kpi = overviewQuery.data;
  const entries = ledgerQuery.data?.data ?? [];
  const total = ledgerQuery.data?.meta.total ?? entries.length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Vendor Ledger"
        description="Append-only money events for vendors — bills, payments, adjustments"
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Vendor</Label>
          <Select
            value={vendorId || "all"}
            onValueChange={(v) =>
              setVendorId(!v || v === "all" ? "" : v)
            }
          >
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="All vendors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {vendorOptions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 max-w-[360px]">
          <Label className="text-xs text-muted-foreground">
            Vendor ID (type/paste UUID)
          </Label>
          <Input
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Entry Type</Label>
          <Select
            value={entryType}
            onValueChange={(v) =>
              setEntryType(v as VendorLedgerEntryType | "all")
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {VENDOR_LEDGER_ENTRY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Per-vendor balance / overview */}
      {vendorId ? (
        <Card>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Vendor ID</p>
                <p className="text-xs font-mono mt-0.5">{vendorId}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Current Balance (Payable)
                </p>
                {balanceQuery.isLoading ? (
                  <Skeleton className="h-6 w-24 mt-1" />
                ) : balanceQuery.isError || !balanceQuery.data ? (
                  <p className="text-sm text-muted-foreground mt-0.5">—</p>
                ) : (
                  <p className="text-lg font-semibold mt-0.5 text-orange-700 tabular-nums">
                    {formatMoney(
                      balanceQuery.data.balance,
                      kpi?.currency ?? "INR",
                    )}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Entries</p>
                <p className="text-sm font-medium mt-0.5">
                  {ledgerQuery.isLoading ? "…" : total}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="AP Outstanding"
            value={kpi ? formatMoney(kpi.apOutstanding, kpi.currency) : "—"}
            icon={ShoppingCart}
            iconColor="text-orange-600"
            change={kpi ? `${kpi.postedPurchaseInvoices} posted` : ""}
            trend="neutral"
          />
          <KPICard
            title="AP 30+ days"
            value={kpi ? formatMoney(kpi.apOverdue30, kpi.currency) : "—"}
            icon={Clock}
            iconColor="text-amber-600"
            change="Aging bucket"
            trend="neutral"
          />
          <KPICard
            title="AP 60+ days"
            value={kpi ? formatMoney(kpi.apOverdue60, kpi.currency) : "—"}
            icon={AlertCircle}
            iconColor="text-orange-600"
            change="Aging bucket"
            trend="neutral"
          />
          <KPICard
            title="AP 90+ days"
            value={kpi ? formatMoney(kpi.apOverdue90, kpi.currency) : "—"}
            icon={AlertCircle}
            iconColor="text-red-600"
            change="Aging bucket"
            trend="down"
          />
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            Ledger Entries
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ledgerQuery.isLoading && (
            <div className="p-6">
              <Skeleton className="h-48 w-full" />
            </div>
          )}
          {ledgerQuery.isError && (
            <div className="p-4">
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                Failed to load ledger:{" "}
                {ledgerQuery.error instanceof Error
                  ? ledgerQuery.error.message
                  : "Unknown error"}
              </div>
            </div>
          )}
          {!ledgerQuery.isLoading && !ledgerQuery.isError && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Date</TableHead>
                    {!vendorId && <TableHead>Vendor ID</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={vendorId ? 7 : 8}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No ledger entries
                      </TableCell>
                    </TableRow>
                  )}
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs">
                        {formatDate(entry.entryDate)}
                      </TableCell>
                      {!vendorId && (
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {entry.vendorId.slice(0, 8)}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs whitespace-nowrap ${ENTRY_TONE[entry.entryType]}`}
                        >
                          {entry.entryType === "BILL" && (
                            <ArrowUpCircle className="h-3 w-3 mr-1" />
                          )}
                          {entry.entryType === "PAYMENT" && (
                            <ArrowDownCircle className="h-3 w-3 mr-1" />
                          )}
                          {entry.entryType.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {entry.referenceNumber ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[320px] truncate">
                        {entry.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {Number(entry.debit) > 0
                          ? formatMoney(entry.debit, entry.currency)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {Number(entry.credit) > 0
                          ? formatMoney(entry.credit, entry.currency)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium tabular-nums">
                        {formatMoney(entry.runningBalance, entry.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Showing {entries.length} of {total}
      </p>
    </div>
  );
}
