/**
 * QC Certificate PDF template — ARCHITECTURE.md §4.1.
 *
 * One certificate page per (work_order, product, lot). Captures:
 *   - cert_number + issued_at (top-right block)
 *   - product + work order + lot header
 *   - device serials table (max 50 rows per page; we A4-chunk if more)
 *   - signature block with placeholder for signature_hash
 *
 * Rendering is via the same @react-pdf/renderer pipeline as the Phase-2
 * quotation PDF (see ../email/pdf/quotation.tsx) so the same
 * `renderToBuffer` discipline applies — the template function is
 * synchronous, the PDF bytes come back as a Buffer.
 *
 * No money, no locale-sensitive formatting — compliance documents stay
 * plain, large-typeface, audit-review-friendly.
 */

import type { ReactElement } from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: "#111",
  },
  brand: { fontSize: 14, fontWeight: 700 },
  docTitle: { fontSize: 22, fontWeight: 700, marginBottom: 2 },
  certNumber: { fontSize: 11, fontWeight: 600 },
  issuedAt: { fontSize: 9, color: "#555" },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#333",
  },
  kvRow: { flexDirection: "row", paddingVertical: 2 },
  kvLabel: { width: 130, color: "#666" },
  kvValue: { flexGrow: 1, fontWeight: 600 },
  serialGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: "#e5e7eb",
  },
  serialCell: {
    width: "33.333%",
    padding: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e5e7eb",
    fontSize: 9,
  },
  emptyState: { color: "#999", fontStyle: "italic" },
  signatureBlock: {
    marginTop: 36,
    padding: 12,
    borderWidth: 1,
    borderColor: "#111",
    backgroundColor: "#fafafa",
  },
  signatureRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  hash: {
    fontFamily: "Courier",
    fontSize: 8,
    color: "#222",
    marginTop: 4,
    wordBreak: "break-all",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    textAlign: "center",
    color: "#999",
    fontSize: 8,
  },
});

export interface QcCertificatePdfData {
  /** Top-of-page brand — defaults to "InstiGenie" in callers. */
  brandName: string;
  certNumber: string;
  /** ISO timestamp of issuance, rendered in UTC. */
  issuedAt: string;
  productName: string;
  /** Work-order pid ("WO-DEAL-…" etc). */
  workOrderPid: string;
  lotNumber: string | null;
  quantity: string;
  uom: string;
  /** Device serials — empty array renders "—". */
  deviceSerials: string[];
  /** Name of the QC signer. Null when cert is unsigned. */
  signedByName: string | null;
  /** Hex signature hash (or placeholder in Phase 4.1a). */
  signatureHash: string | null;
  /** Optional free-text notes from the QC team. */
  notes: string | null;
}

function QcCertificateDoc({
  data,
}: {
  data: QcCertificatePdfData;
}): ReactElement {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{data.brandName}</Text>
            <Text style={styles.docTitle}>Quality Certificate</Text>
          </View>
          <View>
            <Text style={styles.certNumber}>{data.certNumber}</Text>
            <Text style={styles.issuedAt}>Issued {data.issuedAt}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Product</Text>
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>Product name</Text>
            <Text style={styles.kvValue}>{data.productName}</Text>
          </View>
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>Work order</Text>
            <Text style={styles.kvValue}>{data.workOrderPid}</Text>
          </View>
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>Lot number</Text>
            <Text style={styles.kvValue}>{data.lotNumber ?? "—"}</Text>
          </View>
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>Quantity</Text>
            <Text style={styles.kvValue}>
              {data.quantity} {data.uom}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Device serials ({data.deviceSerials.length})
          </Text>
          {data.deviceSerials.length === 0 ? (
            <Text style={styles.emptyState}>
              No per-device serials recorded.
            </Text>
          ) : (
            <View style={styles.serialGrid}>
              {data.deviceSerials.map((sn) => (
                <Text key={sn} style={styles.serialCell}>
                  {sn}
                </Text>
              ))}
            </View>
          )}
        </View>

        {data.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <View style={styles.signatureBlock}>
          <Text style={styles.sectionTitle}>Quality sign-off</Text>
          <View style={styles.signatureRow}>
            <Text>Signed by</Text>
            <Text>{data.signedByName ?? "— unsigned —"}</Text>
          </View>
          <View style={styles.signatureRow}>
            <Text>Signed at</Text>
            <Text>{data.issuedAt}</Text>
          </View>
          <Text style={styles.hash}>
            signature_hash: {data.signatureHash ?? "(none — Phase 4.2)"}
          </Text>
        </View>

        <Text style={styles.footer} fixed>
          {data.brandName} · {data.certNumber} · QC-01
        </Text>
      </Page>
    </Document>
  );
}

export async function renderQcCertificatePdf(
  data: QcCertificatePdfData,
): Promise<Buffer> {
  return renderToBuffer(<QcCertificateDoc data={data} />);
}
