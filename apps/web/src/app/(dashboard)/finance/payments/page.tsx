"use client";

/**
 * Payments — reads /finance/payments via useApiPayments.
 *
 * Polymorphic register showing both CUSTOMER_RECEIPT (AR) and VENDOR_PAYMENT
 * (AP) rows with filters and inline void. Void is a destructive-but-reversible
 * (in the accounting sense) operation: the server appends an offsetting
 * ADJUSTMENT row to the relevant ledger and flips the payment status to
 * VOIDED — the row is kept for audit, never deleted.
 *
 * Creating a payment happens contextually from the invoice detail page where
 * the counterparty + outstanding amount are already known; this page is the
 * global audit register, not a creation surface.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  useApiFinanceOverview,
  useApiPayments,
  useApiVoidPayment,
} from "@/hooks/useFinanceApi";
import {
  PAYMENT_MODES,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  type Payment,
  type PaymentMode,
  type PaymentStatus,
  type PaymentType,
} from "@mobilab/contracts";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  IndianRupee,
  Loader2,
  Wallet,
  XCircle,
} from "lucide-react";

// ─── Display helpers ─────────────────────────────────────────────────────────

function formatMoney(value: string, currency = "INR"): string {
  // Number() banned at construction/math; permitted at display sites for
  // Intl.NumberFormat which requires a number input. Wire format is decimal
  // string (NUMERIC(18,4)) preserved end-to-end.
  const n = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
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

const STATUS_TONE: Record<PaymentStatus, string> = {
  RECORDED: "bg-green-50 text-green-700 border-green-200",
  VOIDED: "bg-gray-50 text-gray-600 border-gray-200",
};

const TYPE_TONE: Record<PaymentType, string> = {
  CUSTOMER_RECEIPT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  VENDOR_PAYMENT: "bg-rose-50 text-rose-700 border-rose-200",
};

const TYPE_LABEL: Record<PaymentType, string> = {
  CUSTOMER_RECEIPT: "Receipt",
  VENDOR_PAYMENT: "Payment",
};

const MODE_LABEL: Record<PaymentMode, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
  UPI: "UPI",
  CARD: "Card",
  OTHER: "Other",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [paymentType, setPaymentType] = useState<PaymentType | "all">("all");
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const [mode, setMode] = useState<PaymentMode | "all">("all");
  const [search, setSearch] = useState("");

  const query = useMemo(
    () => ({
      limit: 100,
      paymentType: paymentType === "all" ? undefined : paymentType,
      status: status === "all" ? undefined : status,
      mode: mode === "all" ? undefined : mode,
      search: search.trim() || undefined,
    }),
    [paymentType, status, mode, search],
  );

  const paymentsQuery = useApiPayments(query);
  const overviewQuery = useApiFinanceOverview();

  // ─── Void dialog state ──────────────────────────────────────────────────
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const voidPayment = useApiVoidPayment(voidTarget?.id ?? "");

  const resetVoidDialog = (): void => {
    setVoidTarget(null);
    setVoidReason("");
    setVoidError(null);
  };

  const handleVoid = async (): Promise<void> => {
    setVoidError(null);
    if (!voidTarget) return;
    const trimmed = voidReason.trim();
    if (!trimmed) {
      setVoidError("reason is required");
      return;
    }
    try {
      await voidPayment.mutateAsync({ reason: trimmed });
      resetVoidDialog();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : "failed to void");
    }
  };

  // ─── Loading / error shells ─────────────────────────────────────────────
  if (paymentsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (paymentsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load payments
            </p>
            <p className="text-red-700 mt-1">
              {paymentsQuery.error instanceof Error
                ? paymentsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const payments = paymentsQuery.data?.data ?? [];
  const total = paymentsQuery.data?.meta.total ?? payments.length;

  // Page-window totals
  const receiptsTotal = payments
    .filter((p) => p.paymentType === "CUSTOMER_RECEIPT" && p.status === "RECORDED")
    .reduce((s, p) => s + Number(p.amount || "0"), 0);
  const paymentsTotal = payments
    .filter((p) => p.paymentType === "VENDOR_PAYMENT" && p.status === "RECORDED")
    .reduce((s, p) => s + Number(p.amount || "0"), 0);
  const voidedCount = payments.filter((p) => p.status === "VOIDED").length;

  const kpi = overviewQuery.data;

  const columns: Column<Payment>[] = [
    {
      key: "paymentNumber",
      header: "Payment #",
      sortable: true,
      render: (p) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {p.paymentNumber}
        </span>
      ),
    },
    {
      key: "paymentType",
      header: "Type",
      render: (p) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${TYPE_TONE[p.paymentType]}`}
        >
          {TYPE_LABEL[p.paymentType]}
        </Badge>
      ),
    },
    {
      key: "counterpartyName",
      header: "Counterparty",
      render: (p) => (
        <span className="text-sm">{p.counterpartyName ?? "—"}</span>
      ),
    },
    {
      key: "paymentDate",
      header: "Date",
      sortable: true,
      render: (p) => (
        <span className="text-muted-foreground text-sm">
          {formatDate(p.paymentDate)}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      className: "text-right",
      sortable: true,
      render: (p) => (
        <span className="font-semibold tabular-nums">
          {formatMoney(p.amount, p.currency)}
        </span>
      ),
    },
    {
      key: "mode",
      header: "Mode",
      render: (p) => (
        <span className="text-sm text-muted-foreground">
          {MODE_LABEL[p.mode]}
        </span>
      ),
    },
    {
      key: "referenceNo",
      header: "Reference",
      render: (p) => (
        <span className="text-xs font-mono text-muted-foreground">
          {p.referenceNo ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[p.status]}`}
        >
          {p.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (p) => (
        <div className="flex justify-end">
          {p.status === "RECORDED" ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={(e) => {
                e.stopPropagation();
                setVoidTarget(p);
                setVoidReason("");
                setVoidError(null);
              }}
            >
              <Ban className="h-3.5 w-3.5 mr-1" />
              Void
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground italic pr-2">
              {p.voidedAt ? formatDate(p.voidedAt) : "—"}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Void dialog */}
      <Dialog
        open={voidTarget !== null}
        onOpenChange={(open) => {
          if (!open) resetVoidDialog();
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Void Payment</DialogTitle>
          </DialogHeader>
          {voidTarget && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment #</span>
                  <span className="font-mono font-semibold">
                    {voidTarget.paymentNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(voidTarget.amount, voidTarget.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Counterparty</span>
                  <span>{voidTarget.counterpartyName ?? "—"}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Voiding reverses all invoice applications and appends offsetting
                ADJUSTMENT rows on the ledger. The original row is retained for
                audit and cannot be deleted while RECORDED.
              </p>
              <div className="space-y-2">
                <Label htmlFor="voidReason" className="text-xs">
                  Reason *
                </Label>
                <Textarea
                  id="voidReason"
                  rows={3}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="e.g. Payment was recorded against the wrong invoice"
                />
              </div>
              {voidError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  {voidError}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={resetVoidDialog}
              disabled={voidPayment.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={voidPayment.isPending}
            >
              {voidPayment.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Voiding…
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4 mr-2" /> Void Payment
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PageHeader
        title="Payments"
        description="Global register of customer receipts and vendor payments"
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Recorded Payments"
          value={kpi ? kpi.recordedPayments.toLocaleString() : "—"}
          icon={Wallet}
          iconColor="text-blue-600"
          change="All-time"
          trend="neutral"
        />
        <KPICard
          title="Receipts (Page)"
          value={formatMoney(
            String(receiptsTotal),
            kpi?.currency ?? "INR",
          )}
          icon={CheckCircle2}
          iconColor="text-emerald-600"
          change={`${payments.filter((p) => p.paymentType === "CUSTOMER_RECEIPT" && p.status === "RECORDED").length} recorded`}
          trend="up"
        />
        <KPICard
          title="Payments (Page)"
          value={formatMoney(
            String(paymentsTotal),
            kpi?.currency ?? "INR",
          )}
          icon={IndianRupee}
          iconColor="text-rose-600"
          change={`${payments.filter((p) => p.paymentType === "VENDOR_PAYMENT" && p.status === "RECORDED").length} recorded`}
          trend="down"
        />
        <KPICard
          title="Voided (Page)"
          value={voidedCount.toLocaleString()}
          icon={voidedCount > 0 ? AlertTriangle : XCircle}
          iconColor={voidedCount > 0 ? "text-amber-600" : "text-gray-500"}
          change={
            voidedCount > 0 ? "Check audit trail" : "No voids in filter"
          }
          trend={voidedCount > 0 ? "down" : "neutral"}
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select
            value={paymentType}
            onValueChange={(v) =>
              setPaymentType(!v ? "all" : (v as PaymentType | "all"))
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {PAYMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={status}
            onValueChange={(v) =>
              setStatus(!v ? "all" : (v as PaymentStatus | "all"))
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {PAYMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Mode</Label>
          <Select
            value={mode}
            onValueChange={(v) =>
              setMode(!v ? "all" : (v as PaymentMode | "all"))
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modes</SelectItem>
              {PAYMENT_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[240px]">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Payment number, reference, or counterparty…"
          />
        </div>
      </div>

      <DataTable<Payment>
        data={payments}
        columns={columns}
        searchKey="paymentNumber"
        searchPlaceholder="Search by payment number..."
      />

      <p className="text-xs text-muted-foreground">
        Showing {payments.length.toLocaleString()} of {total.toLocaleString()}{" "}
        payment{total === 1 ? "" : "s"}. Create new payments from the sales or
        purchase invoice detail pages.
      </p>
    </div>
  );
}
