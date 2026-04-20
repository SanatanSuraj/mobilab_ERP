"use client";

/**
 * ConvertLeadDialog — one-click lead → Account + Deal conversion.
 *
 * Creates:
 *   1. Account (company becomes an Account record)
 *   2. Deal (enters the sales pipeline)
 *   3. Updates the lead: status="converted", convertedToAccountId, convertedToDealId
 *
 * After conversion: navigate to the new deal page.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Building2, Handshake } from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConvertLead, useCrmUsers } from "@/hooks/useCrm";
import { useAuthStore } from "@/store/auth.store";
import { formatCurrency } from "@/data/mock";
import type { EnhancedLead } from "@/data/crm-mock";
import type { DealStage } from "@/data/mock";

const DEAL_STAGES: { value: DealStage; label: string }[] = [
  { value: "discovery",   label: "Discovery" },
  { value: "proposal",    label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: EnhancedLead;
}

export function ConvertLeadDialog({ open, onOpenChange, lead }: Props) {
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const { data: users = [] } = useCrmUsers();
  const convertLead = useConvertLead();

  // 90 days from today as default expected close
  const defaultClose = new Date();
  defaultClose.setDate(defaultClose.getDate() + 90);

  const [form, setForm] = useState({
    dealTitle: `${lead.company} – Product Deal`,
    dealValue: String(lead.estimatedValue),
    dealStage: "discovery" as DealStage,
    expectedClose: defaultClose.toISOString().slice(0, 10),
    assignedTo: currentUser?.id ?? "u2",
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleConvert() {
    try {
      const result = await convertLead.mutateAsync({
        leadId: lead.id,
        input: {
          dealTitle: form.dealTitle,
          dealValue: parseFloat(form.dealValue) || lead.estimatedValue,
          dealStage: form.dealStage,
          expectedClose: form.expectedClose,
          assignedTo: form.assignedTo,
        },
      });

      toast.success(`${lead.name} converted!`, {
        description: `Account "${result.account.name}" and Deal "${result.deal.title}" created.`,
      });
      onOpenChange(false);
      router.push(`/crm/deals/${result.deal.id}`);
    } catch (err) {
      toast.error((err as Error).message || "Conversion failed. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-4 w-4" />
            Convert Lead to Account + Deal
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* What gets created */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-primary shrink-0" />
              <span>
                Account: <span className="font-semibold">{lead.company}</span> will be created
              </span>
            </div>
            <p className="text-xs text-muted-foreground pl-6">
              Contact: {lead.name} · {lead.email}
            </p>
          </div>

          {/* Deal title */}
          <div className="space-y-1.5">
            <Label htmlFor="cl-title">Deal Title</Label>
            <Input
              id="cl-title"
              value={form.dealTitle}
              onChange={(e) => set("dealTitle", e.target.value)}
            />
          </div>

          {/* Deal value + stage */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cl-value">Deal Value (₹)</Label>
              <Input
                id="cl-value"
                type="number"
                min="0"
                step="1000"
                value={form.dealValue}
                onChange={(e) => set("dealValue", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Initial Stage</Label>
              <Select
                value={form.dealStage}
                onValueChange={(v) => v && set("dealStage", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEAL_STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Expected close + Assigned to */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cl-close">Expected Close</Label>
              <Input
                id="cl-close"
                type="date"
                value={form.expectedClose}
                onChange={(e) => set("expectedClose", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Assigned To</Label>
              <Select
                value={form.assignedTo}
                onValueChange={(v) => v && set("assignedTo", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Deal value: {formatCurrency(parseFloat(form.dealValue) || 0)}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={convertLead.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleConvert} disabled={convertLead.isPending}>
            {convertLead.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Converting…</>
              : "Convert Lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
