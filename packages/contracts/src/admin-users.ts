/**
 * Admin-users: invitation flow contracts.
 *
 * Routes (apps/api/src/modules/admin-users):
 *   POST /admin/users/invite             — create invitation, queue email
 *   GET  /admin/users/invitations        — list pending invitations (admin)
 *   POST /admin/users/invitations/:id/revoke   — cancel a pending invite
 *   GET  /auth/accept-invite/preview     — look up invite by raw token
 *   POST /auth/accept-invite             — accept invite + set password
 *
 * All schemas live here so the web app, API, and worker stay aligned. Any
 * shape change goes through this file.
 */

import { z } from "zod";
import { ROLES } from "./roles.js";

// ─── Shared primitives ─────────────────────────────────────────────────────

/**
 * Raw invitation token (the value carried in the email URL). 32 random bytes
 * hex-encoded → 64 hex chars. The API stores `sha256(raw)` in token_hash, the
 * raw token never leaves the email.
 */
export const InviteTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "invalid invite token format");
export type InviteToken = z.infer<typeof InviteTokenSchema>;

/** Invitation status derived by the API from (accepted_at, expires_at). */
export const InvitationStatusSchema = z.enum([
  "PENDING",
  "EXPIRED",
  "ACCEPTED",
  "REVOKED",
]);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

// ─── POST /admin/users/invite ──────────────────────────────────────────────

export const InviteUserRequestSchema = z
  .object({
    /** Invited address. Lowercased server-side before lookup. */
    email: z.string().email().max(254),
    /** Role the new user will be granted when they accept. */
    roleId: z.enum(ROLES),
    /** Optional display-name hint shown on the accept-invite page. */
    name: z.string().trim().min(1).max(120).optional(),
    /**
     * TTL override in hours. Server clamps to [1, 168] (7 days). Default is
     * set server-side so the admin UI doesn't have to care.
     */
    expiresInHours: z.coerce.number().int().min(1).max(168).optional(),
  })
  .strict();
export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>;

export const InvitationSummarySchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
  roleId: z.enum(ROLES),
  /** `users.id` of the inviter's per-tenant profile. */
  invitedBy: z.string().uuid().nullable(),
  /** ISO8601. */
  expiresAt: z.string(),
  /** ISO8601 or null while the invite is open. */
  acceptedAt: z.string().nullable(),
  status: InvitationStatusSchema,
  createdAt: z.string(),
});
export type InvitationSummary = z.infer<typeof InvitationSummarySchema>;

export const InviteUserResponseSchema = z.object({
  invitation: InvitationSummarySchema,
  /**
   * Development-only. In non-production deployments the API returns the
   * accept URL directly so the dashboard can surface it for testing without
   * wiring SMTP. Production builds omit this field.
   */
  devAcceptUrl: z.string().url().optional(),
});
export type InviteUserResponse = z.infer<typeof InviteUserResponseSchema>;

// ─── GET /admin/users/invitations ──────────────────────────────────────────

export const ListInvitationsQuerySchema = z
  .object({
    /** Filter by status. Omit to include PENDING + EXPIRED (not ACCEPTED). */
    status: InvitationStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListInvitationsQuery = z.infer<typeof ListInvitationsQuerySchema>;

export const ListInvitationsResponseSchema = z.object({
  items: z.array(InvitationSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type ListInvitationsResponse = z.infer<
  typeof ListInvitationsResponseSchema
>;

// ─── GET /auth/accept-invite/preview ───────────────────────────────────────
//
// The accept-invite page hits this endpoint first to show the invited email
// + org name + role before the user picks a password. No JWT in play — the
// raw token is the authenticator.

export const AcceptInvitePreviewQuerySchema = z
  .object({
    token: InviteTokenSchema,
  })
  .strict();
export type AcceptInvitePreviewQuery = z.infer<
  typeof AcceptInvitePreviewQuerySchema
>;

export const AcceptInvitePreviewResponseSchema = z.object({
  email: z.string().email(),
  orgId: z.string().uuid(),
  orgName: z.string(),
  roleId: z.enum(ROLES),
  expiresAt: z.string(),
  /** Hint for the display-name field. Inviter's metadata.name, if any. */
  suggestedName: z.string().nullable(),
  /**
   * True if the invited email already has a user_identity. When true, the
   * accept flow will link the new membership to the existing identity and
   * the password field is disabled — the invitee signs in with their
   * existing password.
   */
  identityExists: z.boolean(),
});
export type AcceptInvitePreviewResponse = z.infer<
  typeof AcceptInvitePreviewResponseSchema
>;

// ─── POST /auth/accept-invite ──────────────────────────────────────────────

export const AcceptInviteRequestSchema = z
  .object({
    token: InviteTokenSchema,
    /** Display name the invitee wants on their profile. */
    name: z.string().trim().min(1).max(120),
    /**
     * New password. Only required when the identity is new (identityExists
     * false on the preview). Server rejects with a 400 if the identity
     * already exists and a password is supplied.
     */
    password: z.string().min(12).max(128).optional(),
  })
  .strict();
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>;

/**
 * Accept-invite response. We reuse the shape of the authenticated login
 * response so the client can drop the invitee straight into the dashboard
 * (sessionStorage access/refresh tokens + user context), skipping a round
 * trip through /auth/login.
 */
export const AcceptInviteResponseSchema = z.object({
  status: z.literal("authenticated"),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: z.object({
    id: z.string().uuid(),
    identityId: z.string().uuid(),
    orgId: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    roles: z.array(z.enum(ROLES)),
  }),
});
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;

// ─── Outbox payload ────────────────────────────────────────────────────────
//
// Emitted by the invite route, consumed by the worker handler
// `user-invite-created` which writes to invitation_emails (dev) or calls
// SMTP (prod). Lives here so contracts is the single source of truth.

export const UserInviteCreatedPayloadSchema = z.object({
  invitationId: z.string().uuid(),
  orgId: z.string().uuid(),
  orgName: z.string(),
  recipient: z.string().email(),
  roleId: z.enum(ROLES),
  /** Raw token — worker needs it to render the accept URL. */
  rawToken: InviteTokenSchema,
  expiresAt: z.string(),
  /** Per-tenant `users.id` of the inviter. May be null for system invites. */
  invitedByUserId: z.string().uuid().nullable(),
  invitedByName: z.string().nullable(),
  /** Optional display-name hint the inviter supplied. */
  inviteeNameHint: z.string().nullable(),
});
export type UserInviteCreatedPayload = z.infer<
  typeof UserInviteCreatedPayloadSchema
>;
