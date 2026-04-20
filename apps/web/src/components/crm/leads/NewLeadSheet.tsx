"use client";

/**
 * NewLeadSheet — slide-in form to create a single lead manually.
 * Used by sales reps after calls, meetings, trade shows.
 */

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateLead, useCrmUsers } from "@/hooks/useCrm";
import { useAuthStore } from "@/store/auth.store";

const SOURCES = ["Website", "Referral", "Trade Show", "LinkedIn", "Cold Call", "IndiaMart", "JustDial", "Direct"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewLeadSheet({ open, onOpenChange }: Props) {
  const currentUser = useAuthStore((s) => s.user);
  const { data: users = [] } = useCrmUsers();
  const createLead = useCreateLead();

  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    source: "Website",
    assignedTo: currentUser?.id ?? "u2",
    estimatedValue: "",
    note: "",
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function reset() {
    setForm({
      name: "",
      company: "",
      email: "",
      phone: "",
      source: "Website",
      assignedTo: currentUser?.id ?? "u2",
      estimatedValue: "",
      note: "",
    });
  }

  function isValid() {
    return form.name.trim() && form.company.trim() && form.email.trim() && form.phone.trim();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid()) return;

    try {
      const lead = await createLead.mutateAsync({
        name: form.name,
        company: form.company,
        email: form.email,
        phone: form.phone,
        source: form.source,
        assignedTo: form.assignedTo,
        estimatedValue: parseFloat(form.estimatedValue) || 0,
        note: form.note || undefined,
      });

      toast.success(`Lead "${lead.name}" created`, {
        description: lead.isDuplicate
          ? "⚠ Possible duplicate detected — check the lead list."
          : `Source: ${lead.source}`,
      });
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Failed to create lead. Please try again.");
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 py-2 flex-1">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="nl-name">
              Full Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="nl-name"
              placeholder="Dr. Rakesh Gupta"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
            />
          </div>

          {/* Company */}
          <div className="space-y-1.5">
            <Label htmlFor="nl-company">
              Company / Hospital <span className="text-destructive">*</span>
            </Label>
            <Input
              id="nl-company"
              placeholder="LifeCare Hospitals Pvt Ltd"
              value={form.company}
              onChange={(e) => set("company", e.target.value)}
              required
            />
          </div>

          {/* Email + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nl-email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nl-email"
                type="email"
                placeholder="name@hospital.in"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nl-phone">
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nl-phone"
                placeholder="+91 98765 43210"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                required
              />
            </div>
          </div>

          {/* Source */}
          <div className="space-y-1.5">
            <Label>Lead Source</Label>
            <Select value={form.source} onValueChange={(v) => v && set("source", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Assigned To */}
          <div className="space-y-1.5">
            <Label>Assign To</Label>
            <Select value={form.assignedTo} onValueChange={(v) => v && set("assignedTo", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {users.filter((u) => u.role === "Sales Rep" || u.role === "Finance Lead" || true).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Estimated Value */}
          <div className="space-y-1.5">
            <Label htmlFor="nl-value">Estimated Value (₹)</Label>
            <Input
              id="nl-value"
              type="number"
              min="0"
              step="1000"
              placeholder="500000"
              value={form.estimatedValue}
              onChange={(e) => set("estimatedValue", e.target.value)}
            />
          </div>

          {/* First Note */}
          <div className="space-y-1.5">
            <Label htmlFor="nl-note">First Note (optional)</Label>
            <Textarea
              id="nl-note"
              placeholder="Met at BioMed India 2025 expo. Interested in glucose monitors."
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              className="resize-none min-h-[80px] text-sm"
            />
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
            <Button type="submit" disabled={!isValid() || createLead.isPending}>
              {createLead.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</>
                : "Create Lead"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
