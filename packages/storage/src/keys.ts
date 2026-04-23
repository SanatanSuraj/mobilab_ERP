/**
 * Centralised key conventions for the object store.
 *
 * Keeping every `pdf/...` path in one file means Phase 4.3 lifecycle
 * policies (e.g. "move pdf/qc-certs/* older than 90d to cold tier")
 * target one prefix that's guaranteed-stable across callers.
 *
 * Every builder is a pure string join over (orgId, entityId) so gate
 * tests can roundtrip an object key back to an entity id without
 * touching the database.
 */

/** PDF prefix for QC certificates. One object per (org, cert). */
export function buildQcCertKey(orgId: string, certId: string): string {
  return `pdf/qc-certs/${orgId}/${certId}.pdf`;
}

/** PDF prefix for Sales Invoices. One object per (org, invoice). */
export function buildSalesInvoiceKey(orgId: string, invoiceId: string): string {
  return `pdf/sales-invoices/${orgId}/${invoiceId}.pdf`;
}

/** PDF prefix for Purchase Orders. One object per (org, po). */
export function buildPurchaseOrderKey(orgId: string, poId: string): string {
  return `pdf/purchase-orders/${orgId}/${poId}.pdf`;
}

/**
 * PDF prefix for Delivery Challans. A DC is a shipment view of a sales
 * order, so the key is bound to the sales_order.id.
 */
export function buildDeliveryChallanKey(
  orgId: string,
  salesOrderId: string,
): string {
  return `pdf/delivery-challans/${orgId}/${salesOrderId}.pdf`;
}

/** PDF prefix for GRNs (Goods Receipt Notes). One object per (org, grn). */
export function buildGrnKey(orgId: string, grnId: string): string {
  return `pdf/grns/${orgId}/${grnId}.pdf`;
}
