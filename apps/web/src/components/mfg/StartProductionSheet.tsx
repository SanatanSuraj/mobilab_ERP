"use client";

/**
 * StartProductionSheet — generates Unit IDs when production begins on a WO.
 *
 * A Unit is either a finished Device (MCC) or a sub-assembly Module
 * (MBA/MBM/MBC/CFG). Every WO may produce a mix of both kinds.
 *
 * Flow:
 *  1. Supervisor picks an eligible Work Order (APPROVED / RM_ISSUED / IN_PROGRESS)
 *  2. For each product code in that WO, selects the assembly line
 *  3. Clicks "Generate Unit IDs" → creates N units per product (N = batchQty)
 *  4. WO status advances to IN_PROGRESS
 *  5. Units immediately appear on the shop floor line panels
 *
 * Unit ID format generated: {PRODUCT}-{YYYY}-{MM}-{SEQ4}-0
 *   e.g. MBA-2026-04-0007-0 (Module) or MCC-2026-04-0001-0 (Device)
 */

import { useState, useMemo } from "react";
import { Loader2, Play, Package } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useProductionReadyWOs, useGenerateDeviceIds } from "@/hooks/useMfg";
import {
  isFinishedDeviceCode,
  isVendorSourcedCode,
  type MobicaseProduct,
  type AssemblyLine,
} from "@/data/instigenie-mock";

type BadgeKind = "DEVICE" | "MODULE_INHOUSE" | "MODULE_VENDOR";
function classifyForBadge(code: MobicaseProduct): BadgeKind {
  if (isFinishedDeviceCode(code)) return "DEVICE";
  if (isVendorSourcedCode(code)) return "MODULE_VENDOR";
  return "MODULE_INHOUSE";
}
const CHIP_CLS: Record<BadgeKind, string> = {
  DEVICE: "bg-indigo-600",
  MODULE_INHOUSE: "bg-slate-500",
  MODULE_VENDOR: "bg-amber-500",
};
const CHIP_LETTER: Record<BadgeKind, "D" | "M" | "V"> = {
  DEVICE: "D",
  MODULE_INHOUSE: "M",
  MODULE_VENDOR: "V",
};
const CHIP_TITLE: Record<BadgeKind, string> = {
  DEVICE: "Device (finished unit)",
  MODULE_INHOUSE: "Module · In-house (manufactured on our lines)",
  MODULE_VENDOR: "Module · Vendor-sourced (purchased ready-made)",
};

// Default line per product — operator can override
const DEFAULT_LINE: Record<MobicaseProduct, AssemblyLine> = {
  MBM: "L1",
  MBA: "L2",
  MBC: "L3",
  MCC: "L4",
  CFG: "L5",
};

const ALL_LINES: AssemblyLine[] = ["L1", "L2", "L3", "L4", "L5"];

const LINE_LABEL: Record<AssemblyLine, string> = {
  L1: "L1 — Mobimix",
  L2: "L2 — Analyser",
  L3: "L3 — Incubator",
  L4: "L4 — Final Assembly",
  L5: "L5 — Final Device QC",
};

