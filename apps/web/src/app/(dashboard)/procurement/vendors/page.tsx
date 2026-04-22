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
  useApiCreateVendor,
  useApiVendors,
} from "@/hooks/useProcurementApi";
import {
  VENDOR_TYPES,
  type Vendor,
  type VendorType,
} from "@instigenie/contracts";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Landmark,
  Lightbulb,
  PackageSearch,
  Plus,
  Save,
  ShieldCheck,
  Tag,
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

// Indian states + UTs (official list). State is required per design.
const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

// GST Type options per the screenshot's dropdown. CreateVendorSchema has no
// column for this, so we prefix it into `notes` as [GST Type: X] on save.
const GST_TYPES = [
  "Regular",
  "Unregistered",
  "Composition",
  "Consumer",
  "Government Entity",
  "Unknown",
  "Casual taxable person",
  "e-Commerce Operators / Platforms",
  "Input Service Distributor (ISD)",
  "Non-Resident taxable person",
  "Special Economic Zone (SEZ) Developer",
  "TDS/TCS Deductor",
  "Users Of Reverse Charge Mechanism",
] as const;

// Horizontal radio group on the Company Details header. We keep the contract-
// faithful Supplier/Service/Logistics/Both enum (schema rejects anything else).
const VENDOR_ROLE_OPTIONS: Array<{ value: VendorType; label: string }> = [
  { value: "SUPPLIER", label: "Supplier" },
  { value: "SERVICE", label: "Service" },
  { value: "LOGISTICS", label: "Logistics" },
  { value: "BOTH", label: "Both" },
];

// The design hides the Code field; we auto-generate one from the company name.
// Format: V-{UPPERCASE_SLUG up to 8 chars}-{4 random base36 chars}. Total
// fits comfortably under the schema's 32-char cap.
function generateVendorCode(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const seed = slug.length > 0 ? slug : "VENDOR";
  return `V-${seed}-${suffix}`.slice(0, 32);
}

