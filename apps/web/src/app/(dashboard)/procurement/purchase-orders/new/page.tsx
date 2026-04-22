"use client";

/**
 * New Purchase Order — full-document form.
 *
 * Replaces the thin `New PO` dialog on the list page. Matches the Add Company
 * vendor form design language (section headers, red-asterisk required markers,
 * green Save button) and the document-style layout from the product screenshot:
 *
 *   ┌──────────────┬──────────────┐ ┌─ Primary Document Details ─┐
 *   │ Buyer Detls  │ Delivery Loc │ │ Title, Doc #, Dates, Store │
 *   ├──────────────┼──────────────┤ │ Payment Term, Amendments   │
 *   │ Supplier Det │ Place Of Sup │ │ Advance Payable, Approver  │
 *   └──────────────┴──────────────┘ └────────────────────────────┘
 *
 *   [Items table with HSN/SAC, Qty, Units, Price, Tax]
 *
 *   [Extra Charges] [Attachments] [Additional Details] [Comment] [Signature]
 *   │ Manage Signature pad     │        │ Totals card with Save Draft/Confirm │
 *
 * Contract mapping (the PO schema has fewer columns than the form fields):
 *   - Title, Amendment, OC Number/Date, Indent Number/Date, Advance Payable,
 *     Approving Authority, Advance Payment Date, Kind Attention — folded into
 *     `notes` as structured `[Key: value]` lines so they are searchable later.
 *   - Place of Supply (city/state/country) is composed into `shippingAddress`.
 *   - Buyer + supplier GSTIN / address cards are read-only display of the
 *     selected vendor and the org's own profile (hardcoded placeholder until
 *     we have an org-profile endpoint).
 *
 * Supports `?kind=service` for the Service Order variant — same schema, just a
 * different header title.
 */

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiCreatePurchaseOrder,
  useApiVendors,
} from "@/hooks/useProcurementApi";
import { useApiItems, useApiWarehouses } from "@/hooks/useInventoryApi";
import type { Vendor } from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  HelpCircle,
  Lightbulb,
  MapPin,
  Pencil,
  Plus,
  Save,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";

// ─── Constants ──────────────────────────────────────────────────────────────

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

const ADVANCE_PAYABLE_OPTIONS = [
  "Yes",
  "No",
  "On Delivery",
  "Milestone Based",
] as const;

const APPROVER_OPTIONS = [
  "Finance Head",
  "Procurement Head",
  "CFO",
  "CEO",
  "Plant Manager",
] as const;

const PAYMENT_TERM_OPTIONS = [
  { value: "0", label: "Cash on Delivery" },
  { value: "7", label: "Net 7" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "60", label: "Net 60" },
  { value: "90", label: "Net 90" },
] as const;

// Hardcoded buyer info — the CRM doesn't yet expose an org-profile endpoint,
// so we surface the same primary-entity data shown in the product screenshot.
// Replace with a real `useApiOrgProfile` hook when it lands.
const BUYER_INFO = {
  name: "Primary Healthtech Pvt. Ltd.",
  address:
    "3rd FLOOR, BLOCK C/37, SECTOR 6, NOIDA, UTTAR PRADESH, 201301., PRIMARY HEALTHTECH PVT. LTD.",
  district: "Gautam Buddha Nagar (Uttar Pradesh)",
  country: "India - 201301",
  gstin: "09AAJCP8399K1ZD",
};

// Sequence generator for document numbers. Format: PO#####
// Real systems use a server-side sequence; this is a visual stand-in that the
// API will overwrite with its canonical PO number on save.
function makeDocNumber(): string {
  const n = Math.floor(Math.random() * 99999);
  return `PO${n.toString().padStart(5, "0")}`;
}

// Today as YYYY-MM-DD
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Empty line template
type LineDraft = {
  key: string; // stable react key
  itemId: string;
  description: string;
  hsnCode: string;
  quantity: string;
  uom: string;
  price: string;
  tax: string; // percentage
};

function emptyLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    itemId: "",
    description: "",
    hsnCode: "",
    quantity: "1",
    uom: "",
    price: "0",
    tax: "0",
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const kind = searchParams.get("kind"); // "service" → Service Order header
  const isService = kind === "service";
  const headerTitle = isService ? "Service Order" : "Purchase Order";

  // ─── Data fetches ─────────────────────────────────────────────────────────
  const vendorsQuery = useApiVendors({ limit: 200, isActive: true });
  const warehousesQuery = useApiWarehouses({ limit: 100, isActive: true });
  const itemsQuery = useApiItems({ limit: 500, isActive: true });
  const createPo = useApiCreatePurchaseOrder();

  const vendors = vendorsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];
  const items = itemsQuery.data?.data ?? [];

  // ─── Form state ──────────────────────────────────────────────────────────
  // Primary document
  const [title, setTitle] = useState("");
  const [docNumber] = useState(() => makeDocNumber());
  const [docDate, setDocDate] = useState<string>(todayIso());
  const [amendment, setAmendment] = useState("0");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [ocNumber, setOcNumber] = useState("");
  const [ocDate, setOcDate] = useState("");
  const [indentNumber, setIndentNumber] = useState("");
  const [indentDate, setIndentDate] = useState("");
  const [paymentTerm, setPaymentTerm] = useState<string>("30");
  const [storeId, setStoreId] = useState("");
  const [kindAttention, setKindAttention] = useState("");
  const [advancePayable, setAdvancePayable] =
    useState<(typeof ADVANCE_PAYABLE_OPTIONS)[number]>("No");
  const [approvingAuthority, setApprovingAuthority] = useState<string>("");
  const [advancePaymentDate, setAdvancePaymentDate] = useState("");

  // Supplier
  const [vendorId, setVendorId] = useState("");

  // Place of Supply
  const [posCity, setPosCity] = useState("Gautam Buddha Nagar");
  const [posState, setPosState] = useState<string>("Uttar Pradesh");
  const [posCountry, setPosCountry] = useState<string>("India");

  // Line items
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [priceType, setPriceType] = useState<string>("Default Price");
  const [itemSearch, setItemSearch] = useState("");

  // Bottom sections
  const [activeTab, setActiveTab] = useState<
    "charges" | "attachments" | "details" | "comment" | "signature"
  >("signature");
  const [comment, setComment] = useState("");
  const [additionalDiscountPct, setAdditionalDiscountPct] = useState("0");
  const [advanceToPay, setAdvanceToPay] = useState("");

  // Submit
  const [saveError, setSaveError] = useState<string | null>(null);

  // ─── Derived data ────────────────────────────────────────────────────────
  const selectedVendor: Vendor | undefined = useMemo(
    () => vendors.find((v) => v.id === vendorId),
    [vendors, vendorId]
  );

  // Per-line and overall totals — decimal-string math would be safer but for
  // a visual display INR 2-decimal arithmetic via Number is fine.
  const rows = useMemo(
    () =>
      lines.map((l) => {
        const qty = Number.parseFloat(l.quantity || "0") || 0;
        const price = Number.parseFloat(l.price || "0") || 0;
        const taxPct = Number.parseFloat(l.tax || "0") || 0;
        const subtotal = qty * price;
        const tax = (subtotal * taxPct) / 100;
        return { line: l, subtotal, tax, total: subtotal + tax };
      }),
    [lines]
  );

  const totals = useMemo(() => {
    const subtotal = rows.reduce((s, r) => s + r.subtotal, 0);
    const tax = rows.reduce((s, r) => s + r.tax, 0);
    const discountPct = Number.parseFloat(additionalDiscountPct || "0") || 0;
    const discount = (subtotal * discountPct) / 100;
    const afterTax = subtotal - discount + tax;
    return { subtotal, tax, discount, afterTax, grand: afterTax };
  }, [rows, additionalDiscountPct]);

  // ─── Line-item helpers ───────────────────────────────────────────────────
  function patchLine(idx: number, patch: Partial<LineDraft>): void {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))
    );
  }

  function handlePickItem(idx: number, newItemId: string): void {
    const item = items.find((p) => p.id === newItemId);
    if (!item) {
      patchLine(idx, { itemId: newItemId });
      return;
    }
    patchLine(idx, {
      itemId: newItemId,
      description: item.name,
      hsnCode: item.hsnCode ?? "",
      uom: item.uom,
      price: item.unitCost ?? "0",
    });
  }

  function addLine(): void {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number): void {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return items;
    const q = itemSearch.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)
    );
  }, [items, itemSearch]);

  // ─── Save ────────────────────────────────────────────────────────────────
  async function doSave(confirmOnSave: boolean): Promise<void> {
    setSaveError(null);
    const missing: string[] = [];
    if (!title.trim()) missing.push("Title");
    if (!vendorId) missing.push("Supplier");
    if (!deliveryDate) missing.push("Delivery Date");
    if (!storeId) missing.push("Store");
    if (advancePayable === "Yes" && !advancePaymentDate)
      missing.push("Advance Payment Date");
    if (!approvingAuthority) missing.push("Approving Authority");
    if (!posCity.trim()) missing.push("Place of Supply — City");
    if (!posState) missing.push("Place of Supply — State");

    const validLines = lines.filter((l) => l.itemId);
    if (validLines.length === 0) missing.push("At least one item line");

    if (missing.length > 0) {
      setSaveError(`Please complete: ${missing.join(", ")}.`);
      return;
    }

    // Fold all the screenshot-specific fields that have no direct schema
    // column into `notes` as structured prefixes.
    const extras: string[] = [
      `[Title: ${title.trim()}]`,
      `[Doc#: ${docNumber}]`,
      `[Amendment: ${amendment || "0"}]`,
      `[Advance Payable: ${advancePayable}]`,
      `[Approving Authority: ${approvingAuthority}]`,
    ];
    if (advancePaymentDate)
      extras.push(`[Advance Payment Date: ${advancePaymentDate}]`);
    if (ocNumber.trim()) extras.push(`[OC#: ${ocNumber.trim()}]`);
    if (ocDate) extras.push(`[OC Date: ${ocDate}]`);
    if (indentNumber.trim()) extras.push(`[Indent#: ${indentNumber.trim()}]`);
    if (indentDate) extras.push(`[Indent Date: ${indentDate}]`);
    if (kindAttention.trim())
      extras.push(`[Kind Attention: ${kindAttention.trim()}]`);
    if (priceType !== "Default Price")
      extras.push(`[Price Type: ${priceType}]`);
    if (isService) extras.push("[Order Kind: SERVICE]");
    if (comment.trim()) extras.push(`[Comment: ${comment.trim()}]`);

    const combinedNotes = extras.join("\n");

    const placeOfSupply =
      `${posCity.trim()}, ${posState}, ${posCountry}`.trim();

    try {
      const created = await createPo.mutateAsync({
        vendorId,
        deliveryWarehouseId: storeId || undefined,
        orderDate: docDate || undefined,
        expectedDate: deliveryDate || undefined,
        paymentTermsDays: Number.parseInt(paymentTerm, 10) || 30,
        currency: "INR",
        shippingAddress: placeOfSupply,
        notes: combinedNotes,
        lines: validLines.map((l) => ({
          itemId: l.itemId,
          description: l.description || undefined,
          quantity: l.quantity || "1",
          uom: l.uom || "EA",
          unitPrice: l.price || "0",
          discountPct: "0",
          taxPct: l.tax || "0",
        })),
      });

      // SAVE & CONFIRM drops the user onto the detail page where they can
      // approve/send. SAVE DRAFT also goes to detail but this is where a real
      // impl would diverge (e.g. send a confirm mutation).
      router.push(
        `/procurement/purchase-orders/${created.id}${
          confirmOnSave ? "?action=confirm" : ""
        }`
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  // ─── Loading shell ───────────────────────────────────────────────────────
  if (vendorsQuery.isLoading || warehousesQuery.isLoading || itemsQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      {/* Teal header bar */}
      <div className="mb-4 flex items-center justify-between rounded-t-md bg-[#0f6a7a] px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md p-1 hover:bg-white/10"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <FileText className="h-5 w-5" />
          <h1 className="text-lg font-semibold">{headerTitle}</h1>
        </div>
        <Select value="INR" onValueChange={() => {}}>
          <SelectTrigger className="h-8 min-w-[110px] border-white/20 bg-white/10 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="INR">INR - ₹</SelectItem>
            <SelectItem value="USD">USD - $</SelectItem>
            <SelectItem value="EUR">EUR - €</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {saveError && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {/* ─── Top grid: Buyer/Delivery/Supplier/POS on left, PDD on right ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left two columns of info cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-2">
          {/* Buyer Details */}
          <InfoCard
            title="Buyer Details"
            action={
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Edit buyer"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            }
          >
            <p className="text-sm font-semibold">{BUYER_INFO.name}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {BUYER_INFO.address}
            </p>
            <p className="text-xs text-muted-foreground">
              {BUYER_INFO.district}
            </p>
            <p className="text-xs text-muted-foreground">
              {BUYER_INFO.country}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs">
                <span className="text-muted-foreground">GSTIN:</span>{" "}
                <span className="font-mono">{BUYER_INFO.gstin}</span>
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" />
                Place of Supply
              </button>
            </div>
          </InfoCard>

          {/* Delivery Location */}
          <InfoCard
            title="Delivery Location"
            action={
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Edit delivery"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            }
          >
            <p className="text-sm font-semibold">
              {warehouses.find((w) => w.id === storeId)?.name ?? "Location 2"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {BUYER_INFO.address}
            </p>
            <p className="text-xs text-muted-foreground">
              {BUYER_INFO.district}
            </p>
            <p className="text-xs text-muted-foreground">
              {BUYER_INFO.country}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs">
                <span className="text-muted-foreground">GSTIN:</span>{" "}
                <span className="font-mono">{BUYER_INFO.gstin}</span>
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" />
                Place of Supply
              </button>
            </div>
          </InfoCard>

          {/* Supplier Details */}
          <InfoCard
            title="Supplier Details"
            action={
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Edit supplier"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            }
          >
            <div className="space-y-1.5">
              <Select
                value={vendorId}
                onValueChange={(v) => setVendorId(v ?? "")}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder="Pick a supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.code} — {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedVendor ? (
              <>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {selectedVendor.address ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[selectedVendor.city, selectedVendor.state]
                    .filter(Boolean)
                    .join(", ") || ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  India - {selectedVendor.postalCode ?? ""}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs">
                    <span className="text-muted-foreground">GSTIN:</span>{" "}
                    <span className="font-mono">
                      {selectedVendor.gstin ?? "—"}
                    </span>
                  </p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    Place of Supply
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs italic text-muted-foreground">
                Select a supplier to see their address and GSTIN.
              </p>
            )}
          </InfoCard>

          {/* Place Of Supply */}
          <InfoCard title="Place Of Supply">
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  City<span className="ml-0.5 text-red-500">*</span>
                </Label>
                <Input
                  value={posCity}
                  onChange={(e) => setPosCity(e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    State<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Select
                    value={posState}
                    onValueChange={(v) => setPosState(v ?? "")}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue placeholder="State" />
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
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Country<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Select
                    value={posCountry}
                    onValueChange={(v) => setPosCountry(v ?? "India")}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="India">India</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </InfoCard>
        </div>

        {/* Primary Document Details */}
        <div>
          <InfoCard title="Primary Document Details" fill>
            <div className="space-y-3">
              <Field
                label="Title"
                required
                value={title}
                onChange={setTitle}
                placeholder="Please Enter a Transaction Title"
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Document Number
                    <span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={docNumber}
                      readOnly
                      className="h-8 flex-1 font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 shrink-0 px-2 text-xs"
                    >
                      Customize
                    </Button>
                  </div>
                </div>
                <DateField
                  label="Document Date"
                  value={docDate}
                  onChange={setDocDate}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Amendment"
                  value={amendment}
                  onChange={setAmendment}
                  type="number"
                />
                <DateField
                  label="Delivery Date"
                  required
                  value={deliveryDate}
                  onChange={setDeliveryDate}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="OC Number"
                  value={ocNumber}
                  onChange={setOcNumber}
                />
                <DateField
                  label="OC Date"
                  value={ocDate}
                  onChange={setOcDate}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Indent Number"
                  value={indentNumber}
                  onChange={setIndentNumber}
                />
                <DateField
                  label="Indent Date"
                  value={indentDate}
                  onChange={setIndentDate}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Payment Term
                  </Label>
                  <Select
                    value={paymentTerm}
                    onValueChange={(v) => setPaymentTerm(v ?? "30")}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_TERM_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Store<span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Select
                    value={storeId}
                    onValueChange={(v) => setStoreId(v ?? "")}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue placeholder="Select store" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  OC Details
                </Label>
                <button
                  type="button"
                  className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-2.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
                >
                  <span>0 OC selected. Click to view</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  Kind Attention
                </Label>
                <Textarea
                  rows={2}
                  value={kindAttention}
                  onChange={(e) =>
                    setKindAttention(e.target.value.slice(0, 200))
                  }
                  placeholder=""
                  className="resize-none"
                />
                <p className="text-right text-[10px] text-muted-foreground">
                  {kindAttention.length} / 200
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Advance Payable
                    <span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Select
                    value={advancePayable}
                    onValueChange={(v) => {
                      if (v)
                        setAdvancePayable(
                          v as (typeof ADVANCE_PAYABLE_OPTIONS)[number]
                        );
                    }}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ADVANCE_PAYABLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Approving Authority
                    <span className="ml-0.5 text-red-500">*</span>
                  </Label>
                  <Select
                    value={approvingAuthority}
                    onValueChange={(v) => setApprovingAuthority(v ?? "")}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {APPROVER_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DateField
                label="Advance Payment Date"
                value={advancePaymentDate}
                onChange={setAdvancePaymentDate}
              />
            </div>
          </InfoCard>
        </div>
      </div>

      {/* ─── Items Table ───────────────────────────────────────────────── */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-end text-xs">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            Optional Columns
            <ChevronRight className="h-3 w-3 rotate-90" />
          </button>
        </div>
        <div className="rounded-md border">
          <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="gap-1.5 border-green-600 text-green-700 hover:bg-green-50"
                type="button"
              >
                <Download className="h-3.5 w-3.5" />
                Download Item Template
              </Button>
              <Button
                variant="outline"
                className="gap-1.5 border-green-600 text-green-700 hover:bg-green-50"
                type="button"
              >
                <Upload className="h-3.5 w-3.5" />
                Bulk Upload
              </Button>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div className="flex items-center gap-2">
                <Label className="text-[11px] whitespace-nowrap text-muted-foreground">
                  Price type
                </Label>
                <Select
                  value={priceType}
                  onValueChange={(v) => setPriceType(v ?? "Default Price")}
                >
                  <SelectTrigger className="h-8 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Default Price">
                      Default Price
                    </SelectItem>
                    <SelectItem value="MRP">MRP</SelectItem>
                    <SelectItem value="Wholesale">Wholesale</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Search with Id or Name..."
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="h-8 w-full md:w-64"
              />
            </div>
          </div>

          {/* Items table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-teal-50/60 text-muted-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">#</th>
                  <th className="p-2 text-left font-medium">Item ID</th>
                  <th className="p-2 text-left font-medium">
                    Item Description
                  </th>
                  <th className="p-2 text-left font-medium">HSN/SAC Code</th>
                  <th className="p-2 text-left font-medium">Quantity</th>
                  <th className="p-2 text-left font-medium">Units</th>
                  <th className="p-2 text-left font-medium">Current Stock</th>
                  <th className="p-2 text-right font-medium">Price</th>
                  <th className="p-2 text-right font-medium">Tax %</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={l.key} className="border-t">
                    <td className="p-2 align-top text-muted-foreground">
                      {idx + 1}
                    </td>
                    <td className="p-2 align-top">
                      <Select
                        value={l.itemId}
                        onValueChange={(v) => handlePickItem(idx, v ?? "")}
                      >
                        <SelectTrigger className="h-8 w-[160px]">
                          <SelectValue placeholder="Pick item" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredItems.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.sku}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2 align-top">
                      <Input
                        value={l.description}
                        onChange={(e) =>
                          patchLine(idx, { description: e.target.value })
                        }
                        className="h-8 min-w-[200px]"
                      />
                    </td>
                    <td className="p-2 align-top">
                      <Input
                        value={l.hsnCode}
                        onChange={(e) =>
                          patchLine(idx, { hsnCode: e.target.value })
                        }
                        className="h-8 w-[110px] font-mono"
                      />
                    </td>
                    <td className="p-2 align-top">
                      <Input
                        type="number"
                        value={l.quantity}
                        onChange={(e) =>
                          patchLine(idx, { quantity: e.target.value })
                        }
                        className="h-8 w-[80px]"
                      />
                    </td>
                    <td className="p-2 align-top">
                      <Input
                        value={l.uom}
                        onChange={(e) =>
                          patchLine(idx, { uom: e.target.value })
                        }
                        className="h-8 w-[80px]"
                      />
                    </td>
                    <td className="p-2 align-top text-muted-foreground">
                      —
                    </td>
                    <td className="p-2 align-top text-right">
                      <Input
                        type="number"
                        value={l.price}
                        onChange={(e) =>
                          patchLine(idx, { price: e.target.value })
                        }
                        className="h-8 w-[90px] text-right"
                      />
                    </td>
                    <td className="p-2 align-top text-right">
                      <Input
                        type="number"
                        value={l.tax}
                        onChange={(e) =>
                          patchLine(idx, { tax: e.target.value })
                        }
                        className="h-8 w-[70px] text-right"
                      />
                    </td>
                    <td className="p-2 align-top">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remove line ${idx + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>&nbsp;</span>
            <div className="flex items-center gap-2">
              <span>
                1-{lines.length} of {lines.length}
              </span>
              <button
                type="button"
                disabled
                className="rounded-md p-1 text-muted-foreground/60"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled
                className="rounded-md p-1 text-muted-foreground/60"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <Button
          type="button"
          onClick={addLine}
          variant="outline"
          className="mt-3 gap-1.5 border-blue-500 text-blue-700 hover:bg-blue-50"
        >
          <Plus className="h-4 w-4" />
          ADD ITEM
        </Button>
      </div>

      {/* ─── Bottom: Tabs + Totals ───────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap gap-2">
            {(
              [
                { k: "charges", label: "Extra Charges" },
                { k: "attachments", label: "Attachments" },
                { k: "details", label: "Additional Details" },
                { k: "comment", label: "Comment" },
                { k: "signature", label: "Attach Signature" },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => setActiveTab(t.k)}
                className={
                  "rounded-full px-3 py-1 text-xs transition-colors " +
                  (activeTab === t.k
                    ? "bg-teal-100 text-teal-800"
                    : "bg-muted text-muted-foreground hover:bg-muted/80")
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "signature" && (
            <InfoCard title="Manage Signature">
              <div className="flex items-center justify-center rounded-md border border-dashed bg-muted/20 p-6 text-muted-foreground">
                <div className="flex flex-col items-center gap-2 text-xs">
                  <Upload className="h-5 w-5" />
                  Drop signature image here or click to upload
                </div>
              </div>
            </InfoCard>
          )}
          {activeTab === "comment" && (
            <InfoCard title="Comment">
              <Textarea
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add an internal comment..."
              />
            </InfoCard>
          )}
          {activeTab === "charges" && (
            <InfoCard title="Extra Charges">
              <p className="text-xs text-muted-foreground">
                Freight, packaging and other line-external charges land here.
                This surface is reserved — wire it up when the extra-charges
                endpoint ships.
              </p>
            </InfoCard>
          )}
          {activeTab === "attachments" && (
            <InfoCard title="Attachments">
              <div className="flex items-center justify-center rounded-md border border-dashed bg-muted/20 p-6 text-muted-foreground">
                <div className="flex flex-col items-center gap-2 text-xs">
                  <Upload className="h-5 w-5" />
                  Drop PO attachments here (PDF, invoice copies)
                </div>
              </div>
            </InfoCard>
          )}
          {activeTab === "details" && (
            <InfoCard title="Additional Details">
              <p className="text-xs text-muted-foreground">
                Use the “Kind Attention” and “Notes” on the header, or the
                line-level notes on each item row.
              </p>
            </InfoCard>
          )}
        </div>

        {/* Totals panel */}
        <div>
          <InfoCard title="" fill>
            <div className="space-y-3">
              <div className="space-y-1">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-xs hover:bg-muted/30"
                >
                  <span>Additional Discount</span>
                  <ChevronRight className="h-3.5 w-3.5 rotate-90" />
                </button>
                <Input
                  type="number"
                  value={additionalDiscountPct}
                  onChange={(e) => setAdditionalDiscountPct(e.target.value)}
                  placeholder="Discount %"
                  className="h-8"
                />
              </div>
              <TotalRow label="Total (before tax) :" value={totals.subtotal} />
              <TotalRow
                label={
                  <span className="flex items-center gap-1.5">
                    <span className="rounded border px-1 py-0.5 font-mono text-[10px] text-blue-700">
                      RCM
                    </span>
                    Total Tax :
                  </span>
                }
                value={totals.tax}
              />
              <TotalRow
                label="Total (after tax) :"
                value={totals.afterTax}
              />
              <div className="border-t pt-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-xs hover:bg-muted/30"
                >
                  <span>Non-Taxable Extra Charges</span>
                  <ChevronRight className="h-3.5 w-3.5 rotate-90" />
                </button>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="rounded border px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                    Round-off
                  </span>
                  Grand Total :
                </div>
                <span className="text-base font-semibold">
                  {formatINR(totals.grand)}
                </span>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  Advance To Pay :
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    value={advanceToPay}
                    onChange={(e) => setAdvanceToPay(e.target.value)}
                    className="h-8"
                  />
                  <span className="text-sm text-muted-foreground">₹</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 border-t pt-3 md:flex-row md:items-center md:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => doSave(false)}
                disabled={createPo.isPending}
                className="gap-1.5 bg-teal-50 text-teal-800 hover:bg-teal-100"
              >
                <Save className="h-3.5 w-3.5" />
                {createPo.isPending ? "Saving…" : "SAVE DRAFT"}
              </Button>
              <Button
                type="button"
                onClick={() => doSave(true)}
                disabled={createPo.isPending}
                className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                SAVE & CONFIRM
              </Button>
            </div>

            <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
              <Shield className="h-3 w-3 text-green-600" />
              <span>Encrypted Action</span>
            </div>
          </InfoCard>
        </div>
      </div>

      {/* Compliance banner */}
      <div className="mt-6 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
        <ShieldCheck className="h-4 w-4 shrink-0 text-green-600" />
        <span className="font-medium">
          100% Safe and Compliant with Indian Govt Laws and Regulations
        </span>
      </div>

      {/* Floating Get Help + info chips (cosmetic) */}
      <div className="pointer-events-none fixed bottom-6 right-6 flex flex-col items-end gap-3">
        <button
          type="button"
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-green-600 px-4 py-2 text-xs font-medium text-white shadow-lg hover:bg-green-700"
        >
          <HelpCircle className="h-4 w-4" />
          Get Help
        </button>
      </div>
      <div className="pointer-events-none fixed bottom-6 left-6">
        <button
          type="button"
          className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 shadow-lg hover:bg-amber-200"
          aria-label="Tips"
        >
          <Lightbulb className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Small building blocks ──────────────────────────────────────────────────

function InfoCard({
  title,
  children,
  action,
  fill,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  fill?: boolean;
}) {
  return (
    <div
      className={
        "flex flex-col rounded-md border bg-white " +
        (fill ? "h-full" : "")
      }
    >
      {title && (
        <div className="flex items-center justify-between border-b bg-teal-50 px-3 py-2">
          <h3 className="text-xs font-semibold text-teal-900">{title}</h3>
          {action}
        </div>
      )}
      <div className="flex-1 p-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  value,
  onChange,
  placeholder,
  type,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8"
      />
    </div>
  );
}

function DateField({
  label,
  required,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
    </div>
  );
}

function TotalRow({
  label,
  value,
}: {
  label: React.ReactNode;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{formatINR(value)}</span>
    </div>
  );
}

function formatINR(n: number): string {
  if (!Number.isFinite(n)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}
