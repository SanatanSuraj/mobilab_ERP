"use client";

/**
 * New Indent — full-document form.
 *
 * Replaces the thin `New Indent` dialog on the list page. Matches the
 * Primary Healthtech document-style layout from the product screenshot:
 *
 *   ┌──────────────┬──────────────┐ ┌─ Primary Document Details ─┐
 *   │ Buyer Detls  │ Delivery Loc │ │ Doc#, Doc Date, Store,     │
 *   │              │              │ │ Expected By, Required For  │
 *   └──────────────┴──────────────┘ └────────────────────────────┘
 *
 *   [Items table: Item ID | Desc | Qty | Units | Curr. Stock | Exp By | Req For]
 *
 *   [Attachments] [Comment] [Attach Signature]
 *   │ Manage Signature                │          [SAVE DRAFT] [SAVE AND SEND]
 *
 * Contract mapping (the Indent schema doesn't have columns for store,
 * per-line expected-by, or per-line required-for):
 *   - Store (delivery warehouse) folds into `notes` as `[Store: <name>]`.
 *   - Expected By + Required For (header) fold into `notes` too — the
 *     schema's `requiredBy` gets set from the document-level Expected By.
 *   - Per-line expectedBy + requiredFor fold into the line's `notes`.
 *
 * Buyer + delivery cards are read-only display of the org's own profile —
 * hardcoded until we have a real org-profile endpoint.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { useApiCreateIndent } from "@/hooks/useProcurementApi";
import { useApiItems, useApiWarehouses } from "@/hooks/useInventoryApi";
import {
  AlertCircle,
  ArrowLeft,
  Cloud,
  Download,
  FileText,
  HelpCircle,
  Plus,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";

// ─── Buyer / Delivery defaults (until org-profile endpoint exists) ─────────
// These populate the editable cards on first render. Users can override any
// field on a per-document basis — the overrides fold into `notes` on save
// since the Indent header schema has no dedicated columns for them.
const BUYER_DEFAULTS = {
  name: "Primary Healthtech Pvt. Ltd.",
  address:
    "3rd FLOOR, BLOCK C/37, SECTOR 6, NOIDA, UTTAR PRADESH, 201301., PRIMARY HEALTHTECH PVT. LTD.",
  district: "Gautam Buddha Nagar (Uttar Pradesh)",
  country: "India - 201301",
  gstin: "09AAJCP8399K1ZD",
};

const DELIVERY_DEFAULTS = {
  label: "Location 2",
  ...BUYER_DEFAULTS,
};

// Sequence stand-in for the document number. Format: INDXXXXX. The server
// issues the canonical IND-YYYY-NNNN on save via procurement_number_sequences.
function makeDocNumber(): string {
  const n = Math.floor(Math.random() * 99999);
  return `IND${n.toString().padStart(5, "0")}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type LineDraft = {
  key: string;
  itemId: string;
  description: string;
  quantity: string;
  uom: string;
  expectedBy: string;
  requiredFor: string;
};

function emptyLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    itemId: "",
    description: "",
    quantity: "1",
    uom: "",
    expectedBy: "",
    requiredFor: "",
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NewIndentPage() {
  const router = useRouter();

  // ─── Data fetches ────────────────────────────────────────────────────────
  const warehousesQuery = useApiWarehouses({ limit: 100, isActive: true });
  const itemsQuery = useApiItems({ limit: 500, isActive: true });
  const createIndent = useApiCreateIndent();

  const warehouses = warehousesQuery.data?.data ?? [];
  const items = itemsQuery.data?.data ?? [];

  // ─── Form state ──────────────────────────────────────────────────────────
  // Document identifiers — both editable. The server will still issue the
  // canonical IND-YYYY-NNNN on save; the typed value just flows into notes.
  const [docNumber, setDocNumber] = useState(() => makeDocNumber());
  const [docDate, setDocDate] = useState(() => todayIso());
  const [storeId, setStoreId] = useState<string>("");
  const [expectedBy, setExpectedBy] = useState<string>("");
  const [requiredFor, setRequiredFor] = useState<string>("");

  // Buyer card — editable. Starts from defaults but any field can be changed
  // and the overrides fold into notes on save.
  const [buyerName, setBuyerName] = useState(BUYER_DEFAULTS.name);
  const [buyerAddress, setBuyerAddress] = useState(BUYER_DEFAULTS.address);
  const [buyerDistrict, setBuyerDistrict] = useState(BUYER_DEFAULTS.district);
  const [buyerCountry, setBuyerCountry] = useState(BUYER_DEFAULTS.country);
  const [buyerGstin, setBuyerGstin] = useState(BUYER_DEFAULTS.gstin);

  // Delivery card — editable. When a store is picked, the name field updates
  // to the store name but the user can still type a custom label.
  const [deliveryName, setDeliveryName] = useState(DELIVERY_DEFAULTS.label);
  const [deliveryAddress, setDeliveryAddress] = useState(
    DELIVERY_DEFAULTS.address
  );
  const [deliveryDistrict, setDeliveryDistrict] = useState(
    DELIVERY_DEFAULTS.district
  );
  const [deliveryCountry, setDeliveryCountry] = useState(
    DELIVERY_DEFAULTS.country
  );
  const [deliveryGstin, setDeliveryGstin] = useState(DELIVERY_DEFAULTS.gstin);

  // Items
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [itemSearch, setItemSearch] = useState("");

  // Bottom tab: "attachments" | "comment" | "signature"
  const [activeTab, setActiveTab] = useState<
    "attachments" | "comment" | "signature"
  >("signature");
  const [comment, setComment] = useState("");

  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedStore = useMemo(
    () => warehouses.find((w) => w.id === storeId),
    [warehouses, storeId]
  );

  // ─── Derived ─────────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return items;
    const q = itemSearch.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)
    );
  }, [items, itemSearch]);

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
      uom: item.uom,
    });
  }

  function addLine(): void {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number): void {
    setLines((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  }

  // ─── Save ────────────────────────────────────────────────────────────────
  async function doSave(sendAfterSave: boolean): Promise<void> {
    setSaveError(null);

    const missing: string[] = [];
    if (!storeId) missing.push("Store");
    const validLines = lines.filter((l) => l.itemId && l.quantity);
    if (validLines.length === 0) missing.push("At least one item line");
    for (let i = 0; i < validLines.length; i++) {
      if (!validLines[i].uom)
        missing.push(`Line ${i + 1}: Units`);
    }

    if (missing.length > 0) {
      setSaveError(`Please complete: ${missing.join(", ")}.`);
      return;
    }

    // Fold document-level extras (buyer overrides, delivery overrides, store,
    // doc#, required-for, comment) into notes as structured prefixes so they
    // remain searchable even though the header schema has no dedicated
    // columns for them.
    const headerExtras: string[] = [
      `[Doc#: ${docNumber}]`,
      `[Doc Date: ${docDate}]`,
      `[Buyer: ${buyerName.trim()}]`,
      `[Buyer Address: ${buyerAddress.trim()}]`,
      `[Buyer District: ${buyerDistrict.trim()}]`,
      `[Buyer Country: ${buyerCountry.trim()}]`,
      `[Buyer GSTIN: ${buyerGstin.trim()}]`,
      `[Delivery: ${deliveryName.trim()}]`,
      `[Delivery Address: ${deliveryAddress.trim()}]`,
      `[Delivery District: ${deliveryDistrict.trim()}]`,
      `[Delivery Country: ${deliveryCountry.trim()}]`,
      `[Delivery GSTIN: ${deliveryGstin.trim()}]`,
    ];
    if (selectedStore)
      headerExtras.push(`[Store: ${selectedStore.code} — ${selectedStore.name}]`);
    if (requiredFor.trim())
      headerExtras.push(`[Required For: ${requiredFor.trim()}]`);
    if (comment.trim()) headerExtras.push(`[Comment: ${comment.trim()}]`);
    if (sendAfterSave) headerExtras.push("[Intent: SEND_FOR_APPROVAL]");
    const combinedNotes = headerExtras.join("\n");

    try {
      const created = await createIndent.mutateAsync({
        priority: "NORMAL",
        requiredBy: expectedBy || undefined,
        notes: combinedNotes,
        lines: validLines.map((l) => {
          // Per-line extras (expected-by, required-for) into line.notes.
          const lineExtras: string[] = [];
          if (l.expectedBy) lineExtras.push(`[Expected By: ${l.expectedBy}]`);
          if (l.requiredFor.trim())
            lineExtras.push(`[Required For: ${l.requiredFor.trim()}]`);
          return {
            itemId: l.itemId,
            quantity: l.quantity || "1",
            uom: l.uom || "EA",
            estimatedCost: "0",
            notes: lineExtras.length > 0 ? lineExtras.join("\n") : undefined,
          };
        }),
      });

      router.push(
        `/procurement/indents/${created.id}${sendAfterSave ? "?action=send" : ""}`
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  // ─── Loading shell ───────────────────────────────────────────────────────
  if (warehousesQuery.isLoading || itemsQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      {/* Teal header bar */}
      <div className="mb-4 flex items-center gap-3 rounded-md bg-[#0f6a7a] px-4 py-3 text-white">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md p-1 hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <FileText className="h-5 w-5" />
        <h1 className="text-lg font-semibold">Indent</h1>
      </div>

      {saveError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <span className="text-red-700">{saveError}</span>
        </div>
      )}

      {/* Top row: Buyer | Delivery | Primary Document Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <InfoCard title="Buyer Details" editable>
          <div className="space-y-2">
            <Input
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="Company name"
              className="h-8 text-sm font-semibold"
            />
            <Textarea
              rows={3}
              value={buyerAddress}
              onChange={(e) => setBuyerAddress(e.target.value)}
              placeholder="Address"
              className="text-sm leading-relaxed resize-none"
            />
            <Input
              value={buyerDistrict}
              onChange={(e) => setBuyerDistrict(e.target.value)}
              placeholder="District (State)"
              className="h-8 text-sm"
            />
            <Input
              value={buyerCountry}
              onChange={(e) => setBuyerCountry(e.target.value)}
              placeholder="Country - PIN"
              className="h-8 text-sm"
            />
            <div className="flex items-center gap-2">
              <Label className="text-sm font-semibold text-slate-900 shrink-0">
                GSTIN:
              </Label>
              <Input
                value={buyerGstin}
                onChange={(e) => setBuyerGstin(e.target.value)}
                placeholder="GSTIN"
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>
        </InfoCard>

        <InfoCard title="Delivery Location" editable>
          <div className="space-y-2">
            <Input
              value={deliveryName}
              onChange={(e) => setDeliveryName(e.target.value)}
              placeholder={selectedStore?.name ?? "Location name"}
              className="h-8 text-sm font-semibold"
            />
            <Textarea
              rows={3}
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Address"
              className="text-sm leading-relaxed resize-none"
            />
            <Input
              value={deliveryDistrict}
              onChange={(e) => setDeliveryDistrict(e.target.value)}
              placeholder="District (State)"
              className="h-8 text-sm"
            />
            <Input
              value={deliveryCountry}
              onChange={(e) => setDeliveryCountry(e.target.value)}
              placeholder="Country - PIN"
              className="h-8 text-sm"
            />
            <div className="flex items-center gap-2">
              <Label className="text-sm font-semibold text-slate-900 shrink-0">
                GSTIN :
              </Label>
              <Input
                value={deliveryGstin}
                onChange={(e) => setDeliveryGstin(e.target.value)}
                placeholder="GSTIN"
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>
        </InfoCard>

        {/* Primary Document Details */}
        <div className="rounded-md border bg-white">
          <div className="rounded-t-md bg-[#d9edf2] px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-800">
              Primary Document Details
            </h3>
          </div>
          <div className="p-4 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px] font-medium text-[#0f6a7a]">
                  Document Number<span className="text-red-500">*</span>
                </Label>
                <div className="flex items-center gap-2 border-b-2 border-[#0f6a7a] pb-1">
                  <Input
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    className="h-7 border-0 p-0 text-sm font-medium text-slate-900 focus-visible:ring-0 shadow-none"
                  />
                  <button
                    type="button"
                    className="ml-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => { /* customize dialog stub */ }}
                  >
                    Customize
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-[11px] font-medium text-slate-500">
                  Document Date
                </Label>
                <div className="flex items-center gap-2 border-b border-dotted border-slate-300 pb-1">
                  <span className="text-slate-400">📅</span>
                  <Input
                    type="date"
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                    className="h-7 border-0 p-0 text-sm text-slate-700 focus-visible:ring-0 shadow-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-[11px] font-medium text-slate-500">
                Store<span className="text-red-500">*</span>
              </Label>
              <Select
                value={storeId}
                onValueChange={(v) => setStoreId(v ?? "")}
              >
                <SelectTrigger className="h-9 border-0 border-b border-dotted border-slate-300 rounded-none focus:ring-0 px-0 shadow-none">
                  <SelectValue placeholder="Select store…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[11px] font-medium text-slate-500">
                Expected By
              </Label>
              <div className="flex items-center gap-2 border-b border-dotted border-slate-300 pb-1">
                <span className="text-slate-400">📅</span>
                <Input
                  type="date"
                  value={expectedBy}
                  onChange={(e) => setExpectedBy(e.target.value)}
                  className="h-7 border-0 p-0 focus-visible:ring-0 shadow-none text-sm"
                />
              </div>
            </div>

            <div>
              <Label className="text-[11px] font-medium text-slate-500">
                Required For
              </Label>
              <Input
                value={requiredFor}
                onChange={(e) => setRequiredFor(e.target.value)}
                placeholder=""
                className="h-8 border-0 border-b border-dotted border-slate-300 rounded-none px-0 focus-visible:ring-0 shadow-none text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Optional columns selector */}
      <div className="mt-6 flex items-center justify-end">
        <Select defaultValue="all">
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder="Optional Columns" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Optional Columns</SelectItem>
            <SelectItem value="none">Hide optional</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Download / Bulk Upload / Search */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 border-green-600 text-green-700 hover:bg-green-50"
            onClick={() => { /* stub */ }}
          >
            <Download className="h-4 w-4" />
            Download Item Template
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 border-green-600 text-green-700 hover:bg-green-50"
            onClick={() => { /* stub */ }}
          >
            <Upload className="h-4 w-4" />
            Bulk Upload
          </Button>
        </div>
        <Input
          placeholder="Search with Id or description…"
          value={itemSearch}
          onChange={(e) => setItemSearch(e.target.value)}
          className="h-9 w-[260px]"
        />
      </div>

      {/* Items table */}
      <div className="mt-4 overflow-hidden rounded-md border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#d9edf2] text-slate-800">
            <tr>
              <th className="w-10 px-3 py-2 text-left text-[11px] font-semibold">
                &nbsp;
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold">
                Item ID
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold">
                Item Description
              </th>
              <th className="px-3 py-2 text-center text-[11px] font-semibold">
                Quantity
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold">
                Units
              </th>
              <th className="px-3 py-2 text-center text-[11px] font-semibold">
                Current Stock
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold">
                Expected By
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold">
                Required For
              </th>
              <th className="w-10 px-2 py-2 text-[11px] font-semibold">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const picked = items.find((i) => i.id === l.itemId);
              return (
                <tr key={l.key} className="border-t">
                  <td className="px-3 py-2 text-center text-sm text-slate-600">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={l.itemId}
                      onValueChange={(v) => handlePickItem(idx, v ?? "")}
                    >
                      <SelectTrigger className="h-8 border-0 border-b border-slate-300 rounded-none px-0 focus:ring-0 shadow-none text-sm">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredItems.map((it) => (
                          <SelectItem key={it.id} value={it.id}>
                            {it.sku} — {it.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={l.description}
                      onChange={(e) =>
                        patchLine(idx, { description: e.target.value })
                      }
                      placeholder={picked?.name ?? "—"}
                      className="h-8 border-0 border-b border-slate-300 rounded-none px-0 shadow-none focus-visible:ring-0 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Input
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) =>
                        patchLine(idx, { quantity: e.target.value })
                      }
                      className="h-8 border-0 border-b border-dotted border-slate-300 rounded-none text-center px-0 shadow-none focus-visible:ring-0 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={l.uom}
                      onChange={(e) => patchLine(idx, { uom: e.target.value })}
                      placeholder={picked?.uom ?? "EA"}
                      className="h-8 border-0 border-b border-slate-300 rounded-none px-0 shadow-none focus-visible:ring-0 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-center text-sm text-slate-400">
                    —
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="date"
                      value={l.expectedBy}
                      onChange={(e) =>
                        patchLine(idx, { expectedBy: e.target.value })
                      }
                      className="h-8 border-0 border-b border-dotted border-slate-300 rounded-none px-0 shadow-none focus-visible:ring-0 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={l.requiredFor}
                      onChange={(e) =>
                        patchLine(idx, { requiredFor: e.target.value })
                      }
                      className="h-8 border-0 border-b border-dotted border-slate-300 rounded-none px-0 shadow-none focus-visible:ring-0 text-sm"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove line ${idx + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination footer (visual only) */}
        <div className="flex items-center justify-end gap-3 border-t bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          <span>1–{lines.length} of {lines.length}</span>
          <button
            type="button"
            className="rounded px-1 py-0.5 text-slate-400 hover:bg-slate-200"
            disabled
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            type="button"
            className="rounded px-1 py-0.5 text-slate-400 hover:bg-slate-200"
            disabled
            aria-label="Next"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          onClick={addLine}
          className="bg-[#2a8aa0] hover:bg-[#227a8f] text-white gap-1.5"
        >
          <Plus className="h-4 w-4" />
          ADD ITEM
        </Button>
      </div>

      {/* Bottom tabs */}
      <div className="mt-8">
        <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 w-fit">
          <TabButton
            active={activeTab === "attachments"}
            onClick={() => setActiveTab("attachments")}
          >
            Attachments
          </TabButton>
          <TabButton
            active={activeTab === "comment"}
            onClick={() => setActiveTab("comment")}
          >
            Comment
          </TabButton>
          <TabButton
            active={activeTab === "signature"}
            onClick={() => setActiveTab("signature")}
          >
            Attach Signature
          </TabButton>
        </div>

        <div className="mt-4">
          {activeTab === "attachments" && (
            <div className="rounded-md border border-dashed bg-slate-50 p-6 text-center">
              <Upload className="mx-auto h-6 w-6 text-slate-400" />
              <p className="mt-2 text-sm text-slate-600">
                Drag files here or click to upload (not wired up yet).
              </p>
            </div>
          )}
          {activeTab === "comment" && (
            <Textarea
              rows={4}
              placeholder="Add a comment for the approver…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
          {activeTab === "signature" && (
            <div className="max-w-[420px] rounded-md border bg-white">
              <div className="flex items-center justify-between rounded-t-md bg-[#d9edf2] px-4 py-2">
                <h4 className="text-sm font-semibold text-slate-800">
                  Manage Signature
                </h4>
                <Cloud className="h-4 w-4 text-[#0f6a7a]" />
              </div>
              <div className="flex min-h-[120px] items-center justify-center p-4">
                <svg
                  viewBox="0 0 300 80"
                  className="h-16 w-full"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-label="Signature placeholder"
                >
                  <path
                    d="M10 55 C 30 20, 50 70, 70 40 S 110 10, 130 45 S 170 65, 200 35 S 240 15, 280 50"
                    stroke="#1e293b"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save bar */}
      <div className="mt-8 flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => void doSave(false)}
            disabled={createIndent.isPending}
            className="bg-[#6fb8c8] hover:bg-[#5ba8b8] text-white uppercase tracking-wider"
          >
            {createIndent.isPending ? "Saving…" : "Save Draft"}
          </Button>
          <Button
            type="button"
            onClick={() => void doSave(true)}
            disabled={createIndent.isPending}
            className="bg-[#0f6a7a] hover:bg-[#0c5a68] text-white uppercase tracking-wider"
          >
            {createIndent.isPending ? "Saving…" : "Save and Send"}
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Shield className="h-3.5 w-3.5 text-slate-600" />
          <span>Encrypted Action</span>
        </div>
      </div>

      {/* Get Help floating FAB */}
      <button
        type="button"
        className="fixed bottom-6 right-6 flex items-center gap-2 rounded-full bg-[#1aa87b] px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-[#168f68]"
        onClick={() => { /* stub */ }}
      >
        <HelpCircle className="h-4 w-4" />
        Get Help
      </button>
    </div>
  );
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function InfoCard({
  title,
  editable,
  children,
}: {
  title: string;
  editable?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between rounded-t-md bg-[#d9edf2] px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {editable && (
          <button
            type="button"
            className="rounded p-0.5 text-[#0f6a7a] hover:bg-white/60"
            aria-label={`Edit ${title}`}
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-[#d9edf2] px-4 py-1.5 text-sm font-medium text-[#0f6a7a]"
          : "rounded-full px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-200"
      }
    >
      {children}
    </button>
  );
}
