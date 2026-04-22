/**
 * Email queue processor.
 *
 * Consumes jobs routed from outbox-dispatch. For each `quotation.sent` job:
 *   1. Loads the quotation, its line items, and the contact email under
 *      the correct tenant GUC via withOrg().
 *   2. Renders the PDF via @react-pdf/renderer.
 *   3. Calls the mailer (Resend or dev stub).
 *   4. Appends a row to quotation_send_log.
 *
 * Any throw here is surfaced to BullMQ; the default exponential backoff
 * (5 attempts, 2s → 5m cap) gives transient provider outages room to clear.
 * After the final attempt the job lands in the failed set and the outbox
 * row stays marked dispatched — the send log row is the truth about
 * delivery outcome.
 */

import type { Processor } from "bullmq";
import type pg from "pg";
import { withOrg } from "@instigenie/db";
import type { Logger } from "@instigenie/observability";
import { jobsProcessedTotal } from "@instigenie/observability";
import type { Mailer } from "../email/mailer.js";
import { renderQuotationPdf } from "../email/pdf/quotation.js";
import type { QuotationPdfLineItem } from "../email/pdf/quotation.js";
import { renderQuotationSentEmail } from "../email/templates/quotation-sent.js";

export interface EmailJob {
  outboxId: string;
  aggregateType: string;
}

export interface EmailProcessorDeps {
  pool: pg.Pool;
  log: Logger;
  mailer: Mailer;
  mailFrom: string;
  mailReplyTo: string | null;
  brandName: string;
}

interface QuotationLoadRow {
  id: string;
  org_id: string;
  quotation_number: string;
  company: string;
  contact_name: string;
  contact_id: string | null;
  subtotal: string;
  tax_amount: string;
  grand_total: string;
  valid_until: Date | null;
  notes: string | null;
  version: number;
}

interface LineItemRow {
  product_code: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  discount_pct: string;
  tax_pct: string;
  line_total: string;
}

function toIsoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toLineItem(r: LineItemRow): QuotationPdfLineItem {
  return {
    productCode: r.product_code,
    productName: r.product_name,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    discountPct: r.discount_pct,
    taxPct: r.tax_pct,
    lineTotal: r.line_total,
  };
}

