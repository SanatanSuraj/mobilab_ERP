"use client";

/**
 * LogActivitySheet — log a call, email, WhatsApp, meeting, or note on a lead.
 * Auto-advances status: new → contacted on first call/email/meeting.
 */

import { useState } from "react";
import { Phone, Mail, MessageCircle, FileText, Calendar, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAddLeadActivity } from "@/hooks/useCrm";
import { useAuthStore } from "@/store/auth.store";
import type { LeadActivity } from "@/data/crm-mock";

type ActivityType = LeadActivity["type"];

const ACTIVITY_TYPES: { type: ActivityType; label: string; icon: React.ElementType; color: string }[] = [
  { type: "call",      label: "Call",     icon: Phone,         color: "text-blue-600 bg-blue-50 border-blue-200 data-[active=true]:bg-blue-100 data-[active=true]:border-blue-400" },
  { type: "email",     label: "Email",    icon: Mail,          color: "text-purple-600 bg-purple-50 border-purple-200 data-[active=true]:bg-purple-100 data-[active=true]:border-purple-400" },
  { type: "whatsapp",  label: "WhatsApp", icon: MessageCircle, color: "text-green-600 bg-green-50 border-green-200 data-[active=true]:bg-green-100 data-[active=true]:border-green-400" },
  { type: "meeting",   label: "Meeting",  icon: Calendar,      color: "text-amber-600 bg-amber-50 border-amber-200 data-[active=true]:bg-amber-100 data-[active=true]:border-amber-400" },
  { type: "note",      label: "Note",     icon: FileText,      color: "text-gray-600 bg-gray-50 border-gray-200 data-[active=true]:bg-gray-100 data-[active=true]:border-gray-400" },
];

const PLACEHOLDER: Record<ActivityType, string> = {
  call: "Introductory call. Discussed product range. Follow up next week.",
  email: "Sent product catalog and pricing sheet.",
  whatsapp: "Shared case study on cost reduction.",
  meeting: "On-site demo at their facility. 5 attendees including CFO.",
  note: "Met at BioMed India 2025 expo. Interested in glucose monitors.",
  status_change: "",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
}

export function LogActivitySheet({ open, onOpenChange, leadId, leadName }: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? "u1");
  const addActivity = useAddLeadActivity();

  const [activityType, setActivityType] = useState<ActivityType>("call");
  const [content, setContent] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    try {
      const updated = await addActivity.mutateAsync({
        leadId,
        input: { type: activityType, content, userId },
      });

      // Show auto-advance notice
      if (updated.status === "contacted") {
        toast.success("Activity logged — lead moved to Contacted");
      } else {
        toast.success("Activity logged");
      }
      setContent("");
      onOpenChange(false);
    } catch {
      toast.error("Failed to log activity.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md w-full">
        <SheetHeader>
          <SheetTitle className="text-base">Log Activity</SheetTitle>
          <p className="text-xs text-muted-foreground">{leadName}</p>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 py-3 flex-1">
          {/* Activity type picker */}
          <div className="grid grid-cols-5 gap-2">
            {ACTIVITY_TYPES.map(({ type, label, icon: Icon, color }) => (
              <button
                key={type}
                type="button"
                data-active={activityType === type}
                onClick={() => setActivityType(type)}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-2 rounded-lg border text-xs font-medium transition-colors",
                  color
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <Textarea
            placeholder={PLACEHOLDER[activityType]}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="resize-none min-h-[140px] text-sm"
            required
          />

          <SheetFooter className="px-0 pb-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={addActivity.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!content.trim() || addActivity.isPending}>
              {addActivity.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Logging…</>
                : "Log Activity"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
