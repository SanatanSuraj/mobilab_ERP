"use client";

/**
 * Notifications inbox — reads /notifications via useApiNotifications.
 *
 * ARCHITECTURE.md §13.7. The inbox is user-scoped; this is the global
 * browsable feed with filters (severity, read-state, event, free-text,
 * date range), bulk mark-as-read, single-row delete, and a header of
 * KPI cards sourced from /notifications/unread-count.
 *
 * Dispatch (creating a notification) is Phase 3 territory — in Phase 2
 * the event bus isn't wired yet, so the UI here is read + hygiene only.
 * Admins with `notifications:dispatch` can still POST manually via the
 * API; a dispatch surface will land once Phase 3 closes the loop.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  useApiDeleteNotification,
  useApiMarkAllNotificationsRead,
  useApiMarkNotificationsRead,
  useApiNotifications,
  useApiUnreadCount,
} from "@/hooks/useNotificationsApi";
import {
  NOTIFICATION_SEVERITIES,
  type Notification,
  type NotificationSeverity,
} from "@instigenie/contracts";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  Flame,
  Info,
  Loader2,
  Mail,
  MailOpen,
  Trash2,
  XCircle,
} from "lucide-react";

// ─── Display helpers ─────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const SEVERITY_TONE: Record<NotificationSeverity, string> = {
  INFO: "bg-blue-50 text-blue-700 border-blue-200",
  SUCCESS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WARNING: "bg-amber-50 text-amber-700 border-amber-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
  CRITICAL: "bg-red-100 text-red-800 border-red-300",
};

const SEVERITY_ICON: Record<
  NotificationSeverity,
  React.ComponentType<{ className?: string }>
> = {
  INFO: Info,
  SUCCESS: CheckCircle2,
  WARNING: AlertTriangle,
  ERROR: XCircle,
  CRITICAL: Flame,
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [severity, setSeverity] = useState<NotificationSeverity | "all">("all");
  const [readState, setReadState] = useState<"all" | "unread" | "read">("all");
  const [eventType, setEventType] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useMemo(
    () => ({
      limit: 100,
      sortBy: "createdAt",
      sortDir: "desc" as const,
      severity: severity === "all" ? undefined : severity,
      isRead:
        readState === "all" ? undefined : readState === "read" ? true : false,
      eventType: eventType.trim() || undefined,
      search: search.trim() || undefined,
    }),
    [severity, readState, eventType, search],
  );

  const notificationsQuery = useApiNotifications(query);
  const unreadQuery = useApiUnreadCount();

  const markRead = useApiMarkNotificationsRead();
  const markAllRead = useApiMarkAllNotificationsRead();
  const deleteOne = useApiDeleteNotification();

  const handleToggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMarkSelectedRead = async (): Promise<void> => {
    if (selected.size === 0) return;
    try {
      await markRead.mutateAsync(Array.from(selected));
      setSelected(new Set());
    } catch {
      // Error surfaces via mutation state; no-op here.
    }
  };

  const handleMarkAllRead = async (): Promise<void> => {
    try {
      await markAllRead.mutateAsync();
      setSelected(new Set());
    } catch {
      // no-op
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await deleteOne.mutateAsync(id);
      setSelected((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      // no-op
    }
  };

  // ─── Loading / error shells ─────────────────────────────────────────────
  if (notificationsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notificationsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load notifications
            </p>
            <p className="text-red-700 mt-1">
              {notificationsQuery.error instanceof Error
                ? notificationsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const notifications = notificationsQuery.data?.data ?? [];
  const total = notificationsQuery.data?.meta.total ?? notifications.length;

  const unread = unreadQuery.data;
  const unreadTotal = unread?.total ?? 0;
  const criticalCount = unread?.bySeverity.CRITICAL ?? 0;
  const errorCount = unread?.bySeverity.ERROR ?? 0;
  const warningCount = unread?.bySeverity.WARNING ?? 0;

  const visibleIds = notifications.map((n) => n.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  const toggleSelectAllVisible = (): void => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  };

  const columns: Column<Notification>[] = [
    {
      key: "select",
      header: "",
      className: "w-[40px]",
      render: (n) => (
        <Checkbox
          checked={selected.has(n.id)}
          onCheckedChange={() => handleToggleSelect(n.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select notification"
        />
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (n) => {
        const Icon = SEVERITY_ICON[n.severity];
        return (
          <Badge
            variant="outline"
            className={`text-xs whitespace-nowrap inline-flex items-center gap-1 ${SEVERITY_TONE[n.severity]}`}
          >
            <Icon className="h-3 w-3" />
            {n.severity}
          </Badge>
        );
      },
    },
    {
      key: "title",
      header: "Notification",
      render: (n) => (
        <div className="flex items-start gap-2 min-w-0">
          {n.isRead ? (
            <MailOpen className="h-3.5 w-3.5 text-muted-foreground mt-1 shrink-0" />
          ) : (
            <Mail className="h-3.5 w-3.5 text-blue-600 mt-1 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm truncate ${n.isRead ? "text-muted-foreground" : "font-semibold"}`}
            >
              {n.title}
            </p>
            <p className="text-xs text-muted-foreground truncate">{n.body}</p>
          </div>
        </div>
      ),
    },
    {
      key: "eventType",
      header: "Event",
      render: (n) => (
        <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {n.eventType}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      sortable: true,
      render: (n) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatRelative(n.createdAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (n) => (
        <div
          className="flex justify-end items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {n.linkUrl && (
            <Link
              href={n.linkUrl}
              className="inline-flex items-center justify-center h-8 px-2 rounded-md text-blue-700 hover:text-blue-800 hover:bg-blue-50 text-sm"
              title="Open linked resource"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="sr-only">Open link</span>
            </Link>
          )}
          {!n.isRead && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => markRead.mutate([n.id])}
              disabled={markRead.isPending}
              title="Mark as read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span className="sr-only">Mark as read</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={() => handleDelete(n.id)}
            disabled={deleteOne.isPending}
            title="Dismiss"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="sr-only">Dismiss</span>
          </Button>
        </div>
      ),
    },
  ];

  const pageUnreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Notifications"
        description="Inbox feed for alerts, approvals, and system events"
        actions={
          <Button
            variant="outline"
            onClick={handleMarkAllRead}
            disabled={markAllRead.isPending || unreadTotal === 0}
          >
            {markAllRead.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Marking…
              </>
            ) : (
              <>
                <CheckCheck className="h-4 w-4 mr-2" /> Mark all as read
              </>
            )}
          </Button>
        }
      />

      {/* KPIs — sourced from /notifications/unread-count (global aggregate) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Unread"
          value={unreadTotal.toLocaleString()}
          icon={unreadTotal > 0 ? BellRing : Bell}
          iconColor={unreadTotal > 0 ? "text-blue-600" : "text-gray-500"}
          change={unreadTotal > 0 ? "Needs attention" : "All caught up"}
          trend={unreadTotal > 0 ? "up" : "neutral"}
        />
        <KPICard
          title="Critical"
          value={criticalCount.toLocaleString()}
          icon={Flame}
          iconColor={criticalCount > 0 ? "text-red-600" : "text-gray-500"}
          change={criticalCount > 0 ? "Immediate action" : "Clear"}
          trend={criticalCount > 0 ? "down" : "neutral"}
        />
        <KPICard
          title="Errors"
          value={errorCount.toLocaleString()}
          icon={XCircle}
          iconColor={errorCount > 0 ? "text-red-600" : "text-gray-500"}
          change={errorCount > 0 ? "Investigate" : "Clear"}
          trend={errorCount > 0 ? "down" : "neutral"}
        />
        <KPICard
          title="Warnings"
          value={warningCount.toLocaleString()}
          icon={AlertTriangle}
          iconColor={warningCount > 0 ? "text-amber-600" : "text-gray-500"}
          change={warningCount > 0 ? "Review soon" : "Clear"}
          trend={warningCount > 0 ? "down" : "neutral"}
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Read state</Label>
          <Select
            value={readState}
            onValueChange={(v) =>
              setReadState(
                !v ? "all" : (v as "all" | "unread" | "read"),
              )
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="read">Read</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Severity</Label>
          <Select
            value={severity}
            onValueChange={(v) =>
              setSeverity(
                !v ? "all" : (v as NotificationSeverity | "all"),
              )
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {NOTIFICATION_SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Event type</Label>
          <Input
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder="e.g. work_order.created"
            className="w-[220px] font-mono text-xs"
          />
        </div>
        <div className="space-y-1 flex-1 min-w-[240px]">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title, body, or event…"
          />
        </div>
      </div>

      {/* Bulk action bar — shows selected count + select-all-visible toggle */}
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={allVisibleSelected}
            indeterminate={!allVisibleSelected && someVisibleSelected}
            onCheckedChange={toggleSelectAllVisible}
            aria-label="Select all visible notifications"
          />
          <span className="text-sm text-muted-foreground">
            {selected.size === 0 ? (
              "Select rows to mark as read in bulk"
            ) : (
              <>
                <span className="font-semibold text-foreground">
                  {selected.size.toLocaleString()}
                </span>{" "}
                selected
              </>
            )}
          </span>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={markRead.isPending}
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handleMarkSelectedRead}
              disabled={markRead.isPending}
            >
              {markRead.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Marking…
                </>
              ) : (
                <>
                  <CheckCheck className="h-4 w-4 mr-2" /> Mark as read
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      <DataTable<Notification>
        data={notifications}
        columns={columns}
        searchKey="title"
        searchPlaceholder="Filter visible rows…"
      />

      <p className="text-xs text-muted-foreground">
        Showing {notifications.length.toLocaleString()} of{" "}
        {total.toLocaleString()} notification{total === 1 ? "" : "s"} (
        {pageUnreadCount.toLocaleString()} unread on this page). Dispatch and
        real-time delivery arrive in Phase 3.
      </p>
    </div>
  );
}
