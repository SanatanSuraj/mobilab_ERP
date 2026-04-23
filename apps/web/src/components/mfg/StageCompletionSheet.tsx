"use client";

/**
 * StageCompletionSheet — technician form to log a manufacturing stage completion.
 *
 * Context-aware: shows only the fields that the LineStageTemplate requires.
 *   requiresMeasurement → cycle time + domain measurements (OC gap, temp, etc.)
 *   requiresQCGate      → QC Pass / Fail + inspector name
 *   isBottleneck (L2-4) → Fixture ID (mandatory)
 *   ocAssemblyOnly (L2-2) → OC Gap (mm) measurement
 *   firmware stage      → Firmware Version field
 *
 * On submit: calls useLogStageCompletion() → mfgService.logStageCompletion()
 *            → React Query invalidates device-ids + stage-logs queries.
 */

import { useState } from "react";
import { Loader2, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLogStageCompletion } from "@/hooks/useMfg";
import { mobiOperators, type LineStageTemplate, type MobiDeviceID } from "@/data/instigenie-mock";

const FIXTURE_IDS = [
  "FIXTURE-QCA-001",
  "FIXTURE-QCA-002",
  "FIXTURE-QCA-003",
  "FIXTURE-QCA-004",
  "FIXTURE-GEN-001",
  "FIXTURE-GEN-002",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: MobiDeviceID;
  template: LineStageTemplate;
}

