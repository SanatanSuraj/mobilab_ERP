/**
 * Gate 39 — Phase 4 §4.1 QC Certificate PDF render pipeline.
 *
 * ARCHITECTURE.md §4.1 mandates the pdf-render pipeline for QC
 * certificates (and, in later increments, POs / SIs / DCs / GRNs). This
 * gate drives the pdf-render processor directly against a freshly-
 * inserted cert fixture and asserts:
 *
 *   (a) End-to-end success — PDF bytes land in MinIO at the
 *       deterministic key, pdf_render_runs flips to COMPLETED with
 *       object_key + object_etag + byte_size filled in, and
 *       qc_certs.pdf_minio_key is stamped in the same txn.
 *   (b) Idempotent re-delivery — a second invocation of the processor
 *       with the identical BullMQ payload returns ALREADY_COMPLETED and
 *       does NOT re-upload to MinIO (etag stays identical;
 *       pdf_render_runs row count stays at 1 for the cert).
 *   (c) Transient-failure retry shape — throwing once leaves
 *       pdf_render_runs.status='FAILED' with last_error, a subsequent
 *       attempt flips it back to RENDERING and completes.
 *   (d) DLQ on terminal exhaustion — after 3 attempts the writePdfRenderDlq
 *       helper (which the BullMQ .on("failed") listener calls) parks a
 *       row into pdf_render_dlq with payload + attempts + last_error.
 *
 * We call the processor directly with a synthesised BullMQ `Job` stub —
 * the actual BullMQ/Redis loop is covered by the noeviction + retention
 * gates. Storage is the real S3ObjectStorage pointed at the local MinIO
 * container so any format / wire-level regressions surface here.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { installNumericTypeParser, withOrg } from "@instigenie/db";
import {
  S3ObjectStorage,
  buildQcCertKey,
  type ObjectStorage,
  type PutObjectInput,
} from "@instigenie/storage";
import {
  createPdfRenderProcessor,
  writePdfRenderDlq,
  type PdfRenderJob,
} from "@instigenie/worker/processors/pdf-render";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://instigenie_app:instigenie_dev@localhost:5434/instigenie";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "instigenie";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "instigenie_dev_minio";
const BUCKET = process.env.PDF_BUCKET ?? "instigenie-pdfs-gate39";

const ORG_ID = "00000000-0000-0000-0000-00000000a001";
const PRODUCT_ID = "00000000-0000-0000-0000-000000fc0001";
const BOM_ID = "00000000-0000-0000-0000-000000fc0101"; // v3 ACTIVE

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
    application_name: "gate-39",
  });
  storage = new S3ObjectStorage({
    endpoint: MINIO_ENDPOINT,
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  });
  // Pre-create the gate-specific bucket so the first putObject doesn't
  // race. ensureBucket is idempotent so re-runs are fine.
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
    id: `gate-39-${data.docId}`,
    name: `pdf-render:${data.docType}`,
    opts: { attempts: 3 },
  };
}

/** Insert a PASSED FINAL_QC inspection + qc_cert to render. */
async function seedCert(): Promise<{
  certId: string;
  certNumber: string;
  workOrderId: string;
}> {
  return withOrg(pool, ORG_ID, async (client) => {
    // Work order — the cert snapshots pid + device_serials from this.
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const {
      rows: [wo],
    } = await client.query<{ id: string; pid: string }>(
      `INSERT INTO work_orders
         (org_id, pid, product_id, bom_id, bom_version_label,
          quantity, status, device_serials)
       VALUES ($1, $2, $3, $4, 'v3', 2, 'IN_PROGRESS',
               ARRAY['SN-G39-01','SN-G39-02'])
       RETURNING id, pid`,
      [ORG_ID, `WO-G39-${suffix}`, PRODUCT_ID, BOM_ID],
    );

    // QC inspection — cert FK requires this row.
    const {
      rows: [insp],
    } = await client.query<{ id: string }>(
      `INSERT INTO qc_inspections
         (org_id, inspection_number, kind, status, source_type, source_id,
          product_id, work_order_id, verdict, completed_at)
       VALUES ($1, $2, 'FINAL_QC', 'PASSED', 'WO', $3,
               $4, $3, 'PASS', now())
       RETURNING id`,
      [ORG_ID, `QCI-G39-${suffix}`, wo!.id, PRODUCT_ID],
    );

    const certNumber = `QCC-G39-${suffix}`;
    const {
      rows: [cert],
    } = await client.query<{ id: string }>(
      `INSERT INTO qc_certs
         (org_id, cert_number, inspection_id, work_order_id, product_id,
          product_name, wo_pid, device_serials, notes)
       VALUES ($1, $2, $3, $4, $5, 'ECG Patient Monitor v2', $6,
               ARRAY['SN-G39-01','SN-G39-02'], 'Gate 39 cert')
       RETURNING id`,
      [
        ORG_ID,
        certNumber,
        insp!.id,
        wo!.id,
        PRODUCT_ID,
        wo!.pid,
      ],
    );
    return { certId: cert!.id, certNumber, workOrderId: wo!.id };
  });
}

