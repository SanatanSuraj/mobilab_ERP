/**
 * Email body for a `quotation.sent` event.
 *
 * Pure data in → { subject, html, text } out. Keep both html and text
 * populated — inbox providers grade for a plain-text alternative.
 */

export interface QuotationSentTemplateInput {
  quotationNumber: string;
  company: string;
  contactName: string;
  validUntil: string | null;
  grandTotalDisplay: string;
  brandName: string;
}

export interface QuotationSentTemplateOutput {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderQuotationSentEmail(
  input: QuotationSentTemplateInput,
): QuotationSentTemplateOutput {
  const subject = `Quotation ${input.quotationNumber} from ${input.brandName}`;
  const firstName = input.contactName.split(" ")[0] ?? input.contactName;
  const validLine = input.validUntil
    ? `This quote is valid until ${input.validUntil}.`
    : "This quote has no expiry.";

  const text = [
    `Hi ${firstName},`,
    "",
    `Please find attached quotation ${input.quotationNumber} for ${input.company}.`,
    `Grand total: ${input.grandTotalDisplay}.`,
    validLine,
    "",
    `Reply to this email with any questions.`,
    "",
    `— ${input.brandName}`,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; color: #111; line-height: 1.5;">
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Please find attached quotation <strong>${escapeHtml(input.quotationNumber)}</strong>
       for ${escapeHtml(input.company)}.</p>
    <p>Grand total: <strong>${escapeHtml(input.grandTotalDisplay)}</strong>.<br>
       ${escapeHtml(validLine)}</p>
    <p>Reply to this email with any questions.</p>
    <p style="color:#666;">— ${escapeHtml(input.brandName)}</p>
  </body>
</html>`;

  return { subject, html, text };
}