// Quick email shape check — matches the zod `.email()` loosely.
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

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
  // Contact Person section
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  // Company section
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [newVendorType, setNewVendorType] = useState<VendorType>("SUPPLIER");
  const [newGstin, setNewGstin] = useState("");
  const [newGstType, setNewGstType] =
    useState<(typeof GST_TYPES)[number]>("Regular");
  // Address section
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [pincode, setPincode] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState<string>("");
  const [countryLabel, setCountryLabel] = useState<string>("India");
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

  function resetDialogFields(): void {
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setCompanyName("");
    setCompanyEmail("");
    setNewVendorType("SUPPLIER");
    setNewGstin("");
    setNewGstType("Regular");
    setAddressLine1("");
    setAddressLine2("");
    setPincode("");
    setCity("");
    setStateName("");
    setCountryLabel("India");
    setSaveError(null);
  }

  async function handleSave(): Promise<void> {
    setSaveError(null);

    // Required-field validation matching the * markers in the design.
    const missing: string[] = [];
    if (!contactName.trim()) missing.push("Contact Name");
    if (!contactEmail.trim()) missing.push("Contact Email");
    if (!companyName.trim()) missing.push("Company Name");
    if (!companyEmail.trim()) missing.push("Company Email");
    if (!addressLine1.trim()) missing.push("Address Line 1");
    if (!addressLine2.trim()) missing.push("Address Line 2");
    if (!pincode.trim()) missing.push("Pincode");
    if (!city.trim()) missing.push("City");
    if (!stateName) missing.push("State");
    if (missing.length > 0) {
      setSaveError(`Please fill required fields: ${missing.join(", ")}.`);
      return;
    }
    if (!isValidEmail(contactEmail.trim())) {
      setSaveError("Contact email is not a valid email address.");
      return;
    }
    if (!isValidEmail(companyEmail.trim())) {
      setSaveError("Company email is not a valid email address.");
      return;
    }
    if (!/^\d{6}$/u.test(pincode.trim())) {
      setSaveError("Pincode must be exactly 6 digits.");
      return;
    }

    // Fold the two address lines into the single `address` column the schema
    // supports. Prefix the GST Type into `notes` since there's no column for it.
    const foldedAddress = [addressLine1.trim(), addressLine2.trim()]
      .filter(Boolean)
      .join("\n");
    const notes = `[GST Type: ${newGstType}]`;

    try {
      await createVendor.mutateAsync({
        code: generateVendorCode(companyName),
        name: companyName.trim(),
        vendorType: newVendorType,
        gstin: newGstin.trim() || undefined,
        contactName: contactName.trim(),
        phone: contactPhone.trim() || undefined,
        // The design surfaces two emails. The schema has only one — we keep the
        // contact email as primary (it's the person we reach) and stash the
        // company email into notes.
        email: contactEmail.trim(),
        address: foldedAddress || undefined,
        city: city.trim(),
        state: stateName,
        postalCode: pincode.trim(),
        notes: `${notes}\n[Company Email: ${companyEmail.trim()}]`,
        // Server zod defaults these; z.infer<> output type still wants them.
        paymentTermsDays: 30,
        isMsme: false,
        isActive: true,
        country: "IN",
        creditLimit: "0",
      });
      setDialogOpen(false);
      resetDialogFields();
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

      {/* Create dialog — Add Company design */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetDialogFields();
        }}
      >
        <DialogContent className="max-w-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Add Company
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            {saveError && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            {/* ─── Contact Person Details ──────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Contact Person Details
                </h3>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Name<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Input
                    placeholder="Full name"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Email<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Input
                    type="email"
                    placeholder="name@example.com"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Phone No.
                  </Label>
                  <Input
                    placeholder="+91-XXXXX-XXXXX"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </div>
              </div>
            </section>

            {/* ─── Company Details ─────────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <h3 className="text-sm font-semibold text-foreground whitespace-nowrap">
                  Company Details
                </h3>
                <div className="hidden h-px flex-1 bg-border md:block" />
                <div
                  role="radiogroup"
                  aria-label="Vendor role"
                  className="flex flex-wrap items-center gap-3"
                >
                  {VENDOR_ROLE_OPTIONS.map((opt) => {
                    const selected = newVendorType === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className="flex cursor-pointer items-center gap-1.5 text-sm"
                      >
                        <span
                          className={
                            "flex h-4 w-4 items-center justify-center rounded-full border transition-colors " +
                            (selected
                              ? "border-green-600 ring-1 ring-green-600"
                              : "border-muted-foreground/40")
                          }
                          aria-hidden="true"
                        >
                          {selected && (
                            <span className="h-2 w-2 rounded-full bg-green-600" />
                          )}
                        </span>
                        <input
                          type="radio"
                          name="vendor-role"
                          value={opt.value}
                          checked={selected}
                          onChange={() => setNewVendorType(opt.value)}
                          className="sr-only"
                        />
                        {opt.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Company Name<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Input
                    placeholder="Full legal entity name"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Email<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Input
                    type="email"
                    placeholder="billing@company.com"
                    value={companyEmail}
                    onChange={(e) => setCompanyEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr]">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    GST Number
                  </Label>
                  <Input
                    placeholder="15-character GSTIN"
                    maxLength={15}
                    value={newGstin}
                    onChange={(e) =>
                      setNewGstin(e.target.value.toUpperCase())
                    }
                    className="font-mono"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 whitespace-nowrap"
                    onClick={() => {
                      // GST lookup API is not wired up yet — nudge the user
                      // instead of silently doing nothing.
                      setSaveError(
                        "GST auto-fetch is not yet available — please enter company details manually."
                      );
                    }}
                  >
                    Fetch Details
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    GST Type<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Select
                    value={newGstType}
                    onValueChange={(v) => {
                      if (v) setNewGstType(v as (typeof GST_TYPES)[number]);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GST_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                <span>
                  Verify the GST number to capture all the details
                  automatically.
                </span>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Address Line 1<span className="ml-0.5 text-red-500">*</span>
                </Label>
                <Input
                  placeholder="Building, street"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Address Line 2<span className="ml-0.5 text-red-500">*</span>
                </Label>
                <Input
                  placeholder="Locality, landmark"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Pincode<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit PIN"
                    value={pincode}
                    onChange={(e) =>
                      setPincode(e.target.value.replace(/\D/g, ""))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    City<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Input
                    placeholder="City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    State<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Select
                    value={stateName}
                    onValueChange={(v) => setStateName(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDIAN_STATES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Country<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Select
                    value={countryLabel}
                    onValueChange={(v) => setCountryLabel(v ?? "India")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="India">India</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* ─── Compliance banner ───────────────────────────────── */}
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <ShieldCheck className="h-4 w-4 shrink-0 text-green-600" />
              <span className="font-medium">
                100% Safe and Compliant with Indian Govt Laws and Regulations
              </span>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 text-green-700 hover:bg-green-50 hover:text-green-800"
              onClick={() => {
                // Tag assignment isn't part of the vendor contract yet. Stub
                // it out so the button is discoverable but doesn't mislead.
                setSaveError(
                  "Tag assignment will be available once vendor tags ship."
                );
              }}
            >
              <Tag className="h-4 w-4" />
              Assign Tags
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={createVendor.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={createVendor.isPending}
                className="gap-1.5 bg-green-600 text-white hover:bg-green-700"
              >
                <Save className="h-4 w-4" />
                {createVendor.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