// ─── Gate 39.1 — End-to-end render to MinIO ──────────────────────────────

describe("Gate 39.1 — pdf-render end-to-end", () => {
  test("renders QC cert → MinIO → pdf_minio_key + pdf_render_runs COMPLETED", async () => {
    const { certId, certNumber } = await seedCert();
    const processor = createPdfRenderProcessor({
      pool,
      log: silentLog,
      storage,
      bucket: BUCKET,
      brandName: "Gate39 Brand",
    });

    const result = await processor(
      fakeJob({ docType: "qc_cert", docId: certId, orgId: ORG_ID }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      undefined as any,
    );
    expect(result.status).toBe("COMPLETED");
    expect(result.objectKey).toBe(buildQcCertKey(ORG_ID, certId));

    // MinIO has the object.
    const head = await storage.headObject(BUCKET, result.objectKey!);
    expect(head.exists).toBe(true);
    expect((head.size ?? 0)).toBeGreaterThan(1000); // PDFs are kB-sized

    // Bytes parse as a real PDF — first 5 bytes must be "%PDF-".
    const body = await storage.getObject(BUCKET, result.objectKey!);
    expect(body.slice(0, 5).toString("utf8")).toBe("%PDF-");

    // pdf_render_runs row is COMPLETED. pdf_render_runs is RLS-scoped on
    // org_id (ops/sql/rls/14-pdf-render-rls.sql), so read via withOrg.
    const { rows: runs } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{
        status: string;
        object_key: string;
        object_etag: string;
        byte_size: number;
      }>(
        `SELECT status, object_key, object_etag, byte_size
           FROM pdf_render_runs
          WHERE doc_type = 'qc_cert' AND doc_id = $1`,
        [certId],
      ),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("COMPLETED");
    expect(runs[0]!.object_key).toBe(result.objectKey);
    expect(runs[0]!.byte_size).toBe(body.length);

    // qc_certs.pdf_minio_key is stamped.
    const certRow = await withOrg(pool, ORG_ID, async (c) =>
      c.query<{ pdf_minio_key: string | null }>(
        `SELECT pdf_minio_key FROM qc_certs WHERE id = $1`,
        [certId],
      ),
    );
    expect(certRow.rows[0]!.pdf_minio_key).toBe(result.objectKey);

    // PDF metadata — the processor stamps docType/docId/orgId so ops
    // tooling (and this gate) can round-trip an object key back to the
    // cert id without touching the DB. Compressed PDF body can't be
    // grepped for certNumber directly so we lean on metadata instead.
    expect(head.metadata?.doctype ?? head.metadata?.docType).toBe("qc_cert");
    expect(head.metadata?.docid ?? head.metadata?.docId).toBe(certId);
    expect(certNumber).toMatch(/^QCC-G39-/); // sanity on our own fixture
  }, 30_000);
});

// ─── Gate 39.2 — Idempotent redelivery ───────────────────────────────────

describe("Gate 39.2 — idempotent redelivery short-circuit", () => {
  test("second invocation returns ALREADY_COMPLETED, no re-upload", async () => {
    const { certId } = await seedCert();
    const processor = createPdfRenderProcessor({
      pool,
      log: silentLog,
      storage,
      bucket: BUCKET,
      brandName: "Gate39 Brand",
    });
    const job = fakeJob({ docType: "qc_cert", docId: certId, orgId: ORG_ID });

    const first = await processor(job, undefined as never);
    expect(first.status).toBe("COMPLETED");
    const firstHead = await storage.headObject(BUCKET, first.objectKey!);
    const firstEtag = firstHead.etag;

    const second = await processor(job, undefined as never);
    expect(second.status).toBe("ALREADY_COMPLETED");
    expect(second.objectKey).toBe(first.objectKey);

    // MinIO etag did NOT change — we didn't upload a second time.
    const secondHead = await storage.headObject(BUCKET, first.objectKey!);
    expect(secondHead.etag).toBe(firstEtag);

    // Still exactly one pdf_render_runs row for this cert.
    const { rows: runRows } = await withOrg(pool, ORG_ID, (c) =>
      c.query(
        `SELECT count(*)::text AS count FROM pdf_render_runs
          WHERE doc_type = 'qc_cert' AND doc_id = $1`,
        [certId],
      ),
    );
    expect(runRows[0]!.count).toBe("1");
  }, 30_000);
});

// ─── Gate 39.3 — Transient failure then recover ──────────────────────────

describe("Gate 39.3 — transient failure retry path", () => {
  test("throws → FAILED row; next attempt succeeds and flips to COMPLETED", async () => {
    const { certId } = await seedCert();

    // First processor: storage that throws on putObject — simulates a
    // transient MinIO hiccup. qc-cert row query succeeds; the PUT trips.
    const flakeyStorage: ObjectStorage = {
      ensureBucket: async () => undefined,
      putObject: async (_input: PutObjectInput) => {
        throw new Error("Gate 39.3: simulated transient MinIO failure");
      },
      headObject: async () => ({ exists: false }),
      getObject: async () => Buffer.from(""),
    };
    const flakeyProc = createPdfRenderProcessor({
      pool,
      log: silentLog,
      storage: flakeyStorage,
      bucket: BUCKET,
    });
    await expect(
      flakeyProc(
        fakeJob({ docType: "qc_cert", docId: certId, orgId: ORG_ID }),
        undefined as never,
      ),
    ).rejects.toThrow(/simulated transient MinIO/);

    // Ledger row shows FAILED with our error message.
    const { rows: afterFail } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{
        status: string;
        last_error: string;
      }>(
        `SELECT status, last_error FROM pdf_render_runs
          WHERE doc_type = 'qc_cert' AND doc_id = $1`,
        [certId],
      ),
    );
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0]!.status).toBe("FAILED");
    expect(afterFail[0]!.last_error).toMatch(/simulated transient MinIO/);

    // Second pass: real storage, attempt 2. The ON CONFLICT DO UPDATE
    // flips FAILED → RENDERING and bumps the attempts counter.
    const realProc = createPdfRenderProcessor({
      pool,
      log: silentLog,
      storage,
      bucket: BUCKET,
    });
    const result = await realProc(
      fakeJob({ docType: "qc_cert", docId: certId, orgId: ORG_ID }, 1),
      undefined as never,
    );
    expect(result.status).toBe("COMPLETED");

    const { rows: afterOk } = await withOrg(pool, ORG_ID, (c) =>
      c.query<{
        status: string;
        attempts: number;
        last_error: string | null;
      }>(
        `SELECT status, attempts, last_error FROM pdf_render_runs
          WHERE doc_type = 'qc_cert' AND doc_id = $1`,
        [certId],
      ),
    );
    expect(afterOk[0]!.status).toBe("COMPLETED");
    expect(afterOk[0]!.attempts).toBeGreaterThanOrEqual(2);
    expect(afterOk[0]!.last_error).toBeNull(); // cleared on success
  }, 30_000);
});

