/**
 * Provider-agnostic mailer.
 *
 * Backend selection at construction time (in this priority):
 *   1. SMTP (Nodemailer) — if smtp deps provided. Use this when you want
 *      to send via Gmail/Workspace App Password, Mailgun SMTP, SES SMTP,
 *      etc. The "send to anyone without verifying a domain" path lives
 *      here (Gmail SMTP allows any recipient up to ~500/day).
 *   2. Resend HTTP API — if resendApiKey provided. Resend's sandbox
 *      requires domain verification before you can send to addresses
 *      other than the account's own.
 *   3. SKIPPED_DEV stub — if neither, or `emailDisabled=true`. Returns
 *      synchronously without touching the network. The handler still
 *      writes its audit row so devs can see what would've shipped.
 *
 * Provider name is preserved on the result so downstream logs and
 * `quotation_send_log` rows accurately attribute the send. Throws bubble
 * up to BullMQ for the standard exponential-backoff retry.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";

export interface SendMailInput {
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  /** Plain-text body — always required so clients that strip HTML still
   *  see the link. */
  text: string;
  /** Optional rich-text body. Provider serves whichever the client prefers. */
  html?: string;
  /** Optional PDF attachment. Only the quotation flow uses this today. */
  attachment?: {
    filename: string;
    content: Buffer;
    contentType: "application/pdf";
  };
}

export type SendMailResult =
  | {
      kind: "SENT";
      provider: "smtp" | "resend";
      messageId: string | null;
    }
  | {
      kind: "SKIPPED_DEV";
      provider: "stub";
    };

export interface Mailer {
  send(input: SendMailInput): Promise<SendMailResult>;
}

export interface SmtpDeps {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
}

export interface MailerDeps {
  /** When set, takes priority over Resend. */
  smtp: SmtpDeps | null;
  resendApiKey: string | null;
  emailDisabled: boolean;
}

export function createMailer(deps: MailerDeps): Mailer {
  if (deps.emailDisabled || (!deps.smtp && !deps.resendApiKey)) {
    return {
      async send(): Promise<SendMailResult> {
        return { kind: "SKIPPED_DEV", provider: "stub" };
      },
    };
  }

  if (deps.smtp) {
    return makeSmtpMailer(deps.smtp);
  }

  // deps.resendApiKey is non-null here by the early-return above.
  return makeResendMailer(deps.resendApiKey!);
}

function makeSmtpMailer(smtp: SmtpDeps): Mailer {
  // One transporter per process. Nodemailer pools connections internally.
  const transporter: Transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user && smtp.password
      ? { auth: { user: smtp.user, pass: smtp.password } }
      : {}),
  });

  return {
    async send(input: SendMailInput): Promise<SendMailResult> {
      try {
        const info = await transporter.sendMail({
          from: input.from,
          to: input.to,
          replyTo: input.replyTo ?? undefined,
          subject: input.subject,
          text: input.text,
          ...(input.html !== undefined ? { html: input.html } : {}),
          ...(input.attachment
            ? {
                attachments: [
                  {
                    filename: input.attachment.filename,
                    content: input.attachment.content,
                    contentType: input.attachment.contentType,
                  },
                ],
              }
            : {}),
        });
        return {
          kind: "SENT",
          provider: "smtp",
          messageId: info.messageId ?? null,
        };
      } catch (err) {
        // Surface the SMTP error verbatim so BullMQ's retry / failed-set
        // log captures the actual reason (auth, rate-limit, recipient
        // rejected, etc.). No special-casing here.
        const msg =
          err instanceof Error ? err.message : String(err);
        throw new Error(`smtp error: ${msg}`);
      }
    },
  };
}

function makeResendMailer(apiKey: string): Mailer {
  const client = new Resend(apiKey);
  return {
    async send(input: SendMailInput): Promise<SendMailResult> {
      const result = await client.emails.send({
        from: input.from,
        to: input.to,
        replyTo: input.replyTo ?? undefined,
        subject: input.subject,
        text: input.text,
        ...(input.html !== undefined ? { html: input.html } : {}),
        ...(input.attachment
          ? {
              attachments: [
                {
                  filename: input.attachment.filename,
                  content: input.attachment.content,
                },
              ],
            }
          : {}),
      });
      if (result.error) {
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
