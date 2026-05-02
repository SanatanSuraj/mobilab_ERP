/**
 * vendor.password_reset.requested handler.
 *
 *   vendor.password_reset.requested → vendor.sendPasswordResetEmail
 *
 * Identical shape to user.password_reset.requested, but:
 *   - the URL points at /vendor-admin/reset-password (NOT /auth/reset-password)
 *   - the body wording reflects the vendor-console surface, so a staff
 *     member who got both flavours of email can tell which one to click
 */

import type { Mailer } from "../email/mailer.js";
import type { EventHandler } from "./types.js";

export interface VendorPasswordResetRequestedPayload {
  tokenId: string;
  vendorAdminId: string;
  recipient: string;
  rawToken: string;
  expiresAt: string;
}

interface HandlerEnv {
  webOrigin: string;
  mailer: Mailer;
  mailFrom: string;
  mailReplyTo: string | null;
}

export function makeSendVendorPasswordResetEmail(
  env: HandlerEnv,
): EventHandler<VendorPasswordResetRequestedPayload> {
  return async function sendVendorPasswordResetEmail(_client, payload, ctx) {
    const resetUrl = buildVendorResetUrl(env.webOrigin, payload.rawToken);
    const subject = "Reset your Instigenie Vendor Console password";
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
        vendorAdminId: payload.vendorAdminId,
        recipient: payload.recipient,
        send: result.kind,
        provider: result.provider,
        messageId: result.kind === "SENT" ? result.messageId : null,
      },
      "handler vendor.password_reset.requested → vendor.sendPasswordResetEmail",
    );
  };
}

function buildVendorResetUrl(webOrigin: string, rawToken: string): string {
  const url = new URL("/vendor-admin/reset-password", webOrigin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

function renderBody(args: { resetUrl: string; expiresAt: string }): string {
  return [
    `Hi,`,
    ``,
    `We received a request to reset your password for the Instigenie Vendor Console.`,
    ``,
    `Click the link below to choose a new password:`,
    args.resetUrl,
    ``,
    `This link expires at ${args.expiresAt} (1 hour from when it was`,
    `requested) and can only be used once.`,
    ``,
    `If you didn't ask for this, you can safely ignore this email — your`,
    `password won't change.`,
  ].join("\n");
}
