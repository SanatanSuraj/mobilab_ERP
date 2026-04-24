"use client";

/**
 * NewApiLeadSheet — real-API variant of NewLeadSheet.
 *
 * Deliberately a separate file rather than a flag on the mock component
 * because the contract shapes diverge (decimalStr value, no free-form
 * note, uppercase enums, UUID-valued assignee) and baking both paths
 * into one component would fork most of the logic anyway.
 *
 * The mock NewLeadSheet stays in place for prototype pages that still
 * consume mock shapes. Delete it once every caller is migrated.
 */

import { useRef, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
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
import { useApiCreateLead } from "@/hooks/useCrmApi";
import { ApiProblem } from "@/lib/api/tenant-fetch";

// Sources aren't enumerated server-side — keep the UX familiar.
const SOURCES = [
  "Website",
  "Referral",
  "Trade Show",
  "LinkedIn",
  "Cold Call",
  "IndiaMart",
  "JustDial",
  "Direct",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewApiLeadSheet({ open, onOpenChange }: Props) {
  const createLead = useApiCreateLead();

  // useMutation.isPending has a render-gap between click 1 and click 2,
  // so a fast double-click on the disabled button slips a 2nd POST
  // through. A ref is synchronous — the 2nd handler invocation sees
  // submittingRef.current === true and bails before calling mutateAsync.
  const submittingRef = useRef(false);

  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    source: "Website",
    estimatedValue: "",
  });

  function set<K extends keyof typeof form>(
    field: K,
    value: (typeof form)[K]
  ) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function reset() {
    setForm({
      name: "",
      company: "",
      email: "",
      phone: "",
      source: "Website",
      estimatedValue: "",
    });
  }

  function isValid() {
    return (
      form.name.trim() &&
      form.company.trim() &&
      form.email.trim() &&
      form.phone.trim()
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid()) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

    // decimalStr: raw trimmed string. Empty → default "0" (matches
    // CreateLeadSchema.estimatedValue.default("0")).
    const rawValue = form.estimatedValue.trim();
    const estimatedValue = rawValue === "" ? "0" : rawValue;

    try {
      const lead = await createLead.mutateAsync({
        name: form.name.trim(),
        company: form.company.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        source: form.source || undefined,
        estimatedValue,
      });
      toast.success(`Lead "${lead.name}" created`, {
        description: lead.isDuplicate
          ? "⚠ Possible duplicate detected — check the lead list."
          : `Source: ${lead.source ?? "—"}`,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof ApiProblem
          ? err.problem.detail ?? err.problem.title ?? "Failed to create lead"
          : "Failed to create lead.";
      toast.error(msg);
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            New Lead
          </SheetTitle>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 px-4 py-2 flex-1"
        >
          <div className="space-y-1.5">
            <Label htmlFor="nal-name">
              Full Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="nal-name"
              placeholder="Dr. Rakesh Gupta"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nal-company">
              Company / Hospital <span className="text-destructive">*</span>
            </Label>
            <Input
              id="nal-company"
              placeholder="LifeCare Hospitals Pvt Ltd"
              value={form.company}
              onChange={(e) => set("company", e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nal-email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nal-email"
                type="email"
                placeholder="name@hospital.in"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nal-phone">
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nal-phone"
                placeholder="+91 98765 43210"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Lead Source</Label>
            <Select
              value={form.source}
              onValueChange={(v) => v && set("source", v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nal-value">Estimated Value (₹)</Label>
            <Input
              id="nal-value"
              inputMode="decimal"
              placeholder="500000"
              value={form.estimatedValue}
              onChange={(e) => set("estimatedValue", e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Decimal value in rupees. Leave blank for ₹0.
            </p>
          </div>

          <SheetFooter className="px-0 pb-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createLead.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid() || createLead.isPending}
            >
              {createLead.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Lead"
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
