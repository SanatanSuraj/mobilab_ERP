"use client";

/**
 * Engineering Change Notices (ECN).
 *
 * The page is one screen for the whole register: list + filters + KPI rail
 * up top, "Raise ECN" dialog for new requests, and a row-click "Manage"
 * dialog that holds both the editable body fields and the workflow
 * transition controls. The detail dialog adapts to the current status — a
 * DRAFT shows "Submit for review" and "Cancel" buttons, an APPROVED shows
 * "Mark Implemented" / "Cancel", and so on. The allowed-transitions map
 * mirrors the server adjacency table.
 */

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useApiCreateEcn,
  useApiEcns,
  useApiProducts,
  useApiTransitionEcn,
  useApiUpdateEcn,
} from "@/hooks/useProductionApi";
import type {
  CreateEcn,
  EcnChangeType,
  EcnSeverity,
  EcnStatus,
  EngineeringChangeNotice,
  UpdateEcn,
} from "@instigenie/contracts";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileEdit,
  Plus,
} from "lucide-react";

const STATUSES: EcnStatus[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "IMPLEMENTED",
  "CANCELLED",
];

const SEVERITIES: EcnSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const CHANGE_TYPES: EcnChangeType[] = [
  "DESIGN",
  "MATERIAL",
  "PROCESS",
  "DOCUMENTATION",
  "OTHER",
];

const DEFAULT_LIMIT = 25;

// Adjacency table — keep in lockstep with apps/api/.../ecns.service.ts.
const ALLOWED_TRANSITIONS: Record<EcnStatus, EcnStatus[]> = {
  DRAFT: ["PENDING_REVIEW", "CANCELLED"],
  PENDING_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["IMPLEMENTED", "CANCELLED"],
  REJECTED: [],
  IMPLEMENTED: [],
  CANCELLED: [],
};

