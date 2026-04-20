"use client";

import { useState, useEffect } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, ArrowRightLeft, AtSign, Cpu, Plus, Send } from "lucide-react";
import { Activity, getUserById } from "@/data/mock";
import { cn } from "@/lib/utils";

const typeConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  comment: { icon: MessageSquare, color: "text-blue-500", label: "Comment" },
  status_change: { icon: ArrowRightLeft, color: "text-amber-500", label: "Status Change" },
  mention: { icon: AtSign, color: "text-purple-500", label: "Mention" },
  system_log: { icon: Cpu, color: "text-gray-400", label: "System" },
  creation: { icon: Plus, color: "text-green-500", label: "Created" },
  update: { icon: ArrowRightLeft, color: "text-orange-500", label: "Updated" },
};

// Moved outside component — no closure deps, avoids recreation on every render
function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Moved outside component — no closure deps, avoids recreation on every render
function highlightMentions(text: string): React.ReactNode {
  const parts = text.split(/(@\w+\s\w+)/g);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="text-blue-600 font-medium bg-blue-50 px-1 rounded">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

interface ActivityFeedProps {
  activities: Activity[];
  entityType?: string;
  entityId?: string;
  compact?: boolean;
  maxHeight?: string;
}

export function ActivityFeed({ activities, compact = false, maxHeight = "500px" }: ActivityFeedProps) {
  const [comment, setComment] = useState("");
  const [localActivities, setLocalActivities] = useState(activities);

  // Sync local state when the activities prop changes
  useEffect(() => {
    setLocalActivities(activities);
  }, [activities]);

  function handleAddComment() {
    if (!comment.trim()) return;
    const newActivity: Activity = {
      id: `a-new-${Date.now()}`,
      entityType: "system",
      entityId: "",
      type: "comment",
      user: "u1",
      content: comment,
      timestamp: new Date().toISOString(),
    };
    setLocalActivities((prev) => [newActivity, ...prev]);
    setComment("");
  }

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <div className="flex gap-2">
          <Textarea
            placeholder="Write a comment... Use @name to mention someone"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="min-h-[60px] text-sm resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) handleAddComment();
            }}
          />
          <Button size="icon" onClick={handleAddComment} className="shrink-0 self-end">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
      <ScrollArea style={{ maxHeight }}>
        <div className="space-y-1">
          {localActivities.map((a) => {
            const cfg = typeConfig[a.type] ?? typeConfig.comment;
            const Icon = cfg.icon;
            const user = a.user === "system" ? null : getUserById(a.user);

            return (
              <div key={a.id} className={cn("flex gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors", compact && "p-1.5")}>
                <div className="shrink-0 mt-0.5">
                  {user ? (
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{user.avatar}</AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                      <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{user?.name ?? "System"}</span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-4", cfg.color)}>
                      <Icon className="h-2.5 w-2.5 mr-0.5" />
                      {cfg.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">{formatTimestamp(a.timestamp)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                    {highlightMentions(a.content)}
                  </p>
                </div>
              </div>
            );
          })}
          {localActivities.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No activity yet</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
