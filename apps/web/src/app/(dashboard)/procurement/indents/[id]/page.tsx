"use client";

/**
 * Indent detail — reads /procurement/indents/:id (returns IndentWithLines)
 * via useApiIndent.
 *
 * **Edit-in-place**: every header input and every line cell is a real form
 * control when the indent is DRAFT or REJECTED (the two states where edits
 * are legal under the workflow in `procurement.ts`). Once the indent is
 * SUBMITTED / APPROVED / CONVERTED the UI locks to read-only so we don't
 * surface edit affordances that would 409.
 *
 * Capabilities:
 *   - Inline-edit header (department, purpose, priority, requiredBy, notes).
 *     Saves via useApiUpdateIndent with `expectedVersion`.
 *   - Inline-edit lines (quantity, uom, estimatedCost, notes) via
 *     useApiUpdateIndentLine. Header version bumps on line writes so we
 *     re-seed drafts on each refetch.
 *   - Add / delete line items.
 *   - Status transitions:
 *       DRAFT     → SUBMITTED   (Submit for approval)
 *       SUBMITTED → APPROVED    (Approve)
 *       SUBMITTED → REJECTED    (Reject)
 *       (APPROVED → CONVERTED happens implicitly when a PO references this
 *        indent's lines via indentLineId — no manual transition.)
 *
 * This mirrors the purchase-orders/[id] detail page so the two documents
 * feel the same to the user.
 */

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiAddIndentLine,
  useApiDeleteIndentLine,
  useApiIndent,
  useApiUpdateIndent,
  useApiUpdateIndentLine,
} from "@/hooks/useProcurementApi";
import { useApiItems } from "@/hooks/useInventoryApi";
import {
  INDENT_PRIORITIES,
  type IndentLine,
  type IndentPriority,
  type IndentStatus,
  type Item,
} from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";

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

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

const STATUS_TONE: Record<IndentStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  SUBMITTED: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-green-50 text-green-700 border-green-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  CONVERTED: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

