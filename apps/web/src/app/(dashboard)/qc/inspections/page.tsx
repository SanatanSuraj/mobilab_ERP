"use client";

/**
 * QC Inspections — reads /qc/inspections via useApiQcInspections.
 *
 * This is the canonical Phase 2 QC entrypoint (sibling to /qc/inward,
 * /qc/wip, /qc/final which remain mock prototypes). Shows the cross-kind
 * inspection board with lifecycle status filter + create dialog. Row click
 * routes to /qc/inspections/:id for the detail + findings view.
 *
 * Contract shape (from @mobilab/contracts):
 *   - kind: IQC | SUB_QC | FINAL_QC
 *   - status: DRAFT | IN_PROGRESS | PASSED | FAILED
 *   - sourceType: GRN_LINE | WIP_STAGE | WO  (polymorphic link)
 *   - Server auto-generates QC-YYYY-NNNN on create.
 *
 * Filters hit the real API (kind / status / verdict / search).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import {
  useApiCreateQcInspection,
  useApiQcInspections,
} from "@/hooks/useQcApi";
import { useApiInspectionTemplates } from "@/hooks/useQcApi";
import {
  QC_INSPECTION_KINDS,
  QC_INSPECTION_STATUSES,
  QC_SOURCE_TYPES,
  QC_VERDICTS,
  type QcInspection,
  type QcInspectionKind,
  type QcInspectionStatus,
  type QcSourceType,
  type QcVerdict,
} from "@mobilab/contracts";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  XCircle,
} from "lucide-react";

const STATUS_TONE: Record<QcInspectionStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  PASSED: "bg-green-50 text-green-700 border-green-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

const VERDICT_TONE: Record<QcVerdict, string> = {
  PASS: "bg-green-50 text-green-700 border-green-200",
  FAIL: "bg-red-50 text-red-700 border-red-200",
};

const KIND_TONE: Record<QcInspectionKind, string> = {
  IQC: "bg-sky-50 text-sky-700 border-sky-200",
  SUB_QC: "bg-violet-50 text-violet-700 border-violet-200",
  FINAL_QC: "bg-amber-50 text-amber-700 border-amber-200",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function QcInspectionsPage() {
  const router = useRouter();

  // ─── Filters ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<QcInspectionKind | "all">("all");
  const [status, setStatus] = useState<QcInspectionStatus | "all">("all");
  const [verdict, setVerdict] = useState<QcVerdict | "all">("all");

  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      kind: kind === "all" ? undefined : kind,
      status: status === "all" ? undefined : status,
      verdict: verdict === "all" ? undefined : verdict,
    }),
    [search, kind, status, verdict],
  );

  const inspectionsQuery = useApiQcInspections(query);
  const templatesQuery = useApiInspectionTemplates({
    limit: 200,
    isActive: true,
  });
  const createInspection = useApiCreateQcInspection();

  // ─── Create dialog state ────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formKind, setFormKind] = useState<QcInspectionKind>("FINAL_QC");
  const [formTemplateId, setFormTemplateId] = useState<string>("");
  const [formSourceType, setFormSourceType] = useState<QcSourceType>("WO");
  const [formSourceId, setFormSourceId] = useState("");
  const [formSourceLabel, setFormSourceLabel] = useState("");
  const [formWorkOrderId, setFormWorkOrderId] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const templates = templatesQuery.data?.data ?? [];
  const templatesForKind = useMemo(
    () => templates.filter((t) => t.kind === formKind),
    [templates, formKind],
  );

  // Loading / error shells
  if (inspectionsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (inspectionsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load inspections
            </p>
            <p className="text-red-700 mt-1">
              {inspectionsQuery.error instanceof Error
                ? inspectionsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const inspections = inspectionsQuery.data?.data ?? [];
  const total = inspectionsQuery.data?.meta.total ?? inspections.length;

  // KPIs — scoped to the current page window.
  const draftOrInProgress = inspections.filter(
    (i) => i.status === "DRAFT" || i.status === "IN_PROGRESS",
  ).length;
  const passed = inspections.filter((i) => i.status === "PASSED").length;
  const failed = inspections.filter((i) => i.status === "FAILED").length;
  const critical = inspections.filter(
    (i) => i.kind === "FINAL_QC" && i.status !== "PASSED",
  ).length;

  const resetForm = (): void => {
    setFormKind("FINAL_QC");
    setFormTemplateId("");
    setFormSourceType("WO");
    setFormSourceId("");
    setFormSourceLabel("");
    setFormWorkOrderId("");
    setFormNotes("");
    setSaveError(null);
  };

  const handleCreate = async (): Promise<void> => {
    setSaveError(null);
    if (!formSourceId.trim()) {
      setSaveError("source ID is required (UUID of grn_line, wip_stage, or WO)");
      return;
    }
    try {
      const created = await createInspection.mutateAsync({
        kind: formKind,
        templateId: formTemplateId || undefined,
        sourceType: formSourceType,
        sourceId: formSourceId.trim(),
        sourceLabel: formSourceLabel.trim() || undefined,
        workOrderId:
          formSourceType === "WO"
            ? formSourceId.trim()
            : formWorkOrderId.trim() || undefined,
        grnLineId: formSourceType === "GRN_LINE" ? formSourceId.trim() : undefined,
        wipStageId:
          formSourceType === "WIP_STAGE" ? formSourceId.trim() : undefined,
        notes: formNotes.trim() || undefined,
      });
      setDialogOpen(false);
      resetForm();
      router.push(`/qc/inspections/${created.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "failed to create");
    }
  };

  const columns: Column<QcInspection>[] = [
    {
      key: "inspectionNumber",
      header: "Inspection #",
      render: (i) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {i.inspectionNumber}
        </span>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      render: (i) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${KIND_TONE[i.kind]}`}
        >
          {i.kind.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "templateName",
      header: "Template",
      render: (i) => (
        <div className="space-y-0.5">
          <div className="text-sm">{i.templateName ?? "—"}</div>
          {i.templateCode && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {i.templateCode}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "sourceLabel",
      header: "Source",
      render: (i) => (
        <div className="space-y-0.5">
          <Badge
            variant="outline"
            className="text-[10px] text-muted-foreground whitespace-nowrap"
          >
            {i.sourceType.replace(/_/g, " ")}
          </Badge>
          {i.sourceLabel && (
            <div className="text-xs text-muted-foreground">{i.sourceLabel}</div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (i) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[i.status]}`}
        >
          {i.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "verdict",
      header: "Verdict",
      render: (i) =>
        i.verdict ? (
          <Badge
            variant="outline"
            className={`text-xs whitespace-nowrap ${VERDICT_TONE[i.verdict]}`}
          >
            {i.verdict}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "startedAt",
      header: "Started",
      render: (i) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(i.startedAt)}
        </span>
      ),
    },
    {
      key: "completedAt",
      header: "Completed",
      render: (i) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(i.completedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="QC Inspections"
        description="Cross-kind inspection board — IQC, Sub-QC (WIP), and Final QC"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Inspection
          </Button>
        }
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Open"
          value={String(draftOrInProgress)}
          icon={ClipboardList}
          iconColor="text-blue-600"
          change="Draft + In Progress"
          trend="neutral"
        />
        <KPICard
          title="Passed"
          value={String(passed)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change="In current page"
          trend="up"
        />
        <KPICard
          title="Failed"
          value={String(failed)}
          icon={XCircle}
          iconColor="text-red-600"
          change={failed > 0 ? "Requires NCR" : "All clear"}
          trend={failed > 0 ? "down" : "up"}
        />
        <KPICard
          title="Final QC Not-Passed"
          value={String(critical)}
          icon={AlertCircle}
          iconColor="text-amber-600"
          change="Cannot ship"
          trend={critical > 0 ? "down" : "up"}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <Label htmlFor="search" className="text-xs">
            Search
          </Label>
          <Input
            id="search"
            placeholder="Inspection #, template, source..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="kind-filter" className="text-xs">
            Kind
          </Label>
          <Select
            value={kind}
            onValueChange={(v) =>
              setKind(v === "all" ? "all" : (v as QcInspectionKind))
            }
          >
            <SelectTrigger id="kind-filter" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {QC_INSPECTION_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="status-filter" className="text-xs">
            Status
          </Label>
          <Select
            value={status}
            onValueChange={(v) =>
              setStatus(v === "all" ? "all" : (v as QcInspectionStatus))
            }
          >
            <SelectTrigger id="status-filter" className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {QC_INSPECTION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="verdict-filter" className="text-xs">
            Verdict
          </Label>
          <Select
            value={verdict}
            onValueChange={(v) =>
              setVerdict(v === "all" ? "all" : (v as QcVerdict))
            }
          >
            <SelectTrigger id="verdict-filter" className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {QC_VERDICTS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {total} total
        </div>
      </div>

      {/* Table */}
      <DataTable
        data={inspections}
        columns={columns}
        onRowClick={(i) => router.push(`/qc/inspections/${i.id}`)}
        pageSize={25}
      />

      {/* Create Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New QC Inspection</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Kind</Label>
                <Select
                  value={formKind}
                  onValueChange={(v) => {
                    setFormKind(v as QcInspectionKind);
                    setFormTemplateId("");
                    if (v === "IQC") setFormSourceType("GRN_LINE");
                    else if (v === "SUB_QC") setFormSourceType("WIP_STAGE");
                    else setFormSourceType("WO");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QC_INSPECTION_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Source Type</Label>
                <Select
                  value={formSourceType}
                  onValueChange={(v) => setFormSourceType(v as QcSourceType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QC_SOURCE_TYPES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Template (optional)</Label>
              <Select
                value={formTemplateId || "none"}
                onValueChange={(v) =>
                  setFormTemplateId(!v || v === "none" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— no template —</SelectItem>
                  {templatesForKind.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.code} — {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Findings will be seeded from this template on Start.
              </p>
            </div>

            <div>
              <Label className="text-xs">
                Source ID — UUID of{" "}
                {formSourceType === "GRN_LINE"
                  ? "grn_line"
                  : formSourceType === "WIP_STAGE"
                    ? "wip_stage"
                    : "work_order"}
              </Label>
              <Input
                placeholder="00000000-0000-0000-0000-000000000000"
                value={formSourceId}
                onChange={(e) => setFormSourceId(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            {formSourceType !== "WO" && (
              <div>
                <Label className="text-xs">
                  Work Order ID (optional — for context on Sub/IQC)
                </Label>
                <Input
                  placeholder="00000000-0000-0000-0000-000000000000"
                  value={formWorkOrderId}
                  onChange={(e) => setFormWorkOrderId(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            )}

            <div>
              <Label className="text-xs">Source Label (optional)</Label>
              <Input
                placeholder="e.g. WO-2026-0001 • Stage 2"
                value={formSourceLabel}
                onChange={(e) => setFormSourceLabel(e.target.value)}
              />
            </div>

            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea
                placeholder="Optional inspection notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={3}
              />
            </div>

            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {saveError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createInspection.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createInspection.isPending || !formSourceId.trim()}
            >
              {createInspection.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
