/**
 * Single source of truth for queue names. Importing a queue by string literal
 * anywhere in the codebase is a lint error — use QueueNames instead.
 *
 * ARCHITECTURE.md §8. Phase 1 queues:
 *   - outbox-dispatch    — sends rows from outbox.events to the appropriate
 *                          destination queue or external hook.
 *   - email              — transactional email via SMTP / provider.
 *   - sms                — OTP + notifications via SMS provider.
 *   - scheduled-tasks    — cron / interval jobs (stats, reports).
 *
 * Phase 4 queues (§4.1, §4.2):
 *   - pdf-render         — renders React PDFs (QC cert, invoices, DCs, …)
 *                          and streams them to MinIO. Retries 3× at 60s
 *                          backoff; permanent failures land in
 *                          pdf_render_dlq.
 *   - audit-hashchain    — scheduled compliance sweep (§4.2). Walks every
 *                          org's qc_certs hash chain via verifyQcCertChain
 *                          and records the result into
 *                          qc_cert_chain_audit_runs. Any break increments
 *                          the `erp_audit_chain_break_total` Prometheus
 *                          counter which wires into the §10.3 CRITICAL
 *                          alert. Scheduled daily at 02:00 via
 *                          upsertJobScheduler (§6.5 — no OS cron, no
 *                          setInterval).
 */

export const QueueNames = {
  outboxDispatch: "outbox-dispatch",
  email: "email",
  sms: "sms",
  scheduledTasks: "scheduled-tasks",
  pdfRender: "pdf-render",
  auditHashchain: "audit-hashchain",
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];
