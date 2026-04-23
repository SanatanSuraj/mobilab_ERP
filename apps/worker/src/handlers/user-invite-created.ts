/**
 * user.invite.created handler.
 *
 *   user.invite.created → admin.sendInvitationEmail
 *
 * Emits an invitation email. In dev (no SMTP adapter wired) we write a row
 * to `invitation_emails` so the accept URL + body is visible from a quick
 * SQL query and from the admin dashboard. In production, swap the table
 * insert for the transactional-email adapter call — the handler contract
 * and inputs are identical.
 *
 * Idempotency: the outbox processor wraps this in a per-(event, handler)
 * idempotency slot in the same txn as the INSERT, so redelivery collapses
 * to one mailbox row. The partial unique index on
 *   invitation_emails (invitation_id)
 * is not declared because there's legitimately N emails per invitation in
 * prod (initial + reminders). Dev just happens to write once because we
 * don't re-emit.
 */

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
}

/**
 * Factory so the handler can be parameterised on web-origin without
 * reaching for process.env at call time — apps/worker/src/index.ts wires
 * the env once when it builds the catalogue.
 */
export function makeSendInvitationEmail(
  env: HandlerEnv,
): EventHandler<UserInviteCreatedPayload> {
  return async function sendInvitationEmail(client, payload, ctx) {
    const acceptUrl = buildAcceptUrl(env.webOrigin, payload.rawToken);
    const subject = `You're invited to ${payload.orgName || "Instigenie"}`;
    const body = renderBody({ payload, acceptUrl });

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
        // Keep the raw token OUT of the log. The dev mailbox row holds
        // the URL; production's email adapter will strip `accept_url`
        // before persistence.
      },
      "handler user.invite.created → admin.sendInvitationEmail (dev mailbox row inserted)",
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
