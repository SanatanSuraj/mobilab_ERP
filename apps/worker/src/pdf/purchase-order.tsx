/**
 * Purchase Order PDF template — ARCHITECTURE.md §4.1.
 *
 * Rendered by the pdf-render worker when a `purchase_order` doc arrives
 * on the pdf-render queue. Same pipeline as sales-invoice.tsx with
 * vendor-facing content.
 *
 * Content map (entity → PDF):
 *   po_number                  → header "PO #"
 *   order_date/expected_date   → meta rows
 *   vendor_*                   → Vendor column
 *   shipping_address/
 *    delivery warehouse         → Ship-to column
 *   lines                      → line table (Sr, Item, Description, Qty,
 *                                UOM, Unit, Tax %, Total)
 *   subtotal/tax/discount/
 *    grand_total                → totals block
 *   payment_terms_days         → meta + footer note
 *   approved_by/approved_at    → signature column
 */

import type { ReactElement } from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { docStyles as s, fmtMoney } from "./_shared.js";

export interface PurchaseOrderLineData {
  lineNo: number;
  itemCode: string;
  description: string | null;
  quantity: string;
  uom: string;
  unitPrice: string;
  discountPct: string;
  taxPct: string;
  lineTotal: string;
}

export interface PurchaseOrderPdfData {
  brandName: string;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  status: string;
  currency: string;
  vendorName: string | null;
  vendorGstin: string | null;
  vendorAddress: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  deliveryWarehouseName: string | null;
  paymentTermsDays: number;
  lines: PurchaseOrderLineData[];
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  grandTotal: string;
  notes: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
}

function onlyDate(iso: string): string {
  return iso.slice(0, 10);
}

function PurchaseOrderDoc({
  data,
}: {
  data: PurchaseOrderPdfData;
}): ReactElement {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>{data.brandName}</Text>
            <Text style={s.docTitle}>Purchase Order</Text>
          </View>
          <View>
            <Text style={s.docNumber}>{data.poNumber}</Text>
            <Text style={s.docDate}>Ordered {onlyDate(data.orderDate)}</Text>
            {data.expectedDate ? (
              <Text style={s.docDate}>
                Expected {onlyDate(data.expectedDate)}
              </Text>
            ) : null}
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
            <Text style={s.partyTitle}>Ship to</Text>
            {data.deliveryWarehouseName ? (
              <Text style={s.partyName}>{data.deliveryWarehouseName}</Text>
            ) : (
              <Text style={s.partyName}>{data.brandName}</Text>
            )}
            {data.shippingAddress ? (
              <Text style={s.partyDetail}>{data.shippingAddress}</Text>
            ) : null}
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Status</Text>
              <Text style={s.metaValue}>{data.status}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Payment</Text>
              <Text style={s.metaValue}>
                Net {data.paymentTermsDays} days
              </Text>
            </View>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.cellHdr, { width: "5%" }]}>#</Text>
            <Text style={[s.cellHdr, { width: "15%" }]}>Item</Text>
            <Text style={[s.cellHdr, { width: "30%" }]}>Description</Text>
            <Text style={[s.cellHdr, { width: "9%", textAlign: "right" }]}>
              Qty
            </Text>
            <Text style={[s.cellHdr, { width: "7%" }]}>UOM</Text>
            <Text style={[s.cellHdr, { width: "12%", textAlign: "right" }]}>
              Unit
            </Text>
            <Text style={[s.cellHdr, { width: "7%", textAlign: "right" }]}>
              Tax%
            </Text>
            <Text style={[s.cellHdr, { width: "15%", textAlign: "right" }]}>
              Total
            </Text>
          </View>
          {data.lines.length === 0 ? (
            <View style={s.tableRow}>
              <Text style={s.emptyState}>No line items.</Text>
            </View>
          ) : (
            data.lines.map((ln, idx) => (
              <View
                key={ln.lineNo}
                style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}
              >
                <Text style={[s.cellTxt, { width: "5%" }]}>{ln.lineNo}</Text>
                <Text style={[s.cellTxt, { width: "15%" }]}>
                  {ln.itemCode}
                </Text>
                <Text style={[s.cellTxt, { width: "30%" }]}>
                  {ln.description ?? "—"}
                </Text>
                <Text style={[s.cellNum, { width: "9%" }]}>{ln.quantity}</Text>
                <Text style={[s.cellTxt, { width: "7%" }]}>{ln.uom}</Text>
                <Text style={[s.cellNum, { width: "12%" }]}>
                  {ln.unitPrice}
                </Text>
                <Text style={[s.cellNum, { width: "7%" }]}>{ln.taxPct}</Text>
                <Text style={[s.cellNum, { width: "15%" }]}>
                  {ln.lineTotal}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={s.totalsBlock}>
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>Subtotal</Text>
            <Text style={s.totalsValue}>
              {fmtMoney(data.subtotal, data.currency)}
            </Text>
          </View>
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>Discount</Text>
            <Text style={s.totalsValue}>
              {fmtMoney(data.discountTotal, data.currency)}
            </Text>
          </View>
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>Tax</Text>
            <Text style={s.totalsValue}>
              {fmtMoney(data.taxTotal, data.currency)}
            </Text>
          </View>
          <View style={s.totalsRowGrand}>
            <Text style={s.totalsGrandLabel}>Grand Total</Text>
            <Text style={s.totalsGrandValue}>
              {fmtMoney(data.grandTotal, data.currency)}
            </Text>
          </View>
        </View>

        {data.notes ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Notes</Text>
            <Text style={s.cellTxt}>{data.notes}</Text>
          </View>
        ) : null}

        <View style={s.signatureBlock}>
          <View style={s.signCol}>
            <Text style={s.signLabel}>Approved by</Text>
            <Text style={s.signLine}>
              {data.approvedByName ?? "— pending —"}
            </Text>
            {data.approvedAt ? (
              <Text style={s.partyDetail}>at {data.approvedAt}</Text>
            ) : null}
          </View>
          <View style={s.signCol}>
            <Text style={s.signLabel}>Vendor acknowledgement</Text>
            <Text style={s.signLine}>Received & confirmed</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {data.brandName} · {data.poNumber} · Goods/services must match the
          quantities and specifications above. Deviations require written
          change-order approval.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderPurchaseOrderPdf(
  data: PurchaseOrderPdfData,
): Promise<Buffer> {
  return renderToBuffer(<PurchaseOrderDoc data={data} />);
}
