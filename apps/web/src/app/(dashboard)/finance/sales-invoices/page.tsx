"use client";

/**
 * Sales Invoices — reads /finance/sales-invoices via useApiSalesInvoices.
 *
 * Phase 2 entrypoint. Shows the invoice register with status filter + inline
 * KPIs sourced from /finance/overview (so the numbers are global, not
 * page-window-scoped). Row click → /finance/sales-invoices/[id] for the
 * detail + lines view.
 *
 * Create flow: posts a DRAFT invoice with no lines; caller then navigates to
 * the detail page to add lines and post. This keeps the create dialog tight
 * and avoids a mega-form. Invoice numbers auto-generate server-side.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  useApiCreateSalesInvoice,
  useApiFinanceOverview,
  useApiSalesInvoices,
} from "@/hooks/useFinanceApi";
import {
  INVOICE_STATUSES,
  type InvoiceStatus,
  type SalesInvoice,
} from "@mobilab/contracts";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileText,
  IndianRupee,
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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SalesInvoicesPage() {
  const router = useRouter();

  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");

  const query = useMemo(
    () => ({
      limit: 100,
      status: status === "all" ? undefined : status,
      search: search.trim() || undefined,
    }),
    [status, search],
  );

  const invoicesQuery = useApiSalesInvoices(query);
  const overviewQuery = useApiFinanceOverview();

  // ─── Create dialog state ────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formCustomerId, setFormCustomerId] = useState("");
  const [formCustomerName, setFormCustomerName] = useState("");
  const [formInvoiceDate, setFormInvoiceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [formDueDate, setFormDueDate] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const createInvoice = useApiCreateSalesInvoice();

  const resetForm = (): void => {
    setFormCustomerId("");
    setFormCustomerName("");
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
      const created = await createInvoice.mutateAsync({
        customerId: formCustomerId.trim() || undefined,
        customerName: formCustomerName.trim() || undefined,
        invoiceDate: formInvoiceDate,
        dueDate: formDueDate || undefined,
        notes: formNotes.trim() || undefined,
        // Zod default([]) but z.infer makes it required at type-level.
        lines: [],
      });
      setDialogOpen(false);
      resetForm();
      router.push(`/finance/sales-invoices/${created.id}`);
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
              Failed to load sales invoices
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

  // Page-window totals (for the filtered list)
  const listTotal = invoices.reduce(
    (s, i) => s + Number(i.grandTotal || "0"),
    0,
  );
  const listPaid = invoices.reduce(
    (s, i) => s + Number(i.amountPaid || "0"),
    0,
  );

  // Overview KPIs — global scope (AR outstanding + posted count)
  const kpi = overviewQuery.data;
  const arOverdue = kpi
    ? Number(kpi.arOverdue30) +
      Number(kpi.arOverdue60) +
      Number(kpi.arOverdue90)
    : 0;

  const columns: Column<SalesInvoice>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      sortable: true,
      render: (inv) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {inv.invoiceNumber}
        </span>
      ),
    },
    {
      key: "customerName",
      header: "Customer",
      render: (inv) => (
        <span className="text-sm">{inv.customerName ?? "—"}</span>
      ),
    },
    {
      key: "invoiceDate",
      header: "Invoice Date",
      sortable: true,
      render: (inv) => (
        <span className="text-muted-foreground text-sm">
          {formatDate(inv.invoiceDate)}
        </span>
      ),
    },
    {
      key: "dueDate",
      header: "Due Date",
      sortable: true,
      render: (inv) => (
        <span className="text-muted-foreground text-sm">
          {formatDate(inv.dueDate)}
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
      key: "amountPaid",
      header: "Paid",
      className: "text-right",
      render: (inv) => (
        <span className="tabular-nums text-muted-foreground">
          {formatMoney(inv.amountPaid, inv.currency)}
        </span>
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
            <DialogTitle>New Sales Invoice</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            Create a DRAFT invoice. Add lines and post it from the detail view
            to append to customer ledger.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="customerId" className="text-xs">
                Customer ID (UUID — optional)
              </Label>
              <Input
                id="customerId"
                value={formCustomerId}
                onChange={(e) => setFormCustomerId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Label htmlFor="customerName" className="text-xs">
                Customer Name (denormalized)
              </Label>
              <Input
                id="customerName"
                value={formCustomerName}
                onChange={(e) => setFormCustomerName(e.target.value)}
                placeholder="Acme Hospital"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="invoiceDate" className="text-xs">
                  Invoice Date *
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
                placeholder="Payment terms, PO reference, etc."
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
        title="Sales Invoices"
        description="GST-compliant sales invoice register"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        }
      />

      {/* KPIs — overview-sourced (global) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="AR Outstanding"
          value={kpi ? formatMoney(kpi.arOutstanding, kpi.currency) : "—"}
          icon={FileText}
          iconColor="text-blue-600"
          change={kpi ? `${kpi.postedSalesInvoices} posted` : ""}
          trend="neutral"
        />
        <KPICard
          title="Page Total"
          value={formatMoney(String(listTotal))}
          icon={IndianRupee}
          iconColor="text-amber-600"
          change={`${total} result${total === 1 ? "" : "s"}`}
          trend="neutral"
        />
        <KPICard
          title="Page Paid"
          value={formatMoney(String(listPaid))}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change="In current filter"
          trend="up"
        />
        <KPICard
          title="AR Overdue"
          value={kpi ? formatMoney(String(arOverdue), kpi.currency) : "—"}
          icon={AlertTriangle}
          iconColor="text-red-600"
          change={arOverdue > 0 ? "Needs follow-up" : "All clear"}
          trend={arOverdue > 0 ? "down" : "up"}
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as InvoiceStatus | "all")}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {INVOICE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
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
            placeholder="Invoice number or customer name…"
          />
        </div>
      </div>

      <DataTable<SalesInvoice>
        data={invoices}
        columns={columns}
        searchKey="invoiceNumber"
        searchPlaceholder="Search by invoice number..."
        onRowClick={(item) => router.push(`/finance/sales-invoices/${item.id}`)}
      />
    </div>
  );
}
