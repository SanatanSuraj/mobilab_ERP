/**
 * Delivery Challan PDF template — ARCHITECTURE.md §4.1.
 *
 * A Delivery Challan is the shipment document that rides with goods
 * when they leave the warehouse. In this codebase a DC is a view onto
 * the sales_order at DISPATCHED/IN_TRANSIT/DELIVERED status — it lists
 * what's being physically moved and to whom, but NOT money (money
 * lives on the sales_invoice).
 *
 * So we bind the DC PDF to `sales_orders.id` and deliberately OMIT the
 * money columns from the line table. The customer + ship-to parties
 * come from the sales order's account/contact link plus the order's
 * notes field if ops has recorded a ship-to override.
 *
 * Keyed as pdf/delivery-challans/<org>/<sales_order_id>.pdf.
 */

import type { ReactElement } from "react";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { docStyles as s } from "./_shared.js";

export interface DeliveryChallanLineData {
  lineNo: number;
  productCode: string;
  productName: string;
  quantity: number;
  /** Sr / batch / serial bundle if the item is serialised. */
  serials: string[];
}

export interface DeliveryChallanPdfData {
  brandName: string;
  /** DC references the SO number directly — no separate DC numbering scheme. */
  orderNumber: string;
  dispatchDate: string;
  expectedDeliveryDate: string | null;
  status: string;
  customerCompany: string;
  customerContactName: string;
  customerAddress: string | null;
  vehicleNumber: string | null;
  transporter: string | null;
  lines: DeliveryChallanLineData[];
  notes: string | null;
  dispatchedByName: string | null;
  dispatchedAt: string | null;
}

function onlyDate(iso: string): string {
  return iso.slice(0, 10);
}

function DeliveryChallanDoc({
  data,
}: {
  data: DeliveryChallanPdfData;
}): ReactElement {
  const totalUnits = data.lines.reduce((sum, ln) => sum + ln.quantity, 0);
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>{data.brandName}</Text>
            <Text style={s.docTitle}>Delivery Challan</Text>
          </View>
          <View>
            <Text style={s.docNumber}>{data.orderNumber}</Text>
            <Text style={s.docDate}>
              Dispatched {onlyDate(data.dispatchDate)}
            </Text>
            {data.expectedDeliveryDate ? (
              <Text style={s.docDate}>
                ETA {onlyDate(data.expectedDeliveryDate)}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.partyCol}>
            <Text style={s.partyTitle}>Deliver to</Text>
            <Text style={s.partyName}>{data.customerCompany}</Text>
            <Text style={s.partyDetail}>
              Attn: {data.customerContactName}
            </Text>
            {data.customerAddress ? (
              <Text style={s.partyDetail}>{data.customerAddress}</Text>
            ) : null}
          </View>
          <View style={s.partyCol}>
            <Text style={s.partyTitle}>Transport</Text>
            {data.transporter ? (
              <Text style={s.partyName}>{data.transporter}</Text>
            ) : (
              <Text style={s.emptyState}>— own fleet —</Text>
            )}
            {data.vehicleNumber ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Vehicle</Text>
                <Text style={s.metaValue}>{data.vehicleNumber}</Text>
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
            <Text style={[s.cellHdr, { width: "5%" }]}>#</Text>
            <Text style={[s.cellHdr, { width: "18%" }]}>Product</Text>
            <Text style={[s.cellHdr, { width: "37%" }]}>Description</Text>
            <Text style={[s.cellHdr, { width: "10%", textAlign: "right" }]}>
              Qty
            </Text>
            <Text style={[s.cellHdr, { width: "30%" }]}>Serials / batch</Text>
          </View>
          {data.lines.length === 0 ? (
            <View style={s.tableRow}>
              <Text style={s.emptyState}>No line items on this challan.</Text>
            </View>
          ) : (
            data.lines.map((ln, idx) => (
              <View
                key={ln.lineNo}
                style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}
              >
                <Text style={[s.cellTxt, { width: "5%" }]}>{ln.lineNo}</Text>
                <Text style={[s.cellTxt, { width: "18%" }]}>
                  {ln.productCode}
                </Text>
                <Text style={[s.cellTxt, { width: "37%" }]}>
                  {ln.productName}
                </Text>
                <Text style={[s.cellNum, { width: "10%" }]}>{ln.quantity}</Text>
                <Text style={[s.cellTxt, { width: "30%" }]}>
                  {ln.serials.length === 0
                    ? "—"
                    : ln.serials.slice(0, 4).join(", ") +
                      (ln.serials.length > 4
                        ? ` (+${ln.serials.length - 4})`
                        : "")}
                </Text>
              </View>
            ))
          )}
        </View>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "flex-end",
            marginTop: 8,
          }}
        >
          <Text style={s.totalsLabel}>Total units shipped: </Text>
          <Text style={s.totalsGrandValue}> {totalUnits}</Text>
        </View>

        {data.notes ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Notes</Text>
            <Text style={s.cellTxt}>{data.notes}</Text>
          </View>
        ) : null}

        <View style={s.signatureBlock}>
          <View style={s.signCol}>
            <Text style={s.signLabel}>Dispatched by</Text>
            <Text style={s.signLine}>
              {data.dispatchedByName ?? "— pending —"}
            </Text>
            {data.dispatchedAt ? (
              <Text style={s.partyDetail}>at {data.dispatchedAt}</Text>
            ) : null}
          </View>
          <View style={s.signCol}>
            <Text style={s.signLabel}>Received by (customer)</Text>
            <Text style={s.signLine}>Name, signature, date</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {data.brandName} · DC for {data.orderNumber} · Not a tax invoice. Tax
          invoice is issued separately.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderDeliveryChallanPdf(
  data: DeliveryChallanPdfData,
): Promise<Buffer> {
  return renderToBuffer(<DeliveryChallanDoc data={data} />);
}
