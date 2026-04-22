"use client";

/**
 * QC Inspection detail — shows header + lifecycle actions + findings table.
 *
 * Lifecycle actions:
 *   - DRAFT       → "Start Inspection"   (calls /qc/inspections/:id/start)
 *   - IN_PROGRESS → "Complete PASS"      (qc:approve + verdict=PASS)
 *                 → "Complete FAIL"      (qc:reject  + verdict=FAIL)
 *   - PASSED      → "Issue Certificate"  (only for FINAL_QC; routes to
 *                                         /qc/certs after create)
 *   - FAILED      → no lifecycle actions; find the NCR module (Phase 3)
 *
 * Findings table:
 *   - Inline edit: actualValue / actualNumeric / actualBoolean / result /
 *     inspectorNotes
 *   - result must be one of PENDING / PASS / FAIL / SKIPPED
 *   - Disabled once inspection.status = PASSED | FAILED (server-enforced too)
 *
 * expectedVersion is carried through start/complete so stale clients get a
 * 409 and re-fetch.
 */

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  useApiQcInspection,
  useApiStartQcInspection,
  useApiCompleteQcInspection,
  useApiUpdateQcFinding,
  useApiQcInspectionCert,
  useApiIssueQcCert,
} from "@/hooks/useQcApi";
import {
  QC_FINDING_RESULTS,
  type QcFinding,
  type QcFindingResult,
  type QcInspectionStatus,
  type QcVerdict,
} from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  Loader2,
  Play,
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

