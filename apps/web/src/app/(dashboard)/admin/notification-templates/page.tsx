"use client";

/**
 * Admin — notification templates library. CRUD over the
 * `notification_templates` header (event_type + channel + body etc.)
 * plus a local preview that interpolates `{{var}}` placeholders
 * against a sample variables map. Preview is client-side only — the
 * server doesn't render here, so what's shown is a faithful
 * approximation of the dispatcher's substitution step (matching the
 * `{{name}}` regex used by NotificationDispatcher).
 *
 * Concurrency: PATCH passes `expectedVersion`. On a 409 we surface a
 * refresh prompt; the caller has to reload before retrying.
 */

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiCreateNotificationTemplate,
  useApiDeleteNotificationTemplate,
  useApiNotificationTemplates,
  useApiUpdateNotificationTemplate,
} from "@/hooks/useNotificationsApi";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SEVERITIES,
  type CreateNotificationTemplate,
  type NotificationChannel,
  type NotificationSeverity,
  type NotificationTemplate,
  type UpdateNotificationTemplate,
} from "@instigenie/contracts";
import {
  AlertCircle,
  Eye,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

const CHANNEL_TONE: Record<NotificationChannel, string> = {
  IN_APP: "bg-blue-50 text-blue-700 border-blue-200",
  EMAIL: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WHATSAPP: "bg-violet-50 text-violet-700 border-violet-200",
};

const SEVERITY_TONE: Record<NotificationSeverity, string> = {
  INFO: "bg-blue-50 text-blue-700 border-blue-200",
  SUCCESS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WARNING: "bg-amber-50 text-amber-700 border-amber-200",
  ERROR: "bg-red-50 text-red-700 border-red-200",
  CRITICAL: "bg-red-100 text-red-800 border-red-300",
};

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined ? `{{${key}}}` : v;
  });
}

function extractVariableKeys(template: string): string[] {
  const keys = new Set<string>();
  const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    keys.add(m[1]);
  }
  return Array.from(keys);
}

