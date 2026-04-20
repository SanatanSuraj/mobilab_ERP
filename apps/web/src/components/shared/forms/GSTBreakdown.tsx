import React from "react";
import { cn } from "@/lib/utils";

export type GSTBreakdownProps = {
  subtotal: number;
  gstRate: number;
  supplyType: "INTRA" | "INTER";
  className?: string;
};

function formatCurrency(n: number): string {
  return "\u20B9" + n.toLocaleString("en-IN");
}

export function GSTBreakdown({
  subtotal,
  gstRate,
  supplyType,
  className,
}: GSTBreakdownProps) {
  const halfRate = gstRate / 2;

  const cgstAmount = supplyType === "INTRA" ? (subtotal * halfRate) / 100 : 0;
  const sgstAmount = supplyType === "INTRA" ? (subtotal * halfRate) / 100 : 0;
  const igstAmount = supplyType === "INTER" ? (subtotal * gstRate) / 100 : 0;

  const total = subtotal + cgstAmount + sgstAmount + igstAmount;

  return (
    <div className={cn("w-full text-sm", className)}>
      <table className="w-full">
        <tbody>
          <Row label="Subtotal" value={formatCurrency(subtotal)} />

          {supplyType === "INTRA" ? (
            <>
              <Row
                label={`CGST ${halfRate}%`}
                value={formatCurrency(cgstAmount)}
              />
              <Row
                label={`SGST ${halfRate}%`}
                value={formatCurrency(sgstAmount)}
              />
            </>
          ) : (
            <Row
              label={`IGST ${gstRate}%`}
              value={formatCurrency(igstAmount)}
            />
          )}

          {/* Divider */}
          <tr>
            <td colSpan={2} className="py-1">
              <hr className="border-border" />
            </td>
          </tr>

          <Row
            label="Total"
            value={formatCurrency(total)}
            bold
          />
        </tbody>
      </table>
    </div>
  );
}

function Row({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <tr className={bold ? "font-semibold text-foreground" : "text-muted-foreground"}>
      <td className="py-1 pr-4">{label}</td>
      <td className="py-1 text-right font-mono tabular-nums text-foreground">
        {value}
      </td>
    </tr>
  );
}
