/**
 * pdf-render processor — ARCHITECTURE.md §4.1.
 *
 * Pulls a job describing a target entity (currently only QC certs; the
 * other 4 document types follow the same shape), materialises the right
 * PDF into a Buffer, streams it to MinIO/S3, and records the resulting
 * object key on the entity row.
 *
 * Contract:
 *   Job payload  = { docType: "qc_cert", docId: <uuid>, orgId: <uuid> }
 *   Backoff      = 3 attempts, 60s between (spec §4.1).
 *   On success   → pdf_render_runs.status = COMPLETED,
 *                  qc_certs.pdf_minio_key = <S3 key>.
 *   On attempt-exhaustion → the BullMQ Worker's "failed" event writes
 *                           a row into pdf_render_dlq; see index.ts.
 *
 * Idempotency:
 *   INSERT ON CONFLICT DO NOTHING the claim row in pdf_render_runs
 *   keyed on (doc_type, doc_id). If the existing row is already
 *   COMPLETED we short-circuit with `status: "ALREADY_COMPLETED"`.
 *   If the existing row is FAILED we update it to RENDERING and retry
 *   (this is the ops "re-drive" path for post-DLQ manual fixes).
 */

import type { Processor } from "bullmq";
import type pg from "pg";
import type { Logger } from "@instigenie/observability";
import { jobsProcessedTotal } from "@instigenie/observability";
import { withOrg } from "@instigenie/db";
import {
  buildQcCertKey,
  buildSalesInvoiceKey,
  buildPurchaseOrderKey,
  buildDeliveryChallanKey,
  buildGrnKey,
  type ObjectStorage,
} from "@instigenie/storage";
import { renderQcCertificatePdf } from "../pdf/qc-certificate.js";
import {
  renderSalesInvoicePdf,
  type SalesInvoiceLineData,
} from "../pdf/sales-invoice.js";
import {
  renderPurchaseOrderPdf,
  type PurchaseOrderLineData,
} from "../pdf/purchase-order.js";
import {
  renderDeliveryChallanPdf,
  type DeliveryChallanLineData,
} from "../pdf/delivery-challan.js";
import { renderGrnPdf, type GrnLineData } from "../pdf/grn.js";

export type PdfDocType =
  | "qc_cert"
  | "purchase_order"
  | "sales_invoice"
  | "delivery_challan"
  | "grn";

export interface PdfRenderJob {
  docType: PdfDocType;
  docId: string;
  orgId: string;
}

export interface PdfRenderDeps {
  pool: pg.Pool;
  log: Logger;
  storage: ObjectStorage;
  /** S3/MinIO bucket for generated PDFs. Default "instigenie-pdfs". */
  bucket?: string;
  /** Brand name on the PDF header. Default "InstiGenie". */
  brandName?: string;
}

export const PDF_BUCKET_DEFAULT = "instigenie-pdfs";

export interface WritePdfRenderDlqInput {
  orgId: string;
  docType: PdfDocType;
  docId: string;
  payload: PdfRenderJob;
  /** attemptsMade at the moment of terminal failure. */
  attempts: number;
  lastError: string;
}

/**
 * Park a terminally-failed pdf-render job into `pdf_render_dlq` for ops
 * triage. Extracted from the BullMQ `.on("failed")` listener in
 * `apps/worker/src/index.ts` so gate tests can drive the DLQ path
 * without spinning up Redis + a real Worker.
 *
 * Idempotent by hand: the DLQ has no unique constraint on
 * (doc_type, doc_id) — one failure could conceivably recur after a
 * manual re-drive — so callers are expected to only invoke this on
 * attemptsMade >= maxAttempts, and duplicate DLQ rows represent
 * genuinely separate exhaustion events.
 */
