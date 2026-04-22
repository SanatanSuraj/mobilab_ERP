/**
 * Thin Resend wrapper with a dev-safe stub.
 *
 * When `emailDisabled` is true (or no RESEND_API_KEY), `send()` returns a
 * SKIPPED_DEV result without touching the network. The processor still
 * writes a quotation_send_log row so developers see what would've shipped.
 *
 * We wrap Resend here (rather than at the call site) so retries, errors, and
 * the dev stub all live in one file. Everything above this layer treats
 * "sent mail" as an opaque side-effect.
 */

import { Resend } from "resend";

export interface SendMailInput {
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
  attachment: {
    filename: string;
    content: Buffer;
    contentType: "application/pdf";
  };
}

export type SendMailResult =
  | {
      kind: "SENT";
      provider: "resend";
      messageId: string | null;
    }
  | {
      kind: "SKIPPED_DEV";
      provider: "stub";
    };

export interface Mailer {
  send(input: SendMailInput): Promise<SendMailResult>;
}

export interface MailerDeps {
  resendApiKey: string | null;
  emailDisabled: boolean;
}

export function createMailer(deps: MailerDeps): Mailer {
  if (deps.emailDisabled || !deps.resendApiKey) {
    return {
      async send(): Promise<SendMailResult> {
        return { kind: "SKIPPED_DEV", provider: "stub" };
      },
    };
  }

  const client = new Resend(deps.resendApiKey);

  return {
    async send(input: SendMailInput): Promise<SendMailResult> {
      const result = await client.emails.send({
        from: input.from,
        to: input.to,
        replyTo: input.replyTo ?? undefined,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: [
          {
            filename: input.attachment.filename,
            content: input.attachment.content,
          },
        ],
      });
      if (result.error) {
        // Let BullMQ retry with the exponential backoff policy.
        throw new Error(
          `resend error: ${result.error.name} ${result.error.message}`,
        );
      }
      return {
        kind: "SENT",
        provider: "resend",
        messageId: result.data?.id ?? null,
      };
    },
  };
}
