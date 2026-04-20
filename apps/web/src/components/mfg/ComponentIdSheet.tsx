"use client";

/**
 * ComponentIdSheet — technician form to record component serial numbers
 * (PCB IDs, sensor IDs, machine body IDs, etc.) on a device.
 *
 * Fields shown depend on the device's productCode:
 *   MBA → PCB ID, Sensor ID, Detector ID
 *   MBM → Machine ID, PCB ID
 *   MBC → PCB ID
 *   CFG → CFG Vendor ID, Serial No
 *   MCC → All of the above (analyzerXxx, mixerXxx, incubatorXxx, cfgXxx) + accessories
 *
 * Pre-fills from existing device data so technicians can update individual fields.
 * On submit: calls useUpdateComponentIds() → invalidates device-ids queries.
 */

import { useState } from "react";
import { Loader2, Scan } from "lucide-react";
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
import { useUpdateComponentIds } from "@/hooks/useMfg";
import type { MobiDeviceID } from "@/data/mobilab-mock";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: MobiDeviceID;
}

/** A single labelled field with a placeholder format hint */
function ComponentField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-sm"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ComponentIdSheet({ open, onOpenChange, device }: Props) {
  const updateIds = useUpdateComponentIds();
  const pc = device.productCode;

  // MBA / MBC standalone fields
  const [pcbId, setPcbId] = useState(device.pcbId ?? "");
  const [sensorId, setSensorId] = useState(device.sensorId ?? "");
  const [detectorId, setDetectorId] = useState(device.detectorId ?? "");

  // MBM standalone fields
  const [machineId, setMachineId] = useState(device.machineId ?? "");

  // CFG standalone fields
  const [cfgVendorId, setCfgVendorId] = useState(device.cfgVendorId ?? "");
  const [cfgSerialNo, setCfgSerialNo] = useState(device.cfgSerialNo ?? "");

  // MCC internal sub-assembly fields
  const [analyzerPcbId, setAnalyzerPcbId] = useState(device.analyzerPcbId ?? "");
  const [analyzerSensorId, setAnalyzerSensorId] = useState(device.analyzerSensorId ?? "");
  const [analyzerDetectorId, setAnalyzerDetectorId] = useState(device.analyzerDetectorId ?? "");
  const [mixerMachineId, setMixerMachineId] = useState(device.mixerMachineId ?? "");
  const [mixerPcbId, setMixerPcbId] = useState(device.mixerPcbId ?? "");
  const [incubatorPcbId, setIncubatorPcbId] = useState(device.incubatorPcbId ?? "");
  const [mccCfgVendorId, setMccCfgVendorId] = useState(device.cfgVendorId ?? "");
  const [mccCfgSerialNo, setMccCfgSerialNo] = useState(device.cfgSerialNo ?? "");

  // Accessories (all product types)
  const [micropipetteId, setMicropipetteId] = useState(device.micropipetteId ?? "");
  const [centrifugeId, setCentrifugeId] = useState(device.centrifugeId ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    let data: Parameters<typeof updateIds.mutateAsync>[0]["data"] = {};

    if (pc === "MBA") {
      data = { pcbId, sensorId, detectorId };
    } else if (pc === "MBM") {
      data = { machineId, pcbId };
    } else if (pc === "MBC") {
      data = { pcbId };
    } else if (pc === "CFG") {
      data = { cfgVendorId, cfgSerialNo };
    } else if (pc === "MCC") {
      data = {
        analyzerPcbId,
        analyzerSensorId,
        analyzerDetectorId,
        mixerMachineId,
        mixerPcbId,
        incubatorPcbId,
        cfgVendorId: mccCfgVendorId,
        cfgSerialNo: mccCfgSerialNo,
        micropipetteId,
        centrifugeId,
      };
    }

    // Also save accessories for non-MCC types
    if (pc !== "MCC") {
      data = { ...data, micropipetteId, centrifugeId };
    }

    try {
      await updateIds.mutateAsync({ deviceId: device.deviceId, data });
      toast.success("Component IDs saved", {
        description: `${device.deviceId} updated with ${Object.values(data).filter(Boolean).length} IDs.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to save. Try again.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Scan className="h-4 w-4" />
            Update Component IDs
          </SheetTitle>
          <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
            <p>
              <span className="font-medium">Device:</span>{" "}
              <span className="font-mono">{device.deviceId}</span>
            </p>
            <p>
              <span className="font-medium">Product:</span> {pc} ·{" "}
              <span className="font-medium">WO:</span> {device.workOrderNumber}
            </p>
          </div>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 py-4">

          {/* ── MBA standalone ─────────────────────────────────────────────── */}
          {pc === "MBA" && (
            <section className="space-y-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                Analyser (MBA) Component IDs
              </p>
              <ComponentField
                label="PCB ID"
                value={pcbId}
                onChange={setPcbId}
                placeholder="PCB-MBA-2604-XXXX"
                hint="Scanned from the PCB barcode label at PCB Rework & QC stage"
              />
              <ComponentField
                label="Flow Cell Sensor ID"
                value={sensorId}
                onChange={setSensorId}
                placeholder="SNS-MBA-2604-XXXX"
                hint="Sensor lot number from vendor COA"
              />
              <ComponentField
                label="Detector ID"
                value={detectorId}
                onChange={setDetectorId}
                placeholder="DET-MBA-2604-XXXX"
              />
            </section>
          )}

          {/* ── MBM standalone ─────────────────────────────────────────────── */}
          {pc === "MBM" && (
            <section className="space-y-3">
              <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
                Mobimix (MBM) Component IDs
              </p>
              <ComponentField
                label="Machine Body ID"
                value={machineId}
                onChange={setMachineId}
                placeholder="MCH-MBM-2604-XXXX"
                hint="Stamped on the mechanical frame (Motor & Scotch Assembly)"
              />
              <ComponentField
                label="PCB ID"
                value={pcbId}
                onChange={setPcbId}
                placeholder="PCB-MBM-2604-XXXX"
              />
            </section>
          )}

          {/* ── MBC standalone ─────────────────────────────────────────────── */}
          {pc === "MBC" && (
            <section className="space-y-3">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                Mobicube / Incubator (MBC) Component IDs
              </p>
              <ComponentField
                label="PCB ID"
                value={pcbId}
                onChange={setPcbId}
                placeholder="PCB-MBC-2604-XXXX"
              />
            </section>
          )}

          {/* ── CFG standalone ─────────────────────────────────────────────── */}
          {pc === "CFG" && (
            <section className="space-y-3">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">
                Centrifuge (CFG) — Vendor Details
              </p>
              <ComponentField
                label="Vendor ID / Lot Number"
                value={cfgVendorId}
                onChange={setCfgVendorId}
                placeholder="OMRON-CFG-YYYYMMDD-XXXX"
                hint="From vendor delivery note (Centrifuge Battery Pack stage)"
              />
              <ComponentField
                label="Vendor Serial Number"
                value={cfgSerialNo}
                onChange={setCfgSerialNo}
                placeholder="OMR-SN-YYYYMMDD-XXXX"
                hint="Nameplate serial number"
              />
            </section>
          )}

          {/* ── MCC final device — all sub-assembly IDs ─────────────────────── */}
          {pc === "MCC" && (
            <>
              <section className="space-y-3">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide border-b pb-1">
                  Analyzer (MBA) Assembly Inside MCC
                </p>
                <ComponentField label="Analyzer PCB ID" value={analyzerPcbId} onChange={setAnalyzerPcbId} placeholder="PCB-MBA-2603-XXXX" />
                <ComponentField label="Analyzer Sensor ID" value={analyzerSensorId} onChange={setAnalyzerSensorId} placeholder="SNS-MBA-2603-XXXX" />
                <ComponentField label="Analyzer Detector ID" value={analyzerDetectorId} onChange={setAnalyzerDetectorId} placeholder="DET-MBA-2603-XXXX" />
              </section>

              <section className="space-y-3">
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide border-b pb-1">
                  Mixer (MBM) Assembly Inside MCC
                </p>
                <ComponentField label="Mixer Machine ID" value={mixerMachineId} onChange={setMixerMachineId} placeholder="MCH-MBM-2603-XXXX" />
                <ComponentField label="Mixer PCB ID" value={mixerPcbId} onChange={setMixerPcbId} placeholder="PCB-MBM-2603-XXXX" />
              </section>

              <section className="space-y-3">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide border-b pb-1">
                  Incubator (MBC) Assembly Inside MCC
                </p>
                <ComponentField label="Incubator PCB ID" value={incubatorPcbId} onChange={setIncubatorPcbId} placeholder="PCB-MBC-2603-XXXX" />
              </section>

              <section className="space-y-3">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide border-b pb-1">
                  Centrifuge (Vendor-provided) Inside MCC
                </p>
                <ComponentField label="CFG Vendor ID" value={mccCfgVendorId} onChange={setMccCfgVendorId} placeholder="OMRON-CFG-YYYYMMDD-XXXX" />
                <ComponentField label="CFG Serial No" value={mccCfgSerialNo} onChange={setMccCfgSerialNo} placeholder="OMR-SN-YYYYMMDD-XXXX" />
              </section>
            </>
          )}

          {/* ── Accessories (all types) ─────────────────────────────────────── */}
          <section className="space-y-3">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide border-b pb-1">
              Unit Accessories
            </p>
            <ComponentField
              label="Micropipette ID"
              value={micropipetteId}
              onChange={setMicropipetteId}
              placeholder="MP-2026-XXXX"
              hint="Accessory bundled with the finished device"
            />
            {pc !== "CFG" && pc !== "MCC" && (
              <ComponentField
                label="Centrifuge ID"
                value={centrifugeId}
                onChange={setCentrifugeId}
                placeholder="CFG-2026-XXXX"
              />
            )}
          </section>

          <SheetFooter className="px-0 pb-0 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateIds.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateIds.isPending}>
              {updateIds.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
              ) : (
                "Save IDs"
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