const TERMINAL_STATUSES: EcnStatus[] = [
  "REJECTED",
  "IMPLEMENTED",
  "CANCELLED",
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

interface CreateForm {
  title: string;
  description: string;
  changeType: EcnChangeType;
  severity: EcnSeverity;
  affectedProductId: string;
  reason: string;
  proposedChange: string;
  impactSummary: string;
  raisedBy: string;
  targetImplementationDate: string;
}

const EMPTY_CREATE_FORM: CreateForm = {
  title: "",
  description: "",
  changeType: "DESIGN",
  severity: "MEDIUM",
  affectedProductId: "",
  reason: "",
  proposedChange: "",
  impactSummary: "",
  raisedBy: "",
  targetImplementationDate: "",
};

export default function EcnPage() {
  const [statusFilter, setStatusFilter] = useState<"ALL" | EcnStatus>("ALL");
  const [severityFilter, setSeverityFilter] = useState<"ALL" | EcnSeverity>(
    "ALL",
  );
  const [changeTypeFilter, setChangeTypeFilter] = useState<
    "ALL" | EcnChangeType
  >("ALL");

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, severityFilter, changeTypeFilter, debouncedSearch]);

  const query = useApiEcns({
    page,
    limit: DEFAULT_LIMIT,
    sortBy: "createdAt",
    sortDir: "desc",
    status: statusFilter === "ALL" ? undefined : statusFilter,
    severity: severityFilter === "ALL" ? undefined : severityFilter,
    changeType: changeTypeFilter === "ALL" ? undefined : changeTypeFilter,
    search: debouncedSearch || undefined,
  });

  const data = query.data;
  const rows: EngineeringChangeNotice[] = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  // Products feed the affected-product picker. Only fetched once when the
  // create dialog opens so we don't pay for a /production/products list on
  // every ECN page load.
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const productsQuery = useApiProducts({ limit: 200 });
  const products = productsQuery.data?.data ?? [];

  const createMutation = useApiCreateEcn();

  const [selected, setSelected] = useState<EngineeringChangeNotice | null>(
    null,
  );
  const [editForm, setEditForm] = useState<UpdateEcn>({});
  const [manageError, setManageError] = useState<string | null>(null);
  const updateMutation = useApiUpdateEcn(selected?.id ?? "");
  const transitionMutation = useApiTransitionEcn(selected?.id ?? "");

  // Sync editForm whenever a different row is selected so the inputs stay
  // in step with the picked ECN.
  useEffect(() => {
    if (!selected) {
      setEditForm({});
      setManageError(null);
      return;
    }
    setEditForm({
      title: selected.title,
      description: selected.description ?? undefined,
      changeType: selected.changeType,
      severity: selected.severity,
      affectedProductId: selected.affectedProductId ?? undefined,
      reason: selected.reason ?? undefined,
      proposedChange: selected.proposedChange ?? undefined,
      impactSummary: selected.impactSummary ?? undefined,
      raisedBy: selected.raisedBy ?? undefined,
      targetImplementationDate:
        selected.targetImplementationDate ?? undefined,
    });
    setManageError(null);
  }, [selected]);

  const kpis = useMemo(() => {
    const open = rows.filter(
      (r) => r.status === "DRAFT" || r.status === "PENDING_REVIEW",
    ).length;
    const greenlit = rows.filter(
      (r) => r.status === "APPROVED" || r.status === "IMPLEMENTED",
    ).length;
    const criticalOpen = rows.filter(
      (r) =>
        (r.severity === "CRITICAL" || r.severity === "HIGH") &&
        r.status !== "IMPLEMENTED" &&
        r.status !== "CANCELLED" &&
        r.status !== "REJECTED",
    ).length;
    return { total: rows.length, open, greenlit, criticalOpen };
  }, [rows]);

  const columns: Column<EngineeringChangeNotice>[] = [
    {
      key: "ecnNumber",
      header: "ECN #",
      render: (r) => (
        <span className="font-mono font-bold text-xs text-blue-600">
          {r.ecnNumber}
        </span>
      ),
    },
    {
      key: "title",
      header: "Title",
      render: (r) => (
        <div className="space-y-0.5 max-w-[360px]">
          <div className="text-sm font-medium line-clamp-1">{r.title}</div>
          {r.description && (
            <div className="text-xs text-muted-foreground line-clamp-1">
              {r.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "changeType",
      header: "Type",
      render: (r) => (
        <Badge variant="outline" className="text-[10px]">
          {r.changeType}
        </Badge>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (r) => <StatusBadge status={r.severity} />,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "affectedProduct",
      header: "Affected",
      render: (r) =>
        r.affectedProductCode ? (
          <div className="space-y-0.5 max-w-[200px]">
            <div className="text-xs font-mono font-semibold text-muted-foreground">
              {r.affectedProductCode}
            </div>
            {r.affectedBomVersionLabel && (
              <Badge
                variant="outline"
                className="font-mono text-[10px] text-muted-foreground"
              >
                BOM {r.affectedBomVersionLabel}
              </Badge>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "raisedBy",
      header: "Raised By",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.raisedBy ?? "—"}
        </span>
      ),
    },
    {
      key: "targetImplementationDate",
      header: "Target",
      render: (r) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {fmtDate(r.targetImplementationDate)}
        </span>
      ),
    },
  ];

  async function submitCreate(): Promise<void> {
    setCreateError(null);
    if (!createForm.title.trim()) {
      setCreateError("Title is required.");
      return;
    }
    const body: CreateEcn = {
      title: createForm.title.trim(),
      description: createForm.description.trim() || undefined,
      changeType: createForm.changeType,
      severity: createForm.severity,
      affectedProductId: createForm.affectedProductId || undefined,
      reason: createForm.reason.trim() || undefined,
      proposedChange: createForm.proposedChange.trim() || undefined,
      impactSummary: createForm.impactSummary.trim() || undefined,
      raisedBy: createForm.raisedBy.trim() || undefined,
      targetImplementationDate:
        createForm.targetImplementationDate || undefined,
    };
    try {
      await createMutation.mutateAsync(body);
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE_FORM);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed.");
    }
  }

  async function saveEdit(): Promise<void> {
    if (!selected) return;
    setManageError(null);
    try {
      const next = await updateMutation.mutateAsync(editForm);
      setSelected(next);
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function transition(toStatus: EcnStatus): Promise<void> {
    if (!selected) return;
    setManageError(null);
    let approvedBy: string | undefined;
    if (toStatus === "APPROVED") {
      const v = window.prompt(
        "Who is approving this ECN? (audit name)",
        selected.approvedBy ?? "",
      );
      if (!v || !v.trim()) return;
      approvedBy = v.trim();
    }
    try {
      const next = await transitionMutation.mutateAsync({
        toStatus,
        approvedBy,
      });
      setSelected(next);
    } catch (err) {
      setManageError(
        err instanceof Error ? err.message : "Transition failed.",
      );
    }
  }

  const editLocked = selected
    ? TERMINAL_STATUSES.includes(selected.status)
    : false;

  if (query.isLoading && !data) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Engineering Change Notices (ECN)"
          description="Track engineering changes across products and BOMs"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Engineering Change Notices (ECN)"
          description="Track engineering changes across products and BOMs"
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-red-600">
            Failed to load ECN register. {String(query.error)}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Engineering Change Notices (ECN)"
        description="Track engineering changes across products and BOMs"
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Raise ECN
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total (page)"
          value={kpis.total.toLocaleString("en-IN")}
          icon={ClipboardList}
          iconColor="text-blue-600"
          change={`${total.toLocaleString("en-IN")} overall`}
          trend="neutral"
        />
        <KPICard
          title="Draft / Pending"
          value={kpis.open.toLocaleString("en-IN")}
          icon={FileEdit}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Approved / Implemented"
          value={kpis.greenlit.toLocaleString("en-IN")}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Critical / High Open"
          value={kpis.criticalOpen.toLocaleString("en-IN")}
          icon={AlertTriangle}
          iconColor={kpis.criticalOpen > 0 ? "text-red-600" : "text-gray-500"}
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">
              Filters:
            </span>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter((v ?? "ALL") as "ALL" | EcnStatus)
                }
              >
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Severity</Label>
              <Select
                value={severityFilter}
                onValueChange={(v) =>
                  setSeverityFilter((v ?? "ALL") as "ALL" | EcnSeverity)
                }
              >
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Change Type</Label>
              <Select
                value={changeTypeFilter}
                onValueChange={(v) =>
                  setChangeTypeFilter((v ?? "ALL") as "ALL" | EcnChangeType)
                }
              >
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  {CHANGE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(statusFilter !== "ALL" ||
              severityFilter !== "ALL" ||
              changeTypeFilter !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setStatusFilter("ALL");
                  setSeverityFilter("ALL");
                  setChangeTypeFilter("ALL");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <DataTable<EngineeringChangeNotice>
        serverSide
        data={rows}
        totalCount={total}
        columns={columns}
        searchPlaceholder="Search ECN # or title..."
        searchKey="ecnNumber"
        pageSize={DEFAULT_LIMIT}
        onPageChange={(p) => setPage(p + 1)}
        onSearchChange={(s) => setSearchInput(s)}
        onRowClick={(r) => setSelected(r)}
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Raise an Engineering Change Notice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {createError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {createError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input
                placeholder="Short summary of the change"
                value={createForm.title}
                onChange={(e) =>
                  setCreateForm({ ...createForm, title: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Change Type</Label>
                <Select
                  value={createForm.changeType}
                  onValueChange={(v) =>
                    setCreateForm({
                      ...createForm,
                      changeType: v as EcnChangeType,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANGE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select
                  value={createForm.severity}
                  onValueChange={(v) =>
                    setCreateForm({
                      ...createForm,
                      severity: v as EcnSeverity,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Affected Product (optional)</Label>
              <Select
                value={createForm.affectedProductId || "__none__"}
                onValueChange={(v) =>
                  setCreateForm({
                    ...createForm,
                    affectedProductId: !v || v === "__none__" ? "" : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No specific product" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.productCode} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                rows={2}
                placeholder="Longer description (optional)"
                value={createForm.description}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    description: e.target.value,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Raised By</Label>
                <Input
                  placeholder="e.g. R. Sharma"
                  value={createForm.raisedBy}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      raisedBy: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Target Implementation</Label>
                <Input
                  type="date"
                  value={createForm.targetImplementationDate}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      targetImplementationDate: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                rows={2}
                placeholder="Why is this change being raised?"
                value={createForm.reason}
                onChange={(e) =>
                  setCreateForm({ ...createForm, reason: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Proposed Change</Label>
              <Textarea
                rows={2}
                placeholder="What specifically is changing?"
                value={createForm.proposedChange}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    proposedChange: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Impact Summary</Label>
              <Textarea
                rows={2}
                placeholder="Downstream effects, cost, schedule, etc."
                value={createForm.impactSummary}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    impactSummary: e.target.value,
                  })
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              ECN is created in <span className="font-medium">DRAFT</span>.
              Open the row to submit it for review.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={submitCreate}
              disabled={
                createMutation.isPending || !createForm.title.trim()
              }
            >
              {createMutation.isPending ? "Creating…" : "Create Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage dialog */}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span className="font-mono text-sm text-blue-600">
                {selected?.ecnNumber}
              </span>
              {selected && <StatusBadge status={selected.status} />}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              {manageError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                  {manageError}
                </div>
              )}
              {editLocked && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                  This ECN is in a terminal status (
                  {selected.status.replace(/_/g, " ")}). Editing is locked —
                  raise a new ECN if further changes are needed.
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  value={editForm.title ?? ""}
                  disabled={editLocked}
                  onChange={(e) =>
                    setEditForm({ ...editForm, title: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Change Type</Label>
                  <Select
                    value={editForm.changeType ?? selected.changeType}
                    onValueChange={(v) =>
                      setEditForm({
                        ...editForm,
                        changeType: v as EcnChangeType,
                      })
                    }
                    disabled={editLocked}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANGE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Severity</Label>
                  <Select
                    value={editForm.severity ?? selected.severity}
                    onValueChange={(v) =>
                      setEditForm({
                        ...editForm,
                        severity: v as EcnSeverity,
                      })
                    }
                    disabled={editLocked}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEVERITIES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  value={editForm.description ?? ""}
                  disabled={editLocked}
                  onChange={(e) =>
                    setEditForm({ ...editForm, description: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Raised By</Label>
                  <Input
                    value={editForm.raisedBy ?? ""}
                    disabled={editLocked}
                    onChange={(e) =>
                      setEditForm({ ...editForm, raisedBy: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Target Implementation</Label>
                  <Input
                    type="date"
                    value={editForm.targetImplementationDate ?? ""}
                    disabled={editLocked}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        targetImplementationDate: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Textarea
                  rows={2}
                  value={editForm.reason ?? ""}
                  disabled={editLocked}
                  onChange={(e) =>
                    setEditForm({ ...editForm, reason: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Proposed Change</Label>
                <Textarea
                  rows={2}
                  value={editForm.proposedChange ?? ""}
                  disabled={editLocked}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      proposedChange: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Impact Summary</Label>
                <Textarea
                  rows={2}
                  value={editForm.impactSummary ?? ""}
                  disabled={editLocked}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      impactSummary: e.target.value,
                    })
                  }
                />
              </div>

              {selected.approvedBy && (
                <div className="text-xs text-muted-foreground space-y-0.5 border-t pt-3">
                  <div>
                    Approved by{" "}
                    <span className="font-medium">{selected.approvedBy}</span>{" "}
                    on {fmtDate(selected.approvedAt)}
                  </div>
                  {selected.implementedAt && (
                    <div>
                      Implemented on {fmtDate(selected.implementedAt)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <div className="flex gap-2 mr-auto">
              {selected &&
                ALLOWED_TRANSITIONS[selected.status].map((to) => (
                  <Button
                    key={to}
                    variant={
                      to === "APPROVED"
                        ? "default"
                        : to === "REJECTED" || to === "CANCELLED"
                          ? "destructive"
                          : "secondary"
                    }
                    size="sm"
                    onClick={() => transition(to)}
                    disabled={transitionMutation.isPending}
                  >
                    {to === "PENDING_REVIEW"
                      ? "Submit for Review"
                      : to === "APPROVED"
                        ? "Approve"
                        : to === "REJECTED"
                          ? "Reject"
                          : to === "IMPLEMENTED"
                            ? "Mark Implemented"
                            : "Cancel ECN"}
                  </Button>
                ))}
            </div>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
            <Button
              onClick={saveEdit}
              disabled={updateMutation.isPending || editLocked}
            >
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