const PRIORITY_TONE: Record<IndentPriority, string> = {
  LOW: "bg-gray-50 text-gray-600 border-gray-200",
  NORMAL: "bg-blue-50 text-blue-600 border-blue-200",
  HIGH: "bg-amber-50 text-amber-700 border-amber-200",
  URGENT: "bg-red-50 text-red-700 border-red-200",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function IndentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const indentQuery = useApiIndent(id);
  const indent = indentQuery.data;

  const itemsQuery = useApiItems({ limit: 500, isActive: true });
  const items = itemsQuery.data?.data ?? [];

  const updateIndent = useApiUpdateIndent(id);
  const addLine = useApiAddIndentLine(id);
  const updateLine = useApiUpdateIndentLine(id);
  const deleteLine = useApiDeleteIndentLine(id);

  // ─── Dialog state ────────────────────────────────────────────────────────
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [formItemId, setFormItemId] = useState("");
  const [formQty, setFormQty] = useState("1");
  const [formUom, setFormUom] = useState("");
  const [formEstCost, setFormEstCost] = useState("0");
  const [formNotes, setFormNotes] = useState("");
  const [lineError, setLineError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  // ─── Editable header draft ───────────────────────────────────────────────
  type HeaderDraft = {
    department: string;
    purpose: string;
    priority: IndentPriority;
    requiredBy: string;
    notes: string;
  };

  function draftFromIndent(): HeaderDraft {
    return {
      department: indent?.department ?? "",
      purpose: indent?.purpose ?? "",
      priority: (indent?.priority ?? "NORMAL") as IndentPriority,
      requiredBy: toDateInput(indent?.requiredBy),
      notes: indent?.notes ?? "",
    };
  }

  const [draft, setDraft] = useState<HeaderDraft>(() => draftFromIndent());

  useEffect(() => {
    if (!indent) return;
    setDraft(draftFromIndent());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indent?.id, indent?.updatedAt, indent?.version]);

  const isDirty = useMemo(() => {
    if (!indent) return false;
    const server = {
      department: indent.department ?? "",
      purpose: indent.purpose ?? "",
      priority: indent.priority,
      requiredBy: toDateInput(indent.requiredBy),
      notes: indent.notes ?? "",
    };
    return JSON.stringify(server) !== JSON.stringify(draft);
  }, [indent, draft]);

  // Early returns — all hooks are above.
  if (indentQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (indentQuery.isError || !indent) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              {indentQuery.isError
                ? "Failed to load indent"
                : "Indent not found"}
            </p>
            {indentQuery.isError && (
              <p className="text-red-700 mt-1">
                {indentQuery.error instanceof Error
                  ? indentQuery.error.message
                  : "Unknown error"}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/procurement/indents")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Indents
        </Button>
      </div>
    );
  }

  const editable =
    indent.status === "DRAFT" || indent.status === "REJECTED";

  // ─── Header save ────────────────────────────────────────────────────────
  async function saveHeader(): Promise<void> {
    if (!indent) return;
    setActionError(null);
    try {
      await updateIndent.mutateAsync({
        department: draft.department || undefined,
        purpose: draft.purpose || undefined,
        priority: draft.priority,
        requiredBy: draft.requiredBy || undefined,
        notes: draft.notes || undefined,
        expectedVersion: indent.version,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Save failed — please refresh."
      );
    }
  }

  async function changeStatus(next: IndentStatus): Promise<void> {
    if (!indent) return;
    setActionError(null);
    try {
      await updateIndent.mutateAsync({
        status: next,
        expectedVersion: indent.version,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Status update failed");
    }
  }

  async function handleAddLine(): Promise<void> {
    setLineError(null);
    if (!formItemId || !formQty || !formUom) {
      setLineError("Item, quantity and UoM are required.");
      return;
    }
    try {
      await addLine.mutateAsync({
        itemId: formItemId,
        quantity: formQty,
        uom: formUom,
        estimatedCost: formEstCost || "0",
        notes: formNotes.trim() || undefined,
      });
      setLineDialogOpen(false);
      setFormItemId("");
      setFormQty("1");
      setFormUom("");
      setFormEstCost("0");
      setFormNotes("");
    } catch (err) {
      setLineError(err instanceof Error ? err.message : "Add line failed");
    }
  }

  async function handleDeleteLine(lineId: string): Promise<void> {
    setActionError(null);
    try {
      await deleteLine.mutateAsync(lineId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const canSubmit = indent.status === "DRAFT" && indent.lines.length > 0;
  const canApproveOrReject = indent.status === "SUBMITTED";

  const selectedFormItem = items.find((i) => i.id === formItemId);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/procurement/indents")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Indents
        </Button>
      </div>

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight font-mono">
              {indent.indentNumber}
            </h1>
            <Badge
              variant="outline"
              className={`text-xs whitespace-nowrap ${STATUS_TONE[indent.status]}`}
            >
              {indent.status}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs whitespace-nowrap ${PRIORITY_TONE[indent.priority]}`}
            >
              {indent.priority}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {indent.department ?? "No department"}
            {indent.requiredBy && ` · Required by ${formatDate(indent.requiredBy)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canSubmit && (
            <Button
              size="sm"
              onClick={() => changeStatus("SUBMITTED")}
              disabled={updateIndent.isPending}
              className="gap-1"
            >
              <Send className="h-4 w-4" /> Submit for Approval
            </Button>
          )}
          {canApproveOrReject && (
            <>
              <Button
                size="sm"
                onClick={() => changeStatus("APPROVED")}
                disabled={updateIndent.isPending}
                className="gap-1"
              >
                <CheckCircle2 className="h-4 w-4" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 border-red-300 hover:bg-red-50 gap-1"
                onClick={() => changeStatus("REJECTED")}
                disabled={updateIndent.isPending}
              >
                <XCircle className="h-4 w-4" /> Reject
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left */}
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Indent Header</CardTitle>
              {!editable && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-normal text-muted-foreground"
                >
                  Read-only ({indent.status})
                </Badge>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              {/* Department */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Department
                </Label>
                {editable ? (
                  <Input
                    value={draft.department}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, department: e.target.value }))
                    }
                    className="h-9"
                    placeholder="e.g. Production, R&D"
                  />
                ) : (
                  <p>{indent.department ?? "—"}</p>
                )}
              </div>

              {/* Priority */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Priority
                </Label>
                {editable ? (
                  <Select
                    value={draft.priority}
                    onValueChange={(v) => {
                      if (v)
                        setDraft((d) => ({
                          ...d,
                          priority: v as IndentPriority,
                        }));
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INDENT_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p>{indent.priority}</p>
                )}
              </div>

              {/* Required By */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Required By
                </Label>
                {editable ? (
                  <Input
                    type="date"
                    value={draft.requiredBy}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, requiredBy: e.target.value }))
                    }
                    className="h-9"
                  />
                ) : (
                  <p>{formatDate(indent.requiredBy)}</p>
                )}
              </div>

              {indent.approvedAt && (
                <div>
                  <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                    Approved
                  </Label>
                  <p>{formatDate(indent.approvedAt)}</p>
                </div>
              )}

              {/* Purpose */}
              <div className="col-span-2 space-y-1 pt-2 border-t">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Purpose
                </Label>
                {editable ? (
                  <Textarea
                    rows={2}
                    value={draft.purpose}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, purpose: e.target.value }))
                    }
                    placeholder="Why is this material needed?"
                  />
                ) : (
                  <p className="whitespace-pre-line">
                    {indent.purpose ?? "—"}
                  </p>
                )}
              </div>

              {/* Notes */}
              <div className="col-span-2 space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Notes
                </Label>
                {editable ? (
                  <Textarea
                    rows={3}
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, notes: e.target.value }))
                    }
                    placeholder="Internal notes, delivery constraints…"
                  />
                ) : (
                  <p className="whitespace-pre-line">{indent.notes ?? "—"}</p>
                )}
              </div>

              {/* Inline save bar */}
              {editable && (
                <div className="col-span-2 pt-3 border-t flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {isDirty
                      ? "Unsaved changes — click Save to commit."
                      : "No pending header changes."}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isDirty || updateIndent.isPending}
                      onClick={() => setDraft(draftFromIndent())}
                    >
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      disabled={!isDirty || updateIndent.isPending}
                      onClick={saveHeader}
                      className="gap-1"
                    >
                      <Check className="h-4 w-4" />
                      {updateIndent.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Line Items
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  ({indent.lines.length})
                </span>
              </CardTitle>
              {editable && (
                <Button
                  size="sm"
                  onClick={() => setLineDialogOpen(true)}
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" /> Add Line
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {indent.lines.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No line items yet.{" "}
                  {editable && (
                    <>Click <b>Add Line</b> to add the first one.</>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-10 text-xs">#</TableHead>
                      <TableHead className="text-xs">Item</TableHead>
                      <TableHead className="text-right text-xs">
                        Quantity
                      </TableHead>
                      <TableHead className="text-xs">UoM</TableHead>
                      <TableHead className="text-right text-xs">
                        Est. Cost
                      </TableHead>
                      <TableHead className="text-xs">Notes</TableHead>
                      {editable && <TableHead className="w-20 text-xs" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {indent.lines.map((line) => (
                      <EditableIndentLineRow
                        key={line.id}
                        line={line}
                        indentVersion={indent.version}
                        items={items}
                        editable={editable}
                        updateLine={updateLine}
                        onDelete={() => handleDeleteLine(line.id)}
                        deleting={deleteLine.isPending}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: metadata */}
        <div className="col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Status</p>
                <Badge
                  variant="outline"
                  className={`text-xs ${STATUS_TONE[indent.status]}`}
                >
                  {indent.status}
                </Badge>
              </div>
              <div className="pt-3 border-t space-y-1 text-xs text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">DRAFT</span> →
                  Submit for Approval
                </p>
                <p>
                  <span className="font-medium text-foreground">SUBMITTED</span>{" "}
                  → Approve / Reject
                </p>
                <p>
                  <span className="font-medium text-foreground">APPROVED</span>{" "}
                  → Auto-converts when a PO references a line
                </p>
                <p>
                  <span className="font-medium text-foreground">REJECTED</span>{" "}
                  → Editable again; resubmit when fixed
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono">{indent.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatDate(indent.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last updated</span>
                <span>{formatDate(indent.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add line dialog */}
      <Dialog open={lineDialogOpen} onOpenChange={setLineDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Indent Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {lineError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {lineError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Item</Label>
              <Select
                value={formItemId}
                onValueChange={(v) => {
                  setFormItemId(v ?? "");
                  const item = items.find((i) => i.id === v);
                  if (item) {
                    setFormUom(item.uom);
                    setFormEstCost(item.unitCost);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select item..." />
                </SelectTrigger>
                <SelectContent>
                  {items.map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.sku} — {it.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Qty</Label>
                <Input
                  type="number"
                  value={formQty}
                  onChange={(e) => setFormQty(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>UoM</Label>
                <Input
                  value={formUom}
                  onChange={(e) => setFormUom(e.target.value)}
                  placeholder={selectedFormItem?.uom ?? "EA"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Est. Cost (₹)</Label>
                <Input
                  type="number"
                  value={formEstCost}
                  onChange={(e) => setFormEstCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Optional line-specific notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLineDialogOpen(false)}
              disabled={addLine.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleAddLine} disabled={addLine.isPending}>
              {addLine.isPending ? "Adding…" : "Add Line"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Editable line row ──────────────────────────────────────────────────────

type EditableIndentLineRowProps = {
  line: IndentLine;
  indentVersion: number;
  items: Item[];
  editable: boolean;
  updateLine: ReturnType<typeof useApiUpdateIndentLine>;
  onDelete: () => void;
  deleting: boolean;
};

function EditableIndentLineRow({
  line,
  indentVersion,
  items,
  editable,
  updateLine,
  onDelete,
  deleting,
}: EditableIndentLineRowProps): React.ReactElement {
  type LineDraft = {
    quantity: string;
    uom: string;
    estimatedCost: string;
    notes: string;
  };

  function fromLine(): LineDraft {
    return {
      quantity: line.quantity,
      uom: line.uom,
      estimatedCost: line.estimatedCost,
      notes: line.notes ?? "",
    };
  }

  const [draft, setDraft] = useState<LineDraft>(() => fromLine());

  useEffect(() => {
    setDraft(fromLine());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id, line.updatedAt, indentVersion]);

  const isDirty = useMemo(() => {
    return (
      draft.quantity !== line.quantity ||
      draft.uom !== line.uom ||
      draft.estimatedCost !== line.estimatedCost ||
      draft.notes !== (line.notes ?? "")
    );
  }, [draft, line]);

  async function saveLine(): Promise<void> {
    await updateLine.mutateAsync({
      lineId: line.id,
      body: {
        quantity: draft.quantity,
        uom: draft.uom,
        estimatedCost: draft.estimatedCost,
        notes: draft.notes || undefined,
      },
    });
  }

  const item = items.find((i) => i.id === line.itemId);

  return (
    <TableRow>
      <TableCell className="text-xs font-mono text-muted-foreground">
        {line.lineNo}
      </TableCell>
      <TableCell className="text-sm">
        <p className="font-medium">
          {item?.name ?? line.itemId.slice(0, 8)}
        </p>
        {item && (
          <p className="text-xs font-mono text-muted-foreground">{item.sku}</p>
        )}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <Input
            type="number"
            value={draft.quantity}
            onChange={(e) =>
              setDraft((d) => ({ ...d, quantity: e.target.value }))
            }
            className="h-8 w-[90px] text-right"
          />
        ) : (
          <span className="text-sm">{line.quantity}</span>
        )}
      </TableCell>
      <TableCell>
        {editable ? (
          <Input
            value={draft.uom}
            onChange={(e) => setDraft((d) => ({ ...d, uom: e.target.value }))}
            className="h-8 w-[70px]"
          />
        ) : (
          <span className="text-sm">{line.uom}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <Input
            type="number"
            value={draft.estimatedCost}
            onChange={(e) =>
              setDraft((d) => ({ ...d, estimatedCost: e.target.value }))
            }
            className="h-8 w-[110px] text-right"
          />
        ) : (
          <span className="text-sm">{line.estimatedCost}</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {editable ? (
          <Input
            value={draft.notes}
            onChange={(e) =>
              setDraft((d) => ({ ...d, notes: e.target.value }))
            }
            className="h-8 min-w-[160px]"
            placeholder="—"
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            {line.notes ?? "—"}
          </span>
        )}
      </TableCell>
      {editable && (
        <TableCell>
          <div className="flex items-center gap-1 justify-end">
            <Button
              size="icon"
              variant={isDirty ? "default" : "ghost"}
              className="h-7 w-7"
              disabled={!isDirty || updateLine.isPending}
              onClick={saveLine}
              aria-label={`Save line ${line.lineNo}`}
              title="Save line"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-red-600"
              disabled={deleting}
              onClick={onDelete}
              aria-label={`Delete line ${line.lineNo}`}
              title="Delete line"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}
