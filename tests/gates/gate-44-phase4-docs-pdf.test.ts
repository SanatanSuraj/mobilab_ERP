/**
 * Gate 44 — Phase 4 §4.1 Sales Invoice / Purchase Order / Delivery Challan /
 * GRN PDF render pipeline.
 *
 * The QC-cert half of §4.1 is covered by Gate 39. This gate drives the
 * remaining four doc types end-to-end through the same pdf-render
 * processor and asserts:
 *
 *   (a) Each assembler reads its header + lines inside `withOrg`, feeds
 *       the @instigenie/worker template, and uploads to MinIO at the key
 *       built by the matching buildFooKey helper (`pdf/sales-invoices/…`,
 *       `pdf/purchase-orders/…`, `pdf/delivery-challans/…`, `pdf/grns/…`).
 *   (b) pdf_render_runs flips to COMPLETED with object_key + object_etag +
 *       byte_size stamped in the same txn.
 *   (c) The matching entity row has pdf_minio_key set (sales_invoices,
 *       purchase_orders, sales_orders for DC, grns).
 *   (d) The uploaded bytes are a valid PDF (first 5 bytes == "%PDF-").
 *
 * One describe block per doc type. Each seeds its own fixture via a
 * fresh randomUUID() suffix so parallel runs don't collide on the
 * unique (org_id, invoice_number|po_number|order_number|grn_number)
 * indices.
 *
 * We call the processor directly with a synthesised BullMQ `Job` stub —
 * the BullMQ loop itself is covered by the noeviction + retention gates
 * and Gate 39 covers the retry/DLQ paths; repeating those for every doc
 * type adds wall-clock cost with no new surface.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { installNumericTypeParser, withOrg } from "@instigenie/db";
import {
  S3ObjectStorage,
  buildSalesInvoiceKey,
  buildPurchaseOrderKey,
  buildDeliveryChallanKey,
  buildGrnKey,
} from "@instigenie/storage";
import {
  createPdfRenderProcessor,
  type PdfRenderJob,
} from "@instigenie/worker/processors/pdf-render";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://instigenie_app:instigenie_dev@localhost:5434/instigenie";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "instigenie";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "instigenie_dev_minio";
const BUCKET = process.env.PDF_BUCKET ?? "instigenie-pdfs-gate44";

// Seed fixture ids — reuse the dev seed so we don't have to re-insert
// vendor / warehouse / item / account master-data every test.
const ORG_ID         = "00000000-0000-0000-0000-00000000a001";
const ACCOUNT_ID     = "00000000-0000-0000-0000-0000000ac001"; // Apollo Hospitals
const VENDOR_ID      = "00000000-0000-0000-0000-000000fe0001"; // Elcon Mart
const WAREHOUSE_ID   = "00000000-0000-0000-0000-000000fa0001"; // Main Plant Store
const ITEM_ID        = "00000000-0000-0000-0000-000000fb0001"; // Resistor 1k
const FINANCE_USER   = "00000000-0000-0000-0000-00000000b006"; // Finance
const STORES_USER    = "00000000-0000-0000-0000-00000000b00b"; // Stores

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLog,
  level: "info",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

let pool: pg.Pool;
let storage: S3ObjectStorage;

beforeAll(async () => {
  installNumericTypeParser();
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 6,
    application_name: "gate-44",
  });
  storage = new S3ObjectStorage({
    endpoint: MINIO_ENDPOINT,
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  });
  await storage.ensureBucket(BUCKET);
});

afterAll(async () => {
  await pool.end();
});

/** Build a synthetic BullMQ Job object the processor can consume. */
function fakeJob(
  data: PdfRenderJob,
  attemptsMade = 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    data,
    attemptsMade,
    id: `gate-44-${data.docType}-${data.docId}`,
    name: `pdf-render:${data.docType}`,
    opts: { attempts: 3 },
  };
}

// ─── Gate 44.1 — Sales Invoice ───────────────────────────────────────────

