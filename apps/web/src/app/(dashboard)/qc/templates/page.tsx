"use client";

/**
 * Inspection Templates — reads /qc/templates via useApiInspectionTemplates.
 *
 * Templates are the authoring surface: admins define parameter sets per
 * (kind, product-family / item / product / wip-stage-template) binding.
 * Inspections auto-seed their findings from the template on Start.
 *
 * Minimal Phase 2 UI: list + basic create dialog (code, name, kind). Full
 * parameter authoring lives on the detail page (/qc/templates/:id) in a
 * later sprint.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
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
  useApiCreateInspectionTemplate,
  useApiInspectionTemplates,
} from "@/hooks/useQcApi";
import {
  QC_INSPECTION_KINDS,
  type InspectionTemplate,
  type QcInspectionKind,
} from "@mobilab/contracts";
import {
  AlertCircle,
  ClipboardList,
  FileCheck2,
  Loader2,
  Plus,
} from "lucide-react";

const KIND_TONE: Record<QcInspectionKind, string> = {
  IQC: "bg-sky-50 text-sky-700 border-sky-200",
  SUB_QC: "bg-violet-50 text-violet-700 border-violet-200",
  FINAL_QC: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function QcTemplatesPage() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<QcInspectionKind | "all">("all");

  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      kind: kind === "all" ? undefined : kind,
    }),
    [search, kind],
  );

  const templatesQuery = useApiInspectionTemplates(query);
  const createTemplate = useApiCreateInspectionTemplate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formKind, setFormKind] = useState<QcInspectionKind>("IQC");
  const [formDescription, setFormDescription] = useState("");
  const [formSamplingPlan, setFormSamplingPlan] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const resetForm = (): void => {
    setFormCode("");
    setFormName("");
    setFormKind("IQC");
    setFormDescription("");
    setFormSamplingPlan("");
    setSaveError(null);
  };

  const handleCreate = async (): Promise<void> => {
    setSaveError(null);
    try {
      await createTemplate.mutateAsync({
        code: formCode.trim(),
        name: formName.trim(),
        kind: formKind,
        description: formDescription.trim() || undefined,
        samplingPlan: formSamplingPlan.trim() || undefined,
        isActive: true,
        parameters: [],
      });
      setDialogOpen(false);
      resetForm();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "failed to create");
    }
  };

  if (templatesQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (templatesQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load templates
            </p>
            <p className="text-red-700 mt-1">
              {templatesQuery.error instanceof Error
                ? templatesQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const templates = templatesQuery.data?.data ?? [];
  const total = templatesQuery.data?.meta.total ?? templates.length;
  const active = templates.filter((t) => t.isActive).length;
  const byKind = {
    IQC: templates.filter((t) => t.kind === "IQC").length,
    SUB_QC: templates.filter((t) => t.kind === "SUB_QC").length,
    FINAL_QC: templates.filter((t) => t.kind === "FINAL_QC").length,
  };

  const columns: Column<InspectionTemplate>[] = [
    {
      key: "code",
      header: "Code",
      render: (t) => (
        <span className="font-mono text-xs font-semibold text-blue-700">
          {t.code}
        </span>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (t) => <span className="text-sm">{t.name}</span>,
    },
    {
      key: "kind",
      header: "Kind",
      render: (t) => (
        <Badge variant="outline" className={`text-xs ${KIND_TONE[t.kind]}`}>
          {t.kind.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "productFamily",
      header: "Family",
      render: (t) => (
        <span className="text-xs text-muted-foreground">
          {t.productFamily ? t.productFamily.replace(/_/g, " ") : "—"}
        </span>
      ),
    },
    {
      key: "samplingPlan",
      header: "Sampling",
      render: (t) => (
        <span className="text-xs text-muted-foreground">
          {t.samplingPlan ?? "—"}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Active",
      render: (t) =>
        t.isActive ? (
          <Badge
            variant="outline"
            className="text-xs bg-green-50 text-green-700 border-green-200"
          >
            Active
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-xs bg-gray-50 text-gray-600 border-gray-200"
          >
            Inactive
          </Badge>
        ),
    },
    {
      key: "version",
      header: "Ver",
      render: (t) => (
        <span className="font-mono text-xs tabular-nums">{t.version}</span>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Inspection Templates"
        description="Parameter sets that seed findings on inspection start"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Template
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Templates"
          value={String(total)}
          icon={ClipboardList}
          iconColor="text-blue-600"
          change={`${active} active`}
          trend="neutral"
        />
        <KPICard
          title="IQC"
          value={String(byKind.IQC)}
          icon={FileCheck2}
          iconColor="text-sky-600"
          change="Incoming quality"
          trend="neutral"
        />
        <KPICard
          title="Sub-QC (WIP)"
          value={String(byKind.SUB_QC)}
          icon={FileCheck2}
          iconColor="text-violet-600"
          change="Per-stage inspections"
          trend="neutral"
        />
        <KPICard
          title="Final QC"
          value={String(byKind.FINAL_QC)}
          icon={FileCheck2}
          iconColor="text-amber-600"
          change="Pre-ship inspections"
          trend="neutral"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <Label className="text-xs">Search</Label>
          <Input
            placeholder="Code or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Kind</Label>
          <Select
            value={kind}
            onValueChange={(v) =>
              setKind(v === "all" ? "all" : (v as QcInspectionKind))
            }
          >
            <SelectTrigger className="w-[140px]">
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
      </div>

      <DataTable data={templates} columns={columns} pageSize={25} />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Inspection Template</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Code *</Label>
                <Input
                  placeholder="IQC-XYZ-001"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">Kind *</Label>
                <Select
                  value={formKind}
                  onValueChange={(v) => setFormKind(v as QcInspectionKind)}
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
            </div>

            <div>
              <Label className="text-xs">Name *</Label>
              <Input
                placeholder="Incoming QC — Component XYZ"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div>
              <Label className="text-xs">Sampling plan</Label>
              <Input
                placeholder="e.g. AQL 1.0 / 100%-visual + 10%-functional"
                value={formSamplingPlan}
                onChange={(e) => setFormSamplingPlan(e.target.value)}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Parameters can be added after creation from the template detail
              page.
            </p>

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
              disabled={createTemplate.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                createTemplate.isPending ||
                !formCode.trim() ||
                !formName.trim()
              }
            >
              {createTemplate.isPending && (
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