export default function NotificationTemplatesPage() {
  const [channel, setChannel] = useState<NotificationChannel | "all">("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">(
    "all",
  );
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [previewing, setPreviewing] = useState<NotificationTemplate | null>(null);
  const [deleting, setDeleting] = useState<NotificationTemplate | null>(null);

  const query = useMemo(
    () => ({
      limit: 100,
      sortBy: "createdAt",
      sortDir: "desc" as const,
      channel: channel === "all" ? undefined : channel,
      isActive:
        activeFilter === "all"
          ? undefined
          : activeFilter === "active"
            ? true
            : false,
      search: search.trim() || undefined,
    }),
    [channel, activeFilter, search],
  );

  const templatesQuery = useApiNotificationTemplates(query);

  const columns: Column<NotificationTemplate>[] = [
    {
      key: "name",
      header: "Name",
      render: (t) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{t.name}</p>
          {t.description ? (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {t.description}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "eventType",
      header: "Event",
      render: (t) => (
        <span className="font-mono text-xs">{t.eventType}</span>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      render: (t) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${CHANNEL_TONE[t.channel]}`}
        >
          {t.channel}
        </Badge>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (t) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${SEVERITY_TONE[t.defaultSeverity]}`}
        >
          {t.defaultSeverity}
        </Badge>
      ),
    },
    {
      key: "isActive",
      header: "Active",
      render: (t) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${
            t.isActive
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-gray-50 text-gray-600 border-gray-200"
          }`}
        >
          {t.isActive ? "ACTIVE" : "INACTIVE"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPreviewing(t)}
            title="Preview"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setEditing(t)}
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDeleting(t)}
            title="Delete"
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Notification Templates"
          description="Library of event-based templates rendered by the dispatcher"
        />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New template
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Channel</Label>
          <Select
            value={channel}
            onValueChange={(v) =>
              setChannel(!v ? "all" : (v as NotificationChannel | "all"))
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {NOTIFICATION_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={activeFilter}
            onValueChange={(v) =>
              setActiveFilter(
                !v ? "all" : (v as "all" | "active" | "inactive"),
              )
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 flex-1 min-w-[220px] max-w-[320px]">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or event…"
              className="pl-8"
            />
          </div>
        </div>
      </div>

      {templatesQuery.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : templatesQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load templates</p>
            <p className="text-red-700 mt-1">
              {templatesQuery.error instanceof Error
                ? templatesQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      ) : (
        <>
          <DataTable<NotificationTemplate>
            data={templatesQuery.data?.data ?? []}
            columns={columns}
            pageSize={25}
          />
          <p className="text-xs text-muted-foreground">
            Showing {(templatesQuery.data?.data.length ?? 0).toLocaleString()} of{" "}
            {(templatesQuery.data?.meta.total ?? 0).toLocaleString()} template
            {templatesQuery.data?.meta.total === 1 ? "" : "s"}.
          </p>
        </>
      )}

      {createOpen ? (
        <CreateTemplateDialog onClose={() => setCreateOpen(false)} />
      ) : null}

      {editing ? (
        <EditTemplateDialog
          template={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {previewing ? (
        <PreviewTemplateDialog
          template={previewing}
          onClose={() => setPreviewing(null)}
        />
      ) : null}

      {deleting ? (
        <DeleteTemplateDialog
          template={deleting}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

// ─── Create ────────────────────────────────────────────────────────────────

function CreateTemplateDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState("");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<NotificationChannel>("IN_APP");
  const [severity, setSeverity] = useState<NotificationSeverity>("INFO");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isActive, setIsActive] = useState(true);

  const createMutation = useApiCreateNotificationTemplate();

  const isValid =
    name.trim().length > 0 &&
    eventType.trim().length > 0 &&
    body.trim().length > 0;

  async function onSubmit() {
    if (!isValid) return;
    const payload: CreateNotificationTemplate = {
      name: name.trim(),
      eventType: eventType.trim(),
      channel,
      defaultSeverity: severity,
      bodyTemplate: body.trim(),
      isActive,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(subject.trim() ? { subjectTemplate: subject.trim() } : {}),
    };
    try {
      await createMutation.mutateAsync(payload);
      toast.success("Template created");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create template");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New notification template</DialogTitle>
          <DialogDescription>
            Use {"{{variable}}"} placeholders — the dispatcher will substitute
            them at send time.
          </DialogDescription>
        </DialogHeader>

        <TemplateFormFields
          name={name}
          setName={setName}
          eventType={eventType}
          setEventType={setEventType}
          description={description}
          setDescription={setDescription}
          channel={channel}
          setChannel={setChannel}
          severity={severity}
          setSeverity={setSeverity}
          subject={subject}
          setSubject={setSubject}
          body={body}
          setBody={setBody}
          isActive={isActive}
          setIsActive={setIsActive}
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!isValid || createMutation.isPending}>
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit ──────────────────────────────────────────────────────────────────

function EditTemplateDialog({
  template,
  onClose,
}: {
  template: NotificationTemplate;
  onClose: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [eventType, setEventType] = useState(template.eventType);
  const [description, setDescription] = useState(template.description ?? "");
  const [channel, setChannel] = useState<NotificationChannel>(template.channel);
  const [severity, setSeverity] = useState<NotificationSeverity>(
    template.defaultSeverity,
  );
  const [subject, setSubject] = useState(template.subjectTemplate ?? "");
  const [body, setBody] = useState(template.bodyTemplate);
  const [isActive, setIsActive] = useState(template.isActive);

  const updateMutation = useApiUpdateNotificationTemplate(template.id);

  const isValid =
    name.trim().length > 0 &&
    eventType.trim().length > 0 &&
    body.trim().length > 0;

  async function onSubmit() {
    if (!isValid) return;
    const payload: UpdateNotificationTemplate = {
      name: name.trim(),
      eventType: eventType.trim(),
      channel,
      defaultSeverity: severity,
      bodyTemplate: body.trim(),
      isActive,
      description: description.trim() ? description.trim() : undefined,
      subjectTemplate: subject.trim() ? subject.trim() : undefined,
      expectedVersion: template.version,
    };
    try {
      await updateMutation.mutateAsync(payload);
      toast.success("Template updated");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update template";
      if (msg.includes("409") || msg.toLowerCase().includes("version")) {
        toast.error(
          "Template was edited elsewhere — refresh and try again.",
        );
      } else {
        toast.error(msg);
      }
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit template</DialogTitle>
          <DialogDescription>
            Version {template.version} — concurrent edits will be rejected.
          </DialogDescription>
        </DialogHeader>

        <TemplateFormFields
          name={name}
          setName={setName}
          eventType={eventType}
          setEventType={setEventType}
          description={description}
          setDescription={setDescription}
          channel={channel}
          setChannel={setChannel}
          severity={severity}
          setSeverity={setSeverity}
          subject={subject}
          setSubject={setSubject}
          body={body}
          setBody={setBody}
          isActive={isActive}
          setIsActive={setIsActive}
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={updateMutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!isValid || updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared form fields ────────────────────────────────────────────────────

interface TemplateFormFieldsProps {
  name: string;
  setName: (v: string) => void;
  eventType: string;
  setEventType: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  channel: NotificationChannel;
  setChannel: (v: NotificationChannel) => void;
  severity: NotificationSeverity;
  setSeverity: (v: NotificationSeverity) => void;
  subject: string;
  setSubject: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  isActive: boolean;
  setIsActive: (v: boolean) => void;
}

function TemplateFormFields(props: TemplateFormFieldsProps) {
  const {
    name,
    setName,
    eventType,
    setEventType,
    description,
    setDescription,
    channel,
    setChannel,
    severity,
    setSeverity,
    subject,
    setSubject,
    body,
    setBody,
    isActive,
    setIsActive,
  } = props;

  const variableKeys = useMemo(
    () => extractVariableKeys(`${subject}\n${body}`),
    [subject, body],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">
            Name <span className="text-red-600">*</span>
          </Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Invoice posted (in-app)"
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Event type <span className="text-red-600">*</span>
          </Label>
          <Input
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder="finance.invoice.posted"
            maxLength={100}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional — what this template is for"
          maxLength={1000}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Channel</Label>
          <Select
            value={channel}
            onValueChange={(v) => v && setChannel(v as NotificationChannel)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTIFICATION_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Default severity</Label>
          <Select
            value={severity}
            onValueChange={(v) => v && setSeverity(v as NotificationSeverity)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTIFICATION_SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Active</Label>
          <div className="flex items-center gap-2 h-9">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <span className="text-xs text-muted-foreground">
              {isActive ? "Live" : "Disabled"}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Subject template</Label>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Invoice {{invoiceNumber}} posted"
          maxLength={200}
        />
        <p className="text-[11px] text-muted-foreground">
          Optional — IN_APP rows display this as the title.
        </p>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Body template <span className="text-red-600">*</span>
        </Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"Hi {{customerName}}, your invoice {{invoiceNumber}} for ₹{{amount}} is now due."}
          rows={5}
          maxLength={4000}
        />
        <p className="text-[11px] text-muted-foreground">
          {body.length} / 4000
          {variableKeys.length > 0 ? (
            <>
              {" — variables: "}
              <span className="font-mono">
                {variableKeys.map((k) => `{{${k}}}`).join(" ")}
              </span>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

// ─── Preview ───────────────────────────────────────────────────────────────

function PreviewTemplateDialog({
  template,
  onClose,
}: {
  template: NotificationTemplate;
  onClose: () => void;
}) {
  const variableKeys = useMemo(
    () =>
      extractVariableKeys(
        `${template.subjectTemplate ?? ""}\n${template.bodyTemplate}`,
      ),
    [template],
  );

  const [vars, setVars] = useState<Record<string, string>>(() =>
    Object.fromEntries(variableKeys.map((k) => [k, ""])),
  );

  const renderedSubject = template.subjectTemplate
    ? interpolate(template.subjectTemplate, vars)
    : null;
  const renderedBody = interpolate(template.bodyTemplate, vars);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preview: {template.name}</DialogTitle>
          <DialogDescription>
            Fill in sample values to see how this template will render.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {variableKeys.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Sample variables
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {variableKeys.map((k) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-[11px] font-mono">{k}</Label>
                    <Input
                      value={vars[k] ?? ""}
                      onChange={(e) =>
                        setVars((s) => ({ ...s, [k]: e.target.value }))
                      }
                      placeholder={`Value for {{${k}}}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              This template has no variables — preview shows the raw body.
            </p>
          )}

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Rendered output</Label>
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              {renderedSubject ? (
                <p className="text-sm font-medium">{renderedSubject}</p>
              ) : null}
              <p className="text-sm whitespace-pre-wrap">{renderedBody}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className={`text-[10px] ${CHANNEL_TONE[template.channel]}`}
              >
                {template.channel}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] ${SEVERITY_TONE[template.defaultSeverity]}`}
              >
                {template.defaultSeverity}
              </Badge>
              <span className="font-mono">{template.eventType}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete ────────────────────────────────────────────────────────────────

function DeleteTemplateDialog({
  template,
  onClose,
}: {
  template: NotificationTemplate;
  onClose: () => void;
}) {
  const deleteMutation = useApiDeleteNotificationTemplate();

  async function onConfirm() {
    try {
      await deleteMutation.mutateAsync(template.id);
      toast.success("Template deleted");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete template");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete template?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{template.name}</span>{" "}
            ({template.channel}) will be soft-deleted. The dispatcher won&apos;t
            pick it up for new events; existing notifications referencing it are
            unaffected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={deleteMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