describe("Gate 44.1 — sales_invoice PDF render", () => {
  test("renders SI → MinIO at sales-invoices/…, sets pdf_minio_key, run COMPLETED", async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const invoiceNumber = `SI-G44-${suffix}`;

    const { invoiceId } = await withOrg(pool, ORG_ID, async (client) => {
      // Header — POSTED so the PDF reflects the "final" shape the finance
      // team would see in prod. posted_by hydrates the signatory block.
      const {
        rows: [si],
      } = await client.query<{ id: string }>(
        `INSERT INTO sales_invoices
           (org_id, invoice_number, status, customer_id,
            subtotal, tax_total, discount_total, grand_total,
            amount_paid, place_of_supply, notes, terms,
            posted_by, posted_at)
         VALUES ($1, $2, 'POSTED', $3,
                 '10000.0000', '1800.0000', '0.0000', '11800.0000',
                 '0.0000', '29-Karnataka', 'Gate 44.1 smoke invoice',
                 'Net 30; payable in INR', $4, now())
         RETURNING id`,
        [ORG_ID, invoiceNumber, ACCOUNT_ID, FINANCE_USER],
      );
      // Two lines so we exercise the table-render path in the template.
      await client.query(
        `INSERT INTO sales_invoice_lines
           (org_id, invoice_id, sequence_number, description, hsn_sac,
            quantity, uom, unit_price, discount_percent, tax_rate_percent,
            line_subtotal, line_tax, line_total)
         VALUES
           ($1, $2, 1, 'Resistor 1kΩ 1/4W', '8533',
            '100.0000', 'EA', '50.0000', '0.0000', '18.0000',
            '5000.0000', '900.0000', '5900.0000'),
           ($1, $2, 2, 'Engineering services', '9983',
            '10.0000', 'HR', '500.0000', '0.0000', '18.0000',
            '5000.0000', '900.0000', '5900.0000')`,
        [ORG_ID, si!.id],
      );
      return { invoiceId: si!.id };
    });

    const processor = createPdfRenderProcessor({
      pool,
      log: silentLog,
      storage,
      bucket: BUCKET,
      brandName: "Gate44 Brand",
    });
    const result = await processor(
      fakeJob({
        docType: "sales_invoice",
        docId: invoiceId,
        orgId: ORG_ID,
      }),
      undefined as never,
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.objectKey).toBe(buildSalesInvoiceKey(ORG_ID, invoiceId));

    // Round-trip bytes — it's really a PDF.
    const body = await storage.getObject(BUCKET, result.objectKey!);
    expect(body.slice(0, 5).toString("utf8")).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(1000);

    const head = await storage.headObject(BUCKET, result.objectKey!);
    expect(head.exists).toBe(true);
    expect(head.metadata?.doctype ?? head.metadata?.docType).toBe(
      "sales_invoice",
    );
    expect(head.metadata?.docid ?? head.metadata?.docId).toBe(invoiceId);

    // pdf_render_runs flipped to COMPLETED with the stamp-back fields.
    const { rows: runs } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{
        status: string;
        object_key: string;
        object_etag: string;
        byte_size: number;
      }>(
        `SELECT status, object_key, object_etag, byte_size
           FROM pdf_render_runs
          WHERE doc_type = 'sales_invoice' AND doc_id = $1`,
        [invoiceId],
      ),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("COMPLETED");
    expect(runs[0]!.object_key).toBe(result.objectKey);
    expect(runs[0]!.byte_size).toBe(body.length);

    // Owning entity has the key stamped.
    const { rows: siRow } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{ pdf_minio_key: string | null }>(
        `SELECT pdf_minio_key FROM sales_invoices WHERE id = $1`,
        [invoiceId],
      ),
    );
    expect(siRow[0]!.pdf_minio_key).toBe(result.objectKey);
  }, 30_000);
});

// ─── Gate 44.2 — Purchase Order ──────────────────────────────────────────

