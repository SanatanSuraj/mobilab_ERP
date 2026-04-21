"use client";

/**
 * Vendor Master — reads /procurement/vendors via useApiVendors.
 *
 * Contract deltas vs the older mock (Vendor in src/data/procurement-mock.ts):
 *   - `name` replaces `legalName` / `tradeName`. The dialog keeps a single
 *     name field now (the second one was always the trading name, rarely
 *     different in the seed data).
 *   - `vendorType` (SUPPLIER / SERVICE / LOGISTICS / BOTH) replaces the
 *     more granular mock `category`. The server's vocabulary is deliberately
 *     simpler; we surface the mock categories as free-form `notes` if the
 *     user types one in.
 *   - `isActive` boolean replaces the four-value `status` (ACTIVE /
 *     ON_PROBATION / BLACKLISTED / INACTIVE). Probation + blacklist are
 *     governance workflows that don't exist yet — revisit in Phase 3.
 *   - `paymentTermsDays` is an integer (e.g. 30), not the string "Net 30".
 *   - `isMsme` boolean replaces `msmeRegistered`. Same semantics.
 *   - Rating (`ratingScore`, `ratingPeriods`, `totalPOValue`, `leadTimeDays`)
 *     aren't in the Phase 2 schema — Phase 3 vendor-performance work.
 *   - `creditLimit` is a decimal string (NUMERIC(18,2)); parsed for display.
 *
 * Create dialog posts to /procurement/vendors via useApiCreateVendor.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApiCreateVendor,
  useApiVendors,
} from "@/hooks/useProcurementApi";
import {
  VENDOR_TYPES,
  type Vendor,
  type VendorType,
} from "@mobilab/contracts";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Landmark,
  PackageSearch,
  Plus,
  Truck,
} from "lucide-react";

function formatMoney(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

const VENDOR_TYPE_LABEL: Record<VendorType, string> = {
  SUPPLIER: "Supplier",
  SERVICE: "Service",
  LOGISTICS: "Logistics",
  BOTH: "Supplier + Service",
};

const VENDOR_TYPE_TONE: Record<VendorType, string> = {
  SUPPLIER: "bg-blue-50 text-blue-700 border-blue-200",
  SERVICE: "bg-purple-50 text-purple-700 border-purple-200",
  LOGISTICS: "bg-amber-50 text-amber-700 border-amber-200",
  BOTH: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

export default function VendorsPage() {
  const router = useRouter();

  // ─── Filters ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [vendorType, setVendorType] = useState<VendorType | "all">("all");
  const [active, setActive] = useState<"all" | "true" | "false">("all");
  const [msme, setMsme] = useState<"all" | "true" | "false">("all");

  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      vendorType: vendorType === "all" ? undefined : vendorType,
      isActive: active === "all" ? undefined : active === "true",
      isMsme: msme === "all" ? undefined : msme === "true",
    }),
    [search, vendorType, active, msme]
  );

  const vendorsQuery = useApiVendors(query);
  const createVendor = useApiCreateVendor();

  // ─── Create dialog state ────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newVendorType, setNewVendorType] =
    useState<VendorType>("SUPPLIER");
  const [newGstin, setNewGstin] = useState("");
  const [newPaymentTermsDays, setNewPaymentTermsDays] = useState("30");
  const [newContactName, setNewContactName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newIsMsme, setNewIsMsme] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ─── Loading / error shells ─────────────────────────────────────────────
  if (vendorsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (vendorsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load vendors</p>
            <p className="text-red-700 mt-1">
              {vendorsQuery.error instanceof Error
                ? vendorsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const vendors = vendorsQuery.data?.data ?? [];
  const total = vendorsQuery.data?.meta.total ?? vendors.length;

  // KPI aggregates — scoped to the current page window. Global counts would
  // need dedicated aggregate endpoints.
  const activeCount = vendors.filter((v) => v.isActive).length;
  const msmeCount = vendors.filter((v) => v.isMsme).length;
  const logisticsCount = vendors.filter(
    (v) => v.vendorType === "LOGISTICS"
  ).length;

  const columns: Column<Vendor>[] = [
    {
      key: "code",
      header: "Code",
      render: (v) => (
        <span className="font-mono text-xs text-blue-700">{v.code}</span>
      ),
    },
    {
      key: "name",
      header: "Vendor Name",
      sortable: true,
      render: (v) => (
        <div>
          <p className="font-medium text-sm leading-tight">{v.name}</p>
          {v.gstin && (
            <p className="font-mono text-[11px] text-muted-foreground">
              {v.gstin}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "vendorType",
      header: "Type",
      render: (v) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${VENDOR_TYPE_TONE[v.vendorType]}`}
        >
          {VENDOR_TYPE_LABEL[v.vendorType]}
        </Badge>
      ),
    },
    {
      key: "contactName",
      header: "Contact",
      render: (v) => (
        <div>
          <p className="text-sm">{v.contactName ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{v.phone ?? ""}</p>
        </div>
      ),
    },
    {
      key: "paymentTermsDays",
      header: "Payment Terms",
      render: (v) => (
        <span className="text-sm">Net {v.paymentTermsDays}</span>
      ),
    },
    {
      key: "creditLimit",
      header: "Credit Limit",
      className: "text-right",
      render: (v) => (
        <span className="text-sm font-medium text-right block">
          {formatMoney(v.creditLimit)}
        </span>
      ),
    },
    {
      key: "isMsme",
      header: "MSME",
      render: (v) =>
        v.isMsme ? (
          <Badge className="bg-green-50 text-green-700 border border-green-200 text-xs font-medium">
            MSME
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (v) =>
        v.isActive ? (
          <Badge
            variant="outline"
            className="text-xs bg-green-50 text-green-700 border-green-200"
          >
            Active
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-xs bg-gray-50 text-gray-600 border-gray-200"
          >
            Inactive
          </Badge>
        ),
    },
  ];

  async function handleSave(): Promise<void> {
    setSaveError(null);
    const termsDays = Number.parseInt(newPaymentTermsDays, 10);
    if (!Number.isFinite(termsDays) || termsDays < 0) {
      setSaveError("Payment terms must be a non-negative number of days.");
      return;
    }
    try {
      await createVendor.mutateAsync({
        code: newCode.trim(),
        name: newName.trim(),
        vendorType: newVendorType,
        gstin: newGstin.trim() || undefined,
        paymentTermsDays: termsDays,
        contactName: newContactName.trim() || undefined,
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
        isMsme: newIsMsme,
        // Server zod defaults these; z.infer<> output type still wants them.
        isActive: true,
        country: "IN",
        creditLimit: "0",
      });
      setDialogOpen(false);
      setNewCode("");
      setNewName("");
      setNewVendorType("SUPPLIER");
      setNewGstin("");
      setNewPaymentTermsDays("30");
      setNewContactName("");
      setNewPhone("");
      setNewEmail("");
      setNewIsMsme(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Vendors"
        description="Approved vendor master — suppliers, service providers and logistics partners"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Vendors"
          value={String(total)}
          icon={Building2}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Active"
          value={String(activeCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="MSME Registered"
          value={String(msmeCount)}
          icon={Landmark}
          iconColor="text-emerald-600"
        />
        <KPICard
          title="Logistics Partners"
          value={String(logisticsCount)}
          icon={Truck}
          iconColor="text-amber-600"
        />
      </div>

      <DataTable<Vendor>
        data={vendors}
        columns={columns}
        searchKey="name"
        searchPlaceholder="Search vendors..."
        onRowClick={(v) => router.push(`/procurement/vendors/${v.id}`)}
        pageSize={10}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search name / code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <Select
              value={vendorType}
              onValueChange={(v) =>
                setVendorType((v ?? "all") as VendorType | "all")
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {VENDOR_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {VENDOR_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={active}
              onValueChange={(v) =>
                setActive((v ?? "all") as "all" | "true" | "false")
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={msme}
              onValueChange={(v) =>
                setMsme((v ?? "all") as "all" | "true" | "false")
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="MSME" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="true">MSME</SelectItem>
                <SelectItem value="false">Non-MSME</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Vendor
            </Button>
          </div>
        }
      />

      {vendors.length === 0 && (
        <div className="mt-6 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center">
          <PackageSearch className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-2 text-sm text-muted-foreground">
            No vendors match the current filter.
          </p>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {saveError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Code</label>
                <Input
                  placeholder="e.g. V-ECM"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Vendor Type</label>
                <Select
                  value={newVendorType}
                  onValueChange={(v) =>
                    setNewVendorType((v ?? "SUPPLIER") as VendorType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VENDOR_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {VENDOR_TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Vendor Name</label>
              <Input
                placeholder="Full legal entity name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">GSTIN</label>
                <Input
                  placeholder="15-character GSTIN"
                  maxLength={15}
                  value={newGstin}
                  onChange={(e) => setNewGstin(e.target.value.toUpperCase())}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Payment Terms (days)
                </label>
                <Input
                  type="number"
                  placeholder="30"
                  value={newPaymentTermsDays}
                  onChange={(e) => setNewPaymentTermsDays(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Contact Name</label>
                <Input
                  placeholder="Primary contact"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Phone</label>
                <Input
                  placeholder="+91-XXXXX-XXXXX"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="vendor@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newIsMsme}
                onChange={(e) => setNewIsMsme(e.target.checked)}
                className="h-4 w-4"
              />
              Vendor is MSME-registered
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createVendor.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                createVendor.isPending ||
                !newCode.trim() ||
                !newName.trim()
              }
            >
              {createVendor.isPending ? "Saving…" : "Save Vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