export async function writePdfRenderDlq(
  pool: pg.Pool,
  input: WritePdfRenderDlqInput,
): Promise<void> {
  await withOrg(pool, input.orgId, async (client) => {
    await client.query(
      `INSERT INTO pdf_render_dlq
         (org_id, doc_type, doc_id, payload, attempts, last_error)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        input.orgId,
        input.docType,
        input.docId,
        JSON.stringify(input.payload),
        input.attempts,
        input.lastError,
      ],
    );
  });
}

interface QcCertFixtureRow {
  id: string;
  cert_number: string;
  product_name: string | null;
  wo_pid: string | null;
  device_serials: string[];
  signed_by_name: string | null;
  signature_hash: string | null;
  notes: string | null;
  issued_at: Date;
  lot_number: string | null;
  quantity: string | null;
  uom: string | null;
}

export function createPdfRenderProcessor(
  deps: PdfRenderDeps,
): Processor<PdfRenderJob, { status: string; objectKey?: string }> {
  const bucket = deps.bucket ?? PDF_BUCKET_DEFAULT;
  const brandName = deps.brandName ?? "InstiGenie";

  return async (job) => {
    const { docType, docId, orgId } = job.data;
    deps.log.info(
      { docType, docId, orgId, attempt: job.attemptsMade + 1 },
      "pdf-render: job accepted",
    );

    // Claim the slot. `RENDERING` is the initial state; we flip to
    // COMPLETED or FAILED at the end.
    const claim = await withOrg(deps.pool, orgId, async (client) => {
      const {
        rows: [existing],
      } = await client.query<{ status: string; object_key: string | null }>(
        `INSERT INTO pdf_render_runs
           (doc_type, doc_id, org_id, status, attempts)
         VALUES ($1, $2, $3, 'RENDERING', 1)
         ON CONFLICT (doc_type, doc_id)
           DO UPDATE SET
             status = CASE
               WHEN pdf_render_runs.status = 'COMPLETED' THEN 'COMPLETED'
               ELSE 'RENDERING'
             END,
             attempts = pdf_render_runs.attempts + 1,
             started_at = CASE
               WHEN pdf_render_runs.status = 'COMPLETED' THEN pdf_render_runs.started_at
               ELSE now()
             END
         RETURNING status, object_key`,
        [docType, docId, orgId],
      );
      return existing ?? { status: "RENDERING", object_key: null };
    });

    if (claim.status === "COMPLETED") {
      deps.log.info(
        { docType, docId, objectKey: claim.object_key },
        "pdf-render: already completed — short-circuit",
      );
      jobsProcessedTotal.inc({ queue: "pdf-render", status: "completed" });
      return {
        status: "ALREADY_COMPLETED",
        ...(claim.object_key ? { objectKey: claim.object_key } : {}),
      };
    }

    let pdfBytes: Buffer;
    let objectKey: string;
    try {
      const assemblerInput: AssembleInput = {
        pool: deps.pool,
        orgId,
        docId,
        brandName,
      };
      switch (docType) {
        case "qc_cert":
          ({ pdfBytes, objectKey } = await renderQcCert(assemblerInput));
          break;
        case "sales_invoice":
          ({ pdfBytes, objectKey } = await renderSalesInvoice(assemblerInput));
          break;
        case "purchase_order":
          ({ pdfBytes, objectKey } = await renderPurchaseOrder(assemblerInput));
          break;
        case "delivery_challan":
          ({ pdfBytes, objectKey } = await renderDeliveryChallan(
            assemblerInput,
          ));
          break;
        case "grn":
          ({ pdfBytes, objectKey } = await renderGrn(assemblerInput));
          break;
        default: {
          // Exhaustiveness check at the type level; also surfaces at runtime
          // if a new doc type is added to PdfDocType without a case here.
          const _exhaustive: never = docType;
          throw new Error(
            `pdf-render: unknown docType '${_exhaustive as string}'`,
          );
        }
      }

      await deps.storage.ensureBucket(bucket);
      const { etag } = await deps.storage.putObject({
        bucket,
        key: objectKey,
        body: pdfBytes,
        contentType: "application/pdf",
        metadata: { docType, docId, orgId },
      });

      await withOrg(deps.pool, orgId, async (client) => {
        await client.query(
          `UPDATE pdf_render_runs
             SET status = 'COMPLETED',
                 object_key = $3,
                 object_etag = $4,
                 byte_size = $5,
                 completed_at = now(),
                 last_error = NULL
           WHERE doc_type = $1 AND doc_id = $2`,
          [docType, docId, objectKey, etag, pdfBytes.length],
        );
        // Stamp the generated PDF key back onto the owning entity so API
        // reads and UI downloads don't have to join through pdf_render_runs.
        switch (docType) {
          case "qc_cert":
            await client.query(
              `UPDATE qc_certs SET pdf_minio_key = $2, updated_at = now()
               WHERE id = $1`,
              [docId, objectKey],
            );
            break;
          case "sales_invoice":
            await client.query(
              `UPDATE sales_invoices SET pdf_minio_key = $2, updated_at = now()
               WHERE id = $1`,
              [docId, objectKey],
            );
            break;
          case "purchase_order":
            await client.query(
              `UPDATE purchase_orders SET pdf_minio_key = $2, updated_at = now()
               WHERE id = $1`,
              [docId, objectKey],
            );
            break;
          case "delivery_challan":
            // DC is keyed on sales_orders.id — a DC is a view on the SO at
            // DISPATCHED+ status, not a separate entity.
            await client.query(
              `UPDATE sales_orders SET pdf_minio_key = $2, updated_at = now()
               WHERE id = $1`,
              [docId, objectKey],
            );
            break;
          case "grn":
            await client.query(
              `UPDATE grns SET pdf_minio_key = $2, updated_at = now()
               WHERE id = $1`,
              [docId, objectKey],
            );
            break;
        }
      });

      deps.log.info(
        {
          docType,
          docId,
          objectKey,
          bucket,
          byteSize: pdfBytes.length,
          etag,
        },
        "pdf-render: succeeded",
      );
      jobsProcessedTotal.inc({ queue: "pdf-render", status: "completed" });
      return { status: "COMPLETED", objectKey };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await withOrg(deps.pool, orgId, async (client) => {
        await client.query(
          `UPDATE pdf_render_runs
             SET status = 'FAILED', last_error = $3
           WHERE doc_type = $1 AND doc_id = $2`,
          [docType, docId, error.message],
        );
      });
      deps.log.error(
        { err: error, docType, docId, attempt: job.attemptsMade + 1 },
        "pdf-render: failed",
      );
      jobsProcessedTotal.inc({ queue: "pdf-render", status: "failed" });
      // Throw so BullMQ honors the retry/backoff config on the job.
      throw error;
    }
  };
}

// ─── Per-doc-type assemblers ─────────────────────────────────────────────
//
// Every assembler:
//   1. Reads the header + lines (and any party/brand joins) inside withOrg
//      so RLS binds the tenant.
//   2. Shapes the query result into the template's PdfData interface.
//   3. Calls the template's renderFooPdf() → Buffer.
//   4. Returns { pdfBytes, objectKey } where objectKey is the S3/MinIO path
//      produced by the matching buildFooKey helper in @instigenie/storage.
//
// Design note: these functions are intentionally verbose + copy-shaped.
// Finance/procurement PDFs each have their own columns, join paths, and
// "missing party" fallback rules, so abstracting them behind a generic
// "fetch header + lines" helper has historically produced more bugs than
// lines of code saved. Keep each assembler self-contained.

interface AssembleInput {
  pool: pg.Pool;
  orgId: string;
  /** Doc id (e.g. qc_certs.id, sales_invoices.id, grns.id, …). */
  docId: string;
  brandName: string;
}

async function renderQcCert(
  input: AssembleInput,
): Promise<{ pdfBytes: Buffer; objectKey: string }> {
  const row = await withOrg(input.pool, input.orgId, async (client) => {
    const {
      rows: [cert],
    } = await client.query<QcCertFixtureRow>(
      `SELECT c.id, c.cert_number, c.product_name, c.wo_pid, c.device_serials,
              c.signed_by_name, c.signature_hash, c.notes, c.issued_at,
              w.lot_number, w.quantity::text AS quantity,
              p.uom
       FROM qc_certs c
       LEFT JOIN work_orders w ON w.id = c.work_order_id
       LEFT JOIN products p ON p.id = c.product_id
       WHERE c.id = $1`,
      [input.docId],
    );
    return cert ?? null;
  });
  if (!row) {
    throw new Error(`pdf-render: qc_cert ${input.docId} not found`);
  }
  const pdfBytes = await renderQcCertificatePdf({
    brandName: input.brandName,
    certNumber: row.cert_number,
    issuedAt: row.issued_at.toISOString(),
    productName: row.product_name ?? "—",
    workOrderPid: row.wo_pid ?? "—",
    lotNumber: row.lot_number,
    quantity: row.quantity ?? "0",
    uom: row.uom ?? "EA",
    deviceSerials: row.device_serials ?? [],
    signedByName: row.signed_by_name,
    signatureHash: row.signature_hash,
    notes: row.notes,
  });
  return { pdfBytes, objectKey: buildQcCertKey(input.orgId, input.docId) };
}

// ─── Sales Invoice ───────────────────────────────────────────────────────

interface SalesInvoiceHeaderRow {
  invoice_number: string;
  invoice_date: Date;
  due_date: Date | null;
  status: string;
  currency: string;
  customer_name: string | null;
  customer_gstin: string | null;
  customer_address: string | null;
  place_of_supply: string | null;
  work_order_pid: string | null;
  subtotal: string;
  tax_total: string;
  discount_total: string;
  grand_total: string;
  amount_paid: string;
  notes: string | null;
  terms: string | null;
  posted_by_name: string | null;
  posted_at: Date | null;
  signature_hash: string | null;
}

interface SalesInvoiceLineRow {
  sequence_number: number;
  description: string;
  hsn_sac: string | null;
  quantity: string;
  uom: string | null;
  unit_price: string;
  discount_percent: string;
  tax_rate_percent: string;
  line_total: string;
}

async function renderSalesInvoice(
  input: AssembleInput,
): Promise<{ pdfBytes: Buffer; objectKey: string }> {
  const { header, lines } = await withOrg(
    input.pool,
    input.orgId,
    async (client) => {
      const {
        rows: [headerRow],
      } = await client.query<SalesInvoiceHeaderRow>(
        `SELECT si.invoice_number,
                si.invoice_date,
                si.due_date,
                si.status,
                si.currency,
                COALESCE(si.customer_name, a.name)           AS customer_name,
                COALESCE(si.customer_gstin, a.gstin)         AS customer_gstin,
                COALESCE(si.customer_address, a.address)     AS customer_address,
                si.place_of_supply,
                wo.pid                                       AS work_order_pid,
                si.subtotal::text       AS subtotal,
                si.tax_total::text      AS tax_total,
                si.discount_total::text AS discount_total,
                si.grand_total::text    AS grand_total,
                si.amount_paid::text    AS amount_paid,
                si.notes,
                si.terms,
                u.name                                       AS posted_by_name,
                si.posted_at,
                si.signature_hash
         FROM sales_invoices si
         LEFT JOIN accounts    a  ON a.id  = si.customer_id
         LEFT JOIN work_orders wo ON wo.id = si.work_order_id
         LEFT JOIN users       u  ON u.id  = si.posted_by
         WHERE si.id = $1 AND si.deleted_at IS NULL`,
        [input.docId],
      );
      if (!headerRow) return { header: null, lines: [] as SalesInvoiceLineRow[] };
      const { rows: lineRows } = await client.query<SalesInvoiceLineRow>(
        `SELECT sequence_number,
                description,
                hsn_sac,
                quantity::text         AS quantity,
                uom,
                unit_price::text       AS unit_price,
                discount_percent::text AS discount_percent,
                tax_rate_percent::text AS tax_rate_percent,
                line_total::text       AS line_total
         FROM sales_invoice_lines
         WHERE invoice_id = $1
         ORDER BY sequence_number ASC`,
        [input.docId],
      );
      return { header: headerRow, lines: lineRows };
    },
  );
  if (!header) {
    throw new Error(`pdf-render: sales_invoice ${input.docId} not found`);
  }
  const lineData: SalesInvoiceLineData[] = lines.map((ln) => ({
    sequenceNumber: ln.sequence_number,
    description: ln.description,
    hsnSac: ln.hsn_sac,
    quantity: ln.quantity,
    uom: ln.uom,
    unitPrice: ln.unit_price,
    discountPercent: ln.discount_percent,
    taxRatePercent: ln.tax_rate_percent,
    lineTotal: ln.line_total,
  }));
  const pdfBytes = await renderSalesInvoicePdf({
    brandName: input.brandName,
    invoiceNumber: header.invoice_number,
    invoiceDate: header.invoice_date.toISOString(),
    dueDate: header.due_date ? header.due_date.toISOString() : null,
    status: header.status,
    currency: header.currency,
    customerName: header.customer_name,
    customerGstin: header.customer_gstin,
    customerAddress: header.customer_address,
    placeOfSupply: header.place_of_supply,
    workOrderPid: header.work_order_pid,
    lines: lineData,
    subtotal: header.subtotal,
    taxTotal: header.tax_total,
    discountTotal: header.discount_total,
    grandTotal: header.grand_total,
    amountPaid: header.amount_paid,
    notes: header.notes,
    terms: header.terms,
    postedByName: header.posted_by_name,
    postedAt: header.posted_at ? header.posted_at.toISOString() : null,
    signatureHash: header.signature_hash,
  });
  return {
    pdfBytes,
    objectKey: buildSalesInvoiceKey(input.orgId, input.docId),
  };
}

// ─── Purchase Order ──────────────────────────────────────────────────────

interface PurchaseOrderHeaderRow {
  po_number: string;
  order_date: Date;
  expected_date: Date | null;
  status: string;
  currency: string;
  vendor_name: string | null;
  vendor_gstin: string | null;
  vendor_address: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  delivery_warehouse_name: string | null;
  payment_terms_days: number;
  subtotal: string;
  tax_total: string;
  discount_total: string;
  grand_total: string;
  notes: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
}

interface PurchaseOrderLineRow {
  line_no: number;
  item_code: string;
  description: string | null;
  quantity: string;
  uom: string;
  unit_price: string;
  discount_pct: string;
  tax_pct: string;
  line_total: string;
}

async function renderPurchaseOrder(
  input: AssembleInput,
): Promise<{ pdfBytes: Buffer; objectKey: string }> {
  const { header, lines } = await withOrg(
    input.pool,
    input.orgId,
    async (client) => {
      const {
        rows: [headerRow],
      } = await client.query<PurchaseOrderHeaderRow>(
        `SELECT po.po_number,
                po.order_date,
                po.expected_date,
                po.status,
                po.currency,
                v.name                                       AS vendor_name,
                v.gstin                                      AS vendor_gstin,
                v.address                                    AS vendor_address,
                po.billing_address,
                po.shipping_address,
                w.name                                       AS delivery_warehouse_name,
                po.payment_terms_days,
                po.subtotal::text       AS subtotal,
                po.tax_total::text      AS tax_total,
                po.discount_total::text AS discount_total,
                po.grand_total::text    AS grand_total,
                po.notes,
                u.name                                       AS approved_by_name,
                po.approved_at
         FROM purchase_orders po
         LEFT JOIN vendors    v ON v.id = po.vendor_id
         LEFT JOIN warehouses w ON w.id = po.delivery_warehouse_id
         LEFT JOIN users      u ON u.id = po.approved_by
         WHERE po.id = $1 AND po.deleted_at IS NULL`,
        [input.docId],
      );
      if (!headerRow) return { header: null, lines: [] as PurchaseOrderLineRow[] };
      const { rows: lineRows } = await client.query<PurchaseOrderLineRow>(
        `SELECT pol.line_no,
                i.sku                       AS item_code,
                pol.description,
                pol.quantity::text          AS quantity,
                pol.uom,
                pol.unit_price::text        AS unit_price,
                pol.discount_pct::text      AS discount_pct,
                pol.tax_pct::text           AS tax_pct,
                pol.line_total::text        AS line_total
         FROM po_lines pol
         LEFT JOIN items i ON i.id = pol.item_id
         WHERE pol.po_id = $1
         ORDER BY pol.line_no ASC`,
        [input.docId],
      );
      return { header: headerRow, lines: lineRows };
    },
  );
  if (!header) {
    throw new Error(`pdf-render: purchase_order ${input.docId} not found`);
  }
  const lineData: PurchaseOrderLineData[] = lines.map((ln) => ({
    lineNo: ln.line_no,
    itemCode: ln.item_code,
    description: ln.description,
    quantity: ln.quantity,
    uom: ln.uom,
    unitPrice: ln.unit_price,
    discountPct: ln.discount_pct,
    taxPct: ln.tax_pct,
    lineTotal: ln.line_total,
  }));
  const pdfBytes = await renderPurchaseOrderPdf({
    brandName: input.brandName,
    poNumber: header.po_number,
    orderDate: header.order_date.toISOString(),
    expectedDate: header.expected_date
      ? header.expected_date.toISOString()
      : null,
    status: header.status,
    currency: header.currency,
    vendorName: header.vendor_name,
    vendorGstin: header.vendor_gstin,
    vendorAddress: header.vendor_address,
    billingAddress: header.billing_address,
    shippingAddress: header.shipping_address,
    deliveryWarehouseName: header.delivery_warehouse_name,
    paymentTermsDays: header.payment_terms_days,
    lines: lineData,
    subtotal: header.subtotal,
    taxTotal: header.tax_total,
    discountTotal: header.discount_total,
    grandTotal: header.grand_total,
    notes: header.notes,
    approvedByName: header.approved_by_name,
    approvedAt: header.approved_at ? header.approved_at.toISOString() : null,
  });
  return {
    pdfBytes,
    objectKey: buildPurchaseOrderKey(input.orgId, input.docId),
  };
}

// ─── Delivery Challan (view on sales_orders) ─────────────────────────────

interface DeliveryChallanHeaderRow {
  order_number: string;
  created_at: Date;
  expected_delivery: Date | null;
  status: string;
  customer_company: string;
  customer_contact_name: string;
  customer_address: string | null;
  notes: string | null;
}

interface DeliveryChallanLineRow {
  line_no: number;
  product_code: string;
  product_name: string;
  quantity: number;
}

async function renderDeliveryChallan(
  input: AssembleInput,
): Promise<{ pdfBytes: Buffer; objectKey: string }> {
  const { header, lines } = await withOrg(
    input.pool,
    input.orgId,
    async (client) => {
      const {
        rows: [headerRow],
      } = await client.query<DeliveryChallanHeaderRow>(
        `SELECT so.order_number,
                -- We treat the dispatch date as the SO row's creation time
                -- for the DC PDF (no dedicated dispatch_date column on SO).
                so.created_at,
                so.expected_delivery,
                so.status,
                so.company       AS customer_company,
                so.contact_name  AS customer_contact_name,
                a.address        AS customer_address,
                so.notes
         FROM sales_orders so
         LEFT JOIN accounts a ON a.id = so.account_id
         WHERE so.id = $1 AND so.deleted_at IS NULL`,
        [input.docId],
      );
      if (!headerRow) {
        return { header: null, lines: [] as DeliveryChallanLineRow[] };
      }
      const { rows: lineRows } = await client.query<DeliveryChallanLineRow>(
        `SELECT ROW_NUMBER() OVER (ORDER BY created_at, id)::int AS line_no,
                product_code,
                product_name,
                quantity
         FROM sales_order_line_items
         WHERE order_id = $1
         ORDER BY created_at, id`,
        [input.docId],
      );
      return { header: headerRow, lines: lineRows };
    },
  );
  if (!header) {
    throw new Error(
      `pdf-render: delivery_challan / sales_order ${input.docId} not found`,
    );
  }
  const lineData: DeliveryChallanLineData[] = lines.map((ln) => ({
    lineNo: ln.line_no,
    productCode: ln.product_code,
    productName: ln.product_name,
    quantity: ln.quantity,
    // Phase 2 has no device-serials-against-SO join; left empty and
    // populated by the Phase 3 device dispatch flow once wired.
    serials: [],
  }));
  const pdfBytes = await renderDeliveryChallanPdf({
    brandName: input.brandName,
    orderNumber: header.order_number,
    dispatchDate: header.created_at.toISOString(),
    expectedDeliveryDate: header.expected_delivery
      ? header.expected_delivery.toISOString()
      : null,
    status: header.status,
    customerCompany: header.customer_company,
    customerContactName: header.customer_contact_name,
    customerAddress: header.customer_address,
    // Vehicle + transporter live in ops notes in Phase 2 — leave blank so
    // the "own fleet" fallback path in the template triggers.
    vehicleNumber: null,
    transporter: null,
    lines: lineData,
    notes: header.notes,
    dispatchedByName: null,
    dispatchedAt: null,
  });
  return {
    pdfBytes,
    objectKey: buildDeliveryChallanKey(input.orgId, input.docId),
  };
}

// ─── Goods Receipt Note ──────────────────────────────────────────────────

interface GrnHeaderRow {
  grn_number: string;
  received_date: Date;
  status: string;
  po_number: string;
  vendor_name: string | null;
  vendor_gstin: string | null;
  vendor_address: string | null;
  warehouse_name: string;
  vehicle_number: string | null;
  vendor_invoice_number: string | null;
  vendor_invoice_date: Date | null;
  notes: string | null;
  received_by_name: string | null;
  posted_by_name: string | null;
  posted_at: Date | null;
}

interface GrnLineRow {
  line_no: number;
  item_code: string;
  description: string | null;
  quantity: string;
  uom: string;
  unit_cost: string;
  batch_no: string | null;
  mfg_date: Date | null;
  expiry_date: Date | null;
  qc_status: string | null;
  qc_rejected_qty: string;
}

async function renderGrn(
  input: AssembleInput,
): Promise<{ pdfBytes: Buffer; objectKey: string }> {
  const { header, lines } = await withOrg(
    input.pool,
    input.orgId,
    async (client) => {
      const {
        rows: [headerRow],
      } = await client.query<GrnHeaderRow>(
        `SELECT g.grn_number,
                g.received_date,
                g.status,
                po.po_number,
                v.name    AS vendor_name,
                v.gstin   AS vendor_gstin,
                v.address AS vendor_address,
                w.name    AS warehouse_name,
                g.vehicle_number,
                g.invoice_number AS vendor_invoice_number,
                g.invoice_date   AS vendor_invoice_date,
                g.notes,
                ur.name                                        AS received_by_name,
                up.name                                        AS posted_by_name,
                g.posted_at
         FROM grns g
         JOIN purchase_orders po ON po.id = g.po_id
         JOIN vendors         v  ON v.id  = g.vendor_id
         JOIN warehouses      w  ON w.id  = g.warehouse_id
         LEFT JOIN users      ur ON ur.id = g.received_by
         LEFT JOIN users      up ON up.id = g.posted_by
         WHERE g.id = $1 AND g.deleted_at IS NULL`,
        [input.docId],
      );
      if (!headerRow) return { header: null, lines: [] as GrnLineRow[] };
      const { rows: lineRows } = await client.query<GrnLineRow>(
        `SELECT gl.line_no,
                i.sku                 AS item_code,
                i.name                AS description,
                gl.quantity::text     AS quantity,
                gl.uom,
                gl.unit_cost::text    AS unit_cost,
                gl.batch_no,
                gl.mfg_date,
                gl.expiry_date,
                gl.qc_status,
                gl.qc_rejected_qty::text AS qc_rejected_qty
         FROM grn_lines gl
         LEFT JOIN items i ON i.id = gl.item_id
         WHERE gl.grn_id = $1
         ORDER BY gl.line_no ASC`,
        [input.docId],
      );
      return { header: headerRow, lines: lineRows };
    },
  );
  if (!header) {
    throw new Error(`pdf-render: grn ${input.docId} not found`);
  }
  const lineData: GrnLineData[] = lines.map((ln) => ({
    lineNo: ln.line_no,
    itemCode: ln.item_code,
    description: ln.description,
    quantity: ln.quantity,
    uom: ln.uom,
    unitCost: ln.unit_cost,
    batchNo: ln.batch_no,
    mfgDate: ln.mfg_date ? ln.mfg_date.toISOString() : null,
    expiryDate: ln.expiry_date ? ln.expiry_date.toISOString() : null,
    qcStatus: ln.qc_status,
    qcRejectedQty: ln.qc_rejected_qty,
  }));
  const pdfBytes = await renderGrnPdf({
    brandName: input.brandName,
    grnNumber: header.grn_number,
    receivedDate: header.received_date.toISOString(),
    poNumber: header.po_number,
    status: header.status,
    vendorName: header.vendor_name,
    vendorGstin: header.vendor_gstin,
    vendorAddress: header.vendor_address,
    warehouseName: header.warehouse_name,
    vehicleNumber: header.vehicle_number,
    vendorInvoiceNumber: header.vendor_invoice_number,
    vendorInvoiceDate: header.vendor_invoice_date
      ? header.vendor_invoice_date.toISOString()
      : null,
    lines: lineData,
    notes: header.notes,
    receivedByName: header.received_by_name,
    postedByName: header.posted_by_name,
    postedAt: header.posted_at ? header.posted_at.toISOString() : null,
  });
  return { pdfBytes, objectKey: buildGrnKey(input.orgId, input.docId) };
}