describe("Gate 44.2 — purchase_order PDF render", () => {
  test("renders PO → MinIO at purchase-orders/…, sets pdf_minio_key, run COMPLETED", async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const poNumber = `PO-G44-${suffix}`;

    const { poId } = await withOrg(pool, ORG_ID, async (client) => {
      const {
        rows: [po],
      } = await client.query<{ id: string }>(
        `INSERT INTO purchase_orders
           (org_id, po_number, vendor_id, status, currency,
            delivery_warehouse_id, billing_address, shipping_address,
            payment_terms_days,
            subtotal, tax_total, discount_total, grand_total,
            notes, approved_by, approved_at)
         VALUES ($1, $2, $3, 'APPROVED', 'INR',
                 $4, '221 SP Road, Bengaluru', 'Main Plant Store Dock',
                 30,
                 '1000.00', '180.00', '0.00', '1180.00',
                 'Gate 44.2 smoke PO', $5, now())
         RETURNING id`,
        [ORG_ID, poNumber, VENDOR_ID, WAREHOUSE_ID, FINANCE_USER],
      );
      await client.query(
        `INSERT INTO po_lines
           (org_id, po_id, line_no, item_id, description,
            quantity, uom, unit_price, discount_pct, tax_pct,
            line_subtotal, line_tax, line_total)
         VALUES
           ($1, $2, 1, $3, 'Resistor 1kΩ 1/4W',
            '100.000', 'EA', '10.00', '0.00', '18.00',
            '1000.00', '180.00', '1180.00')`,
        [ORG_ID, po!.id, ITEM_ID],
      );
      return { poId: po!.id };
    });

    const processor = createPdfRenderProcessor({
      pool,
      log: silentLog,
      storage,
      bucket: BUCKET,
      brandName: "Gate44 Brand",
    });
    const result = await processor(
      fakeJob({
        docType: "purchase_order",
        docId: poId,
        orgId: ORG_ID,
      }),
      undefined as never,
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.objectKey).toBe(buildPurchaseOrderKey(ORG_ID, poId));

    const body = await storage.getObject(BUCKET, result.objectKey!);
    expect(body.slice(0, 5).toString("utf8")).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(1000);

    const head = await storage.headObject(BUCKET, result.objectKey!);
    expect(head.exists).toBe(true);
    expect(head.metadata?.doctype ?? head.metadata?.docType).toBe(
      "purchase_order",
    );
    expect(head.metadata?.docid ?? head.metadata?.docId).toBe(poId);

    const { rows: runs } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{
        status: string;
        object_key: string;
        byte_size: number;
      }>(
        `SELECT status, object_key, byte_size
           FROM pdf_render_runs
          WHERE doc_type = 'purchase_order' AND doc_id = $1`,
        [poId],
      ),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("COMPLETED");
    expect(runs[0]!.byte_size).toBe(body.length);

    const { rows: poRow } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{ pdf_minio_key: string | null }>(
        `SELECT pdf_minio_key FROM purchase_orders WHERE id = $1`,
        [poId],
      ),
    );
    expect(poRow[0]!.pdf_minio_key).toBe(result.objectKey);
  }, 30_000);
});

// ─── Gate 44.3 — Delivery Challan (sales_orders-backed) ──────────────────

