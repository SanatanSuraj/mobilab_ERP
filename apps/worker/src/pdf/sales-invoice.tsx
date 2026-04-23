/**
 * Sales Invoice PDF template — ARCHITECTURE.md §4.1.
 *
 * Rendered by the pdf-render worker when a `sales_invoice` doc arrives
 * on the pdf-render queue. Same @react-pdf/renderer pipeline as
 * qc-certificate.tsx; shared styles live in ./_shared.ts.
 *
 * Content map (entity → PDF):
 *   invoice_number         →  header "INVOICE #"
 *   invoice_date/due_date  →  meta rows
 *   customer_*             →  Bill-to column
 *   lines                  →  line table (Sr, HSN, Description, Qty,
 *                             UOM, Unit, Disc %, Tax %, Total)
 *   subtotal/tax_total/
 *    discount_total/
 *    grand_total           →  totals block
 *   notes / terms          →  bottom sections
 *   posted_at/posted_by    →  signature column
 */

import type { ReactElement } from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { docStyles as s, fmtMoney } from "./_shared.js";

export interface SalesInvoiceLineData {
  sequenceNumber: number;
  description: string;
  hsnSac: string | null;
  quantity: string;
  uom: string | null;
  unitPrice: string;
  discountPercent: string;
  taxRatePercent: string;
  lineTotal: string;
}

export interface SalesInvoicePdfData {
  brandName: string;
  invoiceNumber: string;
  /** ISO date or ISO datetime; displayed as YYYY-MM-DD. */
  invoiceDate: string;
  dueDate: string | null;
  status: string;
  currency: string;
  customerName: string | null;
  customerGstin: string | null;
  customerAddress: string | null;
  placeOfSupply: string | null;
  workOrderPid: string | null;
  lines: SalesInvoiceLineData[];
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  grandTotal: string;
  amountPaid: string;
  notes: string | null;
  terms: string | null;
  postedByName: string | null;
  /** ISO timestamp; renders in UTC. */
  postedAt: string | null;
  /**
   * HMAC or SHA-256 fingerprint of the critical-action sign-off,
   * produced by Phase 4 §9.5 e-signature flow. Null if invoice is DRAFT.
   */
  signatureHash: string | null;
}

function onlyDate(iso: string): string {
  // tolerates "2026-04-22" and "2026-04-22T10:00:00Z"
  return iso.slice(0, 10);
}

function SalesInvoiceDoc({ data }: { data: SalesInvoicePdfData }): ReactElement {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>{data.brandName}</Text>
            <Text style={s.docTitle}>Tax Invoice</Text>
          </View>
          <View>
            <Text style={s.docNumber}>{data.invoiceNumber}</Text>
            <Text style={s.docDate}>Issued {onlyDate(data.invoiceDate)}</Text>
            {data.dueDate ? (
              <Text style={s.docDate}>Due {onlyDate(data.dueDate)}</Text>
            ) : null}
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.partyCol}>
            <Text style={s.partyTitle}>Bill to</Text>
            <Text style={s.partyName}>{data.customerName ?? "—"}</Text>
            {data.customerGstin ? (
              <Text style={s.partyDetail}>GSTIN {data.customerGstin}</Text>
            ) : null}
            {data.customerAddress ? (
              <Text style={s.partyDetail}>{data.customerAddress}</Text>
            ) : null}
            {data.placeOfSupply ? (
              <Text style={s.partyDetail}>
                Place of supply: {data.placeOfSupply}
              </Text>
            ) : null}
          </View>
          <View style={s.partyCol}>
            <Text style={s.partyTitle}>Invoice meta</Text>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Status</Text>
              <Text style={s.metaValue}>{data.status}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Currency</Text>
              <Text style={s.metaValue}>{data.currency}</Text>
            </View>
            {data.workOrderPid ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Work order</Text>
                <Text style={s.metaValue}>{data.workOrderPid}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.cellHdr, { width: "5%" }]}>#</Text>
            <Text style={[s.cellHdr, { width: "10%" }]}>HSN</Text>
            <Text style={[s.cellHdr, { width: "35%" }]}>Description</Text>
            <Text style={[s.cellHdr, { width: "8%", textAlign: "right" }]}>
              Qty
            </Text>
            <Text style={[s.cellHdr, { width: "7%" }]}>UOM</Text>
            <Text style={[s.cellHdr, { width: "12%", textAlign: "right" }]}>
              Unit
            </Text>
            <Text style={[s.cellHdr, { width: "8%", textAlign: "right" }]}>
              Disc%
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
                key={ln.sequenceNumber}
                style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}
              >
                <Text style={[s.cellTxt, { width: "5%" }]}>
                  {ln.sequenceNumber}
                </Text>
                <Text style={[s.cellTxt, { width: "10%" }]}>
                  {ln.hsnSac ?? "—"}
                </Text>
                <Text style={[s.cellTxt, { width: "35%" }]}>
                  {ln.description}
                </Text>
                <Text style={[s.cellNum, { width: "8%" }]}>{ln.quantity}</Text>
                <Text style={[s.cellTxt, { width: "7%" }]}>
                  {ln.uom ?? "—"}
                </Text>
                <Text style={[s.cellNum, { width: "12%" }]}>
                  {ln.unitPrice}
                </Text>
                <Text style={[s.cellNum, { width: "8%" }]}>
                  {ln.discountPercent}
                </Text>
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
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>Paid</Text>
            <Text style={s.totalsValue}>
              {fmtMoney(data.amountPaid, data.currency)}
            </Text>
          </View>
        </View>

        {data.notes ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Notes</Text>
            <Text style={s.cellTxt}>{data.notes}</Text>
          </View>
        ) : null}

        {data.terms ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Terms</Text>
            <Text style={s.cellTxt}>{data.terms}</Text>
          </View>
        ) : null}

        <View style={s.signatureBlock}>
          <View style={s.signCol}>
            <Text style={s.signLabel}>Issued under</Text>
            <Text style={s.signLine}>{data.postedByName ?? "— draft —"}</Text>
            {data.postedAt ? (
              <Text style={s.partyDetail}>at {data.postedAt}</Text>
            ) : null}
            {data.signatureHash ? (
              <Text style={s.hash}>sig: {data.signatureHash}</Text>
            ) : null}
          </View>
          <View style={s.signCol}>
            <Text style={s.signLabel}>Customer acknowledgement</Text>
            <Text style={s.signLine}>Received & accepted</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {data.brandName} · {data.invoiceNumber} · This is a computer-generated
          invoice. Electronic signature under 21 CFR Part 11 is legally binding.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderSalesInvoicePdf(
  data: SalesInvoicePdfData,
): Promise<Buffer> {
  return renderToBuffer(<SalesInvoiceDoc data={data} />);
}
