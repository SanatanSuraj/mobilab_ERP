"use client";

/**
 * Purchase Invoices (Vendor Bills) — reads /finance/purchase-invoices via
 * useApiPurchaseInvoices.
 *
 * Parallels the sales invoices surface but for AP. Shows the bill register
 * with status + match-status filters + KPIs sourced from /finance/overview
 * (global AP + aging). Row click → /finance/purchase-invoices/:id (detail
 * view is Phase 3 — for now we route to the dashboard detail stub).
 *
 * Create flow: posts a DRAFT bill with no lines; numbers auto-generate
 * server-side as PI-YYYY-NNNN. Lines + posting come next iteration.
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
  useApiCreatePurchaseInvoice,
  useApiFinanceOverview,
  useApiPurchaseInvoices,
} from "@/hooks/useFinanceApi";
import {
  INVOICE_STATUSES,
  PURCHASE_INVOICE_MATCH_STATUSES,
  type InvoiceStatus,
  type PurchaseInvoice,
  type PurchaseInvoiceMatchStatus,
} from "@instigenie/contracts";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Plus,
} from "lucide-react";

// ─── Display helpers ─────────────────────────────────────────────────────────

function formatMoney(value: string, currency = "INR"): string {
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

const STATUS_TONE: Record<InvoiceStatus, string> = {
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200",
  POSTED: "bg-blue-50 text-blue-700 border-blue-200",
  CANCELLED: "bg-gray-50 text-gray-600 border-gray-200",
};

const MATCH_TONE: Record<PurchaseInvoiceMatchStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  MATCHED: "bg-green-50 text-green-700 border-green-200",
  MATCH_FAILED: "bg-red-50 text-red-700 border-red-200",
  BYPASSED: "bg-gray-50 text-gray-600 border-gray-200",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PurchaseInvoicesPage() {
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [matchStatus, setMatchStatus] = useState<
    PurchaseInvoiceMatchStatus | "all"
  >("all");
  const [search, setSearch] = useState("");

  const query = useMemo(
    () => ({
      limit: 100,
      status: status === "all" ? undefined : status,
      matchStatus: matchStatus === "all" ? undefined : matchStatus,
      search: search.trim() || undefined,
    }),
    [status, matchStatus, search],
  );

  const invoicesQuery = useApiPurchaseInvoices(query);
  const overviewQuery = useApiFinanceOverview();
  const createInvoice = useApiCreatePurchaseInvoice();

  // Create dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formVendorId, setFormVendorId] = useState("");
  const [formVendorName, setFormVendorName] = useState("");
  const [formVendorInvoiceNo, setFormVendorInvoiceNo] = useState("");
  const [formInvoiceDate, setFormInvoiceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [formDueDate, setFormDueDate] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const resetForm = (): void => {
    setFormVendorId("");
    setFormVendorName("");
    setFormVendorInvoiceNo("");
    setFormInvoiceDate(new Date().toISOString().slice(0, 10));
    setFormDueDate("");
    setFormNotes("");
    setSaveError(null);
  };

  const handleCreate = async (): Promise<void> => {
    setSaveError(null);
    if (!formInvoiceDate) {
      setSaveError("invoice date is required");
      return;
    }
    try {
      await createInvoice.mutateAsync({
        vendorId: formVendorId.trim() || undefined,
        vendorName: formVendorName.trim() || undefined,
        vendorInvoiceNo: formVendorInvoiceNo.trim() || undefined,
        invoiceDate: formInvoiceDate,
        dueDate: formDueDate || undefined,
        notes: formNotes.trim() || undefined,
        lines: [],
      });
      setDialogOpen(false);
      resetForm();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "failed to create");
    }
  };

  // ─── Loading / error shells ─────────────────────────────────────────────
  if (invoicesQuery.isLoading) {
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

  if (invoicesQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load purchase invoices
            </p>
            <p className="text-red-700 mt-1">
              {invoicesQuery.error instanceof Error
                ? invoicesQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const invoices = invoicesQuery.data?.data ?? [];
  const total = invoicesQuery.data?.meta.total ?? invoices.length;

  // Overview KPIs
  const kpi = overviewQuery.data;
  const apOverdue = kpi
    ? Number(kpi.apOverdue30) +
      Number(kpi.apOverdue60) +
      Number(kpi.apOverdue90)
    : 0;

  const matchedCount = invoices.filter(
    (p) => p.matchStatus === "MATCHED" || p.matchStatus === "BYPASSED",
  ).length;
  const pendingMatchCount = invoices.filter(
    (p) => p.matchStatus === "PENDING",
  ).length;
  const failedMatchCount = invoices.filter(
    (p) => p.matchStatus === "MATCH_FAILED",
  ).length;

  const columns: Column<PurchaseInvoice>[] = [
    {
      key: "invoiceNumber",
      header: "Bill #",
      sortable: true,
      render: (inv) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {inv.invoiceNumber}
        </span>
      ),
    },
    {
      key: "vendorName",
      header: "Vendor",
      render: (inv) => (
        <span className="text-sm">{inv.vendorName ?? "—"}</span>
      ),
    },
    {
      key: "vendorInvoiceNo",
      header: "Vendor Ref",
      render: (inv) => (
        <span className="text-xs text-muted-foreground font-mono">
          {inv.vendorInvoiceNo ?? "—"}
        </span>
      ),
    },
    {
      key: "invoiceDate",
      header: "Date",
      sortable: true,
      render: (inv) => (
        <span className="text-muted-foreground text-sm">
          {formatDate(inv.invoiceDate)}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      className: "text-right",
      sortable: true,
      render: (inv) => (
        <span className="font-semibold tabular-nums">
          {formatMoney(inv.grandTotal, inv.currency)}
        </span>
      ),
    },
    {
      key: "matchStatus",
      header: "Match",
      render: (inv) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${MATCH_TONE[inv.matchStatus]}`}
        >
          {inv.matchStatus.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (inv) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[inv.status]}`}
        >
          {inv.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>New Vendor Bill</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            Creates a DRAFT vendor bill. Add lines and post it from the detail
            view to append to the vendor ledger.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="vendorId" className="text-xs">
                Vendor ID (UUID — optional)
              </Label>
              <Input
                id="vendorId"
                value={formVendorId}
                onChange={(e) => setFormVendorId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="vendorName" className="text-xs">
                Vendor Name (denormalized)
              </Label>
              <Input
                id="vendorName"
                value={formVendorName}
                onChange={(e) => setFormVendorName(e.target.value)}
                placeholder="ABC Supplies Pvt Ltd"
              />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="vendorInvoiceNo" className="text-xs">
                Vendor&apos;s Invoice Number
              </Label>
              <Input
                id="vendorInvoiceNo"
                value={formVendorInvoiceNo}
                onChange={(e) => setFormVendorInvoiceNo(e.target.value)}
                placeholder="V-2026-0042"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="invoiceDate" className="text-xs">
                  Bill Date *
                </Label>
                <Input
                  id="invoiceDate"
                  type="date"
                  value={formInvoiceDate}
                  onChange={(e) => setFormInvoiceDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dueDate" className="text-xs">
                  Due Date
                </Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="notes" className="text-xs">
                Notes
              </Label>
              <Textarea
                id="notes"
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {saveError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
              disabled={createInvoice.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createInvoice.isPending}>
              {createInvoice.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…
                </>
              ) : (
                <>Create Draft</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PageHeader
        title="Purchase Invoices"
        description="Vendor bills with 3-way match status"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Bill
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="AP Outstanding"
          value={kpi ? formatMoney(kpi.apOutstanding, kpi.currency) : "—"}
          icon={FileText}
          iconColor="text-blue-600"
          change={kpi ? `${kpi.postedPurchaseInvoices} posted` : ""}
          trend="neutral"
        />
        <KPICard
          title="Matched"
          value={String(matchedCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change="PO + GRN + Invoice"
          trend="up"
        />
        <KPICard
          title="Pending Match"
          value={String(pendingMatchCount)}
          icon={Clock}
          iconColor="text-amber-600"
          change={`${failedMatchCount} failed`}
          trend="neutral"
        />
        <KPICard
          title="AP Overdue"
          value={kpi ? formatMoney(String(apOverdue), kpi.currency) : "—"}
          icon={AlertTriangle}
          iconColor="text-red-600"
          change={apOverdue > 0 ? "Needs payment" : "All clear"}
          trend={apOverdue > 0 ? "down" : "up"}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as InvoiceStatus | "all")}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {INVOICE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Match</Label>
          <Select
            value={matchStatus}
            onValueChange={(v) =>
              setMatchStatus(v as PurchaseInvoiceMatchStatus | "all")
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All match states</SelectItem>
              {PURCHASE_INVOICE_MATCH_STATUSES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m.replace(/_/g, " ")}
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
            placeholder="Bill number, vendor name, vendor ref…"
          />
        </div>
      </div>

      <DataTable<PurchaseInvoice>
        data={invoices}
        columns={columns}
        searchKey="invoiceNumber"
        searchPlaceholder="Search by bill number..."
      />

      <p className="text-xs text-muted-foreground">
        Showing {invoices.length} of {total}
      </p>
    </div>
  );
}
