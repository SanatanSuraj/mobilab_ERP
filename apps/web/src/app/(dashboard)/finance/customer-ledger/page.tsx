"use client";

/**
 * Customer Ledger — reads /finance/customer-ledger via useApiCustomerLedger.
 *
 * Append-only feed of customer-side money events (INVOICE / PAYMENT /
 * ADJUSTMENT / OPENING_BALANCE). Runs in two modes:
 *   1. No filter → global feed across all customers (one row per event).
 *   2. Customer ID filter → per-customer feed + live balance lookup.
 *
 * The per-customer balance comes from /finance/customer-ledger/customers/:id/
 * balance, which the repo computes as the running_balance of the most recent
 * row. Entry rows themselves also carry runningBalance for audit.
 *
 * Since there's no dedicated customer-list endpoint in Phase 2, the dropdown
 * populates from the list of customerIds seen in the latest 100 sales
 * invoices (using the denormalized customerName from the invoice row). Typing
 * a UUID directly into the "Customer ID" input works too.
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
  useApiCustomerBalance,
  useApiCustomerLedger,
  useApiFinanceOverview,
  useApiSalesInvoices,
} from "@/hooks/useFinanceApi";
import {
  CUSTOMER_LEDGER_ENTRY_TYPES,
  type CustomerLedgerEntryType,
} from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  Landmark,
  Users,
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

const ENTRY_TONE: Record<CustomerLedgerEntryType, string> = {
  INVOICE: "bg-blue-50 text-blue-700 border-blue-200",
  PAYMENT: "bg-green-50 text-green-700 border-green-200",
  CREDIT_NOTE: "bg-purple-50 text-purple-700 border-purple-200",
  ADJUSTMENT: "bg-orange-50 text-orange-700 border-orange-200",
  OPENING_BALANCE: "bg-gray-50 text-gray-600 border-gray-200",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CustomerLedgerPage() {
  const [customerId, setCustomerId] = useState<string>("");
  const [entryType, setEntryType] = useState<
    CustomerLedgerEntryType | "all"
  >("all");

  // Derive the dropdown options from the latest sales invoices — each one
  // carries a denormalized customerName, so we can show friendly labels.
  const invoicesQuery = useApiSalesInvoices({ limit: 100 });
  const customerOptions = useMemo(() => {
    const entries = invoicesQuery.data?.data ?? [];
    const map = new Map<string, string>();
    for (const inv of entries) {
      if (!inv.customerId) continue;
      if (!map.has(inv.customerId)) {
        map.set(inv.customerId, inv.customerName ?? inv.customerId.slice(0, 8));
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [invoicesQuery.data]);

  const query = useMemo(
    () => ({
      limit: 200,
      customerId: customerId.trim() || undefined,
      entryType: entryType === "all" ? undefined : entryType,
    }),
    [customerId, entryType],
  );

  const ledgerQuery = useApiCustomerLedger(query);
  const balanceQuery = useApiCustomerBalance(customerId.trim() || undefined);
  const overviewQuery = useApiFinanceOverview();

  const kpi = overviewQuery.data;
  const entries = ledgerQuery.data?.data ?? [];
  const total = ledgerQuery.data?.meta.total ?? entries.length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Customer Ledger"
        description="Append-only money events for customers — invoices, payments, adjustments"
      />

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Customer</Label>
          <Select
            value={customerId || "all"}
            onValueChange={(v) =>
              setCustomerId(!v || v === "all" ? "" : v)
            }
          >
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="All customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {customerOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 max-w-[360px]">
          <Label className="text-xs text-muted-foreground">
            Customer ID (type/paste UUID)
          </Label>
          <Input
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Entry Type</Label>
          <Select
            value={entryType}
            onValueChange={(v) =>
              setEntryType(v as CustomerLedgerEntryType | "all")
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {CUSTOMER_LEDGER_ENTRY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Per-customer balance / overview */}
      {customerId ? (
        <Card>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Customer ID</p>
                <p className="text-xs font-mono mt-0.5">{customerId}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Current Balance
                </p>
                {balanceQuery.isLoading ? (
                  <Skeleton className="h-6 w-24 mt-1" />
                ) : balanceQuery.isError || !balanceQuery.data ? (
                  <p className="text-sm text-muted-foreground mt-0.5">—</p>
                ) : (
                  <p className="text-lg font-semibold mt-0.5 text-amber-700 tabular-nums">
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
            title="AR Outstanding"
            value={kpi ? formatMoney(kpi.arOutstanding, kpi.currency) : "—"}
            icon={Users}
            iconColor="text-blue-600"
            change={kpi ? `${kpi.postedSalesInvoices} posted` : ""}
            trend="neutral"
          />
          <KPICard
            title="AR 30+ days"
            value={kpi ? formatMoney(kpi.arOverdue30, kpi.currency) : "—"}
            icon={Clock}
            iconColor="text-amber-600"
            change="Aging bucket"
            trend="neutral"
          />
          <KPICard
            title="AR 60+ days"
            value={kpi ? formatMoney(kpi.arOverdue60, kpi.currency) : "—"}
            icon={AlertCircle}
            iconColor="text-orange-600"
            change="Aging bucket"
            trend="neutral"
          />
          <KPICard
            title="AR 90+ days"
            value={kpi ? formatMoney(kpi.arOverdue90, kpi.currency) : "—"}
            icon={AlertCircle}
            iconColor="text-red-600"
            change="Aging bucket"
            trend="down"
          />
        </div>
      )}

      {/* Ledger entries */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" />
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
                    {!customerId && <TableHead>Customer ID</TableHead>}
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
                        colSpan={customerId ? 7 : 8}
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
                      {!customerId && (
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {entry.customerId.slice(0, 8)}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs whitespace-nowrap ${ENTRY_TONE[entry.entryType]}`}
                        >
                          {entry.entryType === "INVOICE" && (
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
