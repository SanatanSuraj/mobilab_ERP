/**
 * user.password_reset.requested handler.
 *
 *   user.password_reset.requested → auth.sendPasswordResetEmail
 *
 * Mirrors the user-invite-created shape: render the URL, render the body,
 * call the mailer, log the result. NO DB row is written for the dispatch
 * itself — there's no `password_reset_emails` audit table, intentionally,
 * because the rate-limit + token-table already give us the operational
 * surface we need ("who requested how many resets when") without
 * surfacing the URL anywhere persistent. The raw token is in the
 * outgoing message body and never logged.
 *
 * Idempotency: the outbox processor wraps this in a per-(event, handler)
 * idempotency slot, so redelivery is a no-op in normal operation.
 */

import type { Mailer } from "../email/mailer.js";
import type { EventHandler } from "./types.js";

export interface UserPasswordResetRequestedPayload {
  tokenId: string;
  identityId: string;
  recipient: string;
  /** Raw reset token; rendered into the URL, never persisted by this handler. */
  rawToken: string;
  /** ISO-8601, used to print the human-readable expiry in the body. */
  expiresAt: string;
}

interface HandlerEnv {
  webOrigin: string;
  mailer: Mailer;
  mailFrom: string;
  mailReplyTo: string | null;
}

export function makeSendPasswordResetEmail(
  env: HandlerEnv,
): EventHandler<UserPasswordResetRequestedPayload> {
  return async function sendPasswordResetEmail(_client, payload, ctx) {
    const resetUrl = buildResetUrl(env.webOrigin, payload.rawToken);
    const subject = "Reset your Instigenie password";
    const body = renderBody({ resetUrl, expiresAt: payload.expiresAt });

    const result = await env.mailer.send({
      from: env.mailFrom,
      to: payload.recipient,
      replyTo: env.mailReplyTo,
      subject,
      text: body,
    });

    ctx.log.info(
      {
        outboxId: ctx.outboxId,
        tokenId: payload.tokenId,
        identityId: payload.identityId,
        recipient: payload.recipient,
        send: result.kind,
        provider: result.provider,
        messageId: result.kind === "SENT" ? result.messageId : null,
        // Raw token never logged — ctx.log includes payload only at debug,
        // which is off in prod. Belt-and-braces: omit explicitly.
      },
      "handler user.password_reset.requested → auth.sendPasswordResetEmail",
    );
  };
}

function buildResetUrl(webOrigin: string, rawToken: string): string {
  const url = new URL("/auth/reset-password", webOrigin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

function renderBody(args: { resetUrl: string; expiresAt: string }): string {
  return [
    `Hi,`,
    ``,
    `We received a request to reset your Instigenie password.`,
    ``,
    `Click the link below to choose a new password:`,
    args.resetUrl,
    ``,
    `This link expires at ${args.expiresAt} (1 hour from when it was`,
    `requested) and can only be used once.`,
    ``,
    `If you didn't ask for this, you can safely ignore this email — your`,
    `password won't change. Someone may have entered your address by mistake.`,
  ].join("\n");
}
