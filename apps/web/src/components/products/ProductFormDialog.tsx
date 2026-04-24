"use client";

/**
 * ProductFormDialog — shared create/edit form for the product catalog.
 *
 * Modes:
 *   - "create": empty form, POST on submit. 409 (duplicate productCode)
 *     surfaces inline on the productCode field.
 *   - "edit":   seeded from `initial`, PATCH with `expectedVersion` on
 *     submit. 409 splits two ways by the server's Problem.code / detail:
 *       • version conflict → refetch, reseed form, toast, KEEP dialog open
 *       • duplicate productCode → inline field error, KEEP dialog open
 *
 * Validation uses @instigenie/contracts so the client mirrors the server
 * exactly (no drift between client-side hints and server-side enforcement).
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Save } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  apiCreateProduct,
  apiGetProduct,
  apiUpdateProduct,
} from "@/lib/api/production";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import {
  CreateProductSchema,
  PRODUCT_FAMILIES,
  type Product,
  type ProductFamily,
} from "@instigenie/contracts";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProductFormDialogProps =
  | {
      mode: "create";
      open: boolean;
      onOpenChange: (open: boolean) => void;
      onSaved: (product: Product) => void;
    }
  | {
      mode: "edit";
      open: boolean;
      onOpenChange: (open: boolean) => void;
      initial: Product;
      onSaved: (product: Product) => void;
    };

const FAMILY_LABELS: Record<ProductFamily, string> = {
  MODULE: "Module",
  DEVICE: "Device",
  REAGENT: "Reagent",
  CONSUMABLE: "Consumable",
};

// ─── Form state shape ────────────────────────────────────────────────────────

interface FormState {
  productCode: string;
  name: string;
  family: ProductFamily;
  description: string;
  uom: string;
  standardCycleDays: number;
  hasSerialTracking: boolean;
  reworkLimit: number;
  notes: string;
  isActive: boolean;
}

function emptyForm(): FormState {
  return {
    productCode: "",
    name: "",
    family: "DEVICE",
    description: "",
    uom: "PCS",
    standardCycleDays: 0,
    hasSerialTracking: true,
    reworkLimit: 2,
    notes: "",
    isActive: true,
  };
}

function productToForm(p: Product): FormState {
  return {
    productCode: p.productCode,
    name: p.name,
    family: p.family,
    description: p.description ?? "",
    uom: p.uom,
    standardCycleDays: p.standardCycleDays,
    hasSerialTracking: p.hasSerialTracking,
    reworkLimit: p.reworkLimit,
    notes: p.notes ?? "",
    isActive: p.isActive,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProductFormDialog(props: ProductFormDialogProps): React.JSX.Element {
  const { open, onOpenChange, mode, onSaved } = props;

  const [form, setForm] = useState<FormState>(emptyForm);
  // Tracks the version we're editing against — updated after a silent
  // refetch on version-conflict so the next submit uses the fresh value.
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [codeError, setCodeError] = useState<string>("");
  const [genericError, setGenericError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  // Reseed whenever the dialog opens or the edit target changes. We DO NOT
  // reset on close — `closeAndReset` below handles that so parent-driven
  // close after save doesn't flash stale values back into the form.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit") {
      setForm(productToForm(props.initial));
      setExpectedVersion(props.initial.version);
    } else {
      setForm(emptyForm());
      setExpectedVersion(null);
    }
    setCodeError("");
    setGenericError("");
    // Intentional: re-seeding only when `open` flips true, or the edit
    // target's identity changes. Exhaustive-deps would include `props`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode === "edit" ? props.initial.id : null]);

  function closeAndReset(): void {
    onOpenChange(false);
    // Let the exit transition play before wiping state, otherwise fields
    // visibly blank during the close animation.
    setTimeout(() => {
      setForm(emptyForm());
      setExpectedVersion(null);
      setCodeError("");
      setGenericError("");
    }, 200);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function buildBody(): {
    productCode: string;
    name: string;
    family: ProductFamily;
    description?: string;
    uom: string;
    standardCycleDays: number;
    hasSerialTracking: boolean;
    reworkLimit: number;
    notes?: string;
    isActive: boolean;
  } {
    // Trim + drop empty-string optional fields so the zod schema's
    // `.optional()` path sees undefined rather than an empty string
    // (which would fail `min(1)` if the schema ever changes).
    return {
      productCode: form.productCode.trim(),
      name: form.name.trim(),
      family: form.family,
      ...(form.description.trim()
        ? { description: form.description.trim() }
        : {}),
      uom: form.uom.trim(),
      standardCycleDays: form.standardCycleDays,
      hasSerialTracking: form.hasSerialTracking,
      reworkLimit: form.reworkLimit,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      isActive: form.isActive,
    };
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setCodeError("");
    setGenericError("");

    const body = buildBody();
    const parsed = CreateProductSchema.safeParse(body);
    if (!parsed.success) {
      // Map first error to the right surface.
      const first = parsed.error.issues[0]!;
      if (first.path[0] === "productCode") {
        setCodeError(first.message);
      } else {
        setGenericError(`${String(first.path.join(".") || "field")}: ${first.message}`);
      }
      return;
    }

    startTransition(async () => {
      try {
        if (mode === "create") {
          const created = await apiCreateProduct(parsed.data);
          toast.success(`Product ${created.productCode} created.`);
          onSaved(created);
          closeAndReset();
          return;
        }
        // mode === "edit"
        if (expectedVersion == null) {
          setGenericError("Missing version — reload and retry.");
          return;
        }
        const updated = await apiUpdateProduct(props.initial.id, {
          ...parsed.data,
          expectedVersion,
        });
        toast.success(`Product ${updated.productCode} updated.`);
        onSaved(updated);
        closeAndReset();
      } catch (err) {
        if (err instanceof ApiProblem && err.problem.status === 409) {
          // Server's ConflictError serialises to status 409 for both
          // "duplicate productCode" and "version conflict". We key off
          // detail text because server code doesn't expose a distinct
          // problem.code per case today.
          const detail = (err.problem.detail ?? err.problem.title ?? "").toLowerCase();
          const isDuplicateCode = /already exists|product code/.test(detail);

          if (isDuplicateCode) {
            setCodeError(
              err.problem.detail ?? "A product with this code already exists.",
            );
            return;
          }

          // Version conflict path — refetch, reseed, keep dialog open.
          if (mode === "edit") {
            try {
              const fresh = await apiGetProduct(props.initial.id);
              setForm(productToForm(fresh));
              setExpectedVersion(fresh.version);
              toast.error("This product was updated elsewhere.", {
                description:
                  "Form values refreshed from the server. Review, then resubmit.",
              });
              return;
            } catch {
              setGenericError(
                "Conflict — and could not refetch. Close and reopen the form.",
              );
              return;
            }
          }
        }
        setGenericError(
          err instanceof ApiProblem
            ? err.problem.detail ?? err.problem.title
            : "Could not reach the API.",
        );
      }
    });
  }

  const title = mode === "create" ? "New product" : `Edit ${props.mode === "edit" ? props.initial.productCode : ""}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeAndReset();
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Code + Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pf-code">Product code</Label>
              <Input
                id="pf-code"
                autoComplete="off"
                placeholder="MBA-v2"
                value={form.productCode}
                onChange={(e) => {
                  setField("productCode", e.target.value);
                  if (codeError) setCodeError("");
                }}
                required
                disabled={isPending}
                aria-invalid={codeError ? true : undefined}
              />
              {codeError && (
                <p className="text-xs text-destructive">{codeError}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-name">Name</Label>
              <Input
                id="pf-name"
                autoComplete="off"
                placeholder="MobiCase Assembly v2"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                required
                disabled={isPending}
              />
            </div>
          </div>

          {/* Family + UOM row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Family</Label>
              <Select
                value={form.family}
                onValueChange={(v) => setField("family", v as ProductFamily)}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_FAMILIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FAMILY_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-uom">UOM</Label>
              <Input
                id="pf-uom"
                autoComplete="off"
                value={form.uom}
                onChange={(e) => setField("uom", e.target.value)}
                required
                disabled={isPending}
              />
            </div>
          </div>

          {/* Cycle days + Rework limit row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pf-cycle">Standard cycle days</Label>
              <Input
                id="pf-cycle"
                type="number"
                min={0}
                value={form.standardCycleDays}
                onChange={(e) =>
                  setField("standardCycleDays", Number(e.target.value) || 0)
                }
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-rework">Rework limit</Label>
              <Input
                id="pf-rework"
                type="number"
                min={0}
                value={form.reworkLimit}
                onChange={(e) =>
                  setField("reworkLimit", Number(e.target.value) || 0)
                }
                disabled={isPending}
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="pf-serial" className="cursor-pointer">
                  Serial tracking
                </Label>
                <p className="text-xs text-muted-foreground">
                  Require a unique serial per produced unit.
                </p>
              </div>
              <Switch
                id="pf-serial"
                checked={form.hasSerialTracking}
                onCheckedChange={(v) => setField("hasSerialTracking", v)}
                disabled={isPending}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="pf-active" className="cursor-pointer">
                  Active
                </Label>
                <p className="text-xs text-muted-foreground">
                  Visible to work-order creation flows.
                </p>
              </div>
              <Switch
                id="pf-active"
                checked={form.isActive}
                onCheckedChange={(v) => setField("isActive", v)}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-desc">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="pf-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="pf-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              disabled={isPending}
            />
          </div>

          {genericError && (
            <p className="text-xs text-destructive leading-snug">
              {genericError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeAndReset}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !form.productCode.trim() || !form.name.trim()}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : mode === "create" ? (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create product
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save changes
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
