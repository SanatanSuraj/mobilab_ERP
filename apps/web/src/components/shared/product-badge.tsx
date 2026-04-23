/**
 * ProductBadge — renders a Mobicase product code with an explicit
 * Device vs Module indicator (and, for modules, a sourcing indicator).
 *
 *   MCC               → Device   (indigo D-chip, indigo outer ring)
 *   MBA · MBM · MBC   → Module · In-house  (slate  M-chip, slate  outer ring)
 *   CFG                → Module · Vendor    (amber  V-chip, amber  outer ring)
 *
 * The product code itself keeps its existing colour (from `StatusBadge`)
 * so operators can still tell products apart at a glance. The prefix chip
 * makes the classification unambiguous:
 *     D = Device (finished unit, MCC only)
 *     M = Module manufactured in-house (MBA, MBM, MBC)
 *     V = Module vendor-sourced         (CFG — purchased ready-made)
 *
 * Use `<ProductBadgeList>` when you have an array of codes — it sorts
 * Device first, then in-house Modules, then vendor-sourced, so a mixed
 * WO always reads:
 *     [ D · MCC ] [ M · MBA ] [ M · MBM ] [ M · MBC ] [ V · CFG ]
 */

"use client";

import { StatusBadge } from "@/components/shared/status-badge";
import {
  isFinishedDeviceCode,
  isVendorSourcedCode,
  type MobicaseProduct,
} from "@/data/instigenie-mock";

type BadgeKind = "DEVICE" | "MODULE_INHOUSE" | "MODULE_VENDOR";

function classifyCode(code: MobicaseProduct): BadgeKind {
  if (isFinishedDeviceCode(code)) return "DEVICE";
  if (isVendorSourcedCode(code)) return "MODULE_VENDOR";
  return "MODULE_INHOUSE";
}

function KindChip({ kind }: { kind: BadgeKind }) {
  if (kind === "DEVICE") {
    return (
      <span
        title="Device (finished unit)"
        className="inline-flex items-center justify-center text-[9px] font-bold rounded-full px-1 py-0 leading-[14px] bg-indigo-600 text-white"
      >
        D
      </span>
    );
  }
  if (kind === "MODULE_VENDOR") {
    return (
      <span
        title="Module · Vendor-sourced (purchased ready-made)"
        className="inline-flex items-center justify-center text-[9px] font-bold rounded-full px-1 py-0 leading-[14px] bg-amber-500 text-white"
      >
        V
      </span>
    );
  }
  return (
    <span
      title="Module · In-house (manufactured on our lines)"
      className="inline-flex items-center justify-center text-[9px] font-bold rounded-full px-1 py-0 leading-[14px] bg-slate-500 text-white"
    >
      M
    </span>
  );
}

const RING_BY_KIND: Record<BadgeKind, string> = {
  DEVICE: "ring-indigo-300",
  MODULE_INHOUSE: "ring-slate-200",
  MODULE_VENDOR: "ring-amber-200",
};

export function ProductBadge({
  productCode,
  className = "",
}: {
  productCode: MobicaseProduct;
  className?: string;
}) {
  const kind = classifyCode(productCode);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full pl-0.5 pr-0 ring-1 ${RING_BY_KIND[kind]} ${className}`}
    >
      <KindChip kind={kind} />
      <StatusBadge status={productCode} />
    </span>
  );
}

const SORT_RANK: Record<BadgeKind, number> = {
  DEVICE: 0,
  MODULE_INHOUSE: 1,
  MODULE_VENDOR: 2,
};

export function ProductBadgeList({
  productCodes,
  className = "",
}: {
  productCodes: readonly MobicaseProduct[];
  className?: string;
}) {
  // Device first, then in-house Modules (MBA/MBM/MBC) alphabetically,
  // then Vendor-sourced Modules (CFG) last.
  const sorted = [...productCodes].sort((a, b) => {
    const ra = SORT_RANK[classifyCode(a)];
    const rb = SORT_RANK[classifyCode(b)];
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  return (
    <div className={`flex gap-1 flex-wrap items-center ${className}`}>
      {sorted.map((pc) => (
        <ProductBadge key={pc} productCode={pc} />
      ))}
    </div>
  );
}

/**
 * Compact text-only variant used inside dense summary lines, e.g.
 * `... Apollo Diagnostics · MCC + 3 modules`. Returns a short phrase
 * like "1 Device · 3 Modules" or just "3 Modules".
 */
export function summariseProductCodes(
  productCodes: readonly MobicaseProduct[]
): string {
  const devices = productCodes.filter(isFinishedDeviceCode).length;
  const modules = productCodes.length - devices;
  const parts: string[] = [];
  if (devices > 0) {
    parts.push(`${devices} Device${devices === 1 ? "" : "s"}`);
  }
  if (modules > 0) {
    parts.push(`${modules} Module${modules === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}