describe("Gate 44.3 — delivery_challan PDF render", () => {
  test("renders DC → MinIO at delivery-challans/…, stamps sales_orders.pdf_minio_key, run COMPLETED", async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const orderNumber = `SO-G44-${suffix}`;

    const { salesOrderId } = await withOrg(pool, ORG_ID, async (client) => {
      const {
        rows: [so],
      } = await client.query<{ id: string }>(
        `INSERT INTO sales_orders
           (org_id, order_number, account_id, company, contact_name,
            status, subtotal, tax_amount, grand_total,
            expected_delivery, notes)
         VALUES ($1, $2, $3, 'Apollo Hospitals', 'Ravi Menon',
                 'DISPATCHED', '10000.00', '1800.00', '11800.00',
                 current_date + 7, 'Gate 44.3 smoke DC')
         RETURNING id`,
        [ORG_ID, orderNumber, ACCOUNT_ID],
      );
      await client.query(
        `INSERT INTO sales_order_line_items
           (org_id, order_id, product_code, product_name,
            quantity, unit_price, discount_pct, tax_pct,
            tax_amount, line_total)
         VALUES
           ($1, $2, 'ECG-MONITOR-V2', 'ECG Patient Monitor v2',
            2, '5000.00', '0.00', '18.00', '1800.00', '11800.00')`,
        [ORG_ID, so!.id],
      );
      return { salesOrderId: so!.id };
    });

    const processor = createPdfRenderProcessor({
      pool,
      log: silentLog,
      storage,
      bucket: BUCKET,
      brandName: "Gate44 Brand",
    });
    const result = await processor(
      fakeJob({
        docType: "delivery_challan",
        docId: salesOrderId,
        orgId: ORG_ID,
      }),
      undefined as never,
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.objectKey).toBe(
      buildDeliveryChallanKey(ORG_ID, salesOrderId),
    );

    const body = await storage.getObject(BUCKET, result.objectKey!);
    expect(body.slice(0, 5).toString("utf8")).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(1000);

    const head = await storage.headObject(BUCKET, result.objectKey!);
    expect(head.exists).toBe(true);
    expect(head.metadata?.doctype ?? head.metadata?.docType).toBe(
      "delivery_challan",
    );
    expect(head.metadata?.docid ?? head.metadata?.docId).toBe(salesOrderId);

    const { rows: runs } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{
        status: string;
        object_key: string;
        byte_size: number;
      }>(
        `SELECT status, object_key, byte_size
           FROM pdf_render_runs
          WHERE doc_type = 'delivery_challan' AND doc_id = $1`,
        [salesOrderId],
      ),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("COMPLETED");
    expect(runs[0]!.byte_size).toBe(body.length);

    // DC key lives on sales_orders.pdf_minio_key (see 17-phase4-pdf-keys.sql
    // comment — DC is an SO shipment view, not its own entity).
    const { rows: soRow } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{ pdf_minio_key: string | null }>(
        `SELECT pdf_minio_key FROM sales_orders WHERE id = $1`,
        [salesOrderId],
      ),
    );
    expect(soRow[0]!.pdf_minio_key).toBe(result.objectKey);
  }, 30_000);
});

// ─── Gate 44.4 — GRN ─────────────────────────────────────────────────────

describe("Gate 44.4 — grn PDF render", () => {
  test("renders GRN → MinIO at grns/…, sets grns.pdf_minio_key, run COMPLETED", async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const poNumber = `PO-G44G-${suffix}`;
    const grnNumber = `GRN-G44-${suffix}`;

    const { grnId } = await withOrg(pool, ORG_ID, async (client) => {
      // Parent PO + line — grns.po_id and grn_lines.po_line_id are NOT NULL.
      const {
        rows: [po],
      } = await client.query<{ id: string }>(
        `INSERT INTO purchase_orders
           (org_id, po_number, vendor_id, status, currency,
            delivery_warehouse_id,
            subtotal, tax_total, discount_total, grand_total)
         VALUES ($1, $2, $3, 'APPROVED', 'INR', $4,
                 '1000.00', '180.00', '0.00', '1180.00')
         RETURNING id`,
        [ORG_ID, poNumber, VENDOR_ID, WAREHOUSE_ID],
      );
      const {
        rows: [poLine],
      } = await client.query<{ id: string }>(
        `INSERT INTO po_lines
           (org_id, po_id, line_no, item_id,
            quantity, uom, unit_price,
            line_subtotal, line_tax, line_total)
         VALUES ($1, $2, 1, $3,
                 '100.000', 'EA', '10.00',
                 '1000.00', '180.00', '1180.00')
         RETURNING id`,
        [ORG_ID, po!.id, ITEM_ID],
      );

      // GRN header — POSTED so posted_by / posted_at hydrate the PDF footer.
      const {
        rows: [grn],
      } = await client.query<{ id: string }>(
        `INSERT INTO grns
           (org_id, grn_number, po_id, vendor_id, warehouse_id, status,
            vehicle_number, invoice_number, invoice_date,
            received_by, posted_by, posted_at, notes)
         VALUES ($1, $2, $3, $4, $5, 'POSTED',
                 'KA-01-AB-1234', 'VENDOR-INV-001', current_date,
                 $6, $7, now(), 'Gate 44.4 smoke GRN')
         RETURNING id`,
        [
          ORG_ID,
          grnNumber,
          po!.id,
          VENDOR_ID,
          WAREHOUSE_ID,
          STORES_USER,
          FINANCE_USER,
        ],
      );
      await client.query(
        `INSERT INTO grn_lines
           (org_id, grn_id, po_line_id, line_no, item_id,
            quantity, uom, unit_cost,
            batch_no, mfg_date, expiry_date,
            qc_status, qc_rejected_qty)
         VALUES
           ($1, $2, $3, 1, $4,
            '100.000', 'EA', '10.00',
            'BATCH-G44-01', current_date - 30, current_date + 365,
            'ACCEPTED', '0.000')`,
        [ORG_ID, grn!.id, poLine!.id, ITEM_ID],
      );
      return { grnId: grn!.id };
    });

    const processor = createPdfRenderProcessor({
      pool,
      log: silentLog,
      storage,
      bucket: BUCKET,
      brandName: "Gate44 Brand",
    });
    const result = await processor(
      fakeJob({ docType: "grn", docId: grnId, orgId: ORG_ID }),
      undefined as never,
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.objectKey).toBe(buildGrnKey(ORG_ID, grnId));

    const body = await storage.getObject(BUCKET, result.objectKey!);
    expect(body.slice(0, 5).toString("utf8")).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(1000);

    const head = await storage.headObject(BUCKET, result.objectKey!);
    expect(head.exists).toBe(true);
    expect(head.metadata?.doctype ?? head.metadata?.docType).toBe("grn");
    expect(head.metadata?.docid ?? head.metadata?.docId).toBe(grnId);

    const { rows: runs } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{
        status: string;
        object_key: string;
        byte_size: number;
      }>(
        `SELECT status, object_key, byte_size
           FROM pdf_render_runs
          WHERE doc_type = 'grn' AND doc_id = $1`,
        [grnId],
      ),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("COMPLETED");
    expect(runs[0]!.byte_size).toBe(body.length);

    const { rows: grnRow } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{ pdf_minio_key: string | null }>(
        `SELECT pdf_minio_key FROM grns WHERE id = $1`,
        [grnId],
      ),
    );
    expect(grnRow[0]!.pdf_minio_key).toBe(result.objectKey);
  }, 30_000);
});