const PRODUCT_LABEL: Record<MobicaseProduct, string> = {
  MBA: "Analyser (MBA)",
  MBM: "Mobimix (MBM)",
  MBC: "Incubator / Mobicube (MBC)",
  MCC: "Mobicase Final Device (MCC)",
  CFG: "Centrifuge (CFG)",
};

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  RM_ISSUED: "bg-blue-100 text-blue-800 border-blue-200",
  RM_QC_IN_PROGRESS: "bg-yellow-100 text-yellow-800 border-yellow-200",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800 border-indigo-200",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StartProductionSheet({ open, onOpenChange }: Props) {
  const { data: eligibleWOs = [], isLoading } = useProductionReadyWOs();
  const generateDevices = useGenerateDeviceIds();

  const [selectedWoId, setSelectedWoId] = useState<string>("");
  const [linePerProduct, setLinePerProduct] = useState<Partial<Record<MobicaseProduct, AssemblyLine>>>({});

  const selectedWO = useMemo(
    () => eligibleWOs.find((wo) => wo.id === selectedWoId) ?? null,
    [eligibleWOs, selectedWoId]
  );

  // When WO changes, reset line assignments to defaults
  function handleWOChange(woId: string) {
    setSelectedWoId(woId);
    const wo = eligibleWOs.find((w) => w.id === woId);
    if (!wo) return;
    const defaults: Partial<Record<MobicaseProduct, AssemblyLine>> = {};
    wo.productCodes.forEach((pc) => {
      defaults[pc] = DEFAULT_LINE[pc];
    });
    setLinePerProduct(defaults);
  }

  function handleLineChange(product: MobicaseProduct, line: AssemblyLine) {
    setLinePerProduct((prev) => ({ ...prev, [product]: line }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedWO) return;

    // Validate all products have a line
    const missing = selectedWO.productCodes.filter((pc) => !linePerProduct[pc]);
    if (missing.length > 0) {
      toast.error(`Assign a line for: ${missing.join(", ")}`);
      return;
    }

    try {
      const devices = await generateDevices.mutateAsync({
        woId: selectedWO.id,
        linePerProduct,
      });

      toast.success(
        `${devices.length} Unit IDs generated for ${selectedWO.woNumber}`,
        {
          description: `${selectedWO.productCodes.join(" · ")} — ${selectedWO.batchQty} units each. WO → IN PROGRESS.`,
        }
      );

      setSelectedWoId("");
      setLinePerProduct({});
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message ?? "Generation failed. Try again.");
    }
  }

  const totalDevices = selectedWO
    ? selectedWO.productCodes.length * selectedWO.batchQty
    : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md w-full overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Play className="h-4 w-4 text-green-600" />
            Start Production — Generate Unit IDs
          </SheetTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Select an approved Work Order. Unit IDs will be auto-generated
            (Device for MCC, Module for MBA/MBM/MBC/CFG — one per unit per
            product). They will immediately appear on the shop floor line panels.
          </p>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 py-4">

          {/* Work Order picker */}
          <div className="space-y-1.5">
            <Label>Work Order *</Label>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Loading eligible WOs…</p>
            ) : eligibleWOs.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center">
                No Work Orders are ready to start production.
                <br />
                WOs must be APPROVED or RM_ISSUED.
              </div>
            ) : (
              <Select value={selectedWoId} onValueChange={(v) => v && handleWOChange(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a Work Order…" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleWOs.map((wo) => (
                    <SelectItem key={wo.id} value={wo.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold">{wo.woNumber}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLOR[wo.status] ?? "bg-muted text-muted-foreground"}`}>
                          {wo.status.replace(/_/g, " ")}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {wo.productCodes.join("/")} × {wo.batchQty}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* WO summary + line assignments */}
          {selectedWO && (
            <>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{selectedWO.woNumber}</span>
                  <span className={`rounded border px-1.5 py-0.5 font-medium ${STATUS_COLOR[selectedWO.status] ?? ""}`}>
                    {selectedWO.status.replace(/_/g, " ")}
                  </span>
                  {selectedWO.priority !== "NORMAL" && (
                    <Badge variant="outline" className={selectedWO.priority === "CRITICAL" ? "text-red-700 border-red-300" : "text-amber-700 border-amber-300"}>
                      {selectedWO.priority}
                    </Badge>
                  )}
                </div>
                {selectedWO.customerName && (
                  <p className="text-muted-foreground">Customer: {selectedWO.customerName}</p>
                )}
                <p className="text-muted-foreground">
                  Batch qty: <span className="font-semibold text-foreground">{selectedWO.batchQty}</span>{" "}
                  · Products: <span className="font-semibold text-foreground">{selectedWO.productCodes.join(", ")}</span>
                </p>
                {selectedWO.notes && (
                  <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    ⚠ {selectedWO.notes}
                  </p>
                )}
              </div>

              {/* Line assignment per product */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <Label>Assign Assembly Line per Product</Label>
                </div>
                {selectedWO.productCodes.map((pc) => {
                  const kind = classifyForBadge(pc);
                  const isVendor = kind === "MODULE_VENDOR";
                  return (
                  <div key={pc} className="grid grid-cols-2 gap-3 items-center">
                    <div>
                      <p className="text-xs font-semibold inline-flex items-center gap-1.5">
                        <span
                          title={CHIP_TITLE[kind]}
                          className={`inline-flex items-center justify-center text-[9px] font-bold rounded-full px-1 py-0 leading-[14px] text-white ${CHIP_CLS[kind]}`}
                        >
                          {CHIP_LETTER[kind]}
                        </span>
                        {pc}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {PRODUCT_LABEL[pc]}
                        {isVendor && (
                          <span className="ml-1 text-amber-700">· vendor-sourced</span>
                        )}
                      </p>
                    </div>
                    <Select
                      value={linePerProduct[pc] ?? DEFAULT_LINE[pc]}
                      onValueChange={(v) => handleLineChange(pc, v as AssemblyLine)}
                    >
                      <SelectTrigger className="w-full h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_LINES.map((line) => (
                          <SelectItem key={line} value={line} className="text-xs">
                            {LINE_LABEL[line]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  );
                })}
              </div>

              {/* What will be created */}
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 space-y-0.5">
                {(() => {
                  const deviceCount = selectedWO.productCodes.filter(isFinishedDeviceCode).length;
                  const moduleCount = selectedWO.productCodes.length - deviceCount;
                  const deviceUnits = deviceCount * selectedWO.batchQty;
                  const moduleUnits = moduleCount * selectedWO.batchQty;
                  const parts: string[] = [];
                  if (deviceUnits > 0) parts.push(`${deviceUnits} Device${deviceUnits === 1 ? "" : "s"}`);
                  if (moduleUnits > 0) parts.push(`${moduleUnits} Module${moduleUnits === 1 ? "" : "s"}`);
                  return (
                    <p className="font-semibold">
                      Will generate {totalDevices} Unit IDs
                      {parts.length > 0 && (
                        <span className="text-green-700 font-normal"> ({parts.join(" · ")})</span>
                      )}:
                    </p>
                  );
                })()}
                {selectedWO.productCodes.map((pc) => {
                  const kind = classifyForBadge(pc);
                  const isVendor = kind === "MODULE_VENDOR";
                  return (
                    <p key={pc}>
                      · {selectedWO.batchQty}×{" "}
                      <span
                        title={CHIP_TITLE[kind]}
                        className={`inline-flex items-center justify-center text-[9px] font-bold rounded-full px-1 py-0 leading-[14px] text-white mr-0.5 ${CHIP_CLS[kind]}`}
                      >
                        {CHIP_LETTER[kind]}
                      </span>
                      <span className="font-mono">{pc}</span> on{" "}
                      <span className="font-semibold">{linePerProduct[pc] ?? DEFAULT_LINE[pc]}</span>
                      {" "}({LINE_LABEL[linePerProduct[pc] ?? DEFAULT_LINE[pc]]})
                      {isVendor && (
                        <span className="text-amber-700"> — vendor scan</span>
                      )}
                    </p>
                  );
                })}
              </div>
            </>
          )}

          <SheetFooter className="px-0 pb-0 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={generateDevices.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!selectedWO || generateDevices.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {generateDevices.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>
              ) : (
                <><Play className="h-4 w-4 mr-2" />Generate {totalDevices > 0 ? `${totalDevices} ` : ""}Unit IDs</>
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
