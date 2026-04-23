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
  type ObjectStorage,
} from "@instigenie/storage";
import { renderQcCertificatePdf } from "../pdf/qc-certificate.js";

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
      if (docType === "qc_cert") {
        ({ pdfBytes, objectKey } = await renderQcCert({
          pool: deps.pool,
          orgId,
          certId: docId,
          brandName,
        }));
      } else {
        throw new Error(
          `pdf-render: docType '${docType}' not implemented in Phase 4.1a`,
        );
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
        if (docType === "qc_cert") {
          await client.query(
            `UPDATE qc_certs SET pdf_minio_key = $2, updated_at = now()
             WHERE id = $1`,
            [docId, objectKey],
          );
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

interface AssembleInput {
  pool: pg.Pool;
  orgId: string;
  certId: string;
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
      [input.certId],
    );
    return cert ?? null;
  });
  if (!row) {
    throw new Error(`pdf-render: qc_cert ${input.certId} not found`);
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
  return { pdfBytes, objectKey: buildQcCertKey(input.orgId, input.certId) };
}