export function createEmailProcessor(
  deps: EmailProcessorDeps,
): Processor<EmailJob> {
  return async (job) => {
    if (job.name !== "quotation.sent") {
      // Unknown event on the email queue — log loudly, don't fail
      // (otherwise we'd retry 5× for something we can never handle).
      deps.log.warn(
        { jobName: job.name, outboxId: job.data.outboxId },
        "email processor received unknown event",
      );
      jobsProcessedTotal.inc({ queue: "email", status: "skipped" });
      return;
    }

    const { outboxId } = job.data;
    const { rows: evRows } = await deps.pool.query<{
      payload: { orgId?: string; quotationId?: string };
    }>(`SELECT payload FROM outbox.events WHERE id = $1`, [outboxId]);
    const ev = evRows[0];
    if (!ev) {
      deps.log.warn({ outboxId }, "outbox row vanished before email processing");
      jobsProcessedTotal.inc({ queue: "email", status: "skipped" });
      return;
    }
    const orgId = ev.payload.orgId;
    const quotationId = ev.payload.quotationId;
    if (!orgId || !quotationId) {
      throw new Error(
        `malformed quotation.sent payload: ${JSON.stringify(ev.payload)}`,
      );
    }

    await withOrg(deps.pool, orgId, async (client) => {
      const { rows: qRows } = await client.query<QuotationLoadRow>(
        `SELECT id, org_id, quotation_number, company, contact_name,
                contact_id, subtotal, tax_amount, grand_total,
                valid_until, notes, version
           FROM quotations
          WHERE id = $1 AND deleted_at IS NULL`,
        [quotationId],
      );
      const q = qRows[0];
      if (!q) {
        throw new Error(`quotation ${quotationId} not found for send`);
      }

      const { rows: liRows } = await client.query<LineItemRow>(
        `SELECT product_code, product_name, quantity, unit_price,
                discount_pct, tax_pct, line_total
           FROM quotation_line_items
          WHERE quotation_id = $1
          ORDER BY created_at ASC, id ASC`,
        [quotationId],
      );

      // Prefer the bound contact's email; fall back to the quotation's
      // denormalised contact_name (no email) — the mailer then skips with
      // status=FAILED so the UI can surface "no email on contact".
      let recipientEmail: string | null = null;
      if (q.contact_id) {
        const { rows: cRows } = await client.query<{ email: string | null }>(
          `SELECT email FROM contacts
            WHERE id = $1 AND deleted_at IS NULL`,
          [q.contact_id],
        );
        recipientEmail = cRows[0]?.email ?? null;
      }

      const validUntilIso = toIsoDate(q.valid_until);
      const pdfData = {
        quotationNumber: q.quotation_number,
        company: q.company,
        contactName: q.contact_name,
        validUntil: validUntilIso,
        notes: q.notes,
        subtotal: q.subtotal,
        taxAmount: q.tax_amount,
        grandTotal: q.grand_total,
        lineItems: liRows.map(toLineItem),
        brandName: deps.brandName,
      };
      const grandTotalDisplay = `₹ ${q.grand_total}`;

      const { subject, html, text } = renderQuotationSentEmail({
        quotationNumber: q.quotation_number,
        company: q.company,
        contactName: q.contact_name,
        validUntil: validUntilIso,
        grandTotalDisplay,
        brandName: deps.brandName,
      });

      if (!recipientEmail) {
        await client.query(
          `INSERT INTO quotation_send_log
             (org_id, quotation_id, quotation_version, status, subject,
              error_message)
           VALUES ($1, $2, $3, 'FAILED', $4, $5)`,
          [
            orgId,
            quotationId,
            q.version,
            subject,
            "contact has no email on file",
          ],
        );
        deps.log.warn(
          { quotationId, contactId: q.contact_id },
          "quotation send skipped — contact has no email",
        );
        jobsProcessedTotal.inc({ queue: "email", status: "failed" });
        return;
      }

      const pdf = await renderQuotationPdf(pdfData);

      try {
        const result = await deps.mailer.send({
          from: deps.mailFrom,
          to: recipientEmail,
          replyTo: deps.mailReplyTo,
          subject,
          text,
          html,
          attachment: {
            filename: `${q.quotation_number}.pdf`,
            content: pdf,
            contentType: "application/pdf",
          },
        });

        await client.query(
          `INSERT INTO quotation_send_log
             (org_id, quotation_id, quotation_version, status,
              recipient_email, subject, provider, provider_message_id,
              sent_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
          [
            orgId,
            quotationId,
            q.version,
            result.kind,
            recipientEmail,
            subject,
            result.provider,
            result.kind === "SENT" ? result.messageId : null,
          ],
        );
        deps.log.info(
          {
            quotationId,
            recipientEmail,
            status: result.kind,
            messageId: result.kind === "SENT" ? result.messageId : null,
          },
          "quotation email processed",
        );
        jobsProcessedTotal.inc({
          queue: "email",
          status: result.kind === "SENT" ? "completed" : "skipped",
        });
      } catch (err) {
        await client.query(
          `INSERT INTO quotation_send_log
             (org_id, quotation_id, quotation_version, status,
              recipient_email, subject, error_message)
           VALUES ($1, $2, $3, 'FAILED', $4, $5, $6)`,
          [
            orgId,
            quotationId,
            q.version,
            recipientEmail,
            subject,
            err instanceof Error ? err.message.slice(0, 2000) : String(err),
          ],
        );
        jobsProcessedTotal.inc({ queue: "email", status: "failed" });
        throw err;
      }
    });
  };
}
