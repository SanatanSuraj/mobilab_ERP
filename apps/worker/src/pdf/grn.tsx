/**
 * Goods Receipt Note (GRN) PDF template — ARCHITECTURE.md §4.1.
 *
 * Rendered when a `grn` doc arrives on the pdf-render queue. A GRN is
 * the physical-receipt document: what the warehouse saw land against
 * which PO. It's the counterpart of the Delivery Challan on the
 * inbound side.
 *
 * Content map:
 *   grn_number           → header
 *   received_date        → meta
 *   vendor/vendor_address→ Vendor column
 *   warehouse_name       → Received-at column
 *   lines                → line table (Sr, Item, Qty, UOM, Unit cost,
 *                          Batch, Mfg, Expiry, QC status)
 *   vehicle_number +
 *    vendor invoice ref  → transport block
 *   posted_by/posted_at  → signature column
 */

import type { ReactElement } from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { docStyles as s } from "./_shared.js";

export interface GrnLineData {
  lineNo: number;
  itemCode: string;
  description: string | null;
  quantity: string;
  uom: string;
  unitCost: string;
  batchNo: string | null;
  mfgDate: string | null;
  expiryDate: string | null;
  qcStatus: string | null;
  qcRejectedQty: string;
}

export interface GrnPdfData {
  brandName: string;
  grnNumber: string;
  receivedDate: string;
  poNumber: string;
  status: string;
  vendorName: string | null;
  vendorGstin: string | null;
  vendorAddress: string | null;
  warehouseName: string;
  vehicleNumber: string | null;
  vendorInvoiceNumber: string | null;
  vendorInvoiceDate: string | null;
  lines: GrnLineData[];
  notes: string | null;
  receivedByName: string | null;
  postedByName: string | null;
  postedAt: string | null;
}

function onlyDate(iso: string): string {
  return iso.slice(0, 10);
}

function GrnDoc({ data }: { data: GrnPdfData }): ReactElement {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>{data.brandName}</Text>
            <Text style={s.docTitle}>Goods Receipt Note</Text>
          </View>
          <View>
            <Text style={s.docNumber}>{data.grnNumber}</Text>
            <Text style={s.docDate}>
              Received {onlyDate(data.receivedDate)}
            </Text>
            <Text style={s.docDate}>Against {data.poNumber}</Text>
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.partyCol}>
            <Text style={s.partyTitle}>Vendor</Text>
            <Text style={s.partyName}>{data.vendorName ?? "—"}</Text>
            {data.vendorGstin ? (
              <Text style={s.partyDetail}>GSTIN {data.vendorGstin}</Text>
            ) : null}
            {data.vendorAddress ? (
              <Text style={s.partyDetail}>{data.vendorAddress}</Text>
            ) : null}
          </View>
          <View style={s.partyCol}>
            <Text style={s.partyTitle}>Received at</Text>
            <Text style={s.partyName}>{data.warehouseName}</Text>
            {data.vehicleNumber ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Vehicle</Text>
                <Text style={s.metaValue}>{data.vehicleNumber}</Text>
              </View>
            ) : null}
            {data.vendorInvoiceNumber ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Vendor invoice</Text>
                <Text style={s.metaValue}>
                  {data.vendorInvoiceNumber}
                  {data.vendorInvoiceDate
                    ? ` (${onlyDate(data.vendorInvoiceDate)})`
                    : ""}
                </Text>
              </View>
            ) : null}
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Status</Text>
              <Text style={s.metaValue}>{data.status}</Text>
            </View>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.cellHdr, { width: "4%" }]}>#</Text>
            <Text style={[s.cellHdr, { width: "14%" }]}>Item</Text>
            <Text style={[s.cellHdr, { width: "22%" }]}>Description</Text>
            <Text style={[s.cellHdr, { width: "8%", textAlign: "right" }]}>
              Qty
            </Text>
            <Text style={[s.cellHdr, { width: "6%" }]}>UOM</Text>
            <Text style={[s.cellHdr, { width: "10%", textAlign: "right" }]}>
              Unit cost
            </Text>
            <Text style={[s.cellHdr, { width: "12%" }]}>Batch</Text>
            <Text style={[s.cellHdr, { width: "10%" }]}>Mfg</Text>
            <Text style={[s.cellHdr, { width: "10%" }]}>Expiry</Text>
            <Text style={[s.cellHdr, { width: "9%" }]}>QC</Text>
          </View>
          {data.lines.length === 0 ? (
            <View style={s.tableRow}>
              <Text style={s.emptyState}>No line items on this GRN.</Text>
            </View>
          ) : (
            data.lines.map((ln, idx) => (
              <View
                key={ln.lineNo}
                style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}
              >
                <Text style={[s.cellTxt, { width: "4%" }]}>{ln.lineNo}</Text>
                <Text style={[s.cellTxt, { width: "14%" }]}>
                  {ln.itemCode}
                </Text>
                <Text style={[s.cellTxt, { width: "22%" }]}>
                  {ln.description ?? "—"}
                </Text>
                <Text style={[s.cellNum, { width: "8%" }]}>{ln.quantity}</Text>
                <Text style={[s.cellTxt, { width: "6%" }]}>{ln.uom}</Text>
                <Text style={[s.cellNum, { width: "10%" }]}>
                  {ln.unitCost}
                </Text>
                <Text style={[s.cellTxt, { width: "12%" }]}>
                  {ln.batchNo ?? "—"}
                </Text>
                <Text style={[s.cellTxt, { width: "10%" }]}>
                  {ln.mfgDate ? onlyDate(ln.mfgDate) : "—"}
                </Text>
                <Text style={[s.cellTxt, { width: "10%" }]}>
                  {ln.expiryDate ? onlyDate(ln.expiryDate) : "—"}
                </Text>
                <Text style={[s.cellTxt, { width: "9%" }]}>
                  {ln.qcStatus ?? "PENDING"}
                </Text>
              </View>
            ))
          )}
        </View>

        {data.notes ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Notes</Text>
            <Text style={s.cellTxt}>{data.notes}</Text>
          </View>
        ) : null}

        <View style={s.signatureBlock}>
          <View style={s.signCol}>
            <Text style={s.signLabel}>Received by</Text>
            <Text style={s.signLine}>
              {data.receivedByName ?? "— pending —"}
            </Text>
          </View>
          <View style={s.signCol}>
            <Text style={s.signLabel}>Posted by</Text>
            <Text style={s.signLine}>
              {data.postedByName ?? "— unposted —"}
            </Text>
            {data.postedAt ? (
              <Text style={s.partyDetail}>at {data.postedAt}</Text>
            ) : null}
          </View>
        </View>

        <Text style={s.footer} fixed>
          {data.brandName} · {data.grnNumber} · Quantities above constitute
          receipt for inventory purposes. QC acceptance/rejection is recorded
          per line item.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderGrnPdf(data: GrnPdfData): Promise<Buffer> {
  return renderToBuffer(<GrnDoc data={data} />);
}
