"use client";

/**
 * NewQuotationDialog — create a quotation from a deal's detail page.
 *
 * Pre-fills company + contact from the deal, and links the new quotation
 * to the deal via `dealId` (+ accountId when the deal has one). The user
 * picks products from the production master, enters qty/unit-price/disc/tax
 * per line, and the server computes totals.
 *
 * On success, navigates to /crm/quotations/:id so the user is one click
 * away from sending it.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiCreateQuotation } from "@/hooks/useCrmApi";
import { useApiProducts } from "@/hooks/useProductionApi";
import type {
  CreateQuotation,
  CreateQuotationLineItem,
  Deal,
} from "@instigenie/contracts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal;
}

type LineDraft = {
  productId: string; // empty until a product is picked
  quantity: string; // stringified int
  unitPrice: string; // decimal string
  discountPct: string; // decimal string
  taxPct: string; // decimal string
};

const emptyLine = (): LineDraft => ({
  productId: "",
  quantity: "1",
  unitPrice: "",
  discountPct: "0",
  taxPct: "18",
});

const DECIMAL_RE = /^\d+(\.\d+)?$/;

export function NewQuotationDialog({ open, onOpenChange, deal }: Props) {
  const router = useRouter();
  const create = useApiCreateQuotation();

  // Default valid-for 30 days — typical B2B quote shelf life.
  const defaultValidUntil = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const [company, setCompany] = useState(deal.company);
  const [contactName, setContactName] = useState(deal.contactName);
  const [validUntil, setValidUntil] = useState(defaultValidUntil);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const productsQuery = useApiProducts({ isActive: true, limit: 200 });
  const products = productsQuery.data?.data ?? [];

  function patchLine(idx: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((ls) => [...ls, emptyLine()]);
  }

  function removeLine(idx: number) {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, i) => i !== idx)));
  }

  function validate(): { body: CreateQuotation } | { error: string } {
    const trimmedCompany = company.trim();
    const trimmedContact = contactName.trim();
    if (!trimmedCompany || !trimmedContact) {
      return { error: "Company and contact name are required." };
    }

    const lineItems: CreateQuotationLineItem[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.productId) {
        return { error: `Line ${i + 1}: pick a product.` };
      }
      const product = products.find((p) => p.id === l.productId);
      if (!product) {
        return { error: `Line ${i + 1}: product not found.` };
      }
      const qty = Number(l.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        return { error: `Line ${i + 1}: quantity must be a positive integer.` };
      }
      if (!DECIMAL_RE.test(l.unitPrice)) {
        return { error: `Line ${i + 1}: unit price must be a number.` };
      }
      if (!DECIMAL_RE.test(l.discountPct)) {
        return { error: `Line ${i + 1}: discount % must be a number.` };
      }
      if (!DECIMAL_RE.test(l.taxPct)) {
        return { error: `Line ${i + 1}: tax % must be a number.` };
      }
      lineItems.push({
        productCode: product.productCode,
        productName: product.name,
        quantity: qty,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        taxPct: l.taxPct,
      });
    }

    const body: CreateQuotation = {
      dealId: deal.id,
      company: trimmedCompany,
      contactName: trimmedContact,
      lineItems,
    };
    if (deal.accountId) body.accountId = deal.accountId;
    if (validUntil) body.validUntil = validUntil;
    const trimmedNotes = notes.trim();
    if (trimmedNotes) body.notes = trimmedNotes;

    return { body };
  }

  function handleSubmit() {
    const v = validate();
    if ("error" in v) {
      toast.error(v.error);
      return;
    }
    create.mutate(v.body, {
      onSuccess: (q) => {
        toast.success(`Quotation ${q.quotationNumber} created`);
        onOpenChange(false);
        // Reset so a re-open starts fresh.
        setLines([emptyLine()]);
        setNotes("");
        router.push(`/crm/quotations/${q.id}`);
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Failed to create quotation"
        );
      },
    });
  }

  // Client-side totals — purely for live preview. The server recomputes
  // these; we display decimals rounded to 2 places.
  const previewTotals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const l of lines) {
      const qty = Number(l.quantity);
      const price = Number(l.unitPrice);
      const disc = Number(l.discountPct);
      const taxPct = Number(l.taxPct);
      if (
        !Number.isFinite(qty) ||
        !Number.isFinite(price) ||
        !Number.isFinite(disc) ||
        !Number.isFinite(taxPct)
      ) {
        continue;
      }
      const gross = qty * price;
      const afterDisc = gross * (1 - disc / 100);
      subtotal += afterDisc;
      tax += afterDisc * (taxPct / 100);
    }
    return {
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      grandTotal: (subtotal + tax).toFixed(2),
    };
  }, [lines]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            New Quotation for {deal.dealNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nq-company">Company</Label>
              <Input
                id="nq-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nq-contact">Contact name</Label>
              <Input
                id="nq-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nq-valid">Valid until</Label>
              <Input
                id="nq-valid"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLine}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add line
              </Button>
            </div>

            {productsQuery.isLoading && (
              <p className="text-xs text-muted-foreground">
                Loading products…
              </p>
            )}
            {productsQuery.isError && (
              <p className="text-xs text-red-600">
                Failed to load products — line items need the products master.
              </p>
            )}

            <div className="space-y-3">
              {lines.map((l, idx) => (
                <div
                  key={idx}
                  className="rounded-md border bg-muted/20 p-3 space-y-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs">Product</Label>
                      <Select
                        value={l.productId}
                        onValueChange={(v) => patchLine(idx, { productId: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pick a product…" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.productCode} — {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-6 shrink-0 text-muted-foreground hover:text-red-600"
                        onClick={() => removeLine(idx)}
                        aria-label={`Remove line ${idx + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={l.quantity}
                        onChange={(e) =>
                          patchLine(idx, { quantity: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Unit price (₹)</Label>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={l.unitPrice}
                        onChange={(e) =>
                          patchLine(idx, { unitPrice: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Disc %</Label>
                      <Input
                        inputMode="decimal"
                        value={l.discountPct}
                        onChange={(e) =>
                          patchLine(idx, { discountPct: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tax %</Label>
                      <Input
                        inputMode="decimal"
                        value={l.taxPct}
                        onChange={(e) =>
                          patchLine(idx, { taxPct: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nq-notes">Notes (optional)</Label>
            <Textarea
              id="nq-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={4000}
              placeholder="Payment terms, delivery expectations, etc."
            />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal (preview)</span>
              <span>₹ {previewTotals.subtotal}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tax</span>
              <span>₹ {previewTotals.tax}</span>
            </div>
            <div className="flex justify-between font-semibold pt-1 border-t">
              <span>Grand total</span>
              <span>₹ {previewTotals.grandTotal}</span>
            </div>
            <p className="text-[10px] text-muted-foreground pt-1">
              Server recomputes totals; this is a live preview only.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              "Create quotation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
