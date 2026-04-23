/**
 * Shared @react-pdf/renderer styles for Phase 4.1 document PDFs.
 *
 * Sales Invoice, Purchase Order, Delivery Challan, and GRN all render
 * with the same visual language: plain-typeface header, key-value
 * metadata block, line-item table, totals block, signature strip.
 * Centralising the StyleSheet here means typography tweaks ripple
 * through every doc in one edit, not four.
 *
 * The QC Certificate template keeps its own styles — its layout is
 * serial-grid-first, which diverges enough from the tabular money docs
 * that a shared sheet would bloat both.
 *
 * Every style here is usage-compatible with @react-pdf/renderer's
 * constraints (no percentage heights, no calc, borderStyle: "solid" is
 * the default). Colors match the QC cert for brand consistency.
 */

import { StyleSheet } from "@react-pdf/renderer";

export const docStyles = StyleSheet.create({
  page: {
    padding: 42,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: "#111",
  },

  // Header block
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderColor: "#111",
  },
  brand: { fontSize: 14, fontWeight: 700 },
  docTitle: { fontSize: 20, fontWeight: 700, marginBottom: 2 },
  docNumber: { fontSize: 11, fontWeight: 600 },
  docDate: { fontSize: 9, color: "#555" },

  // Two-column parties block (e.g. Bill-to + Ship-to, or Vendor + Ship-to)
  parties: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  partyCol: { width: "48%" },
  partyTitle: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#555",
    marginBottom: 3,
  },
  partyName: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
  partyDetail: { fontSize: 9, color: "#333", marginBottom: 1 },

  // Key-value metadata
  metaRow: { flexDirection: "row", paddingVertical: 1 },
  metaLabel: { width: 110, color: "#666", fontSize: 9 },
  metaValue: { flexGrow: 1, fontWeight: 600, fontSize: 9 },

  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#333",
  },

  // Line-item table
  table: { borderWidth: 1, borderColor: "#111", marginTop: 6 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderColor: "#111",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#d1d5db",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#d1d5db",
    paddingVertical: 3,
    paddingHorizontal: 4,
    backgroundColor: "#fafafa",
  },
  cellHdr: { fontSize: 8.5, fontWeight: 700, color: "#111" },
  cellTxt: { fontSize: 8.5, color: "#111" },
  cellNum: { fontSize: 8.5, color: "#111", textAlign: "right" },

  // Totals block
  totalsBlock: {
    marginTop: 10,
    alignSelf: "flex-end",
    width: "42%",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  totalsRowGrand: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderColor: "#111",
    marginTop: 2,
    backgroundColor: "#f3f4f6",
  },
  totalsLabel: { fontSize: 9, color: "#333" },
  totalsValue: { fontSize: 9, fontWeight: 600 },
  totalsGrandLabel: { fontSize: 10, fontWeight: 700 },
  totalsGrandValue: { fontSize: 10, fontWeight: 700 },

  // Signature / footer
  signatureBlock: {
    marginTop: 28,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signCol: { width: "45%" },
  signLabel: {
    fontSize: 8,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  signLine: {
    marginTop: 30,
    borderTopWidth: 1,
    borderColor: "#111",
    paddingTop: 3,
    fontSize: 9,
  },
  hash: {
    fontFamily: "Courier",
    fontSize: 7,
    color: "#555",
    marginTop: 6,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 42,
    right: 42,
    textAlign: "center",
    color: "#999",
    fontSize: 7.5,
  },
  emptyState: { color: "#999", fontStyle: "italic", fontSize: 9 },
});

/**
 * Compact currency formatter — inputs are decimal strings per the
 * contract rule; we DON'T coerce via Number() because that loses
 * precision on amounts > 2^53. We render the string verbatim with
 * thousand-separators added via a regex pass on the integer portion.
 *
 * Examples:
 *   "123456.78" "INR" → "INR 1,23,456.78"
 *   "0"        "INR" → "INR 0.00"
 *   "1500"     "USD" → "USD 1,500.00"
 */
export function fmtMoney(amount: string, currency: string): string {
  const [intPart, fracPartRaw] = amount.split(".");
  const fracPart = (fracPartRaw ?? "").padEnd(2, "0").slice(0, 2);
  const intWithCommas = (intPart ?? "0").replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  return `${currency} ${intWithCommas}.${fracPart}`;
}
