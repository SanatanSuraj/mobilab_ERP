/**
 * qc_cert.issued → compliance.enqueuePdfRender
 *
 * ARCHITECTURE.md §3.1 + §4.1.
 *
 * The QC service (apps/api/src/modules/qc/certs.service.ts) writes a
 * qc_certs row + an outbox row in the same transaction when a certificate
 * is issued. This handler — one of potentially several on qc_cert.issued
 * — pushes a job into the pdf-render queue so the worker-pdf pipeline can
 * assemble the PDF and stream it to MinIO.
 *
 * Idempotency layering:
 *   - outbox.handler_runs       (this handler's slot, per outbox row)
 *   - BullMQ jobId              (stamped docType:docId — one queue slot
 *                                across re-deliveries of the same event)
 *   - pdf_render_runs           (claim row inside the processor; §4.1
 *                                short-circuits a completed render)
 * Any single layer would suffice for most retry shapes; we belt-and-brace
 * so a Redis flush, a handler_runs purge, or a manual outbox re-drive
 * still can't cause a duplicate upload to MinIO.
 *
 * Failure mode: if `ctx.clients.enqueuePdfRender` is missing (local dev
 * without the pdf-render worker wired up) we throw — it's better to fail
 * the outbox event loudly than silently skip compliance-critical PDF
 * generation. Tests that don't exercise this path should inject a no-op
 * enqueue or omit the qc_cert.issued event entirely.
 */

import type { EventHandler, QcCertIssuedPayload } from "./types.js";

export const enqueuePdfRender: EventHandler<QcCertIssuedPayload> = async (
  _client,
  payload,
  ctx,
) => {
  const enqueue = ctx.clients?.enqueuePdfRender;
  if (!enqueue) {
    throw new Error(
      "compliance.enqueuePdfRender: no enqueuePdfRender client injected — worker wiring missing",
    );
  }
  await enqueue({
    docType: "qc_cert",
    docId: payload.certId,
    orgId: payload.orgId,
  });
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      certId: payload.certId,
      certNumber: payload.certNumber,
    },
    "compliance.enqueuePdfRender: queued QC cert PDF render",
  );
};