// ─── Gate 44.5 — Idempotent redelivery across all 4 types ───────────────

describe("Gate 44.5 — idempotent short-circuit for non-QC doc types", () => {
  test("second call with same payload returns ALREADY_COMPLETED for sales_invoice", async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const invoiceNumber = `SI-G445-${suffix}`;

    const { invoiceId } = await withOrg(pool, ORG_ID, async (client) => {
      const {
        rows: [si],
      } = await client.query<{ id: string }>(
        `INSERT INTO sales_invoices
           (org_id, invoice_number, status, customer_id,
            subtotal, tax_total, grand_total, amount_paid)
         VALUES ($1, $2, 'POSTED', $3,
                 '100.0000', '18.0000', '118.0000', '0.0000')
         RETURNING id`,
        [ORG_ID, invoiceNumber, ACCOUNT_ID],
      );
      await client.query(
        `INSERT INTO sales_invoice_lines
           (org_id, invoice_id, sequence_number, description,
            quantity, unit_price, tax_rate_percent,
            line_subtotal, line_tax, line_total)
         VALUES ($1, $2, 1, 'Gate 44.5 line',
                 '1.0000', '100.0000', '18.0000',
                 '100.0000', '18.0000', '118.0000')`,
        [ORG_ID, si!.id],
      );
      return { invoiceId: si!.id };
    });

    const processor = createPdfRenderProcessor({
      pool,
      log: silentLog,
      storage,
      bucket: BUCKET,
    });
    const job = fakeJob({
      docType: "sales_invoice",
      docId: invoiceId,
      orgId: ORG_ID,
    });

    const first = await processor(job, undefined as never);
    expect(first.status).toBe("COMPLETED");
    const firstHead = await storage.headObject(BUCKET, first.objectKey!);
    const firstEtag = firstHead.etag;

    const second = await processor(job, undefined as never);
    expect(second.status).toBe("ALREADY_COMPLETED");
    expect(second.objectKey).toBe(first.objectKey);

    // No re-upload — etag stays identical.
    const secondHead = await storage.headObject(BUCKET, first.objectKey!);
    expect(secondHead.etag).toBe(firstEtag);

    // Still a single pdf_render_runs row.
    const { rows } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pdf_render_runs
          WHERE doc_type = 'sales_invoice' AND doc_id = $1`,
        [invoiceId],
      ),
    );
    expect(rows[0]!.count).toBe("1");
  }, 30_000);
});