export function StageCompletionSheet({ open, onOpenChange, device, template }: Props) {
  const logStage = useLogStageCompletion();

  const [operator, setOperator] = useState("");
  const [cycleTimeMin, setCycleTimeMin] = useState(String(template.stdTimeMin));
  const [qcResult, setQcResult] = useState<"PASS" | "FAIL" | "">("");
  const [qcInspector, setQcInspector] = useState("");
  const [fixtureId, setFixtureId] = useState("");
  const [ocGapMm, setOcGapMm] = useState("");
  const [firmwareVersion, setFirmwareVersion] = useState("");
  const [notes, setNotes] = useState("");

  // Which operators are permitted on this line + tier check
  const permittedOps = mobiOperators.filter((op) =>
    op.permittedLines.includes(template.line)
  );

  const isFirmwareStage = template.stageName.toLowerCase().includes("program");
  const isOCStage = template.ocAssemblyOnly === true;
  const needsFixture = template.isBottleneck;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!operator) {
      toast.error("Select the operator who performed this stage.");
      return;
    }
    if (template.requiresQCGate && !qcResult) {
      toast.error("Select QC result (Pass / Fail) for this gate stage.");
      return;
    }
    if (needsFixture && !fixtureId) {
      toast.error("Fixture ID is required for this bottleneck stage.");
      return;
    }

    try {
      const result = await logStage.mutateAsync({
        deviceId: device.deviceId,
        line: template.line,
        stageTemplateId: template.id,
        stageName: template.stageName,
        stageSequence: template.sequence,
        stdTimeMin: template.stdTimeMin,
        operator,
        cycleTimeMin: parseInt(cycleTimeMin, 10) || template.stdTimeMin,
        qcResult: template.requiresQCGate ? (qcResult as "PASS" | "FAIL") : undefined,
        qcInspector: qcInspector || undefined,
        fixtureId: fixtureId || undefined,
        ocGapMm: isOCStage && ocGapMm ? parseFloat(ocGapMm) : undefined,
        firmwareVersion: isFirmwareStage ? firmwareVersion : undefined,
        notes: notes || undefined,
      });

      const statusLabel = result.device.status.replace(/_/g, " ");
      toast.success(`Stage logged: ${template.stageName}`, {
        description: `${device.deviceId} → ${statusLabel}`,
      });

      // Reset form
      setOperator("");
      setCycleTimeMin(String(template.stdTimeMin));
      setQcResult("");
      setQcInspector("");
      setFixtureId("");
      setOcGapMm("");
      setFirmwareVersion("");
      setNotes("");
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to log stage. Try again.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4" />
            Log Stage Completion
          </SheetTitle>
          <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
            <p>
              <span className="font-medium">Device:</span>{" "}
              <span className="font-mono">{device.deviceId}</span>
            </p>
            <p>
              <span className="font-medium">Stage:</span>{" "}
              <span className="font-mono text-[11px] text-muted-foreground">S{template.sequence}</span>{" "}
              {template.stageName}
            </p>
            <p>
              <span className="font-medium">Line:</span> {template.line} ·{" "}
              <span className="font-medium">Std time:</span> {template.stdTimeMin} min
            </p>
          </div>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">

          {/* Operator */}
          <div className="space-y-1.5">
            <Label htmlFor="sc-operator">Operator *</Label>
            <Select value={operator} onValueChange={(v) => v && setOperator(v)}>
              <SelectTrigger id="sc-operator" className="w-full">
                <SelectValue placeholder="Select operator…" />
              </SelectTrigger>
              <SelectContent>
                {permittedOps.map((op) => (
                  <SelectItem key={op.id} value={op.name}>
                    {op.name}
                    <span className="ml-1.5 text-muted-foreground text-xs">
                      ({op.tier} · {op.role})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {template.minTier === "T1" && (
              <p className="text-xs text-amber-700">
                ⚠ This stage requires a T1 operator.
              </p>
            )}
            {template.ocAssemblyOnly && (
              <p className="text-xs text-amber-700">
                ⚠ OC Assembly — Rishabh (primary). Go/No-Go jig JIG-OC-001 required.
              </p>
            )}
          </div>

          {/* Cycle Time */}
          <div className="space-y-1.5">
            <Label htmlFor="sc-cycle">
              Actual Cycle Time (min){" "}
              <span className="text-muted-foreground font-normal">
                · std {template.stdTimeMin} min
              </span>
            </Label>
            <Input
              id="sc-cycle"
              type="number"
              min="1"
              max="999"
              value={cycleTimeMin}
              onChange={(e) => setCycleTimeMin(e.target.value)}
              className={
                parseInt(cycleTimeMin) > template.stdTimeMin
                  ? "border-orange-400 focus-visible:ring-orange-400"
                  : ""
              }
            />
            {parseInt(cycleTimeMin) > template.stdTimeMin && (
              <p className="text-xs text-orange-700">
                Over standard time by {parseInt(cycleTimeMin) - template.stdTimeMin} min
              </p>
            )}
          </div>

          {/* OC Gap measurement — L2 OC Assembly stage */}
          {isOCStage && (
            <div className="space-y-1.5">
              <Label htmlFor="sc-ocgap">OC Gap (mm) *</Label>
              <Input
                id="sc-ocgap"
                type="number"
                step="0.01"
                min="0"
                max="2"
                placeholder="0.12"
                value={ocGapMm}
                onChange={(e) => setOcGapMm(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Acceptable range: 0.10 – 0.15 mm (Go/No-Go jig JIG-OC-001)
              </p>
              {ocGapMm && (parseFloat(ocGapMm) < 0.10 || parseFloat(ocGapMm) > 0.15) && (
                <p className="text-xs text-red-700 font-semibold">
                  ❌ Out of spec — raise NCR before proceeding
                </p>
              )}
            </div>
          )}

          {/* Fixture ID — bottleneck stages */}
          {needsFixture && (
            <div className="space-y-1.5">
              <Label>Fixture ID *</Label>
              <Select value={fixtureId} onValueChange={(v) => v && setFixtureId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select fixture…" />
                </SelectTrigger>
                <SelectContent>
                  {FIXTURE_IDS.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Firmware version — programming stages */}
          {isFirmwareStage && (
            <div className="space-y-1.5">
              <Label htmlFor="sc-fw">Firmware Version</Label>
              <Input
                id="sc-fw"
                placeholder="e.g. v3.2.1-rel"
                value={firmwareVersion}
                onChange={(e) => setFirmwareVersion(e.target.value)}
              />
            </div>
          )}

          {/* QC Gate — pass / fail */}
          {template.requiresQCGate && (
            <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
              <p className="text-sm font-semibold text-muted-foreground">QC Gate</p>

              <div className="space-y-1.5">
                <Label>Result *</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={qcResult === "PASS" ? "default" : "outline"}
                    className={qcResult === "PASS" ? "bg-green-600 hover:bg-green-700" : ""}
                    onClick={() => setQcResult("PASS")}
                  >
                    ✓ Pass
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={qcResult === "FAIL" ? "destructive" : "outline"}
                    onClick={() => setQcResult("FAIL")}
                  >
                    ✗ Fail
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sc-qcinspector">QC Inspector</Label>
                <Input
                  id="sc-qcinspector"
                  placeholder="e.g. Dr. Sunit Bhuyan (QC HOD)"
                  value={qcInspector}
                  onChange={(e) => setQcInspector(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Notes / observations */}
          <div className="space-y-1.5">
            <Label htmlFor="sc-notes">Notes / Observations</Label>
            <Textarea
              id="sc-notes"
              placeholder="Any observations, NCR numbers, deviations…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none min-h-[80px] text-sm"
            />
          </div>

          {template.notes && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <span className="font-semibold">Stage note:</span> {template.notes}
            </div>
          )}

          <SheetFooter className="px-0 pb-0 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={logStage.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={logStage.isPending}>
              {logStage.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Logging…</>
              ) : (
                "Log Completion"
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