const RESULT_TONE: Record<QcFindingResult, string> = {
  PENDING: "bg-gray-50 text-gray-700 border-gray-200",
  PASS: "bg-green-50 text-green-700 border-green-200",
  FAIL: "bg-red-50 text-red-700 border-red-200",
  SKIPPED: "bg-slate-50 text-slate-600 border-slate-200",
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function QcInspectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id } = use(params);

  const inspectionQuery = useApiQcInspection(id);
  const certQuery = useApiQcInspectionCert(id);
  const startMutation = useApiStartQcInspection(id);
  const completeMutation = useApiCompleteQcInspection(id);
  const updateFinding = useApiUpdateQcFinding(id);
  const issueCert = useApiIssueQcCert();

  const [completeDialog, setCompleteDialog] = useState<
    null | { verdict: QcVerdict }
  >(null);
  const [verdictNotes, setVerdictNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const inspection = inspectionQuery.data;
  const findings = inspection?.findings ?? [];

  const summary = useMemo(() => {
    const s = {
      total: findings.length,
      pending: 0,
      pass: 0,
      fail: 0,
      skipped: 0,
      criticalFail: 0,
    };
    for (const f of findings) {
      if (f.result === "PENDING") s.pending++;
      else if (f.result === "PASS") s.pass++;
      else if (f.result === "FAIL") {
        s.fail++;
        if (f.isCritical) s.criticalFail++;
      } else if (f.result === "SKIPPED") s.skipped++;
    }
    return s;
  }, [findings]);

  if (inspectionQuery.isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (inspectionQuery.isError || !inspection) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load inspection
            </p>
            <p className="text-red-700 mt-1">
              {inspectionQuery.error instanceof Error
                ? inspectionQuery.error.message
                : "Inspection not found"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isLocked =
    inspection.status === "PASSED" || inspection.status === "FAILED";

  const handleStart = async (): Promise<void> => {
    setActionError(null);
    try {
      await startMutation.mutateAsync({
        expectedVersion: inspection.version,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "failed to start");
    }
  };

  const handleComplete = async (verdict: QcVerdict): Promise<void> => {
    setActionError(null);
    try {
      await completeMutation.mutateAsync({
        expectedVersion: inspection.version,
        verdict,
        verdictNotes: verdictNotes.trim() || undefined,
      });
      setCompleteDialog(null);
      setVerdictNotes("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "failed to complete");
    }
  };

  const handleIssueCert = async (): Promise<void> => {
    setActionError(null);
    try {
      const cert = await issueCert.mutateAsync({
        inspectionId: inspection.id,
      });
      router.push(`/qc/certs/${cert.id}`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "failed to issue certificate",
      );
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <PageHeader
        title={`Inspection ${inspection.inspectionNumber}`}
        description={
          inspection.templateName
            ? `${inspection.kind.replace(/_/g, " ")} • ${inspection.templateName}`
            : inspection.kind.replace(/_/g, " ")
        }
        actions={
          <Button
            variant="outline"
            onClick={() => router.push("/qc/inspections")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        }
      />

      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-3">
            <ClipboardList className="h-5 w-5 text-blue-600" />
            Inspection Details
            <Badge
              variant="outline"
              className={STATUS_TONE[inspection.status]}
            >
              {inspection.status.replace(/_/g, " ")}
            </Badge>
            {inspection.verdict && (
              <Badge
                variant="outline"
                className={VERDICT_TONE[inspection.verdict]}
              >
                {inspection.verdict}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Template code</p>
            <p className="font-mono">{inspection.templateCode ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Source</p>
            <p>
              <Badge variant="outline" className="text-[10px]">
                {inspection.sourceType.replace(/_/g, " ")}
              </Badge>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Source label</p>
            <p>{inspection.sourceLabel ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Sample size</p>
            <p className="tabular-nums">{inspection.sampleSize ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Started</p>
            <p>{formatDateTime(inspection.startedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Completed</p>
            <p>{formatDateTime(inspection.completedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Version</p>
            <p className="font-mono tabular-nums">{inspection.version}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cert</p>
            <p>
              {certQuery.data ? (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 font-mono text-xs"
                  onClick={() =>
                    router.push(`/qc/certs/${certQuery.data?.id}`)
                  }
                >
                  {certQuery.data.certNumber}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </p>
          </div>
          {inspection.notes && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm">{inspection.notes}</p>
            </div>
          )}
          {inspection.verdictNotes && (
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">Verdict notes</p>
              <p className="text-sm">{inspection.verdictNotes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lifecycle action bar */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <span className="font-medium">{summary.total}</span> findings:{" "}
            <span className="text-gray-600">{summary.pending} pending</span>
            {" • "}
            <span className="text-green-700">{summary.pass} pass</span>
            {" • "}
            <span className="text-red-700">{summary.fail} fail</span>
            {" • "}
            <span className="text-slate-600">{summary.skipped} skipped</span>
            {summary.criticalFail > 0 && (
              <>
                {" • "}
                <span className="text-red-700 font-medium">
                  {summary.criticalFail} CRITICAL failed
                </span>
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {inspection.status === "DRAFT" && (
              <Button
                onClick={handleStart}
                disabled={startMutation.isPending}
              >
                {startMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Start Inspection
              </Button>
            )}
            {inspection.status === "IN_PROGRESS" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setCompleteDialog({ verdict: "FAIL" })}
                  disabled={summary.pending > 0}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Complete FAIL
                </Button>
                <Button
                  onClick={() => setCompleteDialog({ verdict: "PASS" })}
                  disabled={
                    summary.pending > 0 ||
                    summary.fail > 0 ||
                    summary.criticalFail > 0
                  }
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Complete PASS
                </Button>
              </>
            )}
            {inspection.status === "PASSED" &&
              inspection.kind === "FINAL_QC" &&
              !certQuery.data && (
                <Button
                  onClick={handleIssueCert}
                  disabled={issueCert.isPending}
                >
                  {issueCert.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileCheck2 className="mr-2 h-4 w-4" />
                  )}
                  Issue Certificate
                </Button>
              )}
          </div>
        </CardContent>
      </Card>

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </div>
      )}

      {/* Findings table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Findings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {findings.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {inspection.status === "DRAFT"
                ? "No findings yet. Click 'Start Inspection' to seed from template."
                : "No findings on this inspection."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 w-10">#</th>
                    <th className="text-left px-4 py-2">Parameter</th>
                    <th className="text-left px-4 py-2">Expected</th>
                    <th className="text-left px-4 py-2">Actual</th>
                    <th className="text-left px-4 py-2 w-32">Result</th>
                    <th className="text-left px-4 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {findings.map((f) => (
                    <FindingRow
                      key={f.id}
                      finding={f}
                      locked={isLocked}
                      onUpdate={(body) =>
                        updateFinding.mutateAsync({
                          findingId: f.id,
                          body,
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Complete dialog */}
      <Dialog
        open={!!completeDialog}
        onOpenChange={(open) => {
          if (!open) {
            setCompleteDialog(null);
            setVerdictNotes("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Complete Inspection — {completeDialog?.verdict}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm">
              You are about to mark this inspection as{" "}
              <span className="font-semibold">
                {completeDialog?.verdict === "PASS" ? "PASSED" : "FAILED"}
              </span>
              . This locks the findings and cannot be undone without admin
              override.
            </div>

            <div>
              <Label className="text-xs">Verdict notes (optional)</Label>
              <Textarea
                value={verdictNotes}
                onChange={(e) => setVerdictNotes(e.target.value)}
                rows={3}
                placeholder="Reason / observations / rework disposition..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCompleteDialog(null);
                setVerdictNotes("");
              }}
              disabled={completeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant={completeDialog?.verdict === "PASS" ? "default" : "destructive"}
              onClick={() =>
                completeDialog && handleComplete(completeDialog.verdict)
              }
              disabled={completeMutation.isPending}
            >
              {completeMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Complete {completeDialog?.verdict}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Finding row (inline edit) ──────────────────────────────────────────────

interface FindingRowProps {
  finding: QcFinding;
  locked: boolean;
  onUpdate: (body: {
    actualValue?: string;
    actualNumeric?: string;
    actualBoolean?: boolean;
    result?: QcFindingResult;
    inspectorNotes?: string;
  }) => Promise<QcFinding>;
}

function FindingRow({ finding, locked, onUpdate }: FindingRowProps) {
  const [actual, setActual] = useState<string>(
    finding.actualNumeric ?? finding.actualValue ?? "",
  );
  const [notes, setNotes] = useState<string>(finding.inspectorNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const expectedLabel = useMemo(() => {
    if (finding.parameterType === "NUMERIC") {
      const parts: string[] = [];
      if (finding.expectedValue !== null)
        parts.push(`target ${finding.expectedValue}`);
      if (finding.minValue !== null) parts.push(`min ${finding.minValue}`);
      if (finding.maxValue !== null) parts.push(`max ${finding.maxValue}`);
      if (finding.uom) parts.push(finding.uom);
      return parts.join(" • ") || "—";
    }
    if (finding.parameterType === "TEXT") {
      return finding.expectedText ?? "—";
    }
    if (finding.parameterType === "BOOLEAN") {
      return finding.expectedText ?? "true/false";
    }
    return "—";
  }, [finding]);

  const saveField = async (
    body: Parameters<typeof onUpdate>[0],
  ): Promise<void> => {
    setRowError(null);
    setSaving(true);
    try {
      await onUpdate(body);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleActualBlur = async (): Promise<void> => {
    if (locked) return;
    if (finding.parameterType === "NUMERIC") {
      if (actual === (finding.actualNumeric ?? "")) return;
      await saveField({
        actualNumeric: actual || undefined,
        actualValue: actual || undefined,
      });
    } else {
      if (actual === (finding.actualValue ?? "")) return;
      await saveField({ actualValue: actual || undefined });
    }
  };

  const handleNotesBlur = async (): Promise<void> => {
    if (locked) return;
    if (notes === (finding.inspectorNotes ?? "")) return;
    await saveField({ inspectorNotes: notes || undefined });
  };

  const handleResultChange = async (result: QcFindingResult): Promise<void> => {
    if (locked) return;
    await saveField({ result });
  };

  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-2 text-xs font-mono text-muted-foreground">
        {finding.sequenceNumber}
      </td>
      <td className="px-4 py-2">
        <div className="font-medium">{finding.parameterName}</div>
        <div className="text-[10px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px] mr-1">
            {finding.parameterType}
          </Badge>
          {finding.isCritical && (
            <Badge
              variant="outline"
              className="text-[10px] bg-red-50 text-red-700 border-red-200"
            >
              CRITICAL
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-xs text-muted-foreground">
        {expectedLabel}
      </td>
      <td className="px-4 py-2">
        {finding.parameterType === "BOOLEAN" ||
        finding.parameterType === "CHECKBOX" ? (
          <Select
            disabled={locked || saving}
            value={
              finding.actualBoolean === true
                ? "true"
                : finding.actualBoolean === false
                  ? "false"
                  : "none"
            }
            onValueChange={(v) =>
              saveField({ actualBoolean: v === "true" ? true : v === "false" ? false : undefined })
            }
          >
            <SelectTrigger className="w-[100px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              <SelectItem value="true">Yes</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            disabled={locked || saving}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            onBlur={handleActualBlur}
            className="h-8 font-mono text-xs"
            placeholder={
              finding.parameterType === "NUMERIC" ? "0.0000" : "value"
            }
          />
        )}
      </td>
      <td className="px-4 py-2">
        <Select
          disabled={locked || saving}
          value={finding.result}
          onValueChange={(v) => handleResultChange(v as QcFindingResult)}
        >
          <SelectTrigger
            className={`w-[120px] h-8 ${RESULT_TONE[finding.result]}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QC_FINDING_RESULTS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2">
        <Input
          disabled={locked || saving}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          className="h-8 text-xs"
          placeholder="inspector notes"
        />
        {rowError && (
          <div className="text-[10px] text-red-600 mt-0.5">{rowError}</div>
        )}
      </td>
    </tr>
  );
}
