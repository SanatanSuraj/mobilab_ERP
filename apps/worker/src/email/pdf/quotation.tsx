/**
 * Quotation PDF template, rendered server-side via @react-pdf/renderer.
 *
 * Intentionally plain: one page, a header, a line-item table, and a totals
 * block. Money arrives as decimal strings (contract rule #1) and is rendered
 * verbatim — no Number() coercion.
 *
 * Exported as a data function `renderQuotationPdf(data)` that returns a
 * Buffer, so callers never touch React/renderer types.
 */

import { type ReactElement } from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  brand: { fontSize: 16, fontWeight: 700 },
  docTitle: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  metaRow: { flexDirection: "row", gap: 16, marginBottom: 16 },
  metaBlock: { flexGrow: 1 },
  metaLabel: { color: "#666", fontSize: 9, marginBottom: 2 },
  metaValue: { fontSize: 11, fontWeight: 600 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e5e7eb",
    marginTop: 16,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderColor: "#e5e7eb",
  },
  col: { flexGrow: 1, flexBasis: 0 },
  colRight: { flexGrow: 1, flexBasis: 0, textAlign: "right" },
  totals: {
    marginTop: 16,
    marginLeft: "auto",
    width: 220,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderColor: "#111",
    paddingTop: 6,
    marginTop: 4,
    fontWeight: 700,
  },
  notes: { marginTop: 32, color: "#333" },
  notesTitle: { fontWeight: 700, marginBottom: 4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: "center",
    color: "#999",
    fontSize: 8,
  },
});

export interface QuotationPdfLineItem {
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  discountPct: string;
  taxPct: string;
  lineTotal: string;
}

export interface QuotationPdfData {
  quotationNumber: string;
  company: string;
  contactName: string;
  validUntil: string | null;
  notes: string | null;
  subtotal: string;
  taxAmount: string;
  grandTotal: string;
  lineItems: QuotationPdfLineItem[];
  brandName: string;
}

function formatMoney(s: string): string {
  return `₹ ${s}`;
}

function QuotationDoc({ data }: { data: QuotationPdfData }): ReactElement {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <Text style={styles.brand}>{data.brandName}</Text>
          <View>
            <Text style={styles.docTitle}>Quotation</Text>
            <Text>{data.quotationNumber}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Billed to</Text>
            <Text style={styles.metaValue}>{data.company}</Text>
            <Text>{data.contactName}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Valid until</Text>
            <Text style={styles.metaValue}>
              {data.validUntil ?? "—"}
            </Text>
          </View>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.col}>Product</Text>
          <Text style={styles.colRight}>Qty</Text>
          <Text style={styles.colRight}>Unit price</Text>
          <Text style={styles.colRight}>Disc %</Text>
          <Text style={styles.colRight}>Tax %</Text>
          <Text style={styles.colRight}>Line total</Text>
        </View>
        {data.lineItems.map((li, idx) => (
          <View style={styles.tableRow} key={idx}>
            <View style={styles.col}>
              <Text>{li.productName}</Text>
              <Text style={{ color: "#666", fontSize: 8 }}>
                {li.productCode}
              </Text>
            </View>
            <Text style={styles.colRight}>{li.quantity}</Text>
            <Text style={styles.colRight}>{formatMoney(li.unitPrice)}</Text>
            <Text style={styles.colRight}>{li.discountPct}</Text>
            <Text style={styles.colRight}>{li.taxPct}</Text>
            <Text style={styles.colRight}>{formatMoney(li.lineTotal)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text>Subtotal</Text>
            <Text>{formatMoney(data.subtotal)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>Tax</Text>
            <Text>{formatMoney(data.taxAmount)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text>Grand total</Text>
            <Text>{formatMoney(data.grandTotal)}</Text>
          </View>
        </View>

        {data.notes ? (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Generated by {data.brandName} · {data.quotationNumber}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderQuotationPdf(
  data: QuotationPdfData,
): Promise<Buffer> {
  return renderToBuffer(<QuotationDoc data={data} />);
}