// ─── Gate 39.4 — DLQ on terminal exhaustion ──────────────────────────────

describe("Gate 39.4 — pdf_render_dlq on attempts-exhausted", () => {
  test("writePdfRenderDlq parks the payload + attempts + last_error", async () => {
    const { certId, certNumber } = await seedCert();
    const payload: PdfRenderJob = {
      docType: "qc_cert",
      docId: certId,
      orgId: ORG_ID,
    };

    await writePdfRenderDlq(pool, {
      orgId: ORG_ID,
      docType: "qc_cert",
      docId: certId,
      payload,
      attempts: 3,
      lastError: "Gate 39.4: terminal failure after 3 attempts",
    });

    const row = await withOrg(pool, ORG_ID, async (c) =>
      c.query<{
        org_id: string;
        doc_type: string;
        doc_id: string;
        attempts: number;
        last_error: string;
        resolved_at: Date | null;
        payload: PdfRenderJob;
      }>(
        `SELECT org_id, doc_type, doc_id, attempts, last_error,
                resolved_at, payload
           FROM pdf_render_dlq
          WHERE doc_type = 'qc_cert' AND doc_id = $1
          ORDER BY failed_at DESC LIMIT 1`,
        [certId],
      ),
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({
      org_id: ORG_ID,
      doc_type: "qc_cert",
      doc_id: certId,
      attempts: 3,
      resolved_at: null,
    });
    expect(row.rows[0]!.last_error).toMatch(
      /Gate 39.4: terminal failure after 3 attempts/,
    );
    // Payload survived round-trip through jsonb.
    expect(row.rows[0]!.payload.docType).toBe("qc_cert");
    expect(row.rows[0]!.payload.docId).toBe(certId);

    // Separate smoke: the cert row is real — DLQ parked it, didn't
    // fabricate it. (Guards against the DLQ helper writing garbage
    // FK-less rows.)
    const certRow = await withOrg(pool, ORG_ID, async (c) =>
      c.query<{ cert_number: string }>(
        `SELECT cert_number FROM qc_certs WHERE id = $1`,
        [certId],
      ),
    );
    expect(certRow.rows[0]!.cert_number).toBe(certNumber);
  });
});
