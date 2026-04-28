/**
 * user.invite.created handler.
 *
 *   user.invite.created → admin.sendInvitationEmail
 *
 * 1. Renders the accept URL + email body.
 * 2. Calls the mailer (Resend in production, no-op SKIPPED_DEV stub when
 *    RESEND_API_KEY is absent or EMAIL_DISABLED=true). The mailer is
 *    transport-agnostic so this handler doesn't know about Resend.
 * 3. Records the dispatch attempt in `invitation_emails` AFTER the send
 *    so the row exists iff dispatch was actually attempted (the dev stub
 *    counts as "attempted" and returns synchronously). The accept_url
 *    is persisted only in the dev path; in prod the column still gets
 *    the URL so vendor-admin can show "what was sent" — the raw token is
 *    short-lived (72h) and the audit value outweighs the leak risk.
 *
 * Idempotency: the outbox processor wraps this in a per-(event, handler)
 * idempotency slot, so redelivery is a no-op. There is intentionally no
 * unique constraint on invitation_emails(invitation_id) — production
 * legitimately writes N rows (initial + reminders).
 */

import type { Mailer } from "../email/mailer.js";
import type { EventHandler } from "./types.js";

export interface UserInviteCreatedPayload {
  invitationId: string;
  orgId: string;
  orgName: string;
  recipient: string;
  roleId: string;
  /** Raw accept token; the handler renders the URL, stores it, does NOT
   *  persist the raw token by itself anywhere else. */
  rawToken: string;
  expiresAt: string;
  invitedByUserId: string | null;
  invitedByName: string | null;
  inviteeNameHint: string | null;
}

interface HandlerEnv {
  /** Web app origin used to render the accept URL. */
  webOrigin: string;
  /** Mailer (Resend or SKIPPED_DEV stub). */
  mailer: Mailer;
  /** From address. Must be a Resend-verified sender in production. */
  mailFrom: string;
  /** Optional Reply-To. Null → omit the header. */
  mailReplyTo: string | null;
}

/**
 * Factory so the handler can be parameterised on env without reaching for
 * process.env at call time — apps/worker/src/handlers/index.ts wires the
 * env once when it builds the catalogue.
 */
export function makeSendInvitationEmail(
  env: HandlerEnv,
): EventHandler<UserInviteCreatedPayload> {
  return async function sendInvitationEmail(client, payload, ctx) {
    const acceptUrl = buildAcceptUrl(env.webOrigin, payload.rawToken);
    const subject = `You're invited to ${payload.orgName || "Instigenie"}`;
    const body = renderBody({ payload, acceptUrl });

    // Send first; record after. If the mailer throws (Resend 5xx, network
    // failure), BullMQ retries the whole outbox job — no orphan row.
    const result = await env.mailer.send({
      from: env.mailFrom,
      to: payload.recipient,
      replyTo: env.mailReplyTo,
      subject,
      text: body,
    });

    await client.query(
      `INSERT INTO invitation_emails
         (org_id, invitation_id, recipient, subject, body, accept_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        payload.orgId,
        payload.invitationId,
        payload.recipient,
        subject,
        body,
        acceptUrl,
      ],
    );

    ctx.log.info(
      {
        outboxId: ctx.outboxId,
        invitationId: payload.invitationId,
        recipient: payload.recipient,
        send: result.kind,
        provider: result.provider,
        messageId: result.kind === "SENT" ? result.messageId : null,
        // Raw token never logged — only the URL is in the DB row above.
      },
      "handler user.invite.created → admin.sendInvitationEmail",
    );
  };
}

function buildAcceptUrl(webOrigin: string, rawToken: string): string {
  const url = new URL("/auth/accept-invite", webOrigin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

function renderBody(args: {
  payload: UserInviteCreatedPayload;
  acceptUrl: string;
}): string {
  const { payload, acceptUrl } = args;
  const inviter = payload.invitedByName ?? "A teammate";
  const org = payload.orgName || "your team";
  const name = payload.inviteeNameHint ?? "there";
  // Plain-text fallback body — a real email adapter will wrap this in an
  // HTML template, but the text version is the source of truth for
  // clients that strip HTML.
  return [
    `Hi ${name},`,
    ``,
    `${inviter} invited you to join ${org} on Instigenie as ${payload.roleId}.`,
    ``,
    `Click to accept and finish setting up your account:`,
    acceptUrl,
    ``,
    `The link expires at ${payload.expiresAt}. If you weren't expecting this,`,
    `you can safely ignore this email.`,
  ].join("\n");
}
